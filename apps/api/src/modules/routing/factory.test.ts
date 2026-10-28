import { describe, expect, it } from "vitest";
import { createRoutingClients } from "./factory.js";
import { RoutingError } from "./types.js";

describe("routing client factory", () => {
  it("refuses to create live clients when either endpoint is missing", () => {
    expect(() => createRoutingClients({})).toThrow(RoutingError);
    expect(() => createRoutingClients({ osrmBaseUrl: "http://osrm.local" })).toThrow(
      /VROOM_BASE_URL/,
    );
    expect(() => createRoutingClients({ vroomBaseUrl: "http://vroom.local" })).toThrow(
      /OSRM_BASE_URL/,
    );
  });

  it("creates the validated provider pair when both are configured", () => {
    const clients = createRoutingClients({
      osrmBaseUrl: "http://osrm.local",
      vroomBaseUrl: "http://vroom.local",
    });
    expect(typeof clients.matrix).toBe("function");
    expect(typeof clients.route).toBe("function");
    expect(typeof clients.solve).toBe("function");
  });
});
