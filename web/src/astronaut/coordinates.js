import { DEG, RAD, latLonToXY, localFrame, xyToLatLon } from "../engine/geometry.js";

export const MOON_RADIUS = 1737400;
export const PATCH_SIZE = 1000;
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const normalize = (v) => { const length = Math.hypot(...v); return v.map((x) => x / length); };

// Right-handed Three.js frame: +X east, +Y up, -Z north. One unit = one meter.
export function makeFrame(lat, lon) {
  const u = [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)];
  const [up, east, north] = localFrame(u);
  return { up, east, north, lat, lon };
}

export function localToLunar(frame, x, z) {
  const unit = normalize(frame.up.map((value, k) => value + (frame.east[k] * x - frame.north[k] * z) / MOON_RADIUS));
  const lat = Math.asin(unit[2]) * DEG, lon = Math.atan2(unit[1], unit[0]) * DEG;
  const [px, py] = latLonToXY({ radiusM: MOON_RADIUS }, lat, lon);
  return { unit, lat, lon, px, py };
}

export function lunarToLocal(frame, lat, lon) {
  const u = makeFrame(lat, lon).up;
  const denominator = dot(u, frame.up);
  return [MOON_RADIUS * dot(u, frame.east) / denominator, -MOON_RADIUS * dot(u, frame.north) / denominator];
}

export function sampleRaster(raster, x, y) {
  const { origin, pixelSize, width, height, values, noData, scale = 1 } = raster;
  const col = (x - origin[0]) / pixelSize[0], row = (y - origin[1]) / pixelSize[1];
  if (col < 0 || row < 0 || col > width - 1 || row > height - 1) return NaN;
  const j = Math.min(width - 2, Math.floor(col)), i = Math.min(height - 2, Math.floor(row));
  const fx = col - j, fy = row - i;
  const samples = [values[i * width + j], values[i * width + j + 1], values[(i + 1) * width + j], values[(i + 1) * width + j + 1]];
  if (samples.some((v) => !Number.isFinite(v) || v === noData)) return NaN;
  return scale * ((1 - fy) * ((1 - fx) * samples[0] + fx * samples[1]) + fy * ((1 - fx) * samples[2] + fx * samples[3]));
}

// Samples the same two triangles used by the render mesh and Rapier collider.
export function surfaceAt(terrain, x, z) {
  const { segments, size = PATCH_SIZE, heights } = terrain;
  const col = (x / size + 0.5) * segments, row = (z / size + 0.5) * segments;
  if (col < 0 || row < 0 || col > segments || row > segments) return NaN;
  const j = Math.min(segments - 1, Math.floor(col)), i = Math.min(segments - 1, Math.floor(row));
  const fx = col - j, fy = row - i, n = segments + 1;
  const a = heights[i * n + j], b = heights[i * n + j + 1], c = heights[(i + 1) * n + j], d = heights[(i + 1) * n + j + 1];
  return fx + fy <= 1 ? a + fx * (b - a) + fy * (c - a) : d + (1 - fx) * (c - d) + (1 - fy) * (b - d);
}

export function buildTerrain(raster, lat, lon, { size = PATCH_SIZE, spacing = 5, anchorHeight } = {}) {
  const frame = makeFrame(lat, lon), center = localToLunar(frame, 0, 0);
  const baseHeight = anchorHeight ?? sampleRaster(raster, center.px, center.py);
  if (!Number.isFinite(baseHeight)) throw new Error("No valid elevation data at this location.");
  const segments = Math.ceil(size / spacing), n = segments + 1;
  const positions = new Float32Array(n * n * 3), heights = new Float32Array(n * n), uv = new Float32Array(n * n * 2);
  const indices = new Uint32Array(segments * segments * 6);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = (j / segments - 0.5) * size, z = (i / segments - 0.5) * size, p = i * n + j;
    const point = localToLunar(frame, x, z);
    const elevation = sampleRaster(raster, point.px, point.py);
    if (!Number.isFinite(elevation)) throw new Error("The complete 1 km region includes missing elevation data. Choose a point inside the DEM coverage.");
    const y = (MOON_RADIUS + elevation) * dot(point.unit, frame.up) - MOON_RADIUS - baseHeight;
    positions.set([x, y, z], p * 3); heights[p] = y; uv.set([j / segments, 1 - i / segments], p * 2);
    if (i < segments && j < segments) {
      const k = (i * segments + j) * 6, a = p, b = p + 1, c = p + n, d = c + 1;
      indices.set([a, c, b, b, c, d], k);
    }
  }
  return { positions, indices, uv, heights, segments, size, anchorHeight: baseHeight, frame, lat, lon };
}

export function seedAt(lat, lon) {
  const text = `${lat.toFixed(7)}:${lon.toFixed(7)}`;
  let seed = 2166136261;
  for (const char of text) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return seed >>> 0;
}

export function randomSeed(seed) {
  return () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export { xyToLatLon };
