/**
 * Delivery confidence (differentiator S2): a 0-100 score derived only from
 * verifiable signals. No invented inputs - every point traces to evidence
 * rows, a GPS stamp near the stop, the time window, or a structured failure.
 */
export interface ConfidenceInputs {
  photo: boolean;
  signature: boolean;
  gpsWithinTolerance: boolean;
  withinWindow: boolean;
  failureCode?: string | null;
}

export interface ConfidenceResult {
  score: number;
  factors: string[];
}

const PHOTO_POINTS = 30;
const SIGNATURE_POINTS = 30;
const GPS_POINTS = 25;
const WINDOW_POINTS = 15;

export function scoreDelivery(inputs: ConfidenceInputs): ConfidenceResult {
  if (inputs.failureCode) {
    return { score: 0, factors: [`failure:${inputs.failureCode}`] };
  }
  let score = 0;
  const factors: string[] = [];
  if (inputs.photo) {
    score += PHOTO_POINTS;
    factors.push("photo");
  }
  if (inputs.signature) {
    score += SIGNATURE_POINTS;
    factors.push("signature");
  }
  if (inputs.gpsWithinTolerance) {
    score += GPS_POINTS;
    factors.push("gps_at_stop");
  }
  if (inputs.withinWindow) {
    score += WINDOW_POINTS;
    factors.push("within_window");
  }
  return { score, factors };
}
