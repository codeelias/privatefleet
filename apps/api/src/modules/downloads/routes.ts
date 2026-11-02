/**
 * Internal native release channel. The APK and manifest are served only on
 * the tailnet-facing API origin; this is an update check, not silent install.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";

const ALLOWED = new Set(["latest.json", "app-release.apk"]);

function releaseDir(): string {
  return process.env.NATIVE_RELEASE_DIR
    ? path.resolve(process.env.NATIVE_RELEASE_DIR)
    : path.resolve(process.cwd(), "../../downloads/native");
}

export function registerNativeReleaseRoutes(app: FastifyInstance): void {
  app.get("/downloads/native/:file", async (request, reply) => {
    const params = request.params as { file?: string };
    const file = params.file ?? "";
    if (!ALLOWED.has(file)) {
      return reply.status(404).send({ error: "NOT_FOUND" });
    }
    try {
      const body = await readFile(path.join(releaseDir(), file));
      reply.header(
        "cache-control",
        file.endsWith(".json") ? "no-store" : "public, max-age=31536000, immutable",
      );
      reply.type(file.endsWith(".json") ? "application/json" : "application/vnd.android.package-archive");
      return reply.send(body);
    } catch {
      return reply.status(404).send({
        error: "RELEASE_NOT_AVAILABLE",
        detail: "The internal release channel has no artifact for this request.",
      });
    }
  });
}
