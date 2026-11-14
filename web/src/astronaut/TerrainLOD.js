import * as THREE from "three";

/** Render-only LOD. The full scientific mesh remains the collision surface.
 * Native edge vertices are retained at both levels, so adjacent tiles join.
 */
export function coarseTileIndices(rows, cols, stride) {
  const result = [], index = (i, j) => i * (cols + 1) + j;
  for (let i = 0; i < rows; i += stride) for (let j = 0; j < cols; j += stride) {
    const endI = Math.min(rows, i + stride), endJ = Math.min(cols, j + stride);
    const a = index(i, j), b = index(i, endJ), c = index(endI, j), d = index(endI, endJ);
    if ((i !== 0 && j !== 0 && endI !== rows && endJ !== cols) || endI - i < 2 || endJ - j < 2) {
      result.push(a, c, b, b, c, d); continue;
    }
    const ring = [a];
    if (i === 0) for (let col = j + 1; col < endJ; col++) ring.push(index(i, col));
    ring.push(b);
    if (endJ === cols) for (let row = i + 1; row < endI; row++) ring.push(index(row, endJ));
    ring.push(d);
    if (endI === rows) for (let col = endJ - 1; col > j; col--) ring.push(index(endI, col));
    ring.push(c);
    if (j === 0) for (let row = endI - 1; row > i; row--) ring.push(index(row, j));
    const center = index(Math.floor((i + endI) / 2), Math.floor((j + endJ) / 2));
    for (let k = 0; k < ring.length; k++) result.push(center, ring[(k + 1) % ring.length], ring[k]);
  }
  return new Uint32Array(result);
}

export function addTerrainLOD(scene, terrain, source, material, geometries) {
  const { segments, positions } = terrain, n = segments + 1;
  const tileStep = Math.ceil(segments / 10), groups = [];
  const stride = Math.max(2, Math.round(20 / (terrain.size / segments)));
  for (let row = 0; row < segments; row += tileStep) for (let col = 0; col < segments; col += tileStep) {
    const rows = Math.min(tileStep, segments - row), cols = Math.min(tileStep, segments - col);
    const count = (rows + 1) * (cols + 1), local = new Float32Array(count * 3), normal = new Float32Array(count * 3), uv = new Float32Array(count * 2);
    const centerP = (row + Math.floor(rows / 2)) * n + col + Math.floor(cols / 2);
    const center = new THREE.Vector3().fromArray(positions, centerP * 3), indices = [];
    for (let i = 0; i <= rows; i++) for (let j = 0; j <= cols; j++) {
      const p = (row + i) * n + col + j, q = i * (cols + 1) + j;
      local.set([positions[p * 3] - center.x, positions[p * 3 + 1] - center.y, positions[p * 3 + 2] - center.z], q * 3);
      normal.set(source.attributes.normal.array.subarray(p * 3, p * 3 + 3), q * 3);
      uv.set(source.attributes.uv.array.subarray(p * 2, p * 2 + 2), q * 2);
      if (i < rows && j < cols) { const a = q, b = q + 1, c = q + cols + 1, d = c + 1; indices.push(a, c, b, b, c, d); }
    }
    const fine = new THREE.BufferGeometry();
    fine.setAttribute("position", new THREE.BufferAttribute(local, 3));
    fine.setAttribute("normal", new THREE.BufferAttribute(normal, 3)); fine.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    fine.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1)); fine.computeBoundingSphere();
    const coarse = new THREE.BufferGeometry();
    for (const key of ["position", "normal", "uv"]) coarse.setAttribute(key, fine.attributes[key]);
    coarse.setIndex(new THREE.BufferAttribute(coarseTileIndices(rows, cols, stride), 1)); coarse.computeBoundingSphere();
    const group = new THREE.LOD(); group.position.copy(center);
    for (const [geometry, distance] of [[fine, 0], [coarse, 200]]) {
      geometries.add(geometry);
      const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = true; mesh.receiveShadow = true;
      group.addLevel(mesh, distance, 0.1);
    }
    scene.add(group); groups.push(group);
  }
  return { setDistance(distance) { groups.forEach((group) => { group.levels[1].distance = distance; }); } };
}
