import { DEG, RAD, localFrame, latLonToXY, xyToPixel } from "../engine/geometry.js";
import { dot, localToLunar, MOON_RADIUS, normalize, surfaceAt } from "./coordinates.js";

export function interpolateEphemeris(ephem, manifest, timeMs) {
  const f = (timeMs - manifest.startUnixMs) / (manifest.stepSeconds * 1000);
  if (f < 0 || f > manifest.count - 1) throw new Error("The selected date is outside the SPICE ephemeris coverage.");
  const k = Math.min(manifest.count - 2, Math.floor(f)), w = f - k;
  const vector = (start) => [0, 1, 2].map((c) => ephem[k * 6 + start + c] * (1 - w) + ephem[(k + 1) * 6 + start + c] * w);
  return { sun: vector(0), earth: vector(3) };
}

export function topocentric(vectorKm, observerM, frame, radiusKm) {
  const vector = vectorKm.map((v, k) => v - observerM[k] / 1000);
  const distance = Math.hypot(...vector), unit = normalize(vector);
  const world = [dot(unit, frame.east), dot(unit, frame.up), -dot(unit, frame.north)];
  return { vector, world, distance, angularRadius: Math.asin(radiusKm / distance) };
}

export function azimuthElevation(vector, unitUp) {
  const [up, east, north] = localFrame(unitUp), v = normalize(vector);
  return { az: ((Math.atan2(dot(v, east), dot(v, north)) * DEG) + 360) % 360, el: Math.asin(Math.max(-1, Math.min(1, dot(v, up)))) * DEG };
}

export function regionalHorizon(data, lat, lon, az) {
  if (!data.horizon || !data.manifest.horizon) return null;
  const grid = data.manifest.grid, meta = data.manifest.horizon;
  const [x, y] = latLonToXY(grid, lat, lon), [row, col] = xyToPixel(grid, x, y);
  const r = Math.max(0, Math.min(grid.n - 1, Math.round(row))), c = Math.max(0, Math.min(grid.n - 1, Math.round(col)));
  const a = (((az % 360) + 360) % 360) / (360 / meta.bins), k = Math.floor(a), w = a - k, p = (r * grid.n + c) * meta.bins;
  return (data.horizon[p + k] * (1 - w) + data.horizon[p + (k + 1) % meta.bins] * w) * meta.scaleDeg + meta.offsetDeg;
}

export function nearHorizon(terrain, eye, worldDirection, unitUp) {
  const length = Math.hypot(worldDirection[0], worldDirection[2]);
  if (length < 1e-8) return -90;
  let maximum = -90;
  const dx = worldDirection[0] / length, dz = worldDirection[2] / length;
  const up = [dot(unitUp, terrain.frame.east), dot(unitUp, terrain.frame.up), -dot(unitUp, terrain.frame.north)];
  for (let distance = 2; distance < 1450; distance += Math.max(2, distance * 0.025)) {
    const x = eye.x + dx * distance, z = eye.z + dz * distance;
    const y = surfaceAt(terrain, x, z);
    if (!Number.isFinite(y)) break;
    const delta = [dx * distance, y - eye.y, dz * distance], d = Math.hypot(...delta);
    maximum = Math.max(maximum, Math.asin(dot(delta, up) / d) * DEG);
  }
  return maximum;
}

export function visibleDisc(elevation, horizon, angularRadius) {
  const q = (elevation - horizon) / (angularRadius * DEG);
  return q >= 1 ? 1 : q <= -1 ? 0 : 1 - (Math.acos(q) - q * Math.sqrt(1 - q * q)) / Math.PI;
}

export function celestialAt(data, skyData, terrain, eye, timeMs) {
  const point = localToLunar(terrain.frame, eye.x, eye.z);
  const observer = terrain.frame.up.map((u, k) => u * (MOON_RADIUS + terrain.anchorHeight + eye.y) + terrain.frame.east[k] * eye.x - terrain.frame.north[k] * eye.z);
  const vectors = interpolateEphemeris(skyData.ephem, skyData.manifest, timeMs);
  const result = { lat: point.lat, lon: point.lon, altitude: Math.hypot(...observer) - MOON_RADIUS, timeMs };
  for (const [key, radius] of [["sun", 695700], ["earth", 6378.1366]]) {
    const body = topocentric(vectors[key], observer, terrain.frame, radius);
    Object.assign(body, azimuthElevation(body.vector, point.unit));
    const far = regionalHorizon(data, point.lat, point.lon, body.az);
    body.horizon = Math.max(far ?? -90, nearHorizon(terrain, eye, body.world, point.unit));
    body.visibleFraction = visibleDisc(body.el, body.horizon, body.angularRadius);
    body.visible = key === "earth" ? body.el > body.horizon : body.visibleFraction > 0;
    body.remoteHorizonAvailable = far != null;
    result[key] = body;
  }
  return result;
}

export async function findSunlitTime(data, skyData, terrain, eye, current, fromMs, toMs, signal) {
  const hour = 3600000;
  // User-triggered search; the selected clock is never changed automatically.
  const intervals = [[Math.max(current, fromMs), toMs], [fromMs, Math.min(current, toMs)]];
  let checked = 0;
  for (const [from, to] of intervals) for (let time = from; time <= to; time += hour) {
    if (signal?.aborted) throw new DOMException("Search cancelled", "AbortError");
    const sky = celestialAt(data, skyData, terrain, eye, time);
    if (sky.sun.visibleFraction >= 0.99) return time;
    if (++checked % 48 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return null;
}
