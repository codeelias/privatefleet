import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import postgres from "postgres";

const secrets = JSON.parse(readFileSync("C:/PrivateFleet/secrets/secrets.json", "utf8"));
const sql = postgres(`postgres://privatefleet:${secrets.owner}@127.0.0.1:5432/privatefleet`, { max: 1 });
const routes = await sql`
  SELECT id, vehicle_id, legs
  FROM routes
  WHERE status IN ('published', 'in_progress') AND legs IS NOT NULL
  ORDER BY vehicle_id
`;

mkdirSync("C:/PrivateFleet/logs", { recursive: true });
const backupPath = `C:/PrivateFleet/logs/route-legs-backup-${new Date().toISOString().replaceAll(":", "-")}.json`;
writeFileSync(backupPath, JSON.stringify(routes, null, 2));

const refresh = process.argv.includes("--refresh");

function formatManeuver(input) {
  const type = String(input.type ?? "continue").toLowerCase().replaceAll("_", " ");
  const modifier = input.modifier ? input.modifier.replaceAll("_", " ") : "";
  const name = input.name?.trim();
  const onto = name ? " onto " + name : "";
  const on = name ? " on " + name : "";
  switch (type) {
    case "depart": return "Head " + (modifier || "out") + on;
    case "arrive": return "Arrive at destination";
    case "turn": return "Turn " + (modifier || "ahead") + onto;
    case "new name":
    case "continue": return "Continue " + (modifier || "ahead") + on;
    case "merge": return "Merge " + (modifier || "ahead") + onto;
    case "fork": return "Keep " + (modifier || "ahead") + (name ? " toward " + name : "");
    case "end of road": return "At the end of the road, turn " + (modifier || "ahead") + onto;
    case "roundabout":
    case "rotary": return "At the roundabout, take exit " + (input.exit ?? "?") + onto;
    case "roundabout turn": return "At the roundabout, turn " + (modifier || "ahead") + onto;
    case "on ramp": return "Take the ramp" + (modifier ? " " + modifier : "") + onto;
    case "off ramp": return "Take the exit" + (modifier ? " " + modifier : "") + onto;
    case "use lane": return "Keep " + (modifier || "ahead") + on;
    case "notification": return name ? "Continue on " + name : "Continue";
    default: return type.charAt(0).toUpperCase() + type.slice(1) + (modifier ? " " + modifier : "") + onto;
  }
}

let updatedLegs = 0;
let skippedLegs = 0;
let updatedRoutes = 0;

for (const route of routes) {
  const legs = Array.isArray(route.legs) ? route.legs : [];
  let changed = false;
  for (const leg of legs) {
    if (!leg || !Array.isArray(leg.points) || leg.points.length < 2) { skippedLegs += 1; continue; }
    if (Array.isArray(leg.steps) && leg.steps.length > 0 && !refresh) continue;
    const from = leg.points[0];
    const to = leg.points[leg.points.length - 1];
    const url = `http://127.0.0.1:5000/route/v1/driving/${from.longitude},${from.latitude};${to.longitude},${to.latitude}?overview=false&steps=true&geometries=geojson`;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`OSRM ${response.status}`);
      const body = await response.json();
      const osrmLeg = body.routes?.[0]?.legs?.[0];
      if (!osrmLeg || !Array.isArray(osrmLeg.steps) || osrmLeg.steps.length === 0) { skippedLegs += 1; continue; }
      const distance = Number(osrmLeg.distance ?? 0);
      const stored = Number(leg.distanceM ?? 0);
      const tolerance = Math.max(100, stored * 0.25);
      if (Number.isFinite(stored) && Math.abs(distance - stored) > tolerance) { skippedLegs += 1; continue; }
      leg.steps = osrmLeg.steps.map((step) => {
        const type = step.maneuver?.type ?? "continue";
        const modifier = step.maneuver?.modifier;
        const name = step.name?.trim();
        const instruction = formatManeuver({ type, ...(modifier ? { modifier } : {}), ...(name ? { name } : {}), ...(step.maneuver?.exit !== undefined ? { exit: step.maneuver.exit } : {}) });
        const location = step.maneuver?.location;
        return {
          instruction: instruction.charAt(0).toUpperCase() + instruction.slice(1),
          maneuver: type,
          ...(modifier ? { modifier } : {}),
          ...(step.maneuver?.exit !== undefined ? { exit: step.maneuver.exit } : {}),
          ...(name ? { roadName: name } : {}),
          distanceM: Number(step.distance ?? 0),
          durationS: Number(step.duration ?? 0),
          ...(location ? { location: { latitude: location[1], longitude: location[0] } } : {}),
        };
      });
      updatedLegs += 1;
      changed = true;
    } catch {
      skippedLegs += 1;
    }
  }
  if (changed) {
    await sql`UPDATE routes SET legs = ${sql.json(legs)} WHERE id = ${route.id}`;
    updatedRoutes += 1;
  }
}
console.log(JSON.stringify({ backupPath, updatedRoutes, updatedLegs, skippedLegs }, null, 2));
await sql.end();
