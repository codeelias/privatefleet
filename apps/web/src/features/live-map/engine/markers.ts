/**
 * Canvas vehicle markers for large fleets (docs/17.10). Drawn with the same
 * projected coordinates as the DOM pins, so a canvas marker and a route
 * vertex share one projection frame. Pure drawing/hit-testing helpers are
 * separated from React and Leaflet for deterministic tests.
 */
export interface CanvasVehicle {
  id: string;
  driverId?: string | null;
  label: string;
  status: string;
  stale: boolean;
  selected: boolean;
  x: number;
  y: number;
}

export interface DrawOptions {
  radius?: number;
  devicePixelRatio?: number;
  width: number;
  height: number;
}

const COLOURS: Record<string, string> = {
  on_route: "#22C55E",
  maintenance: "#F59E0B",
  available: "#4F8CFF",
};

export function vehicleColour(status: string, stale: boolean): string {
  if (stale) {
    return "#64748B";
  }
  return COLOURS[status] ?? "#4F8CFF";
}

/** Initials from a driver name; falls back to the first two of the label. */
export function initials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  const letters = parts
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return letters || (label[0] ?? "?").toUpperCase();
}

export function drawVehicleLayer(
  ctx: CanvasRenderingContext2D,
  vehicles: CanvasVehicle[],
  options: DrawOptions,
): void {
  const radius = options.radius ?? 11;
  const dpr = options.devicePixelRatio ?? 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, options.width * dpr, options.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "700 9px system-ui, sans-serif";

  for (const vehicle of vehicles) {
    if (vehicle.selected) {
      ctx.beginPath();
      ctx.arc(vehicle.x, vehicle.y, radius + 4, 0, Math.PI * 2);
      ctx.strokeStyle = "#38BDF8";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    const sprite = getSprite(vehicle, radius, dpr);
    if (sprite) {
      // Cached circle + initials: one drawImage instead of arc/fill/stroke/text
      // per marker per frame (250 markers at 60 Hz spends the frame in text).
      ctx.drawImage(
        sprite,
        vehicle.x - radius - SPRITE_PAD,
        vehicle.y - radius - SPRITE_PAD,
        (radius + SPRITE_PAD) * 2,
        (radius + SPRITE_PAD) * 2,
      );
      continue;
    }
    ctx.beginPath();
    ctx.arc(vehicle.x, vehicle.y, radius, 0, Math.PI * 2);
    ctx.globalAlpha = vehicle.stale ? 0.55 : 1;
    ctx.fillStyle = vehicleColour(vehicle.status, vehicle.stale);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#0B1220";
    ctx.stroke();
    ctx.fillStyle = "#0B1220";
    ctx.fillText(initials(vehicle.label), vehicle.x, vehicle.y + 0.5);
  }
}

const SPRITE_PAD = 2;
const spriteCache = new Map<string, HTMLCanvasElement>();

/**
 * Offscreen sprite for one marker appearance. Rendered once per
 * label/status/staleness/DPR combination and reused across frames.
 * Returns null in non-DOM test environments (callers draw directly).
 */
function getSprite(
  vehicle: CanvasVehicle,
  radius: number,
  dpr: number,
): HTMLCanvasElement | null {
  if (typeof document === "undefined") {
    return null;
  }
  const key = `${vehicle.label}|${vehicle.status}|${vehicle.stale}|${radius}|${dpr}`;
  const cached = spriteCache.get(key);
  if (cached) {
    return cached;
  }
  const size = (radius + SPRITE_PAD) * 2 * dpr;
  const sprite = document.createElement("canvas");
  sprite.width = Math.ceil(size);
  sprite.height = Math.ceil(size);
  const ctx = sprite.getContext("2d");
  if (!ctx) {
    return null;
  }
  ctx.scale(dpr, dpr);
  const centre = radius + SPRITE_PAD;
  ctx.beginPath();
  ctx.arc(centre, centre, radius, 0, Math.PI * 2);
  ctx.globalAlpha = vehicle.stale ? 0.55 : 1;
  ctx.fillStyle = vehicleColour(vehicle.status, vehicle.stale);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#0B1220";
  ctx.stroke();
  ctx.fillStyle = "#0B1220";
  ctx.font = "700 9px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(initials(vehicle.label), centre, centre + 0.5);
  if (spriteCache.size > 1000) {
    spriteCache.clear();
  }
  spriteCache.set(key, sprite);
  return sprite;
}

/** Nearest marker within the hit radius (CSS pixels), or null. */
export function hitTest(
  vehicles: CanvasVehicle[],
  x: number,
  y: number,
  radius = 15,
): string | null {
  let bestId: string | null = null;
  let bestDistance = radius * radius;
  for (const vehicle of vehicles) {
    const dx = vehicle.x - x;
    const dy = vehicle.y - y;
    const distance = dx * dx + dy * dy;
    if (distance <= bestDistance) {
      bestDistance = distance;
      bestId = vehicle.id;
    }
  }
  return bestId;
}

