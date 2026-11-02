/**
 * Human-readable OSRM manoeuvre text. Kept separate from the HTTP adapter so
 * wording is consistent across live routing and metadata backfills.
 */
export interface ManeuverInput {
  type: string;
  modifier?: string;
  name?: string;
  exit?: number;
}

function direction(value: string | undefined): string {
  return value ? value.replaceAll("_", " ") : "";
}

export function formatManeuver(input: ManeuverInput): string {
  const type = input.type.toLowerCase().replaceAll("_", " ");
  const modifier = direction(input.modifier);
  const name = input.name?.trim();
  const onto = name ? ` onto ${name}` : "";
  const on = name ? ` on ${name}` : "";
  switch (type) {
    case "depart":
      return `Head ${modifier || "out"}${on}`;
    case "arrive":
      return "Arrive at destination";
    case "turn":
      return `Turn ${modifier || "ahead"}${onto}`;
    case "new name":
    case "continue":
      return `Continue ${modifier || "ahead"}${on}`;
    case "merge":
      return `Merge ${modifier || "ahead"}${onto}`;
    case "fork":
      return `Keep ${modifier || "ahead"}${name ? ` toward ${name}` : ""}`;
    case "end of road":
      return `At the end of the road, turn ${modifier || "ahead"}${onto}`;
    case "roundabout":
    case "rotary":
      return `At the roundabout, take exit ${input.exit ?? "?"}${onto}`;
    case "roundabout turn":
      return `At the roundabout, turn ${modifier || "ahead"}${onto}`;
    case "on ramp":
      return `Take the ramp${modifier ? ` ${modifier}` : ""}${onto}`;
    case "off ramp":
      return `Take the exit${modifier ? ` ${modifier}` : ""}${onto}`;
    case "use lane":
      return `Keep ${modifier || "ahead"}${on}`;
    case "notification":
      return name ? `Continue on ${name}` : "Continue";
    default:
      return `${type.charAt(0).toUpperCase() + type.slice(1)}${modifier ? ` ${modifier}` : ""}${onto}`;
  }
}
