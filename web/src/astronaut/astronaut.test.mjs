import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildTerrain, dot, localToLunar, lunarToLocal, makeFrame, MOON_RADIUS, randomSeed, sampleRaster, sampleRasterSmooth, seedAt, surfaceAt } from "./coordinates.js";
import { azimuthElevation, celestialAt, earthOrientation, findSunlitTime, interpolateEphemeris, topocentric, visibleDisc } from "./CelestialPosition.js";
import { initPhysics, LunarPhysics, EYE_HEIGHT, LUNAR_GRAVITY } from "./LunarPhysics.js";
import { NODE_CELLS, nodeIndices, nodeVertices, selectNodes, treeDepth } from "./TerrainLOD.js";
import { buildTerrainContext } from "./TerrainContext.js";
import { buildSurface, craterHeight, craterPopulation, EQUILIBRIUM_DENSITY, groundAt, groundNormal, microCraterTile, reliefOptions, VISIBLE_SHARE } from "./SurfaceRelief.js";
import { HAPKE, lunarLighting, lunarReflectance } from "./SurfaceMaterials.js";

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

test("Smooth DEM interpolation passes through every sample and adds no bumps to a plane", () => {
  const values = new Float32Array(36), plane = new Float32Array(36);
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) { values[i * 6 + j] = Math.sin(i * 1.3) * 40 + j * j; plane[i * 6 + j] = 3 * i - 2 * j + 7; }
  const r = { width: 6, height: 6, values, noData: -9999 };
  for (let i = 1; i <= 4; i++) for (let j = 1; j <= 4; j++) if (i <= 3 && j <= 3) near(sampleRasterSmooth(r, j, i), values[i * 6 + j], 1e-4);
  near(sampleRasterSmooth({ ...r, values: plane }, 2.37, 1.81), 3 * 1.81 - 2 * 2.37 + 7, 1e-4);
  near(sampleRasterSmooth({ ...r, values: plane, scale: 0.5 }, 2.5, 2.5), (3 * 2.5 - 2 * 2.5 + 7) / 2, 1e-4);
  assert.ok(Number.isNaN(sampleRasterSmooth(r, 0.5, 2)), "No extrapolation past the measured samples");
  values[2 * 6 + 3] = -9999; assert.ok(Number.isNaN(sampleRasterSmooth(r, 2.5, 2.5)), "NoData is never interpolated");
});

test("Generated craters follow the lunar size distribution and are mostly worn", () => {
  const seed = seedAt(-86.86, 338.14), craters = craterPopulation(seed, { minD: 2, maxD: 140 });
  assert.deepEqual(craters, craterPopulation(seed, { minD: 2, maxD: 140 }), "Same place, same craters");
  assert.ok(craters.every((c) => c.d >= 2 && c.d <= 140 && c.depth > 0 && c.depth < c.d * 0.2));
  for (let k = 1; k < craters.length; k++) assert.ok(craters[k - 1].d >= craters[k].d, "Largest first");
  const between = (lo, hi) => craters.filter((c) => c.d >= lo && c.d < hi).length;
  // N(>D) ∝ D^-2: each doubling of size leaves about a quarter as many.
  const ratio = between(2, 4) / between(4, 8);
  assert.ok(ratio > 3 && ratio < 5.5, `Size ratio ${ratio}`);
  const expected = EQUILIBRIUM_DENSITY * VISIBLE_SHARE * 1e6 * (2 ** -2 - 140 ** -2);
  assert.ok(craters.length > expected * 0.8 && craters.length < expected * 1.02, `${craters.length} of ${expected}`);
  assert.ok(craters.filter((c) => c.sharp > 0.5).length / craters.length < 0.12, "Sharp rims are the exception");
  assert.ok(craters.filter((c) => c.depth / c.d < 0.03).length / craters.length > 0.6, "Most are shallow dimples");
  assert.ok(craters.every((c) => c.d <= 3.5 || Math.hypot(c.x, c.z) >= c.d * 0.75 + 2.5), "The arrival point stays on open ground");
  assert.equal(craters.filter((c) => c.fresh > 0.85 && Math.hypot(c.x, c.z) < 46 && c.d >= 8).length >= 1, true, "A young crater within a short walk");
  assert.deepEqual(reliefOptions(5).maxD, 20); assert.deepEqual(reliefOptions(240).maxD, 140);
});

test("A crater is a bowl with a raised rim and ejecta that thins to nothing", () => {
  const fresh = { depth: 2, rim: 0.4, sharp: 1 }, old = { depth: 0.2, rim: 0, sharp: 0 };
  assert.ok(craterHeight(fresh, 0) < -1.9 && craterHeight(fresh, 0) > -2.01);
  assert.ok(craterHeight(fresh, 1) > 0.25 && craterHeight(fresh, 1) <= 0.4, "Rounded crest just below the nominal rim height");
  assert.ok(craterHeight(fresh, 1.6) > 0 && craterHeight(fresh, 1.6) < craterHeight(fresh, 1.1));
  assert.equal(craterHeight(fresh, 3), 0); assert.equal(craterHeight(old, 3.2), 0);
  near(craterHeight(old, 0), -0.2); assert.ok(craterHeight(old, 1) > -0.05 && craterHeight(old, 1) < 0);
  for (let q = 0; q < 3; q += 0.02) assert.ok(Math.abs(craterHeight(fresh, q + 0.02) - craterHeight(fresh, q)) < 0.2, "No cliff in the profile");
  const tile = microCraterTile(5, 128, 6);
  assert.ok(tile.count > 50 && tile.heights.every(Number.isFinite) && Math.min(...tile.heights) < -0.01);
});

const fineSurface = (relief = true) => {
  const terrain = flat();
  terrain.surface = buildSurface(raster, terrain, { cells: 256, seed: 77, resolutionM: 5, relief });
  return terrain;
};

test("The walkable surface adds relief inside the kilometre and none at its edge", () => {
  const smooth = fineSurface(false), rough = fineSurface(true), { n, cell, heights, levels, craters } = rough.surface;
  assert.equal(n, 257); near(cell, 1000 / 256); assert.ok(heights.every(Number.isFinite)); assert.ok(craters.length > 1000);
  assert.deepEqual(levels.map((level) => Math.sqrt(level.length)), [257, 129, 65, 33, 17, 9, 5]);
  // Without added relief it is the DEM itself: a flat raster keeps only the Moon's curvature.
  for (const [x, z] of [[0, 0], [250, -120], [-480, 480], [500, 0]]) near(groundAt(smooth, x, z), surfaceAt(smooth, x, z), 2e-3);
  // With relief, the outer edge still matches the measured mesh sample for sample.
  for (let k = 0; k < n; k++) for (const p of [k, (n - 1) * n + k, k * n, k * n + n - 1]) {
    const x = (p % n) * cell - 500, z = Math.floor(p / n) * cell - 500;
    near(heights[p], surfaceAt(rough, x, z), 1e-4);
  }
  let deepest = 0, rms = 0;
  for (let p = 0; p < heights.length; p++) { const d = heights[p] - smooth.surface.heights[p]; deepest = Math.min(deepest, d); rms += d * d; }
  assert.ok(deepest < -0.4 && deepest > -6, `Deepest added hollow ${deepest} m`);
  assert.ok(Math.sqrt(rms / heights.length) < 0.8, "Relief stays below what a 5 m DEM would have shown");
  near(groundAt(rough, -500 + cell * 3.5, -500 + cell * 7), (heights[7 * n + 3] + heights[7 * n + 4]) / 2, 1e-5);
  const normal = groundNormal(rough, 100, 100); near(Math.hypot(...normal), 1); assert.ok(normal[1] > 0.7);
  assert.ok(Number.isNaN(groundAt(rough, 501, 0)));
  assert.deepEqual(rough.surface.heights, fineSurface(true).surface.heights, "Same seed, same ground");
});

test("Terrain quadtree covers the kilometre exactly once, finest underfoot", () => {
  for (const [x, z, detail] of [[0, 0, 0.55], [-431, 212, 0.3], [499, -499, 0.85], [120, 80, 0.4]]) {
    const nodes = selectNodes(x, z, { size: 1000, depth: 6, detail });
    let area = 0; for (const node of nodes) area += (1000 / (1 << node.level)) ** 2;
    near(area, 1e6, 1e-3); assert.equal(new Set(nodes.map((n) => n.key)).size, nodes.length);
    const under = nodes.find((node) => { const span = 1000 / (1 << node.level), x0 = node.ix * span - 500, z0 = node.iz * span - 500; return x >= x0 && x <= x0 + span && z >= z0 && z <= z0 + span; });
    assert.equal(under.level, 6, "Half-metre cells under the walker");
    assert.ok(nodes.length * NODE_CELLS * NODE_CELLS * 2 < 330000, `${nodes.length} nodes`);
    assert.ok(Math.min(...nodes.map((node) => node.level)) <= 2, "Far ground uses coarse nodes");
  }
});

test("Terrain nodes face up, meet their neighbours and fold their skirts out of the shadow pass", () => {
  const terrain = fineSurface(true), surface = terrain.surface, depth = treeDepth(surface);
  assert.equal(depth, 3); assert.equal(NODE_CELLS, 32);
  const a = nodeVertices(surface, 3, 3, 2), b = nodeVertices(surface, 3, 4, 2), row = NODE_CELLS + 1, indices = nodeIndices();
  for (let k = 0; k < row; k++) for (let c = 0; c < 3; c++) assert.equal(a.positions[(k * row + NODE_CELLS) * 3 + c], b.positions[k * row * 3 + c], "Shared edge");
  for (let k = 0; k < row; k++) for (let c = 0; c < 3; c++) near(a.normals[(k * row + NODE_CELLS) * 3 + c], b.normals[k * row * 3 + c], 1e-6);
  for (let k = 0; k < NODE_CELLS * NODE_CELLS * 6; k += 3) {
    const [p, q, r] = [0, 1, 2].map((c) => Array.from(a.positions.slice(indices[k + c] * 3, indices[k + c] * 3 + 3)));
    assert.ok((q[2] - p[2]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[2] - p[2]) > 0, "Inverted or degenerate triangle");
  }
  assert.ok(Math.max(...indices) < a.positions.length / 3);
  for (let p = 0; p < row * row; p++) assert.equal(a.skirt[p], 0);
  for (let p = row * row; p < a.skirt.length; p++) assert.ok(a.skirt[p] > 0.25);
  // Skirt vertices sit on the edge itself until the surface shader lowers them.
  for (let k = 0; k < row; k++) assert.deepEqual(a.positions.slice((row * row + k) * 3, (row * row + k) * 3 + 3), a.positions.slice(k * 3, k * 3 + 3));
  near(a.positions[1], groundAt(terrain, a.positions[0], a.positions[2]), 1e-5);
  const coarse = nodeVertices(surface, 0, 0, 0); near(coarse.positions[0], -500); near(coarse.positions[(row * row - 1) * 3], 500);
});

test("Lunar soil reflects as the Moon does, not as a matte surface", () => {
  const deg = Math.PI / 180, cos = (a) => Math.cos(a * deg);
  near(lunarReflectance(cos(30), 1, cos(30)), cos(30), 1e-9);
  assert.equal(lunarReflectance(0, 0.5, 0.2), 0); assert.equal(lunarReflectance(-0.2, 0.5, 0.2), 0);
  // Opposition surge: the ground brightens sharply around your own shadow.
  const surge = lunarReflectance(0.8, 0.8, 1) / lunarReflectance(0.8, 0.8, cos(30));
  assert.ok(surge > 1.8 && surge < 3, `Surge ${surge}`);
  // Grazing sunlight, as at the poles: far brighter than Lambert's cosine.
  const low = Math.sin(2.5 * deg);
  assert.ok(lunarReflectance(low, 0.3, cos(60)) > low * 2.5);
  // With the Sun behind you the ground is bright; against the Sun it is dark.
  assert.ok(lunarReflectance(low, 0.3, cos(20)) > lunarReflectance(low, 0.3, cos(160)) * 4);
  for (let g = 0; g <= 180; g += 5) for (const mu0 of [0.02, 0.3, 1]) for (const mu of [0.05, 0.5, 1]) {
    const r = lunarReflectance(mu0, mu, cos(g)); assert.ok(Number.isFinite(r) && r >= 0 && r < 6);
  }
  assert.ok(HAPKE.w > 0 && HAPKE.w < 1);
  const chunk = lunarLighting();
  assert.ok(chunk.includes("lunarReflectance( directLight.direction"));
  assert.ok(!/reflectedLight\.directSpecular \+= irradiance \* BRDF_GGX/.test(chunk), "No mirror-like sheen on regolith");
});

test("The Earth is turned and lit for the instant: subsolar point and axis", () => {
  const AU = 149597870.7, deg = Math.PI / 180;
  for (const [iso, declination] of [["2026-11-15T13:00Z", -18.6], ["2026-06-21T06:00Z", 23.44], ["2026-03-20T15:00Z", 0], ["2027-01-10T00:00Z", -22.0]]) {
    const time = Date.parse(iso);
    // Any Moon-fixed geometry will do: the Sun 2° off the lunar equator, the Earth a quarter turn away.
    const sun = [Math.cos(2 * deg) * AU, 0, Math.sin(2 * deg) * AU], earth = [0, 384400, 30000];
    const { north, greenwich, toSun } = earthOrientation({ sun, earth }, time);
    near(Math.hypot(...north), 1, 1e-9); near(Math.hypot(...greenwich), 1, 1e-9); near(dot(north, greenwich), 0, 1e-9);
    const latitude = Math.asin(dot(toSun, north)) / deg;
    near(latitude, declination, 0.5);
    const east = [north[1] * greenwich[2] - north[2] * greenwich[1], north[2] * greenwich[0] - north[0] * greenwich[2], north[0] * greenwich[1] - north[1] * greenwich[0]];
    const longitude = Math.atan2(dot(toSun, east), dot(toSun, greenwich)) / deg;
    // Noon follows the clock: 15° west per hour after 12:00 UTC, give or take the equation of time.
    const hours = (time / 3600000) % 24, expected = ((180 - hours * 15) % 360 + 540) % 360 - 180;
    assert.ok(Math.abs(((longitude - expected + 540) % 360) - 180) < 4.6, `${iso}: subsolar longitude ${longitude}, expected about ${expected}`);
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

test("Walking follows the generated relief: the collider is the surface that is drawn", async () => {
  await initPhysics();
  const terrain = fineSurface(true), p = new LunarPhysics(terrain);
  try {
    const still = { forward: 0, right: 0, fast: false, jump: false };
    for (let k = 0; k < 120; k++) p.step(still, 0);
    assert.ok(p.grounded); near(p.eye().y, groundAt(terrain, 0, 0) + EYE_HEIGHT, 0.08);
    let worst = 0;
    for (const [x, z] of [[37, -52], [-210, 140], [333, 301], [-90, -400]]) {
      p.teleport(x, z);
      for (let k = 0; k < 90; k++) p.step(still, 0);
      worst = Math.max(worst, Math.abs(p.eye().y - groundAt(terrain, p.eye().x, p.eye().z) - EYE_HEIGHT));
    }
    assert.ok(worst < 0.12, `Feet ${worst} m off the drawn ground`);
    p.teleport(60, 60);
    for (let k = 0; k < 600; k++) p.step({ ...still, forward: 1, fast: true }, 0.6);
    const eye = p.eye();
    assert.ok(Math.hypot(eye.x - 60, eye.z - 60) > 25, "Craters must not stop the walker");
    near(eye.y, groundAt(terrain, eye.x, eye.z) + EYE_HEIGHT, 0.2);
  } finally { p.dispose(); }
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
