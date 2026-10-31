import { describe, expect, it } from "vitest";
import { routeLegFeatures } from "./route-progress.js";
import type { RoutePathLike } from "./geo.js";

function route(overrides: Partial<RoutePathLike> = {}): RoutePathLike {
  return {
    vehicleId: "vehicle-1",
    driverId: "driver-1",
    points: [
      { latitude: 51.5, longitude: -0.12 },
      { latitude: 51.51, longitude: -0.11 },
      { latitude: 51.52, longitude: -0.1 },
    ],
    waypoints: [
      {
        id: "r:waypoint:0",
        sequence: 0,
        kind: "origin",
        location: { latitude: 51.5, longitude: -0.12 },
      },
      {
        id: "r:waypoint:1",
        sequence: 1,
        kind: "job_stop",
        jobStopId: "stop-1",
        location: { latitude: 51.51, longitude: -0.11 },
      },
      {
        id: "r:waypoint:2",
        sequence: 2,
        kind: "job_stop",
        jobStopId: "stop-2",
        location: { latitude: 51.52, longitude: -0.1 },
      },
    ],
    legs: [
      {
        id: "r:leg:0",
        sequence: 0,
        fromWaypointId: "r:waypoint:0",
        toWaypointId: "r:waypoint:1",
        points: [
          { latitude: 51.5, longitude: -0.12 },
          { latitude: 51.51, longitude: -0.11 },
        ],
        distanceM: 100,
        estimatedDurationS: 20,
      },
      {
        id: "r:leg:1",
        sequence: 1,
        fromWaypointId: "r:waypoint:1",
        toWaypointId: "r:waypoint:2",
        points: [
          { latitude: 51.51, longitude: -0.11 },
          { latitude: 51.52, longitude: -0.1 },
        ],
        distanceM: 100,
        estimatedDurationS: 20,
      },
    ],
    ...overrides,
  };
}

describe("route leg hierarchy", () => {
  it("marks the first outstanding stop as next and later legs remaining", () => {
    const features = routeLegFeatures([route()], new Map());
    expect(features.map((feature) => feature.properties.status)).toEqual(["next", "remaining"]);
    expect(features[0]?.properties.legId).toBe("r:leg:0");
    expect(features[0]?.geometry.coordinates).toHaveLength(2);
  });

  it("keeps completed stops completed even when an earlier stop is pending", () => {
    const statuses = new Map([
      ["stop-1", "pending"],
      ["stop-2", "completed"],
    ]);
    const features = routeLegFeatures([route()], statuses);
    expect(features.map((feature) => feature.properties.status)).toEqual(["next", "completed"]);
  });

  it("treats skipped and failed stops as exceptions, not completions", () => {
    const skipped = routeLegFeatures([route()], new Map([["stop-1", "skipped"]]));
    expect(skipped[0]?.properties.status).toBe("exception");
    expect(skipped[1]?.properties.status).toBe("next");
    const failed = routeLegFeatures([route()], new Map([["stop-1", "failed"]]));
    expect(failed[0]?.properties.status).toBe("exception");
  });

  it("never marks the destination leg completed from stop status alone", () => {
    const withDestination = route({
      waypoints: [
        ...route().waypoints!,
        {
          id: "r:waypoint:3",
          sequence: 3,
          kind: "destination",
          location: { latitude: 51.53, longitude: -0.09 },
        },
      ],
      legs: [
        ...route().legs!,
        {
          id: "r:leg:2",
          sequence: 2,
          fromWaypointId: "r:waypoint:2",
          toWaypointId: "r:waypoint:3",
          points: [
            { latitude: 51.52, longitude: -0.1 },
            { latitude: 51.53, longitude: -0.09 },
          ],
          distanceM: 100,
          estimatedDurationS: 20,
        },
      ],
    });
    const features = routeLegFeatures(
      [withDestination],
      new Map([
        ["stop-1", "completed"],
        ["stop-2", "completed"],
      ]),
    );
    expect(features[2]?.properties.status).toBe("remaining");
  });

  it("falls back to full geometry for legacy routes without legs", () => {
    const features = routeLegFeatures([route({ waypoints: [], legs: [] })], new Map());
    expect(features).toHaveLength(1);
    expect(features[0]?.properties.status).toBe("route");
    expect(features[0]?.geometry.coordinates).toHaveLength(3);
  });
});
