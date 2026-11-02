import { describe, expect, it } from "vitest";
import { navigationFor, formatNavigationDistance, formatNavigationEta } from "./navigation";

const route = {
  vehicleId: "v1",
  points: [
    { latitude: 51.5, longitude: -0.12 },
    { latitude: 51.5, longitude: -0.11 },
  ],
  legs: [
    {
      id: "l0",
      sequence: 0,
      fromWaypointId: "w0",
      toWaypointId: "w1",
      points: [
        { latitude: 51.5, longitude: -0.12 },
        { latitude: 51.5, longitude: -0.11 },
      ],
      distanceM: 690,
      estimatedDurationS: 120,
      steps: [
        { instruction: "Head east", maneuver: "depart", distanceM: 30, durationS: 10 },
        {
          instruction: "Turn left onto Main Street",
          maneuver: "turn",
          modifier: "left",
          roadName: "Main Street",
          distanceM: 20,
          durationS: 10,
        },
        { instruction: "Turn right onto Market Road", maneuver: "turn", modifier: "right", distanceM: 640, durationS: 100 },
      ],
    },
  ],
};

describe("navigation read model", () => {
  it("reports the next instruction and distance to the manoeuvre", () => {
    const navigation = navigationFor(route, { legIndex: 0, legProgressM: 10 }, Date.now());
    expect(navigation.nextManeuver?.instruction).toBe("Turn left onto Main Street");
    expect(navigation.nextManeuver?.distanceM).toBe(20);
    expect(navigation.hasInstructions).toBe(true);
  });

  it("reports remaining distance and a finite ETA", () => {
    const now = Date.parse("2026-11-02T10:00:00Z");
    const navigation = navigationFor(route, { legIndex: 0, legProgressM: 345 }, now);
    expect(navigation.remainingDistanceM).toBeGreaterThan(300);
    expect(navigation.remainingDurationS).toBeGreaterThan(30);
    expect(navigation.etaIso).toBe(new Date(now + navigation.remainingDurationS! * 1000).toISOString());
  });

  it("does not invent turn instructions for a legacy route without steps", () => {
    const { steps: _steps, ...legacyLeg } = route.legs[0]!;
    const legacy = { ...route, legs: [legacyLeg] };
    const navigation = navigationFor(legacy, { legIndex: 0, legProgressM: 10 }, Date.now());
    expect(navigation.hasInstructions).toBe(false);
    expect(navigation.nextManeuver).toBeNull();
  });

  it("formats distances and ETAs for the HUD", () => {
    expect(formatNavigationDistance(20)).toBe("20 m");
    expect(formatNavigationDistance(1234)).toBe("1.2 km");
    expect(formatNavigationEta(null)).toBe("-");
  });
});


