/**
 * Protocol-faithful fake OSRM + VROOM service for acceptance tests: one
 * process serves /table, /route and the VROOM POST endpoint. No Docker.
 */
import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 4191);

function coordsFrom(pathname) {
  const match = pathname.match(/\/driving\/(.+)$/);
  if (!match) {
    return [];
  }
  return decodeURIComponent(match[1] ?? "")
    .split(";")
    .map((pair) => pair.split(",").map(Number));
}

function haversine(a, b) {
  const dLat = (b[1] - a[1]) * 110_540;
  const dLon = (b[0] - a[0]) * 111_320 * Math.cos((a[1] * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/health") {
    res.writeHead(200).end("ok");
    return;
  }
  if (req.method === "POST" && url.pathname === "/") {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      const shipments = body.shipments ?? [];
      const jobs = body.jobs ?? [];
      const vehicles = body.vehicles ?? [];
      const units = [
        ...shipments.map((shipment) => ({
          pickup: Number(shipment.pickup?.id),
          delivery: Number(shipment.delivery?.id),
        })),
        ...jobs.map((job) => ({ job: Number(job.id) })),
      ];
      // Fleet fixture: leave the last single-stop job explicitly unassigned so
      // the dispatcher UI always exercises the unassigned-work panel.
      const unassignedUnit = units.length > 0 && jobs.length > 0 ? units[units.length - 1] : null;
      const assignedUnits = unassignedUnit ? units.slice(0, -1) : units;
      let arrival = 60;
      const routes = vehicles.map((vehicle, vehicleIndex) => {
        const steps = [{ type: "start", id: 0 }];
        assignedUnits.forEach((unit, unitIndex) => {
          if (unitIndex % vehicles.length !== vehicleIndex) {
            return;
          }
          if (unit.job !== undefined) {
            steps.push({ type: "job", id: unit.job, arrival });
            arrival += 120;
          } else {
            steps.push(
              { type: "pickup", id: unit.pickup, arrival },
              { type: "delivery", id: unit.delivery, arrival: arrival + 60 },
            );
            arrival += 180;
          }
        });
        steps.push({ type: "end", id: 0 });
        return { vehicle: Number(vehicle.id), distance: 12_000, duration: 900, steps };
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          code: 0,
          unassigned: unassignedUnit
            ? [{ id: unassignedUnit.job, description: "MISSING_SKILL" }]
            : [],
          routes,
        }),
      );
    });
    return;
  }
  if (url.pathname.startsWith("/table")) {
    const coords = coordsFrom(url.pathname);
    const size = coords.length;
    const durations = Array.from({ length: size }, (_, row) =>
      Array.from({ length: size }, (_, column) => Math.abs(row - column) * 90),
    );
    const distances = durations.map((row) => row.map((seconds) => seconds * 9));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ code: "Ok", durations, distances }));
    return;
  }
  if (url.pathname.startsWith("/route")) {
    const coords = coordsFrom(url.pathname);
    let distance = 0;
    for (let index = 1; index < coords.length; index += 1) {
      distance += haversine(coords[index - 1], coords[index]);
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        code: "Ok",
        routes: [{ distance, duration: distance / 12, geometry: { coordinates: coords } }],
      }),
    );
    return;
  }
  res.writeHead(404).end();
});

server.on("error", (err) => console.error("fake-routing error", err));
server.listen(port, "127.0.0.1", () => {
  console.log(`fake routing (OSRM+VROOM) on http://127.0.0.1:${port}`);
});




