import * as THREE from "three";
import { randomSeed, seedAt, surfaceAt } from "./coordinates.js";
import { createSurfaceGeology } from "./SurfaceGeology.js";

export function rockPlacements(terrain, density = 1, geology = createSurfaceGeology(terrain.lat, terrain.lon), variants = 4) {
  const seed = seedAt(terrain.lat, terrain.lon), random = randomSeed(seed), rocks = [];
  const regularCount = Math.round(6800 * density + geology.patches.length * 820 * density);
  const fineBackground = 42000 * density;
  const fineCount = Math.round(fineBackground + geology.patches.length * 1800 * density);
  const count = regularCount + fineCount;
  const occupied = new Map(), cellSize = 8;
  for (let k = 0; k < count; k++) {
    const fine = k >= regularCount;
    let x, z;
    if (k < 6800 * density || (fine && k - regularCount < fineBackground)) { x = (random() - 0.5) * 998; z = (random() - 0.5) * 998; }
    else {
      const p = geology.patches[k % geology.patches.length];
      const angle = random() * Math.PI * 2, distance = Math.sqrt(random()) * 1.3;
      const u = Math.cos(angle) * distance * p.a, v = Math.sin(angle) * distance * p.b;
      x = p.x + u * p.cos - v * p.sin; z = p.z + u * p.sin + v * p.cos;
    }
    if (Math.abs(x) > 499 || Math.abs(z) > 499) continue;
    if (Math.hypot(x, z) < (fine ? 1.1 : 4)) continue;
    const y = surfaceAt(terrain, x, z);
    const dx = (surfaceAt(terrain, Math.min(499.9, x + 0.5), z) - surfaceAt(terrain, Math.max(-499.9, x - 0.5), z));
    const dz = (surfaceAt(terrain, x, Math.min(499.9, z + 0.5)) - surfaceAt(terrain, x, Math.max(-499.9, z - 0.5)));
    if (![y, dx, dz].every(Number.isFinite)) continue;
    const slope = Math.hypot(dx, dz);
    const patch = geology.sample(x, z);
    if (random() > (fine ? 0.18 + patch.rocky * 0.76 : 0.075 + patch.rocky * 0.78) / (1 + slope * 0.8)) continue;
    const roll = random(), radius = fine ? 0.018 + roll ** 1.8 * 0.072 : roll > 0.993 ? 0.95 + random() * 1.25 : roll > 0.87 ? 0.3 + random() ** 2 * 0.58 : 0.045 + random() ** 2 * 0.23;
    // Avoid interpenetrating boulders and piles that look like dropped props.
    const cx = Math.floor(x / cellSize), cz = Math.floor(z / cellSize);
    if (radius >= 0.3) {
      let overlaps = false;
      for (let iz = cz - 1; iz <= cz + 1 && !overlaps; iz++) for (let ix = cx - 1; ix <= cx + 1 && !overlaps; ix++) {
        overlaps = (occupied.get(`${ix},${iz}`) || []).some((r) => (x - r.x) ** 2 + (z - r.z) ** 2 < ((r.radius + radius) * 1.05) ** 2);
      }
      if (overlaps) continue;
    }
    const rock = { x, y, z, radius, fine, yaw: random() * Math.PI * 2, variant: Math.floor(random() * variants), coverage: random(),
      normal: new THREE.Vector3(-dx, 1, -dz).normalize().toArray(), shade: 0.87 + random() * 0.23 };
    rocks.push(rock);
    if (radius >= 0.3) {
      const key = `${cx},${cz}`;
      if (!occupied.has(key)) occupied.set(key, []);
      occupied.get(key).push(rock);
    }
  }
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
      dummy.position.set(r.x, r.y + r.radius * (asset ? -0.10 : 0.25), r.z);
      dummy.quaternion.setFromUnitVectors(up, normal); dummy.rotateY(r.yaw); dummy.scale.setScalar(r.radius); dummy.updateMatrix();
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
        for (let k = 0; k < count; k++) {
          const index = batch.selected[k];
          mesh.instanceMatrix.array.set(batch.matrices.subarray(index * 16, index * 16 + 16), k * 16);
          mesh.instanceColor.array.set(batch.colors.subarray(index * 3, index * 3 + 3), k * 3);
        }
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
