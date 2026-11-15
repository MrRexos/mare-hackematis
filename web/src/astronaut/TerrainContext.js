import { dot, localToLunar, MOON_RADIUS, rasterPoint, sampleRaster } from "./coordinates.js";

// Regional and local DEMs may disagree at the boundary. Join every native edge
// vertex through a transition outside the walkable kilometer. Its measured
// vertices and full collision mesh remain untouched.
export function buildTerrainContext(raster, terrain) {
  const edge = 750, axis = [];
  for (let x = -16000; x <= 16000; x += 250) if (Math.abs(x) > edge) axis.push(x);
  axis.push(-edge, edge); axis.sort((a, b) => a - b);
  const n = axis.length, positions = [], uv = [], valid = [], indices = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = axis[j], z = axis[i], point = localToLunar(terrain.frame, x, z);
    const h = sampleRaster(raster, ...rasterPoint(raster, point));
    valid.push(Number.isFinite(h));
    positions.push(x, Number.isFinite(h) ? (MOON_RADIUS + h) * dot(point.unit, terrain.frame.up) - MOON_RADIUS - terrain.anchorHeight : 0, z);
    uv.push(x / 8, -z / 8);
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < n - 1; j++) {
    if (axis[i] === -edge && axis[j] === -edge) continue;
    const a = i * n + j, b = a + 1, c = a + n, d = c + 1;
    if (valid[a] && valid[b] && valid[c] && valid[d]) indices.push(a, c, b, b, c, d);
  }
  const lo = axis.indexOf(-edge), hi = axis.indexOf(edge);
  const outer = [lo * n + lo, lo * n + hi, hi * n + hi, hi * n + lo];
  const inner = new Map(), count = terrain.segments, row = count + 1;
  const sourceIndex = (side, k) => side === 0 ? k : side === 1 ? k * row + count : side === 2 ? count * row + count - k : (count - k) * row;
  for (let side = 0; side < 4; side++) {
    const a = outer[side], b = outer[(side + 1) % 4];
    if (!valid[a] || !valid[b]) continue;
    const boundary = [];
    for (let k = 0; k <= count; k++) {
      const p = sourceIndex(side, k);
      if (!inner.has(p)) {
        inner.set(p, positions.length / 3);
        const [x, y, z] = terrain.positions.subarray(p * 3, p * 3 + 3);
        positions.push(x, y, z); uv.push(x / 8, -z / 8);
      }
      boundary.push(inner.get(p));
    }
    for (let k = 0; k < count; k++) indices.push(a, boundary[k], boundary[k + 1]);
    indices.push(a, boundary[count], b);
  }
  return { positions: new Float32Array(positions), uv: new Float32Array(uv), indices: new Uint32Array(indices) };
}
