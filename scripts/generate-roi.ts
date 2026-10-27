/**
 * Leave-behind ROI generator (docs/14.2c): computes a one-page summary
 * from a prospect's baseline metrics. Every assumption is printed on
 * the page - figures derive from the inputs, never invented (docs/01.4).
 *
 * Usage:
 *   pnpm roi                                      (defaults -> scripts/output/roi-leave-behind.md)
 *   pnpm roi -- --drivers=12 --stops-per-day=80 --hourly-rate=25 --out=roi.md
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

interface RoiInputs {
  drivers: number;
  stopsPerDay: number;
  minutesSavedPerDriver: number;
  hourlyRate: number;
  workingDaysPerYear: number;
  premiumPerStop: number;
  companyName: string;
}

const DEFAULTS: RoiInputs = {
  drivers: 10,
  stopsPerDay: 60,
  minutesSavedPerDriver: 15,
  hourlyRate: 20,
  workingDaysPerYear: 240,
  premiumPerStop: 1,
  companyName: "[Prospect company]",
};

function parseArgs(argv: string[]): RoiInputs {
  const inputs = { ...DEFAULTS };
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.+)$/.exec(arg);
    if (!match) {
      continue;
    }
    const [, key, raw] = match;
    if (key === "out") {
      continue; // handled in main()
    }
    if (key === "company") {
      inputs.companyName = raw;
      continue;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      continue;
    }
    if (key === "drivers") inputs.drivers = value;
    if (key === "stops-per-day") inputs.stopsPerDay = value;
    if (key === "minutes-saved-per-driver") inputs.minutesSavedPerDriver = value;
    if (key === "hourly-rate") inputs.hourlyRate = value;
    if (key === "working-days") inputs.workingDaysPerYear = value;
    if (key === "premium-per-stop") inputs.premiumPerStop = value;
  }
  return inputs;
}

interface RoiResult {
  hoursSavedPerDay: number;
  timeSavingPerYear: number;
  premiumPerYear: number;
  totalPerYear: number;
}

function compute(inputs: RoiInputs): RoiResult {
  const hoursSavedPerDay = (inputs.drivers * inputs.minutesSavedPerDriver) / 60;
  const timeSavingPerYear =
    hoursSavedPerDay * inputs.hourlyRate * inputs.workingDaysPerYear;
  const premiumPerYear =
    inputs.stopsPerDay * inputs.premiumPerStop * inputs.workingDaysPerYear;
  return {
    hoursSavedPerDay,
    timeSavingPerYear,
    premiumPerYear,
    totalPerYear: timeSavingPerYear + premiumPerYear,
  };
}

const gbp = (n: number): string =>
  `GBP ${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;

function render(inputs: RoiInputs, r: RoiResult): string {
  return [
    `# ${inputs.companyName} - Operational ROI summary`,
    "",
    "*Prepared from your baseline inputs. All assumptions are shown - this is an estimate, not a guarantee.*",
    "",
    "## Your inputs",
    "",
    `| Assumption | Value |`,
    `|---|---|`,
    `| Drivers | ${inputs.drivers} |`,
    `| Stops per day | ${inputs.stopsPerDay} |`,
    `| Minutes saved per driver per day | ${inputs.minutesSavedPerDriver} |`,
    `| Loaded hourly cost | ${gbp(inputs.hourlyRate)} |`,
    `| Working days per year | ${inputs.workingDaysPerYear} |`,
    `| Premium per branded delivery | ${gbp(inputs.premiumPerStop)} |`,
    "",
    "## The two levers",
    "",
    `1. **Dispatcher time saved:** ${r.hoursSavedPerDay.toFixed(1)} hours per day recovered - **${gbp(r.timeSavingPerYear)} per year**.`,
    `2. **Brand premium:** sending a branded tracking link with every stop - **${gbp(r.premiumPerYear)} per year**.`,
    "",
    `## Total estimated annual value: ${gbp(r.totalPerYear)}`,
    "",
    "The platform pays for itself when the recovered dispatcher time alone covers the licence.",
    "",
  ].join("\n");
}

function main(): void {
  const args = process.argv.slice(2);
  const inputs = parseArgs(args);
  const result = compute(inputs);
  const outArg = args.find((a) => a.startsWith("--out="));
  const outPath = resolve(outArg ? outArg.slice("--out=".length) : "scripts/output/roi-leave-behind.md");
  const content = render(inputs, result);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, content, "utf8");
  console.log(`ROI summary written to ${outPath}`);
  console.log(`Total estimated annual value: ${gbp(result.totalPerYear)}`);
}

main();
