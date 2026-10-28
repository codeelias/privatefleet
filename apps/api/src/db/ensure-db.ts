/**
 * Ensures the dev database is reachable. On Windows the database runs
 * in WSL, which shuts down when idle, so callers start the distro and
 * wait for the port before connecting. No-op on CI (Linux) where the
 * service is managed externally.
 */
import { spawnSync } from "node:child_process";
import net from "node:net";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function canConnect(url: string): Promise<boolean> {
  const parsed = new URL(url);
  const port = Number(parsed.port || 5432);
  const host = parsed.hostname;
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (ok: boolean): void => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1500);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

export async function ensureDatabase(url: string): Promise<void> {
  if (await canConnect(url)) {
    return;
  }
  if (process.platform === "win32") {
    const distro = process.env.WSL_DISTRO ?? "Ubuntu-24.04";
    spawnSync(
      "wsl",
      [
        "-d",
        distro,
        "-u",
        "root",
        "--",
        "bash",
        "-c",
        "pg_isready -q || (pg_ctlcluster 16 main start 2>/dev/null || service postgresql start); sleep 1",
      ],
      { stdio: "ignore", timeout: 90_000 },
    );
  }
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await canConnect(url)) {
      return;
    }
    await sleep(500);
  }
  throw new Error(
    `database unreachable at ${new URL(url).host}: is Postgres running? (pnpm db:up)`,
  );
}
