import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { createSurfaceGeology } from "./SurfaceGeology.js";
import { addRocks, rockPlacements } from "./ProceduralRocks.js";
import { buildTerrain } from "./coordinates.js";

test("Scree remains visible but breaks into gradual wisps instead of a solid spot", () => {
  for (const [lat, lon] of [[-90, 0], [-86.8562, 338.1428], [-86.17733, 51.30161], [-87.18438, 340.50414]]) {
    const geology = createSurfaceGeology(lat, lon);
    const nearby = [];
    for (let along = 6; along <= 28; along += 2) for (let across = -2; across <= 14; across += 2) {
      const x = along * 0.6 + across * 0.8, z = -along * 0.8 + across * 0.6;
      const cover = geology.surfaceRockiness(x, z); nearby.push(cover);
      assert.ok(Math.abs(cover - geology.surfaceRockiness(x + 0.1, z)) < 0.04, "Material edges must change gradually while walking");
    }
    assert.ok(Math.max(...nearby) > 0.45, "Gravel should remain visible nearby");
    assert.ok(Math.min(...nearby) < 0.2, "Sand should run through the nearby scree instead of forming a filled oval");
    let sand = 0, total = 0, scree = 0;
    for (let z = -490; z < 500; z += 20) for (let x = -490; x < 500; x += 20) {
      const cover = geology.surfaceRockiness(x, z);
      assert.ok(Number.isFinite(cover) && cover >= 0 && cover <= 1);
      total++; if (cover < 0.15) sand++; if (cover > 0.45) scree++;
    }
    assert.ok(sand / total > 0.75, "Grey sand should still dominate the landscape");
    assert.ok(scree > 10, "There should be multiple recognisable scree regions");
  }
});

test("Rock fields are reproducible, concentrated in patches and leave open plains", () => {
  const geology = createSurfaceGeology(-90, 0);
  const terrain = buildTerrain({ origin: [-2000, 2000], pixelSize: [10, -10], width: 401, height: 401, noData: -9999, values: new Float32Array(401 * 401).fill(100) }, -90, 0, { spacing: 10 });
  const rocks = rockPlacements(terrain, 1.4, geology, 20);
  assert.deepEqual(rocks, rockPlacements(terrain, 1.4, geology, 20));
  assert.ok(rocks.length > 6000, "Denser regional fragment fields should be present");
  const fine = rocks.filter((r) => r.fine), original = rocks.filter((r) => !r.fine);
  assert.ok(fine.length > original.filter((r) => r.radius < 0.3).length * 2, "Additions should mainly be small gravel");
  assert.ok(fine.every((r) => r.radius >= 0.018 && r.radius <= 0.09), "Extra gravel stays centimetre-scale without collision bodies");
  assert.equal(original.filter((r) => r.radius >= 0.3).length, 803, "Existing boulders should not multiply when adding fine gravel");
  let area = 0, occupied = 0;
  for (let z = -490; z < 500; z += 20) for (let x = -490; x < 500; x += 20) { area++; if (geology.sample(x, z).rocky > 0.15) occupied++; }
  const clustered = rocks.filter((r) => geology.sample(r.x, r.z).rocky > 0.15).length;
  assert.ok(occupied / area < 0.22, "Broad plains should remain open");
  assert.ok(clustered / rocks.length > occupied / area * 5, "Rock density must follow the shared geological field");
  assert.equal(new Set(rocks.map((r) => r.variant)).size, 20);
  assert.ok(rocks.every((r) => Number.isFinite(r.y) && Math.abs(r.x) < 500 && Math.abs(r.z) < 500 && Math.hypot(r.x, r.z) >= (r.fine ? 1.1 : 4)));
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
