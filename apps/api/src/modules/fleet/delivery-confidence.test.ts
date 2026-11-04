import { describe, expect, it } from "vitest";
import { scoreDelivery } from "./delivery-confidence.js";

describe("delivery confidence", () => {
  it("scores perfect evidence at 100", () => {
    const result = scoreDelivery({
      photo: true,
      signature: true,
      gpsWithinTolerance: true,
      withinWindow: true,
    });
    expect(result.score).toBe(100);
    expect(result.factors).toEqual(["photo", "signature", "gps_at_stop", "within_window"]);
  });

  it("scores a structured failure at 0", () => {
    const result = scoreDelivery({
      photo: true,
      signature: false,
      gpsWithinTolerance: true,
      withinWindow: false,
      failureCode: "recipient_unavailable",
    });
    expect(result.score).toBe(0);
    expect(result.factors).toEqual(["failure:recipient_unavailable"]);
  });

  it("weights missing signals proportionally", () => {
    const result = scoreDelivery({
      photo: true,
      signature: false,
      gpsWithinTolerance: true,
      withinWindow: false,
    });
    expect(result.score).toBe(55);
  });
});
