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

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * Which way the Earth is turned, in the same Moon-fixed frame as the ephemeris:
 * its north pole, the point where the Greenwich meridian crosses the equator,
 * and the direction of the Sun as seen from the Earth (for its day side).
 * The ecliptic is taken as the plane through the Sun closest to the lunar
 * equator, which is right to within the Moon's 1.5° tilt.
 */
export function earthOrientation(vectors, timeMs) {
  const days = timeMs / 86400000 - 10957.5;                       // days from J2000.0
  const anomaly = (357.528 + 0.9856003 * days) * RAD;
  const sunLongitude = (280.460 + 0.9856474 * days + 1.915 * Math.sin(anomaly) + 0.020 * Math.sin(2 * anomaly)) * RAD;
  const toSun = normalize(vectors.sun.map((v, k) => v - vectors.earth[k]));
  const tilt = dot([0, 0, 1], toSun), eclipticNorth = normalize([0, 0, 1].map((v, k) => v - tilt * toSun[k])), ahead = cross(eclipticNorth, toSun);
  const along = (longitude) => toSun.map((v, k) => v * Math.cos(longitude - sunLongitude) + ahead[k] * Math.sin(longitude - sunLongitude));
  const obliquity = 23.4393 * RAD, equinox = along(0), quarter = along(Math.PI / 2);
  const north = quarter.map((v, k) => v * Math.sin(obliquity) + eclipticNorth[k] * Math.cos(obliquity));
  const sidereal = (280.46061837 + 360.98564736629 * days) * RAD, east = cross(north, equinox);
  const greenwich = equinox.map((v, k) => v * Math.cos(sidereal) + east[k] * Math.sin(sidereal));
  return { north, greenwich, toSun };
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
  // The Earth's attitude, turned into the local east / up / south frame of the scene.
  const frame = terrain.frame, local = (v) => [dot(v, frame.east), dot(v, frame.up), -dot(v, frame.north)];
  const attitude = earthOrientation(vectors, timeMs);
  result.earth.north = local(attitude.north); result.earth.greenwich = local(attitude.greenwich); result.earth.toSun = local(attitude.toSun);
  result.earth.litFraction = (1 + dot(attitude.toSun, normalize(result.earth.vector.map((v) => -v)))) / 2;
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
