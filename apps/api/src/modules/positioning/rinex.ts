/**
 * RINEX station utility: extract the surveyed station coordinates and file
 * inventory from OS Net RINEX downloads. Stage-0 reference preparation.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface StationInfo {
  marker: string;
  approxXyz: [number, number, number];
  file: string;
  interval: string;
  obsTypes: number;
}

export function parseStationHeader(text: string, file: string): StationInfo {
  const marker = /([A-Z0-9]{4,9})\s+MARKER NAME/.exec(text)?.[1] ?? "unknown";
  const xyzMatch = /\s*(-?\d+\.\d+)\s+(-?\d+\.\d+)\s+(-?\d+\.\d+)\s+APPROX POSITION XYZ/.exec(text);
  const intervalMatch = /INTERVAL\s*$/m.exec(text);
  const obsCount = (text.match(/^\s+\d+\s{2}/gm) ?? []).length;
  return {
    marker,
    approxXyz: xyzMatch
      ? [Number(xyzMatch[1]), Number(xyzMatch[2]), Number(xyzMatch[3])]
      : [Number.NaN, Number.NaN, Number.NaN],
    file,
    interval: intervalMatch ? intervalMatch[0] : "unknown",
    obsTypes: obsCount,
  };
}

export function inventory(directory: string): StationInfo[] {
  const stations = new Map<string, StationInfo>();
  for (const name of readdirSync(directory)) {
    if (!name.endsWith(".rnx") || !name.includes("_S_")) continue;
    const text = readFileSync(join(directory, name), "utf8").slice(0, 4096);
    const info = parseStationHeader(text, name);
    stations.set(info.marker, info);
  }
  return [...stations.values()];
}
