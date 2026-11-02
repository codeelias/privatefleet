/**
 * Single source of truth for map rendering sources (ADR-0010).
 *
 * The map UI (markers, routes, geofences, dispatch interactions) never
 * hardcodes a tile host or style URL: swapping providers is a config
 * change here, not a rewrite. Defaults use OpenFreeMap vector styles (free,
 * keyless, policy-compliant) with a CARTO raster fallback for sessions
 * without WebGL. OpenStreetMap's volunteer tile servers are NOT a default:
 * they block applications that do not follow their tile usage policy.
 *
 * Environment (all optional):
 *   VITE_MAP_ENGINE=vector|raster        default engine (default: raster)
 *   VITE_MAP_VECTOR_STYLE=<style.json>   primary vector style URL
 *   VITE_MAP_VECTOR_STYLE_NAME=<label>   label shown in the status chip
 *   VITE_MAP_VECTOR_FALLBACKS=<url,...>  retry chain after the primary
 *   VITE_MAP_RASTER_TILES=<template>     primary raster tile template
 *   VITE_MAP_RASTER_ATTRIBUTION=<html>   attribution for that raster
 *   VITE_MAP_RASTER_NAME=<label>         label shown in the status chip
 *   VITE_MAPTILER_KEY=<key>              enables MapTiler defaults
 */

export interface VectorStyle {
  url: string;
  name: string;
}

export interface RasterSource {
  url: string;
  attribution: string;
  name: string;
}

function env(name: string): string | undefined {
  const raw = (import.meta.env as Record<string, unknown>)[name];
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

function hostOf(url: string): string {
  try {
    return new URL(url.replace("{s}", "a")).hostname;
  } catch {
    return "map";
  }
}

const MAPTILER_KEY = env("VITE_MAPTILER_KEY") ?? "";
const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

/**
 * No external raster tiles are requested by default. OpenStreetMap's
 * volunteer tile servers prohibit application use, so the raster fallback is
 * a plain Leaflet surface (overlays still render) unless an operator
 * configures a licensed raster provider via VITE_MAP_RASTER_TILES.
 */
export const BLANK_RASTER: RasterSource = {
  url: "",
  attribution: "",
  name: "No external basemap",
};

export const OSM_RASTER: RasterSource = {
  url: "",
  attribution: "",
  name: "OpenStreetMap (disabled by default - volunteer tile policy)",
};

export const CARTO_RASTER: RasterSource = {
  url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  attribution: CARTO_ATTRIBUTION,
  name: "CARTO light",
};

export const MAPTILER_RASTER: RasterSource = {
  url: `https://api.maptiler.com/maps/basic-v2/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`,
  attribution: '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; OpenStreetMap contributors',
  name: "MapTiler basic",
};

function rasterFromEnv(): RasterSource | undefined {
  const url = env("VITE_MAP_RASTER_TILES");
  if (!url) {
    return undefined;
  }
  return {
    url,
    attribution: env("VITE_MAP_RASTER_ATTRIBUTION") ?? CARTO_ATTRIBUTION,
    name: env("VITE_MAP_RASTER_NAME") ?? hostOf(url),
  };
}

function vectorStylesFromEnv(): VectorStyle[] {
  const styles: VectorStyle[] = [];
  const primary = env("VITE_MAP_VECTOR_STYLE");
  if (primary) {
    styles.push({
      url: primary,
      name: env("VITE_MAP_VECTOR_STYLE_NAME") ?? hostOf(primary),
    });
  }
  const fallbacks = env("VITE_MAP_VECTOR_FALLBACKS");
  if (fallbacks) {
    for (const url of fallbacks.split(",").map((s) => s.trim()).filter(Boolean)) {
      styles.push({ url, name: hostOf(url) });
    }
  }
  return styles;
}

const configuredRaster = rasterFromEnv();
const configuredVector = vectorStylesFromEnv();

/** Primary raster source: explicit config, otherwise a tile-free surface. */
export const PRIMARY_RASTER: RasterSource =
  configuredRaster ?? BLANK_RASTER;

/** Raster fallback for sessions without WebGL: tile-free, overlays still work. */
export const RASTER_FALLBACK: RasterSource = BLANK_RASTER;

/**
 * Vector style chain: explicit config first, then the approved B2
 * defaults (MapTiler when a key exists, then OpenFreeMap bright/liberty).
 */
export const VECTOR_STYLES: VectorStyle[] = dedupe([
  ...configuredVector,
  ...(MAPTILER_KEY
    ? [
        {
          url: `https://api.maptiler.com/maps/basic-v2/style.json?key=${MAPTILER_KEY}`,
          name: "MapTiler basic",
        },
      ]
    : []),
  { url: "/map-style-night.json", name: "PrivateFleet Night" },
  { url: "https://tiles.openfreemap.org/styles/liberty", name: "OpenFreeMap liberty" },
  { url: "https://tiles.openfreemap.org/styles/bright", name: "OpenFreeMap bright" },
]);

/** Vector is the default: OpenFreeMap raster tiles do not exist. */
export const DEFAULT_ENGINE: "vector" | "raster" =
  env("VITE_MAP_ENGINE") === "raster" ? "raster" : "vector";

/** MapTiler answers 403 with a placeholder PNG, so validate before use. */
export function needsKeyPreflight(source: RasterSource): boolean {
  return hostOf(source.url).includes("maptiler");
}

function dedupe(styles: VectorStyle[]): VectorStyle[] {
  const seen = new Set<string>();
  return styles.filter((style) => {
    if (seen.has(style.url)) {
      return false;
    }
    seen.add(style.url);
    return true;
  });
}

