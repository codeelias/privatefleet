/**
 * Pure geometry for the visual geofence editor. No Leaflet dependency so
 * validity, self-intersection, containment and area are unit-testable.
 */
export interface GeoLatLng {
  lat: number;
  lng: number;
}

export interface RingValidation {
  valid: boolean;
  errors: string[];
  areaM2: number;
}

const METRES_PER_DEG_LAT = 110_540;

function toMetres(point: GeoLatLng, reference: GeoLatLng): { x: number; y: number } {
  const latRad = (reference.lat * Math.PI) / 180;
  return {
    x: (point.lng - reference.lng) * 111_320 * Math.cos(latRad),
    y: (point.lat - reference.lat) * METRES_PER_DEG_LAT,
  };
}

export function ringToGeoJSON(vertices: GeoLatLng[]): string {
  const ring = vertices.map((point) => [Number(point.lng.toFixed(6)), Number(point.lat.toFixed(6))]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
    ring.push([first[0]!, first[1]!]);
  }
  return JSON.stringify({ type: "Polygon", coordinates: [ring] });
}

export function geojsonToVertices(geojson: string): GeoLatLng[] {
  try {
    const parsed = JSON.parse(geojson) as {
      type?: string;
      coordinates?: Array<Array<[number, number]>>;
    };
    const ring = parsed.type === "Polygon" ? parsed.coordinates?.[0] : undefined;
    if (!ring || ring.length < 3) return [];
    const points = ring.map(([lng, lat]) => ({ lat: Number(lat), lng: Number(lng) }));
    const first = points[0]!;
    const last = points[points.length - 1]!;
    if (first.lat === last.lat && first.lng === last.lng) points.pop();
    return points;
  } catch {
    return [];
  }
}

function orientation(a: GeoLatLng, b: GeoLatLng, c: GeoLatLng): number {
  return (b.lng - a.lng) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lng - a.lng);
}

function onSegment(a: GeoLatLng, b: GeoLatLng, c: GeoLatLng): boolean {
  return (
    Math.min(a.lat, b.lat) - 1e-9 <= c.lat &&
    c.lat <= Math.max(a.lat, b.lat) + 1e-9 &&
    Math.min(a.lng, b.lng) - 1e-9 <= c.lng &&
    c.lng <= Math.max(a.lng, b.lng) + 1e-9
  );
}

function segmentsIntersect(
  a: GeoLatLng,
  b: GeoLatLng,
  c: GeoLatLng,
  d: GeoLatLng,
): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (o1 === 0 && onSegment(a, b, c)) return true;
  if (o2 === 0 && onSegment(a, b, d)) return true;
  if (o3 === 0 && onSegment(c, d, a)) return true;
  if (o4 === 0 && onSegment(c, d, b)) return true;
  return o1 * o2 < 0 && o3 * o4 < 0;
}

export function hasSelfIntersection(vertices: GeoLatLng[]): boolean {
  const count = vertices.length;
  for (let i = 0; i < count; i += 1) {
    const a = vertices[i]!;
    const b = vertices[(i + 1) % count]!;
    for (let j = i + 1; j < count; j += 1) {
      if (j === i || (j + 1) % count === i || (i + 1) % count === j) continue;
      const c = vertices[j]!;
      const d = vertices[(j + 1) % count]!;
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

export function polygonAreaM2(vertices: GeoLatLng[]): number {
  if (vertices.length < 3) return 0;
  const projected = vertices.map((point) => toMetres(point, vertices[0]!));
  let sum = 0;
  for (let i = 0; i < projected.length; i += 1) {
    const current = projected[i]!;
    const next = projected[(i + 1) % projected.length]!;
    sum += current.x * next.y - next.x * current.y;
  }
  return Math.abs(sum / 2);
}

export function validateRing(vertices: GeoLatLng[]): RingValidation {
  const errors: string[] = [];
  if (vertices.length < 3) {
    errors.push("A fence needs at least three vertices.");
    return { valid: false, errors, areaM2: 0 };
  }
  const unique = new Set(vertices.map((point) => `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`));
  if (unique.size !== vertices.length) {
    errors.push("Two vertices are on the same point.");
  }
  if (hasSelfIntersection(vertices)) {
    errors.push("The boundary crosses itself. Drag a vertex until the shape no longer overlaps.");
  }
  const areaM2 = polygonAreaM2(vertices);
  if (areaM2 < 100) {
    errors.push("The fence is too small (under 100 square metres).");
  }
  return { valid: errors.length === 0, errors, areaM2 };
}

export function pointInPolygon(point: GeoLatLng, vertices: GeoLatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i, i += 1) {
    const current = vertices[i]!;
    const previous = vertices[j]!;
    const intersects =
      current.lat > point.lat !== previous.lat > point.lat &&
      point.lng <
        ((previous.lng - current.lng) * (point.lat - current.lat)) /
          (previous.lat - current.lat) +
          current.lng;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function midpoint(a: GeoLatLng, b: GeoLatLng): GeoLatLng {
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
}
