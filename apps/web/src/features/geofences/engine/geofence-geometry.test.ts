import { describe, expect, it } from "vitest";
import {
  geojsonToVertices,
  hasSelfIntersection,
  midpoint,
  pointInPolygon,
  polygonAreaM2,
  ringToGeoJSON,
  validateRing,
} from "./geofence-geometry";

const square = [
  { lat: 51.5, lng: -0.12 },
  { lat: 51.5, lng: -0.11 },
  { lat: 51.51, lng: -0.11 },
  { lat: 51.51, lng: -0.12 },
];

const bowtie = [
  { lat: 51.5, lng: -0.12 },
  { lat: 51.51, lng: -0.11 },
  { lat: 51.5, lng: -0.11 },
  { lat: 51.51, lng: -0.12 },
];

describe("geofence geometry", () => {
  it("round-trips vertices through GeoJSON with the ring closed once", () => {
    const json = ringToGeoJSON(square);
    const parsed = JSON.parse(json) as { coordinates: Array<Array<[number, number]>> };
    expect(parsed.coordinates[0]).toHaveLength(5);
    const restored = geojsonToVertices(json);
    expect(restored).toHaveLength(4);
    expect(restored[0]).toEqual(square[0]);
  });

  it("validates a simple ring and measures a plausible area", () => {
    const result = validateRing(square);
    expect(result.valid).toBe(true);
    expect(result.areaM2).toBeGreaterThan(100_000);
  });

  it("rejects self-intersection and too few vertices", () => {
    expect(hasSelfIntersection(bowtie)).toBe(true);
    expect(validateRing(bowtie).valid).toBe(false);
    expect(validateRing(square.slice(0, 2)).errors[0]).toContain("three vertices");
  });

  it("contains points inside the polygon and excludes outside points", () => {
    expect(pointInPolygon({ lat: 51.505, lng: -0.115 }, square)).toBe(true);
    expect(pointInPolygon({ lat: 51.6, lng: -0.1 }, square)).toBe(false);
  });

  it("computes midpoints and polygon area", () => {
    const mid = midpoint(square[0]!, square[2]!);
    expect(mid.lat).toBeCloseTo(51.505, 6);
    expect(mid.lng).toBeCloseTo(-0.115, 6);
    expect(polygonAreaM2(square)).toBeGreaterThan(0);
  });
});
