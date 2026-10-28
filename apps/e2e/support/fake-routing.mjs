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
      const vehicleId = Number(body.vehicles?.[0]?.id ?? 0);
      const steps = [
        { type: "start", id: 0 },
        ...shipments.flatMap((shipment) => [
          { type: "pickup", id: Number(shipment.pickup?.id) },
          { type: "delivery", id: Number(shipment.delivery?.id) },
        ]),
        { type: "end", id: 0 },
      ];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          code: 0,
          unassigned: [],
          routes: [{ vehicle: vehicleId, distance: 12_000, duration: 900, steps }],
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




