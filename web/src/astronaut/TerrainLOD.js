import * as THREE from "three";

/** Cells along one side of every terrain node, whatever its size. */
export const NODE_CELLS = 32;

/** Levels of the quadtree: its smallest nodes use the full-resolution samples. */
export const treeDepth = (surface) => Math.min(surface.levels.length - 1, Math.round(Math.log2(surface.cells / NODE_CELLS)));

/**
 * Nodes to draw for an observer at (x, z). A node splits into four while the
 * observer is closer than `detail` times its width, so triangles stay roughly
 * the same size on screen: half-metre cells underfoot, coarse ones far away.
 * Seen from eye height the ground is so foreshortened that finer cells further
 * out would be thinner than a pixel and only cost shading time.
 */
export function selectNodes(x, z, { size = 1000, depth = 6, detail = 0.4 } = {}) {
  const nodes = [];
  const visit = (level, ix, iz) => {
    const span = size / (1 << level), x0 = ix * span - size / 2, z0 = iz * span - size / 2;
    const dx = Math.max(x0 - x, 0, x - x0 - span), dz = Math.max(z0 - z, 0, z - z0 - span);
    if (level < depth && Math.hypot(dx, dz) < span * detail) {
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) visit(level + 1, ix * 2 + b, iz * 2 + a);
    } else nodes.push({ level, ix, iz, key: `${level}:${ix}:${iz}` });
  };
  visit(0, 0, 0);
  return nodes;
}

let sharedIndices;
/** Triangles of a node: the grid, facing up, then a two-sided skirt along each edge. */
export function nodeIndices() {
  if (sharedIndices) return sharedIndices;
  const c = NODE_CELLS, row = c + 1, result = [];
  for (let i = 0; i < c; i++) for (let j = 0; j < c; j++) {
    const a = i * row + j, b = a + 1, d = a + row, e = d + 1;
    result.push(a, d, b, b, d, e);
  }
  const edge = [(k) => k, (k) => k * row + c, (k) => c * row + c - k, (k) => (c - k) * row];
  for (let side = 0; side < 4; side++) for (let k = 0; k < c; k++) {
    const a = edge[side](k), b = edge[side](k + 1), a2 = row * row + side * row + k, b2 = a2 + 1;
    result.push(a, a2, b, b, a2, b2, a, b, a2, b, b2, a2);
  }
  return sharedIndices = new Uint16Array(result);
}

/**
 * Vertices of one node, in metres. Normals come from the slope of the node's
 * own level of detail, sampled across its edges so neighbours shade alike. A
 * skirt along each edge hides the hairline gaps between two levels; `skirt`
 * says how far the shader lowers each of its vertices.
 */
export function nodeVertices(surface, level, ix, iz, tile = 8) {
  const depth = treeDepth(surface), heights = surface.levels[depth - level], n = (surface.cells >> (depth - level)) + 1;
  const cell = surface.size / (n - 1), half = surface.size / 2, c = NODE_CELLS, row = c + 1, count = row * row + 4 * row;
  const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3), uv = new Float32Array(count * 2), skirt = new Float32Array(count);
  const at = (i, j) => heights[Math.max(0, Math.min(n - 1, i)) * n + Math.max(0, Math.min(n - 1, j))];
  for (let a = 0; a <= c; a++) for (let b = 0; b <= c; b++) {
    const i = iz * c + a, j = ix * c + b, p = a * row + b, x = j * cell - half, z = i * cell - half;
    const dx = (at(i, j + 1) - at(i, j - 1)) / (2 * cell), dz = (at(i + 1, j) - at(i - 1, j)) / (2 * cell), length = Math.hypot(dx, 1, dz);
    positions.set([x, heights[i * n + j], z], p * 3); normals.set([-dx / length, 1 / length, -dz / length], p * 3);
    uv.set([x / tile, -z / tile], p * 2);
  }
  const edge = [(k) => k, (k) => k * row + c, (k) => c * row + c - k, (k) => (c - k) * row], drop = cell * 1.5 + 0.25;
  for (let side = 0; side < 4; side++) for (let k = 0; k <= c; k++) {
    const from = edge[side](k), to = row * row + side * row + k;
    // The drop is applied by the surface shader only. In the shadow pass the skirt
    // stays folded on the edge: a wall there would shade the ground behind it at low Sun.
    positions.set(positions.subarray(from * 3, from * 3 + 3), to * 3); skirt[to] = drop;
    normals.set(normals.subarray(from * 3, from * 3 + 3), to * 3); uv.set(uv.subarray(from * 2, from * 2 + 2), to * 2);
  }
  return { positions, normals, uv, skirt, cell };
}

/**
 * Draws the walkable kilometre as a quadtree of equal-sized grids. Nodes are
 * built when first needed and the least recently used ones are released.
 */
export function addTerrainLOD(scene, surface, material, { tile = 8, detail = 0.4, capacity = 320 } = {}) {
  const depth = treeDepth(surface), cache = new Map(), indices = nodeIndices();
  let active = new Set(), lastX = Infinity, lastZ = Infinity, lastDetail = detail, lastDepth = depth, tick = 0;
  const build = (node) => {
    const data = nodeVertices(surface, node.level, node.ix, node.iz, tile), geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(data.uv, 2));
    geometry.setAttribute("lunarSkirt", new THREE.BufferAttribute(data.skirt, 1));
    // One typed array, one GPU buffer per node: a released node cannot take a neighbour's indices with it.
    geometry.setIndex(new THREE.BufferAttribute(indices, 1)); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = true; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
    scene.add(mesh);
    return { mesh, geometry, used: 0 };
  };
  const release = (entry) => { scene.remove(entry.mesh); entry.geometry.dispose(); };
  const update = (eye, nextDetail = lastDetail, finest = depth) => {
    const nextDepth = Math.min(depth, finest);
    if (nextDetail === lastDetail && nextDepth === lastDepth && (eye.x - lastX) ** 2 + (eye.z - lastZ) ** 2 < 2.25) return false;
    lastX = eye.x; lastZ = eye.z; lastDetail = nextDetail; lastDepth = nextDepth; tick++;
    const wanted = new Set();
    for (const node of selectNodes(eye.x, eye.z, { size: surface.size, depth: nextDepth, detail: nextDetail })) {
      if (!cache.has(node.key)) cache.set(node.key, build(node));
      const entry = cache.get(node.key); entry.used = tick; entry.mesh.visible = true; wanted.add(node.key);
    }
    let changed = wanted.size !== active.size;
    for (const key of active) if (!wanted.has(key)) { cache.get(key).mesh.visible = false; changed = true; }
    active = wanted;
    if (cache.size > capacity) {
      const idle = [...cache].filter(([key]) => !wanted.has(key)).sort((a, b) => a[1].used - b[1].used);
      for (const [key, entry] of idle.slice(0, cache.size - capacity)) { release(entry); cache.delete(key); }
    }
    return changed;
  };
  return { update, depth,
    stats: () => ({ nodes: active.size, cached: cache.size, triangles: active.size * NODE_CELLS * NODE_CELLS * 2 }),
    dispose() { cache.forEach(release); cache.clear(); active.clear(); } };
}
