import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildTerrain, dot, localToLunar, lunarToLocal, makeFrame, MOON_RADIUS, randomSeed, sampleRaster, seedAt, surfaceAt } from "./coordinates.js";
import { azimuthElevation, celestialAt, findSunlitTime, interpolateEphemeris, topocentric, visibleDisc } from "./CelestialPosition.js";
import { initPhysics, LunarPhysics, EYE_HEIGHT, LUNAR_GRAVITY } from "./LunarPhysics.js";
import { coarseTileIndices } from "./TerrainLOD.js";
import { buildTerrainContext } from "./TerrainContext.js";

const near = (a, b, epsilon = 1e-5) => assert.ok(Math.abs(a - b) < epsilon, `${a} differs from ${b}`);
const raster = { origin: [-2000, 2000], pixelSize: [10, -10], width: 401, height: 401, noData: -9999, values: new Float32Array(401 * 401).fill(100) };
const flat = () => buildTerrain(raster, -90, 0, { spacing: 10 });

test("Lunar ENU is right handed and preserves east/north without an Earth datum", () => {
  const frame = makeFrame(-86.86, 338.14);
  near(dot(frame.east, frame.north), 0); near(dot(frame.up, frame.north), 0);
  for (const [x, z] of [[500, 0], [0, -500], [-500, 500]]) {
    const p = localToLunar(frame, x, z), actual = lunarToLocal(frame, p.lat, p.lon);
    near(actual[0], x, 1e-4); near(actual[1], z, 1e-4);
  }
  const east = localToLunar(frame, 100, 0), north = localToLunar(frame, 0, -100);
  assert.ok(((east.lon - frame.lon + 540) % 360) - 180 > 0);
  assert.ok(north.lat > frame.lat);
});

test("Raster sampling respects sample centers, bilinear interpolation and NoData", () => {
  const r = { origin: [0, 20], pixelSize: [10, -10], width: 2, height: 2, values: new Float32Array([0, 10, 20, 30]), noData: -9999 };
  near(sampleRaster(r, 5, 15), 15); near(sampleRaster(r, 0, 20), 0); near(sampleRaster(r, 10, 10), 30);
  assert.ok(Number.isNaN(sampleRaster(r, -1, 20)));
  r.values[3] = -9999; assert.ok(Number.isNaN(sampleRaster(r, 5, 15)));
});

test("The patch is exactly 1000 by 1000 meters and retains real spherical curvature", () => {
  const t = flat();
  near(t.positions[0], -500); near(t.positions[2], -500); near(t.positions.at(-3), 500); near(t.positions.at(-1), 500);
  near(surfaceAt(t, 0, 0), 0);
  assert.ok(surfaceAt(t, 500, 0) < -0.07 && surfaceAt(t, 500, 0) > -0.08);
  near(t.anchorHeight, 100); assert.equal(t.indices.length, 100 * 100 * 6);
  const r = { ...raster, values: raster.values.slice() }; r.values.fill(-9999);
  assert.throws(() => buildTerrain(r, -90, 0), /No valid elevation/);
});

test("Triangle sampling matches the collision mesh's diagonal", () => {
  const t = { size: 1000, segments: 1, heights: new Float32Array([0, 10, 20, 50]) };
  near(surfaceAt(t, -250, -250), 7.5); near(surfaceAt(t, 250, 250), 32.5);
});

test("SPICE interpolation uses actual hourly vectors and refuses invented dates", () => {
  const values = new Float32Array([1, 2, 3, 4, 5, 6, 3, 4, 5, 6, 7, 8]);
  const manifest = { startUnixMs: 0, stepSeconds: 3600, count: 2 };
  assert.deepEqual(interpolateEphemeris(values, manifest, 1800000), { sun: [2, 3, 4], earth: [5, 6, 7] });
  assert.throws(() => interpolateEphemeris(values, manifest, -1), /outside/);
});

test("Solar/Earth directions and real angular sizes follow topocentric ENU", () => {
  const frame = makeFrame(-86, 30), observer = frame.up.map((u) => u * MOON_RADIUS);
  for (const [direction, az, el] of [[frame.east, 90, 0], [frame.north, 0, 0], [frame.up, 0, 90]]) {
    const body = topocentric(direction.map((v, k) => v * 384400 + observer[k] / 1000), observer, frame, 6378.1366);
    const angles = azimuthElevation(body.vector, frame.up);
    near(angles.el, el); if (el !== 90) near(angles.az, az);
    near(body.angularRadius, Math.asin(6378.1366 / 384400));
  }
  near(visibleDisc(2, 3, 0.00465), 0); near(visibleDisc(3, 3, 0.00465), 0.5); near(visibleDisc(4, 3, 0.00465), 1);
});

test("Procedural seeds are stable for the same coordinates", () => {
  const a = randomSeed(seedAt(-86.86, 338.14)), b = randomSeed(seedAt(-86.86, 338.14));
  assert.deepEqual(Array.from({ length: 10 }, a), Array.from({ length: 10 }, b));
});

test("Distant terrain LOD keeps native boundary samples and upward winding", () => {
  const indices = coarseTileIndices(20, 20, 4), used = new Set(indices);
  assert.ok(indices.length < 20 * 20 * 6 / 2);
  for (let k = 0; k <= 20; k++) {
    for (const p of [k, 20 * 21 + k, k * 21, k * 21 + 20]) assert.ok(used.has(p), `Missing edge vertex ${p}`);
  }
  for (let k = 0; k < indices.length; k += 3) {
    const [a, b, c] = Array.from(indices.slice(k, k + 3), (p) => [p % 21, Math.floor(p / 21)]);
    const y = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
    assert.ok(y > 0, "LOD has inverted or degenerate triangle");
  }
});

test("Regional terrain joins every detailed edge vertex despite different DEM heights", () => {
  const t = flat(), original = t.positions.slice();
  const regional = { origin: [-25000, 25000], pixelSize: [500, -500], width: 101, height: 101, values: new Float32Array(101 * 101).fill(170), noData: -9999 };
  const context = buildTerrainContext(regional, t), used = new Set(context.indices), vertices = new Set();
  for (const p of used) vertices.add(Array.from(context.positions.slice(p * 3, p * 3 + 3)).join(","));
  for (let k = 0; k <= t.segments; k++) for (const p of [k, t.segments * (t.segments + 1) + k, k * (t.segments + 1), k * (t.segments + 1) + t.segments]) {
    assert.ok(vertices.has(Array.from(t.positions.slice(p * 3, p * 3 + 3)).join(",")), `Unstitched native boundary sample ${p}`);
  }
  for (let k = 0; k < context.indices.length; k += 3) {
    const [a, b, c] = Array.from(context.indices.slice(k, k + 3), p => context.positions.slice(p * 3, p * 3 + 3));
    const up = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    assert.ok(up > 0, "Context must not contain reversed or degenerate triangles");
    assert.ok([a, b, c].some(p => Math.abs(p[0]) >= 750 || Math.abs(p[2]) >= 750), "Transition must stay outside the measured patch");
  }
  assert.deepEqual(t.positions, original, "Stitching must leave measured elevations unchanged");
});

test("Packaged demo DEMs have verifiable hashes, valid heights and native 5 m spacing", async () => {
  const base = new URL("../../public/data/astronaut/", import.meta.url);
  const catalog = JSON.parse(await readFile(new URL("catalog.json", base), "utf8"));
  const { createHash } = await import("node:crypto");
  for (const p of catalog.patches) {
    const bytes = await readFile(new URL(p.file, base));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), p.sha256);
    assert.equal(p.resolutionM, 5); assert.equal(bytes.length, p.width * p.height * 4);
    const values = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    assert.ok(values.every((v) => Number.isFinite(v) && v > -12000 && v < 12000));
    const t = buildTerrain({ ...p, values }, ...p.center);
    near(surfaceAt(t, 0, 0), 0); assert.equal(t.size, 1000);
  }
});

test("Rapier walking, lunar jumping, rock collisions and boundaries", async () => {
  await initPhysics();
  const terrain = flat(), p = new LunarPhysics(terrain);
  try {
    const still = { forward: 0, right: 0, fast: false, jump: false };
    for (let k = 0; k < 120; k++) p.step(still, 0);
    assert.ok(p.grounded); near(p.eye().y, EYE_HEIGHT, 0.08);
    const y0 = p.eye().y; let peak = y0;
    p.step({ ...still, jump: true }, 0);
    for (let k = 0; k < 240; k++) { p.step(still, 0); peak = Math.max(peak, p.eye().y); }
    near(peak - y0, 2.5 ** 2 / (2 * LUNAR_GRAVITY), 0.12); assert.ok(p.grounded);
    for (let k = 0; k < 120; k++) p.step({ ...still, forward: 1 }, 0);
    assert.ok(p.eye().z < -2.6 && p.eye().z > -3.3);
    p.body.setTranslation({ x: 499.5, y: 1, z: 0 }, true); p.world.step();
    for (let k = 0; k < 120; k++) p.step({ ...still, right: 1, fast: true }, 0);
    assert.ok(p.eye().x <= 499.61);
    p.reset(); near(p.eye().x, 0); near(p.eye().z, 0);
  } finally { p.dispose(); }
  const obstacle = new LunarPhysics(terrain, [{ x: 0, y: 0, z: -2, radius: 0.9 }]);
  try {
    for (let k = 0; k < 300; k++) obstacle.step({ forward: 1, right: 0, fast: false, jump: false }, 0);
    assert.ok(obstacle.eye().z > -1.4, `Walked through rock: ${obstacle.eye().z}`);
  } finally { obstacle.dispose(); }
});

test("Find sunlight changes no state and returns a scientifically sunlit hour", async () => {
  const base = new URL("../../public/data/", import.meta.url);
  const json = async (name) => JSON.parse(await readFile(new URL(name, base), "utf8"));
  const typed = async (name, Type) => { const b = await readFile(new URL(name, base)); return new Type(b.buffer, b.byteOffset, b.byteLength / Type.BYTES_PER_ELEMENT); };
  const catalog = await json("astronaut/catalog.json"), patch = catalog.patches.find((p) => p.id === "haworth-demo");
  const terrain = buildTerrain({ ...patch, values: await typed(`astronaut/${patch.file}`, Float32Array) }, -86.8562, 338.1428);
  const data = { manifest: await json("manifest.json"), horizon: await typed("horizon.u8", Uint8Array) };
  const skyData = { manifest: await json("astronaut/ephem-de421.json"), ephem: await typed("astronaut/ephem-de421.f32", Float32Array) };
  const eye = { x: 0, y: 1.7, z: 0 }, from = Date.parse("2026-11-16T09:00Z"), to = from + 30 * 86400000;
  assert.equal(celestialAt(data, skyData, terrain, eye, from).sun.visible, false);
  const found = await findSunlitTime(data, skyData, terrain, eye, from, from, to);
  assert.ok(found > from && found < to);
  assert.ok(celestialAt(data, skyData, terrain, eye, found).sun.visibleFraction >= 0.99);
  assert.equal(await findSunlitTime(data, skyData, terrain, eye, from, from, from), null);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(findSunlitTime(data, skyData, terrain, eye, from, from, to, abort.signal), { name: "AbortError" });
});
