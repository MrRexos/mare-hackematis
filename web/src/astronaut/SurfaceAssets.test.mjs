import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { createSurfaceGeology, ejectaDensity } from "./SurfaceGeology.js";
import { addGravel, addRocks, gravelCell, rockPlacements } from "./ProceduralRocks.js";
import { buildTerrain } from "./coordinates.js";

const flatTerrain = () => buildTerrain({ origin: [-2000, 2000], pixelSize: [10, -10], width: 401, height: 401, noData: -9999, values: new Float32Array(401 * 401).fill(100) }, -90, 0, { spacing: 10 });

test("Gravelly soil follows the young craters and thins out in wisps, with sand everywhere else", () => {
  for (const [lat, lon] of [[-90, 0], [-86.8562, 338.1428], [-86.17733, 51.30161], [-87.18438, 340.50414]]) {
    const geology = createSurfaceGeology(lat, lon), crater = geology.landmark;
    assert.ok(crater && crater.blocky >= 0.7 && Math.hypot(crater.x, crater.z) < 46, "A blocky young crater near the arrival point");
    const rim = [];
    for (let angle = 0; angle < Math.PI * 2; angle += 0.05) for (const q of [0.9, 1.05, 1.3]) {
      const x = crater.x + Math.cos(angle) * q * crater.r, z = crater.z + Math.sin(angle) * q * crater.r, cover = geology.surfaceRockiness(x, z);
      rim.push(cover);
      assert.ok(Math.abs(cover - geology.surfaceRockiness(x + 0.1, z)) < 0.04, "Material edges must change gradually while walking");
    }
    assert.ok(Math.max(...rim) > 0.4, "Gravel should show on the rim of the young crater");
    assert.ok(Math.min(...rim) < 0.15, "Sand should run through it instead of forming a filled ring");
    let sand = 0, total = 0;
    for (let z = -490; z < 500; z += 20) for (let x = -490; x < 500; x += 20) {
      const cover = geology.surfaceRockiness(x, z);
      assert.ok(Number.isFinite(cover) && cover >= 0 && cover <= 1);
      total++; if (cover < 0.15) sand++;
    }
    assert.ok(sand / total > 0.75, "Grey sand should still dominate the landscape");
    assert.ok(geology.fields.length >= 5 && geology.fields.every((f) => f.blocky >= 0.2 && f.d >= 5), "Several rock-strewn craters, all young");
  }
  assert.ok(ejectaDensity(1) === 1 && ejectaDensity(0.2) < 0.5 && ejectaDensity(2) < ejectaDensity(1.3) && ejectaDensity(4.3) === 0);
});

test("Rocks gather around young craters and in groups of fragments instead of lying alone", () => {
  const geology = createSurfaceGeology(-90, 0), terrain = flatTerrain();
  const rocks = rockPlacements(terrain, 1.4, geology, 20);
  assert.deepEqual(rocks, rockPlacements(terrain, 1.4, geology, 20));
  assert.ok(rocks.length > 6000 && rocks.length < 40000, `${rocks.length} rocks`);
  assert.ok(rocks.every((r) => r.radius >= 0.1 && r.radius <= 2.4 && !r.fine), "Stones under 20 cm belong to the gravel around the walker");
  const boulders = rocks.filter((r) => r.radius >= 0.3);
  assert.ok(boulders.length > 250 && boulders.length < 2500, `${boulders.length} boulders with collision`);
  assert.ok(boulders.length < rocks.length * 0.2, "Each halving of size brings several times more pieces");
  let area = 0, occupied = 0;
  for (let z = -490; z < 500; z += 10) for (let x = -490; x < 500; x += 10) { area++; if (geology.sample(x, z).rocky > 0.15) occupied++; }
  const inFields = rocks.filter((r) => geology.sample(r.x, r.z).rocky > 0.15).length;
  assert.ok(occupied / area < 0.22, "Broad plains should remain open");
  assert.ok(inFields / rocks.length > occupied / area * 4, "Rock density must follow the crater ejecta");
  // Clustering: far more rocks have a close neighbour than an even scatter of the same density would give.
  const cells = new Map(), key = (x, z) => `${Math.floor(x / 4)},${Math.floor(z / 4)}`;
  for (const r of rocks) { const k = key(r.x, r.z); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(r); }
  let close = 0;
  for (const r of rocks) {
    let found = false;
    for (let a = -1; a <= 1 && !found; a++) for (let b = -1; b <= 1 && !found; b++) {
      found = (cells.get(`${Math.floor(r.x / 4) + b},${Math.floor(r.z / 4) + a}`) || []).some((o) => o !== r && (o.x - r.x) ** 2 + (o.z - r.z) ** 2 < 9);
    }
    if (found) close++;
  }
  const uniform = 1 - Math.exp(-rocks.length / 1e6 * Math.PI * 9);
  assert.ok(close / rocks.length > uniform * 2 && close / rocks.length > 0.5, `${close / rocks.length} with a neighbour within 3 m; an even scatter gives ${uniform}`);
  assert.equal(new Set(rocks.map((r) => r.variant)).size, 20);
  assert.ok(rocks.every((r) => Number.isFinite(r.y) && Math.abs(r.x) < 500 && Math.abs(r.z) < 500 && Math.hypot(r.x, r.z) >= 4));
  assert.ok(rocks.every((r) => r.sink >= 0.06 && r.sink <= 0.48 && r.scale.every((v) => v > 0.5 && v < 1.35)), "Partly buried, each with its own proportions");
});

test("Gravel is generated cell by cell around the walker and never uploaded while standing still", () => {
  const geology = createSurfaceGeology(-90, 0), terrain = flatTerrain();
  const cell = gravelCell(3, -2, terrain, geology, 12345);
  assert.deepEqual(cell, gravelCell(3, -2, terrain, geology, 12345));
  assert.notDeepEqual(cell, gravelCell(4, -2, terrain, geology, 12345));
  assert.equal(cell.length % 21, 0); assert.ok(cell.length / 21 >= 20 && cell.length / 21 <= 190);
  for (let p = 0; p < cell.length; p += 21) {
    assert.ok(cell[p + 18] >= 0.02 && cell[p + 18] <= 0.1001, "Stones of 4 to 20 cm");
    assert.ok(cell[p + 16] > 18 - 4 && cell[p + 16] < 24 + 4 && cell[p + 17] > -12 - 4 && cell[p + 17] < -6 + 4);
    near(cell[p + 12], cell[p + 16]); near(cell[p + 14], cell[p + 17]);
  }
  const scene = new THREE.Scene(), material = new THREE.MeshStandardMaterial(), field = addGravel(scene, terrain, geology, material);
  try {
    assert.equal(field.meshes.length, 4, "Four draws for every stone in sight");
    assert.equal(field.update({ x: 100, y: 1.7, z: 100 }, 38, 1), true);
    const total = field.count(), versions = field.meshes.map((m) => m.instanceMatrix.version);
    assert.ok(total > 150 && total < 4 * 3200, `${total} stones in sight`);
    assert.equal(field.meshes.filter((m) => m.castShadow).reduce((n, m) => n + m.count, 0) < total, true, "Only the nearest stones cast shadows");
    assert.equal(field.update({ x: 100.4, y: 1.7, z: 100 }, 38, 1), false);
    assert.deepEqual(field.meshes.map((m) => m.instanceMatrix.version), versions, "Idle frames must not upload instance buffers");
    field.update({ x: 100, y: 1.7, z: 100 }, 38, 0.4);
    assert.ok(field.count() < total * 0.6, "The density setting thins the gravel");
    field.update({ x: 100, y: 1.7, z: 100 }, 18, 1);
    assert.ok(field.count() < total, "A shorter range draws fewer stones");
    field.update({ x: 0.2, y: 1.7, z: 0.1 }, 38, 1);
    assert.ok(field.count() > 100, "Gravel follows the walker");
  } finally { field.dispose(); material.dispose(); }
  assert.equal(scene.children.length, 0);
});

test("All four surface scans and 20 near/far Quixel rock variants are packaged", async () => {
  const base = new URL("../../public/assets/astronaut/", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("manifest.json", base), "utf8"));
  assert.equal(manifest.surfaces.length, 4); assert.equal(manifest.models.length, 8);
  assert.deepEqual(manifest.surfaces.map((surface) => surface.tileMeters), [1, 1, 2, 2]);
  let variants = 0;
  for (const entry of manifest.models) {
    const bytes = await readFile(new URL(entry.file, base));
    assert.equal(bytes.toString("ascii", 0, 4), "glTF");
    const json = JSON.parse(bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)));
    const near = json.nodes.filter((node) => node.extras?.lunarLod === "near"), far = json.nodes.filter((node) => node.extras?.lunarLod === "far");
    assert.equal(near.length, entry.variants); assert.equal(far.length, near.length);
    assert.deepEqual(new Set(near.map((n) => n.extras.lunarVariant)), new Set(far.map((n) => n.extras.lunarVariant)));
    assert.ok(entry.farTriangles < entry.triangles / 4);
    variants += near.length;
  }
  assert.equal(variants, 20);
  for (const entry of manifest.surfaces) for (const property of ["color", "normal", "orm"]) assert.ok((await readFile(new URL(entry[property], base))).length > 1000);
  const earth = await readFile(new URL("sky/earth_2k.jpg", base));
  assert.ok(earth.length > 200000 && earth[0] === 0xff && earth[1] === 0xd8, "Earth texture (NASA Blue Marble) is packaged as a JPEG");
});

test("Rock LOD reuses stationary GPU buffers and preserves boulders at low gravel density", () => {
  const scene = new THREE.Scene(), material = new THREE.MeshStandardMaterial(), geometry = new THREE.BoxGeometry();
  const parts = [{ geometry, material }], rocks = [
    { x: 4, y: 3, z: 0, radius: 0.2, coverage: 0.8 },
    { x: 30, y: 0, z: 0, radius: 0.2, coverage: 0.2 },
    { x: 40, y: 0, z: 0, radius: 0.9, coverage: 0.9 },
  ].map((rock) => ({ ...rock, normal: [0, 1, 0], variant: 0, yaw: 0, shade: 0.9 }));
  const field = addRocks(scene, rocks, material, [{ parts, farParts: parts }]);
  try {
    assert.equal(field.update({ x: 0, z: 0 }, 210, 1.4), true);
    const nearGravel = field.batches.find((b) => !b.large && b.lod === "near").meshes[0];
    const farGravel = field.batches.find((b) => !b.large && b.lod === "far").meshes[0];
    assert.equal(nearGravel.count, 1); assert.equal(farGravel.count, 1); assert.equal(farGravel.castShadow, false);
    const matrix = new THREE.Matrix4(); nearGravel.getMatrixAt(0, matrix);
    near(matrix.elements[12], 4); near(matrix.elements[13], 2.98);
    const version = nearGravel.instanceMatrix.version;
    assert.equal(field.update({ x: 0, z: 0 }, 210, 1.4), false);
    assert.equal(field.update({ x: 0.1, z: 0 }, 210, 1.4), false);
    assert.equal(nearGravel.instanceMatrix.version, version, "Idle frames must not upload instance buffers");
    field.update({ x: 0, z: 0 }, 210, 0.4);
    assert.equal(nearGravel.count, 0); assert.equal(farGravel.count, 1);
    assert.equal(field.batches.filter((b) => b.large).reduce((n, b) => n + b.meshes[0].count, 0), 1);
    field.update({ x: 28, z: 0 }, 210, 0.4);
    assert.equal(nearGravel.count, 1); assert.equal(farGravel.count, 0);
    nearGravel.getMatrixAt(0, matrix); near(matrix.elements[12], 30);
  } finally { field.dispose(); geometry.dispose(); material.dispose(); }
  assert.equal(scene.children.length, 0);
});

test("Extra fine gravel shares the far batches and is culled before becoming subpixel", () => {
  const scene = new THREE.Scene(), material = new THREE.MeshStandardMaterial(), geometry = new THREE.BoxGeometry();
  const parts = [{ geometry, material }];
  const rocks = [3, 40].map((x) => ({ x, y: 0, z: 0, radius: 0.025, fine: true, normal: [0, 1, 0], variant: 0, yaw: 0, shade: 0.9, coverage: 0.2 }));
  const field = addRocks(scene, rocks, material, [{ parts, farParts: parts }]);
  try {
    field.update({ x: 0, z: 0 }, 210, 1);
    assert.equal(field.batches.length, 2, "No new material or draw batch is needed for tiny stones");
    const nearMesh = field.batches.find((b) => b.lod === "near").meshes[0];
    const farMesh = field.batches.find((b) => b.lod === "far").meshes[0];
    assert.equal(nearMesh.count, 0); assert.equal(farMesh.count, 1); assert.equal(farMesh.castShadow, false);
    field.update({ x: 38, z: 0 }, 210, 1);
    const matrix = new THREE.Matrix4(); farMesh.getMatrixAt(0, matrix);
    assert.equal(farMesh.count, 1); near(matrix.elements[12], 40);
  } finally { field.dispose(); geometry.dispose(); material.dispose(); }
});

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} differs from ${b}`);
