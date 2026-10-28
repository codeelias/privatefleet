#!/usr/bin/env node
/**
 * Pull a Linux/amd64 image from Docker Hub without the Docker CLI and
 * write a docker-archive tar that `docker load` accepts. Used on hosts
 * where the Docker credential helper is unreachable from an SSH session.
 *
 * All registry traffic goes through curl (retries) because large blobs and
 * even small configs reset over Node fetch on this network.
 *
 * Usage: node scripts/registry-pull.mjs <repo:tag> <out.tar> [layout-dir]
 */
import {
  appendFileSync,
  createReadStream,
  createWriteStream,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { execFileSync } from "node:child_process";

const [imageRef, outFile, layoutArg] = process.argv.slice(2);
if (!imageRef || !outFile) {
  console.error("usage: node scripts/registry-pull.mjs <repo:tag> <out.tar> [layout-dir]");
  process.exit(2);
}
const [repoRaw, tag = "latest"] = imageRef.split(":");
const repo = repoRaw.includes("/") ? repoRaw : `library/${repoRaw}`;
const registryBase = process.env.REGISTRY ?? "https://registry-1.docker.io";
const anonymous = Boolean(process.env.REGISTRY);
const layout = layoutArg ?? `${outFile}.layout`;
rmSync(layout, { recursive: true, force: true });
mkdirSync(layout, { recursive: true });
mkdirSync(dirname(outFile), { recursive: true });

function curl(args) {
  try {
    return execFileSync(
      "curl",
      ["-fsSL", "--ssl-no-revoke", "--retry", "12", "--retry-all-errors", "--retry-delay", "1", ...args],
      { maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (err) {
    const stderr = err && typeof err === "object" && "stderr" in err ? String(err.stderr) : "";
    throw new Error(`curl failed (${args[args.length - 1]}): ${stderr || err.message}`);
  }
}

const token = anonymous
  ? ""
  : JSON.parse(
      curl([
        "https://auth.docker.io/token?service=registry.docker.io&scope=repository:" +
          repo +
          ":pull",
      ]).toString("utf8"),
    ).token;
const authHeaders = token ? ["-H", `Authorization: Bearer ${token}`] : [];

function registryText(path, accept) {
  return curl([
    ...authHeaders,
    ...(accept ? ["-H", `Accept: ${accept}`] : []),
    `${registryBase}/v2/${repo}/${path}`,
  ]).toString("utf8");
}

function registryFile(path, out) {
  curl([...authHeaders, "-o", out, `${registryBase}/v2/${repo}/${path}`]);
}

const manifestList = JSON.parse(
  registryText(
    "manifests/" + tag,
    [
      "application/vnd.docker.distribution.manifest.list.v2+json",
      "application/vnd.oci.image.index.v1+json",
      "application/vnd.docker.distribution.manifest.v2+json",
    ].join(", "),
  ),
);

let manifest = manifestList;
if (manifestList.manifests) {
  const amd64 = manifestList.manifests.find(
    (entry) =>
      entry.platform?.architecture === "amd64" &&
      entry.platform?.os === "linux" &&
      entry.platform?.variant !== "v5",
  );
  if (!amd64) {
    throw new Error("no linux/amd64 manifest");
  }
  manifest = JSON.parse(
    registryText(
      `manifests/${amd64.digest}`,
      "application/vnd.docker.distribution.manifest.v2+json",
    ),
  );
}

const configHex = manifest.config.digest.replace("sha256:", "");
const configPath = join(layout, `${configHex}.json`);
registryFile(`blobs/${manifest.config.digest}`, configPath);

function downloadBlob(digest, out, expectedSize) {
  const url = `${registryBase}/v2/${repo}/blobs/${digest}`;
  const chunkSize = 1024 * 1024;
  let offset = 0;
  rmSync(out, { force: true });
  while (offset < expectedSize) {
    const end = Math.min(expectedSize - 1, offset + chunkSize - 1);
    const part = `${out}.part`;
    rmSync(part, { force: true });
    curl([...authHeaders, "-r", `${offset}-${end}`, "-o", part, url]);
    const requested = end - offset + 1;
    const received = statSync(part).size;
    if (received === 0) {
      throw new Error(`empty range ${offset}-${end}`);
    }
    appendFileSync(out, readFileSync(part));
    rmSync(part, { force: true });
    offset += received;
    if (received > requested) {
      // Server ignored Range and returned the whole blob.
      offset = expectedSize;
    }
    console.log(`  ${digest.slice(0, 12)} ${Math.min(offset, expectedSize)}/${expectedSize}`);
  }
}
const layerPaths = [];
for (const layer of manifest.layers) {
  const hex = layer.digest.replace("sha256:", "");
  const dir = join(layout, hex);
  mkdirSync(dir, { recursive: true });
  const probePath = join(layout, `${hex}.blob`);
  downloadBlob(layer.digest, probePath, layer.size ?? 0);
  try {
    await pipeline(
      createReadStream(probePath),
      createGunzip(),
      createWriteStream(join(dir, "layer.tar")),
    );
  } catch {
    await pipeline(createReadStream(probePath), createWriteStream(join(dir, "layer.tar")));
  }
  rmSync(probePath, { force: true });
  layerPaths.push(`${hex}/layer.tar`);
  console.log(`layer ${hex.slice(0, 12)} ok`);
}

writeFileSync(
  join(layout, "manifest.json"),
  JSON.stringify([
    {
      Config: `${configHex}.json`,
      RepoTags: [`${repo}:${tag}`],
      Layers: layerPaths,
    },
  ]),
);
writeFileSync(join(layout, "repositories"), "{}");
execFileSync("tar", ["-cf", outFile, "-C", layout, "."], { stdio: "inherit" });
rmSync(layout, { recursive: true, force: true });
console.log(`wrote ${outFile}`);






