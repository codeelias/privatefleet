import { describe, expect, it } from "vitest";
import { toGeoJsonCoordinates, toLeafletLatLngs } from "./projection";

const london = { latitude: 51.5074, longitude: -0.1278 };

describe("coordinate order boundaries", () => {
  it("emits [longitude, latitude] for GeoJSON/OSRM sources", () => {
    const [coordinate] = toGeoJsonCoordinates([london]);
    expect(coordinate?.[0]).toBe(-0.1278);
    expect(coordinate?.[1]).toBe(51.5074);
  });

  it("emits [latitude, longitude] for Leaflet", () => {
    const [latLng] = toLeafletLatLngs([london]);
    expect(latLng?.[0]).toBe(51.5074);
    expect(latLng?.[1]).toBe(-0.1278);
  });

  it("keeps both orders consistent for the same point", () => {
    const points = [london, { latitude: 51.52, longitude: -0.1 }];
    const geo = toGeoJsonCoordinates(points);
    const leaf = toLeafletLatLngs(points);
    expect(leaf[0]?.[0]).toBe(geo[0]?.[1]);
    expect(leaf[0]?.[1]).toBe(geo[0]?.[0]);
  });
});
