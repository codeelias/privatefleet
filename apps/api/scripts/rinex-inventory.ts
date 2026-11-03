/**
 * RINEX inventory CLI: prints surveyed stations found in the given directory.
 * usage: tsx scripts/rinex-inventory.ts <directory>
 */
import { inventory } from "../src/modules/positioning/rinex";

const dir = process.argv[2] ?? "C:/privatefleet/rinex";
for (const station of inventory(dir)) {
  console.log(
    `${station.marker}: ${station.file} xyz=(${station.approxXyz
      .map((v) => (Number.isFinite(v) ? v.toFixed(3) : "n/a"))
      .join(", ")}) obsTypes=${station.obsTypes}`,
  );
}
