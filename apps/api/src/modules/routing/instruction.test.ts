import { describe, expect, it } from "vitest";
import { formatManeuver } from "./instruction";

describe("manoeuvre wording", () => {
  it("turns a raw new-name step into a continue instruction", () => {
    expect(formatManeuver({ type: "new name", modifier: "straight", name: "Upper Tollington Park" })).toBe(
      "Continue straight on Upper Tollington Park",
    );
  });

  it("uses the road name for a turn", () => {
    expect(formatManeuver({ type: "turn", modifier: "left", name: "Market Road" })).toBe(
      "Turn left onto Market Road",
    );
  });

  it("includes the roundabout exit", () => {
    expect(
      formatManeuver({ type: "roundabout", exit: 2, name: "High Street" }),
    ).toBe("At the roundabout, take exit 2 onto High Street");
  });

  it("does not emit an empty instruction for arrive", () => {
    expect(formatManeuver({ type: "arrive" })).toBe("Arrive at destination");
  });
});
