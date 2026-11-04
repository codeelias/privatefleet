/**
 * Engineering verification gate (deterministic runner).
 * Usage: node scripts/verify.mjs [--skip-build]
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

// Ensure the user-level pnpm shim is on PATH for the child shell.
if (process.env.APPDATA) {
  const npmDir = path.join(process.env.APPDATA, "npm");
  process.env.PATH = `${npmDir};${process.env.PATH ?? ""}`;
}

const skipBuild = process.argv.includes("--skip-build");

const steps = [
  ["contracts typecheck", "@privatefleet/contracts", ["typecheck"]],
  ["api typecheck", "@privatefleet/api", ["typecheck"]],
  ["api unit tests", "@privatefleet/api", ["test"]],
  ["web typecheck", "@privatefleet/web", ["typecheck"]],
  [
    "web unit tests",
    "@privatefleet/web",
    ["exec", "vitest", "run", "src/features/live-map/engine", "src/features/heads-up/engine", "src/features/geofences/engine"],
  ],
];

if (!skipBuild) {
  steps.push(["web build", "@privatefleet/web", ["build"]]);
}

for (const [name, pkg, args] of steps) {
  console.log(`== ${name} ==`);
  try {
    execFileSync("pnpm", ["--filter", pkg, ...args], { stdio: "inherit", shell: true });
  } catch (error) {
    console.error(`step failed: ${name}`);
    process.exit(1);
  }
}
console.log("verify gate: PASS");
