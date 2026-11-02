import { describe, expect, it } from "vitest";
import { OsrmClient } from "./osrm";

const points = [
  { latitude: 51.5, longitude: -0.12 },
  { latitude: 51.5, longitude: -0.11 },
];

function responseWithSteps() {
  return {
    code: "Ok",
    routes: [
      {
        distance: 800,
        duration: 100,
        geometry: {
          coordinates: [
            [-0.12, 51.5],
            [-0.115, 51.5],
            [-0.11, 51.5],
          ],
        },
        legs: [
          {
            distance: 800,
            duration: 100,
            steps: [
              {
                distance: 200,
                duration: 25,
                name: "High Street",
                maneuver: { type: "depart", location: [-0.12, 51.5] },
                geometry: {
                  coordinates: [
                    [-0.12, 51.5],
                    [-0.118, 51.5],
                  ],
                },
              },
              {
                distance: 600,
                duration: 75,
                name: "Market Road",
                maneuver: { type: "turn", modifier: "left", location: [-0.118, 51.5] },
                geometry: {
                  coordinates: [
                    [-0.118, 51.5],
                    [-0.11, 51.5],
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("OSRM adapter", () => {
  it("keeps turn-by-turn steps while assembling leg geometry", async () => {
    const client = new OsrmClient(
      "http://osrm",
      (async () => new Response(JSON.stringify(responseWithSteps()), { status: 200 })) as typeof fetch,
    );
    const route = await client.route(points);
    expect(route.legs).toHaveLength(1);
    expect(route.legs?.[0]?.steps).toHaveLength(2);
    expect(route.legs?.[0]?.steps?.[1]).toMatchObject({
      instruction: "Turn left onto Market Road",
      maneuver: "turn",
      modifier: "left",
      distanceMetres: 600,
      durationSeconds: 75,
    });
    expect(route.legs?.[0]?.steps?.[1]?.location).toEqual({ latitude: 51.5, longitude: -0.118 });
  });
});
