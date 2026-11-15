import * as THREE from "three";
import { randomSeed, seedAt } from "./coordinates.js";
import { createSurfaceGeology } from "./SurfaceGeology.js";
import { groundAt, groundNormal } from "./SurfaceRelief.js";

const TAU = Math.PI * 2;
/** Fragment sizes follow a power law: each halving of size brings several times more pieces. */
const powerLaw = (u, lo, hi, k) => lo * (1 - u * (1 - (lo / hi) ** k)) ** (-1 / k);

/**
 * Rocks of 20 cm and more across the whole kilometre. They come from two
 * sources, as on the Moon: blocks thrown out by young craters, densest on the
 * rim and thinning along rays, and scattered broken blocks lying with their own
 * fragments. Smaller stones are generated around the walker by `addGravel`.
 */
export function rockPlacements(terrain, density = 1, geology = createSurfaceGeology(terrain.lat, terrain.lon), variants = 4) {
  const seed = seedAt(terrain.lat, terrain.lon), random = randomSeed(seed), rocks = [];
  const size = terrain.size ?? 1000, half = size / 2 - 1, occupied = new Map(), cellSize = 8;
  const place = (x, z, radius) => {
    if (Math.abs(x) > half || Math.abs(z) > half || Math.hypot(x, z) < 4) return null;
    const y = groundAt(terrain, x, z), normal = groundNormal(terrain, x, z, Math.max(0.5, radius));
    if (!Number.isFinite(y) || !normal.every(Number.isFinite)) return null;
    // Blocks do not come to rest on steep walls.
    if (random() > Math.min(1, normal[1] ** 6 * 1.6)) return null;
    const cx = Math.floor(x / cellSize), cz = Math.floor(z / cellSize);
    if (radius >= 0.3) {
      // Avoid interpenetrating boulders and piles that look like dropped props.
      for (let iz = cz - 1; iz <= cz + 1; iz++) for (let ix = cx - 1; ix <= cx + 1; ix++) {
        if ((occupied.get(`${ix},${iz}`) || []).some((r) => (x - r.x) ** 2 + (z - r.z) ** 2 < ((r.radius + radius) * 0.9) ** 2)) return null;
      }
    }
    const flat = 0.62 + random() * 0.4, wide = 0.86 + random() * 0.28;
    const rock = { x, y, z, radius, fine: false, yaw: random() * TAU, variant: Math.floor(random() * variants), coverage: random(), normal,
      shade: 0.9 + random() * 0.16, sink: 0.06 + random() ** 2.2 * 0.42, scale: [wide, flat, 2 - wide - (random() - 0.5) * 0.2],
      tilt: [(random() - 0.5) * 0.5, (random() - 0.5) * 0.5] };
    rocks.push(rock);
    if (radius >= 0.3) { const key = `${cx},${cz}`; if (!occupied.has(key)) occupied.set(key, []); occupied.get(key).push(rock); }
    return rock;
  };
  for (const field of geology.fields) {
    const largest = Math.min(2.4, 0.042 * field.d + 0.14), count = Math.round(density * field.blocky * 8 * field.d ** 1.35);
    for (let k = 0; k < count; k++) {
      const radius = powerLaw(random(), 0.1, largest, 2.0), rank = (radius - 0.1) / (largest - 0.1), angle = random() * TAU;
      // A quarter stays on the floor and wall; the rest lies outside, big blocks nearest the rim.
      const q = random() < 0.24 ? 0.3 + 0.7 * Math.sqrt(random()) : 0.94 + (powerLaw(random(), 1, 4.2, 1.7) - 1) * (1.1 - 0.55 * rank);
      if (random() > geology.ray(field, angle)) continue;
      place(field.x + Math.cos(angle) * q * field.r, field.z + Math.sin(angle) * q * field.r, radius);
    }
  }
  const clusters = Math.round(density * size * size / 900);
  for (let k = 0; k < clusters; k++) {
    const x = (random() - 0.5) * size, z = (random() - 0.5) * size, parent = powerLaw(random(), 0.12, 1.3, 2);
    const pieces = 2 + Math.floor(random() * random() * 9), spread = parent * 2.2 + 0.5;
    if (!place(x, z, parent)) continue;
    for (let n = 0; n < pieces; n++) {
      const angle = random() * TAU, distance = parent * 1.15 + Math.abs(random() + random() + random() - 1.5) * spread;
      place(x + Math.cos(angle) * distance, z + Math.sin(angle) * distance, powerLaw(random(), 0.1, Math.max(0.12, parent * 0.6), 2.4));
    }
  }
  const loners = Math.round(density * size * size / 600);
  for (let k = 0; k < loners; k++) place((random() - 0.5) * size, (random() - 0.5) * size, powerLaw(random(), 0.1, 0.9, 2.7));
  return rocks;
}

export function rockGeometry(variant, detail = 1) {
  const geometry = new THREE.IcosahedronGeometry(1, detail);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    // Coordinate-based perturbation keeps coincident triangle vertices coincident.
    const hash = Math.sin(x * 31.31 + y * 87.71 + z * 17.43 + variant * 11) * 43758.5453;
    const factor = 0.8 + (hash - Math.floor(hash)) * 0.2;
    position.setXYZ(i, x * factor, y * factor * (0.7 + variant * 0.05), z * factor * (0.85 + variant * 0.025));
  }
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  return geometry;
}

export function addRocks(scene, rocks, material, assetVariants = []) {
  const batches = [], dummy = new THREE.Object3D(), up = new THREE.Vector3(0, 1, 0), normal = new THREE.Vector3();
  for (let variant = 0; variant < Math.max(4, assetVariants.length); variant++) for (let large = 0; large < 2; large++) {
    const items = rocks.filter((r) => r.variant === variant && Number(r.radius >= 0.3) === large);
    if (!items.length) continue;
    const asset = assetVariants[variant % Math.max(1, assetVariants.length)];
    const parts = asset?.parts || [{ geometry: rockGeometry(variant, large ? 2 : 0), material }];
    // Grounding, slope alignment and tint never change while exploring.
    // Share these immutable transforms between the near and far batches.
    const matrices = new Float32Array(items.length * 16), colors = new Float32Array(items.length * 3);
    items.forEach((r, index) => {
      normal.fromArray(r.normal);
      // Rocks sit partly sunk in the regolith, each with its own proportions and lean.
      dummy.position.set(r.x, r.y + r.radius * (asset ? -(r.sink ?? 0.10) : 0.25), r.z);
      dummy.quaternion.setFromUnitVectors(up, normal); dummy.rotateY(r.yaw);
      if (r.tilt) { dummy.rotateX(r.tilt[0]); dummy.rotateZ(r.tilt[1]); }
      dummy.scale.setScalar(r.radius); if (r.scale) dummy.scale.set(r.radius * r.scale[0], r.radius * r.scale[1], r.radius * r.scale[2]);
      dummy.updateMatrix();
      dummy.matrix.toArray(matrices, index * 16);
      colors.fill(r.shade, index * 3, index * 3 + 3);
    });
    for (const lod of asset?.farParts?.length ? ["near", "far"] : ["near"]) {
      const meshes = (lod === "far" ? asset.farParts : parts).map((part) => {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, items.length);
        mesh.castShadow = !!large || lod === "near"; mesh.receiveShadow = true;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(items.length * 3), 3).setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0;
        // Instance-level distance LOD below plus a complete, stable bounding sphere.
        mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1100);
        scene.add(mesh); return mesh;
      });
      batches.push({ meshes, items, matrices, colors, selected: new Uint32Array(items.length), visible: new Uint32Array(items.length), count: -1,
        large: !!large, lod, hasFar: !!asset?.farParts?.length });
    }
  }
  let lastX = Infinity, lastZ = Infinity, lastDistance, lastDensity;
  const update = (eye, distance, density = 1) => {
    if (lastDistance === distance && lastDensity === density && (eye.x - lastX) ** 2 + (eye.z - lastZ) ** 2 < 4) return false;
    lastX = eye.x; lastZ = eye.z; lastDistance = distance; lastDensity = density;
    let changed = false;
    for (const batch of batches) {
      let count = 0;
      for (let index = 0; index < batch.items.length; index++) {
        const r = batch.items[index], d2 = (r.x - eye.x) ** 2 + (r.z - eye.z) ** 2;
        // Tiny gravel becomes subpixel well before the larger fragments do.
        const limit = batch.large ? Math.max(300, distance * 1.7) : r.fine ? Math.min(distance, Math.max(22, r.radius * 480)) : Math.min(distance, Math.max(28, r.radius * 650));
        if (d2 > limit * limit) continue;
        if (!batch.large && r.coverage > density / 1.4) continue;
        const nearDistance = batch.large ? 65 : Math.max(8, r.radius * 90);
        // Centimetre-scale gravel uses the scanned low-poly mesh even nearby,
        // sharing the existing far batches without extra draw calls or shadows.
        const far = r.fine || d2 > nearDistance * nearDistance;
        if (batch.hasFar && (batch.lod === "far") !== far) continue;
        batch.visible[count++] = index;
      }
      let selectionChanged = count !== batch.count;
      for (let k = 0; k < count && !selectionChanged; k++) selectionChanged = batch.visible[k] !== batch.selected[k];
      if (!selectionChanged) continue;
      changed = true; batch.count = count; batch.selected.set(batch.visible.subarray(0, count));
      for (const mesh of batch.meshes) {
        mesh.count = count;
        let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity, reach = 0;
        for (let k = 0; k < count; k++) {
          const index = batch.selected[k], r = batch.items[index];
          mesh.instanceMatrix.array.set(batch.matrices.subarray(index * 16, index * 16 + 16), k * 16);
          mesh.instanceColor.array.set(batch.colors.subarray(index * 3, index * 3 + 3), k * 3);
          minX = Math.min(minX, r.x); maxX = Math.max(maxX, r.x); minY = Math.min(minY, r.y); maxY = Math.max(maxY, r.y);
          minZ = Math.min(minZ, r.z); maxZ = Math.max(maxZ, r.z); reach = Math.max(reach, r.radius);
        }
        // A tight bound lets each shadow cascade skip the batches outside it.
        if (count) mesh.boundingSphere.set(mesh.boundingSphere.center.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2),
          Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2 + reach * 2.5);
        if (count) {
          mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, count * 16); mesh.instanceMatrix.needsUpdate = true;
          mesh.instanceColor.clearUpdateRanges(); mesh.instanceColor.addUpdateRange(0, count * 3); mesh.instanceColor.needsUpdate = true;
        }
      }
    }
    return changed;
  };
  return { update, batches, dispose() { for (const batch of batches) for (const mesh of batch.meshes) { scene.remove(mesh); mesh.dispose(); } } };
}

const GRAVEL_CELL = 6, GRAVEL_CAPACITY = 3200, GRAVEL_FLOATS = 21;

/**
 * Stones from 4 to 20 cm in one 6 m cell of ground. A real surface has about one
 * such stone per square metre (Surveyor counts), far too many to keep for a
 * whole kilometre, so each cell is produced from its own seed when the walker
 * comes near. Half of the stones lie in small groups, as fragments do.
 */
export function gravelCell(cx, cz, terrain, geology, seed) {
  const random = randomSeed((seed ^ Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) >>> 0), half = (terrain.size ?? 1000) / 2 - 0.5;
  const x0 = cx * GRAVEL_CELL, z0 = cz * GRAVEL_CELL, rocky = geology.sample(x0 + GRAVEL_CELL / 2, z0 + GRAVEL_CELL / 2).rocky;
  const count = Math.min(190, Math.floor(GRAVEL_CELL * GRAVEL_CELL * 0.9 * (1 + 5 * rocky) + random()));
  const groups = Array.from({ length: 1 + Math.floor(random() * 3) }, () => [x0 + random() * GRAVEL_CELL, z0 + random() * GRAVEL_CELL, 0.2 + random() * 0.7]);
  const stones = new Float32Array(count * GRAVEL_FLOATS), dummy = new THREE.Object3D(), up = new THREE.Vector3(0, 1, 0), normal = new THREE.Vector3();
  let used = 0;
  for (let k = 0; k < count; k++) {
    let x = x0 + random() * GRAVEL_CELL, z = z0 + random() * GRAVEL_CELL;
    const group = groups[Math.floor(random() * groups.length)], radius = powerLaw(random(), 0.02, 0.1, 2.2);
    if (random() < 0.5) { const angle = random() * TAU, distance = Math.abs(random() + random() - 1) * group[2] * 2; x = group[0] + Math.cos(angle) * distance; z = group[1] + Math.sin(angle) * distance; }
    const yaw = random() * TAU, sink = 0.05 + random() ** 2 * 0.35, flat = 0.55 + random() * 0.45, wide = 0.8 + random() * 0.4, shade = 0.9 + random() * 0.16, coverage = random();
    if (Math.abs(x) > half || Math.abs(z) > half || Math.hypot(x, z) < 0.9) continue;
    const y = groundAt(terrain, x, z);
    if (!Number.isFinite(y)) continue;
    normal.fromArray(groundNormal(terrain, x, z, 0.3));
    dummy.position.set(x, y + radius * (flat * 0.5 - sink), z); dummy.quaternion.setFromUnitVectors(up, normal); dummy.rotateY(yaw);
    dummy.scale.set(radius * wide, radius * flat, radius * (2 - wide)); dummy.updateMatrix();
    dummy.matrix.toArray(stones, used * GRAVEL_FLOATS);
    stones.set([x, z, radius, shade, coverage], used * GRAVEL_FLOATS + 16); used++;
  }
  return stones.subarray(0, used * GRAVEL_FLOATS);
}

/** Small stones around the walker: four instanced draws, refilled every metre and a half. */
export function addGravel(scene, terrain, geology, material) {
  const seed = (seedAt(terrain.lat, terrain.lon) ^ 0x9e3779b9) >>> 0, cells = new Map(), meshes = [];
  for (let shape = 0; shape < 2; shape++) for (let near = 0; near < 2; near++) {
    const mesh = new THREE.InstancedMesh(rockGeometry(shape * 3 + 1, 1), material, GRAVEL_CAPACITY);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(GRAVEL_CAPACITY * 3), 3).setUsage(THREE.DynamicDrawUsage);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.count = 0; mesh.castShadow = !!near; mesh.receiveShadow = true;
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
    scene.add(mesh); meshes.push(mesh);
  }
  let lastX = Infinity, lastZ = Infinity, lastRange, lastDensity, total = 0;
  const update = (eye, range = 40, density = 1) => {
    if (lastRange === range && lastDensity === density && (eye.x - lastX) ** 2 + (eye.z - lastZ) ** 2 < 2.25) return false;
    lastX = eye.x; lastZ = eye.z; lastRange = range; lastDensity = density;
    const counts = [0, 0, 0, 0], reach = Math.ceil(range / GRAVEL_CELL), cx = Math.floor(eye.x / GRAVEL_CELL), cz = Math.floor(eye.z / GRAVEL_CELL);
    for (let iz = cz - reach; iz <= cz + reach; iz++) for (let ix = cx - reach; ix <= cx + reach; ix++) {
      const dx = Math.max(ix * GRAVEL_CELL - eye.x, 0, eye.x - (ix + 1) * GRAVEL_CELL), dz = Math.max(iz * GRAVEL_CELL - eye.z, 0, eye.z - (iz + 1) * GRAVEL_CELL);
      if (dx * dx + dz * dz > range * range) continue;
      const key = `${ix},${iz}`;
      if (!cells.has(key)) cells.set(key, gravelCell(ix, iz, terrain, geology, seed));
      const stones = cells.get(key);
      for (let p = 0; p < stones.length; p += GRAVEL_FLOATS) {
        const radius = stones[p + 18], d2 = (stones[p + 16] - eye.x) ** 2 + (stones[p + 17] - eye.z) ** 2;
        // A stone is dropped once it would cover about a pixel.
        const limit = Math.min(range, Math.max(13, radius * 520));
        if (d2 > limit * limit || stones[p + 20] > density / 1.4) continue;
        const slot = ((p / GRAVEL_FLOATS) & 1) * 2 + (d2 < 144 ? 1 : 0), mesh = meshes[slot], k = counts[slot];
        if (k >= GRAVEL_CAPACITY) continue;
        mesh.instanceMatrix.array.set(stones.subarray(p, p + 16), k * 16);
        mesh.instanceColor.array.fill(stones[p + 19], k * 3, k * 3 + 3); counts[slot] = k + 1;
      }
    }
    total = 0;
    meshes.forEach((mesh, slot) => {
      mesh.count = counts[slot]; total += counts[slot];
      mesh.boundingSphere.center.set(eye.x, eye.y ?? 0, eye.z); mesh.boundingSphere.radius = (slot & 1 ? 12 : range) + 3;
      if (!counts[slot]) return;
      mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, counts[slot] * 16); mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.clearUpdateRanges(); mesh.instanceColor.addUpdateRange(0, counts[slot] * 3); mesh.instanceColor.needsUpdate = true;
    });
    // Forget the ground left far behind.
    if (cells.size > 900) for (const key of cells.keys()) {
      const [ix, iz] = key.split(",").map(Number);
      if (Math.abs(ix - cx) > reach * 2 || Math.abs(iz - cz) > reach * 2) cells.delete(key);
    }
    return true;
  };
  return { update, meshes, count: () => total,
    dispose() { for (const mesh of meshes) { scene.remove(mesh); mesh.geometry.dispose(); mesh.dispose(); } } };
}
