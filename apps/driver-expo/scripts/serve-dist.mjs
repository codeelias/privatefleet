/**
 * Minimal static server for the exported Expo web bundle (single output).
 * Used by the Expo runtime acceptance test; not a production server.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const port = Number(process.env.PORT ?? 8080);
const root = join(process.cwd(), "dist");

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

createServer((req, res) => {
  const urlPath = (req.url ?? "/").split("?")[0] ?? "/";
  const safe = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  let file = join(root, safe === "/" ? "index.html" : safe);
  if (!existsSync(file) || statSync(file).isDirectory()) {
    file = join(root, "index.html"); // SPA fallback
  }
  if (!existsSync(file)) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () => {
  console.log(`expo web dist served at http://127.0.0.1:${port}`);
});
