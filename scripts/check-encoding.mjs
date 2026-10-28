/**
 * Encoding guard: repository text files must be UTF-8 without BOM.
 * A BOM in package.json breaks Vite's PostCSS config loader (and other
 * JSON parsers), so this check is part of CI.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SKIP = new Set(["node_modules", ".git", "dist", ".turbo", "test-results", "playwright-report"]);
const EXTENSIONS = [".json", ".ts", ".tsx", ".js", ".mjs", ".css", ".md", ".yml", ".yaml", ".sql", ".ps1"];
const CHECK_ONLY = process.argv.includes("--check");

const offenders = [];
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full);
      continue;
    }
    if (!EXTENSIONS.some((ext) => entry.endsWith(ext))) continue;
    const bytes = readFileSync(full);
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      offenders.push(relative(ROOT, full));
      if (!CHECK_ONLY) {
        const text = bytes.subarray(3).toString("utf8");
        writeFileSync(full, text, "utf8");
      }
    }
  }
}
walk(ROOT);

if (offenders.length === 0) {
  console.log("encoding: clean (no BOMs)");
} else if (CHECK_ONLY) {
  console.error("encoding: BOM found in:", offenders.join(", "));
  process.exit(1);
} else {
  console.log("encoding: stripped BOM from:", offenders.join(", "));
}
