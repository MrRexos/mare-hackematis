import { MOON_RADIUS, PATCH_SIZE, dot, localToLunar, randomSeed, rasterPoint, sampleRaster, sampleRasterSmooth, surfaceAt } from "./coordinates.js";

// Relief below the resolution of the elevation model. The measured DEM fixes
// every hill and every crater it can resolve; what it cannot resolve is filled
// with a crater population that follows lunar statistics. Nothing here is a
// measurement of the chosen place.

/** Samples per side of the walkable surface: 1000 m / 2048 = 0.49 m. */
export const FINE_CELLS = 2048;
/** Lunar equilibrium population, Trask (1966): N(>D) = 10^-1.1 · D^-2 craters per m². */
export const EQUILIBRIUM_DENSITY = 0.0794;
/**
 * Share of that population still worth drawing. Most equilibrium craters are
 * worn down to dimples a few centimetres deep that nobody standing there would
 * pick out; a walker sees a handful of craters, not a field of them. This
 * share is a visual choice checked against Apollo surface photographs.
 */
export const VISIBLE_SHARE = 0.26;

const smooth = (t) => t * t * (3 - 2 * t);
const ramp = (lo, hi, v) => smooth(Math.max(0, Math.min(1, (v - lo) / (hi - lo))));

function hash2(ix, iz, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + seed) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1], cheap enough for millions of samples. */
export function valueNoise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z), u = smooth(x - ix), v = smooth(z - iz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** What the DEM leaves out depends on its sample spacing. */
export function reliefOptions(resolutionM = 240) {
  const maxD = Math.max(16, Math.min(140, resolutionM * 4));
  return { minD: 2, maxD, undulation: resolutionM > 60 ? 0.9 : resolutionM > 8 ? 0.4 : 0.22 };
}

/**
 * Craters between minD and maxD metres across the patch, largest first.
 * `fresh` runs from 0 (a ghost dimple) to 1 (sharp rim, blocky ejecta); most of
 * an equilibrium population is old and subdued.
 */
export function craterPopulation(seed, { size = PATCH_SIZE, minD = 2, maxD = 20, density = EQUILIBRIUM_DENSITY * VISIBLE_SHARE } = {}) {
  const random = randomSeed((seed ^ 0x5eedc4a7) >>> 0), craters = [];
  const lo = minD ** -2, hi = maxD ** -2, count = Math.round(density * size * size * (lo - hi));
  const make = (x, z, d, fresh) => {
    const fresh01 = Math.max(0, Math.min(1, fresh));
    // Small craters in regolith are shallow even when new (Stopar et al. 2017).
    const depth = d * (0.11 + 0.07 * ramp(25, 200, d)) * (0.1 + 0.9 * fresh01 ** 1.4);
    // No crater is a perfect circle: two slow lobes bend the outline by up to a tenth.
    const bend = [random() * 0.07, random() * Math.PI * 2, random() * 0.045, random() * Math.PI * 2];
    return { x, z, d, r: d / 2, fresh: fresh01, depth, rim: 0.034 * d * fresh01 ** 1.3, sharp: ramp(0.4, 0.92, fresh01),
      lobes: [bend[0] * Math.cos(bend[1]), bend[0] * Math.sin(bend[1]), bend[2] * Math.cos(bend[3]), bend[2] * Math.sin(bend[3])] };
  };
  for (let k = 0; k < count; k++) {
    const d = (lo - random() * (lo - hi)) ** -0.5;
    // Nine in ten are old and soft; a sharp rim is the exception.
    const x = (random() - 0.5) * size, z = (random() - 0.5) * size, fresh = random() ** 5;
    // A crater that reaches the edge of the measured kilometre would be cut by it.
    if (d > 12 && Math.max(Math.abs(x), Math.abs(z)) + d * 0.75 > size / 2 - 30) continue;
    // Keep the arrival point on open ground.
    if (d > 3.5 && Math.hypot(x, z) < d * 0.75 + 2.5) continue;
    craters.push(make(x, z, d, fresh));
  }
  // One young, blocky crater within a short walk, so there is always something to reach.
  const angle = random() * Math.PI * 2, reach = 30 + random() * 14;
  craters.push(make(Math.cos(angle) * reach, Math.sin(angle) * reach, Math.min(maxD * 0.7, 9 + random() * 5), 0.86 + random() * 0.12));
  craters.sort((a, b) => b.d - a.d);

  // A younger, larger crater wipes out what lay inside it and buries what lay close.
  const cellSize = Math.max(8, maxD), index = new Map(), kept = [];
  const key = (x, z) => `${Math.floor(x / cellSize)},${Math.floor(z / cellSize)}`;
  for (const c of craters) {
    let erased = false;
    const cx = Math.floor(c.x / cellSize), cz = Math.floor(c.z / cellSize);
    for (let iz = cz - 1; iz <= cz + 1 && !erased; iz++) for (let ix = cx - 1; ix <= cx + 1 && !erased; ix++) {
      for (const big of index.get(`${ix},${iz}`) || []) {
        if (big.fresh <= c.fresh || big.d < c.d * 1.5) continue;
        const q = Math.hypot(c.x - big.x, c.z - big.z) / big.r;
        if (q < 0.95 || (q < 1.5 && hash2(Math.round(c.x * 16), Math.round(c.z * 16), seed) < (1.5 - q) * 1.4 * big.fresh)) { erased = true; break; }
      }
    }
    if (erased) continue;
    kept.push(c);
    if (c.d >= 6) { const k = key(c.x, c.z); if (!index.has(k)) index.set(k, []); index.get(k).push(c); }
  }
  return kept;
}

/** Height of one crater at `q` radii from its centre: bowl, raised rim, thinning ejecta. */
function sharpProfile(c, q) {
  return q < 1 ? -c.depth + (c.depth + c.rim) * q * q : q < 3 ? c.rim / (q * q * q) * (1 - ramp(2.1, 3, q)) : 0;
}
export function craterHeight(c, q) {
  if (q >= 3) return 0;
  const soft = -c.depth * Math.exp(-1.7 * q * q);
  if (c.sharp <= 0) return soft;
  // A real rim crest is rounded: average the profile over a tenth of the radius.
  const sharp = (sharpProfile(c, Math.max(0, q - 0.06)) + 2 * sharpProfile(c, q) + sharpProfile(c, q + 0.06)) / 4;
  return soft + (sharp - soft) * c.sharp;
}

/** Adds every crater to a square grid of n × n samples that spans `size` metres. */
export function stampCraters(grid, n, size, craters) {
  const cell = size / (n - 1), half = size / 2;
  for (const c of craters) {
    const reach = c.r * 3;
    const j0 = Math.max(0, Math.ceil((c.x - reach + half) / cell)), j1 = Math.min(n - 1, Math.floor((c.x + reach + half) / cell));
    const i0 = Math.max(0, Math.ceil((c.z - reach + half) / cell)), i1 = Math.min(n - 1, Math.floor((c.z + reach + half) / cell));
    for (let i = i0; i <= i1; i++) {
      const dz = i * cell - half - c.z;
      for (let j = j0; j <= j1; j++) {
        const dx = j * cell - half - c.x, r2 = dx * dx + dz * dz;
        if (r2 >= reach * reach) continue;
        let q = Math.sqrt(r2) / c.r;
        if (c.lobes && r2 > 1e-6) {
          const cos = dx / (q * c.r), sin = dz / (q * c.r), cos2 = cos * cos - sin * sin, sin2 = 2 * cos * sin;
          q *= 1 + c.lobes[0] * cos2 + c.lobes[1] * sin2 + c.lobes[2] * (cos2 * cos - sin2 * sin) + c.lobes[3] * (sin2 * cos + cos2 * sin);
        }
        if (q < 3) grid[i * n + j] += craterHeight(c, q);
      }
    }
  }
  return grid;
}

/** Gentle hummocks tens of metres across, evaluated at (x, z) in metres. */
export function undulation(x, z, seed, amplitude) {
  let total = 0, gain = 1, norm = 0;
  for (const wave of [150, 71, 34, 17]) {
    total += (valueNoise(x / wave + 31.7, z / wave - 12.3, seed + wave) - 0.5) * gain; norm += gain; gain *= 0.52;
  }
  return total / norm * amplitude * 4;
}

function halve(source, n) {
  const m = (n - 1) / 2 + 1, out = new Float32Array(m * m), clamp = (v) => Math.max(0, Math.min(n - 1, v));
  for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) {
    let sum = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) sum += source[clamp(2 * i + a) * n + clamp(2 * j + b)] * (2 - Math.abs(a)) * (2 - Math.abs(b));
    out[i * m + j] = sum / 16;
  }
  return out;
}

/** Smoothed copies at half the sampling each time, for the distant terrain. */
export function buildPyramid(heights, n, count = 7) {
  const levels = [heights];
  for (let k = 1; k < count && (n - 1) % 2 === 0 && n > 3; k++) { levels.push(halve(levels[k - 1], n)); n = (n - 1) / 2 + 1; }
  return levels;
}

/**
 * The surface that is drawn and walked on: the DEM, interpolated smoothly, plus
 * the craters and hummocks it cannot resolve. At the edge of the kilometre the
 * added relief fades out and the surface returns to the exact DEM mesh, so it
 * meets the surrounding terrain without a step.
 */
export function buildSurface(raster, terrain, { cells = FINE_CELLS, seed = 1, resolutionM = raster?.resolutionM ?? 240, relief = true } = {}) {
  const size = terrain.size ?? PATCH_SIZE, n = cells + 1, cell = size / cells, half = size / 2;
  const heights = new Float32Array(n * n), frame = terrain.frame;
  if (raster) {
    // The map projection is smooth: solve it on a coarse lattice and interpolate.
    const step = 16, m = cells / step + 1, cols = new Float64Array(m * m), rows = new Float64Array(m * m), tilt = new Float64Array(m * m);
    // A DEM far coarser than the lattice (the whole-Moon one, 1.9 km per sample) is read at the
    // lattice nodes only. That is exact enough, and it avoids interpolating longitudes, which
    // jump at ±180° and spin around the poles.
    const coarse = raster.projection === "cylindrical", nodes = coarse ? new Float64Array(m * m) : null;
    for (let a = 0; a < m; a++) for (let b = 0; b < m; b++) {
      const point = localToLunar(frame, b * step * cell - half, a * step * cell - half), p = a * m + b;
      const [rx, ry] = rasterPoint(raster, point);
      cols[p] = (rx - raster.origin[0]) / raster.pixelSize[0]; rows[p] = (ry - raster.origin[1]) / raster.pixelSize[1];
      tilt[p] = dot(point.unit, frame.up);
      if (coarse) {
        let elevation = sampleRasterSmooth(raster, cols[p], rows[p]);
        if (!Number.isFinite(elevation)) elevation = sampleRaster(raster, rx, ry);
        nodes[p] = (MOON_RADIUS + elevation) * tilt[p] - MOON_RADIUS - terrain.anchorHeight;
      }
    }
    for (let i = 0; i < n; i++) {
      const a = Math.min(m - 2, Math.floor(i / step)), fa = i / step - a;
      for (let j = 0; j < n; j++) {
        const b = Math.min(m - 2, Math.floor(j / step)), fb = j / step - b, p = a * m + b;
        const lerp = (field) => (1 - fa) * ((1 - fb) * field[p] + fb * field[p + 1]) + fa * ((1 - fb) * field[p + m] + fb * field[p + m + 1]);
        if (coarse) { heights[i * n + j] = lerp(nodes); continue; }
        const col = lerp(cols), row = lerp(rows);
        let elevation = sampleRasterSmooth(raster, col, row);
        if (!Number.isFinite(elevation)) elevation = sampleRaster(raster, raster.origin[0] + col * raster.pixelSize[0], raster.origin[1] + row * raster.pixelSize[1]);
        heights[i * n + j] = Number.isFinite(elevation) ? (MOON_RADIUS + elevation) * lerp(tilt) - MOON_RADIUS - terrain.anchorHeight : NaN;
      }
    }
  }
  const options = reliefOptions(resolutionM), craters = relief ? craterPopulation(seed, { size, ...options }) : [];
  const detail = new Float32Array(n * n);
  if (relief) {
    stampCraters(detail, n, size, craters);
    // Hummocks vary slowly: a quarter of the samples is plenty.
    const q = 4, mq = cells / q + 1, coarse = new Float32Array(mq * mq);
    for (let i = 0; i < mq; i++) for (let j = 0; j < mq; j++) coarse[i * mq + j] = undulation(j * q * cell - half, i * q * cell - half, seed, options.undulation);
    for (let i = 0; i < n; i++) {
      const a = Math.min(mq - 2, Math.floor(i / q)), fa = i / q - a;
      for (let j = 0; j < n; j++) {
        const b = Math.min(mq - 2, Math.floor(j / q)), fb = j / q - b, p = a * mq + b;
        detail[i * n + j] += (1 - fa) * ((1 - fb) * coarse[p] + fb * coarse[p + 1]) + fa * ((1 - fb) * coarse[p + mq] + fb * coarse[p + mq + 1]);
      }
    }
  }
  // The centre stays at height zero, as in the measured mesh.
  const centre = detail[(cells / 2) * n + cells / 2];
  for (let i = 0; i < n; i++) {
    const z = i * cell - half;
    for (let j = 0; j < n; j++) {
      const x = j * cell - half, p = i * n + j, inside = half - Math.max(Math.abs(x), Math.abs(z));
      let base = heights[p];
      if (!raster || inside < 12 || !Number.isFinite(base)) {
        const measured = surfaceAt(terrain, Math.max(-half, Math.min(half, x)), Math.max(-half, Math.min(half, z)));
        base = !raster || !Number.isFinite(base) ? measured : measured + (base - measured) * ramp(0, 12, inside);
      }
      heights[p] = base + (detail[p] - centre) * ramp(4, 34, inside);
    }
  }
  return { cells, n, cell, size, heights, craters, options, levels: buildPyramid(heights, n) };
}

/** Height of the walkable surface, bilinear between its samples. */
export function groundAt(terrain, x, z) {
  const surface = terrain.surface;
  if (!surface) return surfaceAt(terrain, x, z);
  const { n, cell, size, heights } = surface, col = (x + size / 2) / cell, row = (z + size / 2) / cell;
  if (!(col >= 0 && row >= 0 && col <= n - 1 && row <= n - 1)) return NaN;
  const j = Math.min(n - 2, Math.floor(col)), i = Math.min(n - 2, Math.floor(row)), fx = col - j, fz = row - i, p = i * n + j;
  return (1 - fz) * ((1 - fx) * heights[p] + fx * heights[p + 1]) + fz * ((1 - fx) * heights[p + n] + fx * heights[p + n + 1]);
}

/** Unit normal of the walkable surface, from the slope over one metre. */
export function groundNormal(terrain, x, z, reach = 0.5) {
  const limit = (terrain.size ?? PATCH_SIZE) / 2 - 0.05, clamp = (v) => Math.max(-limit, Math.min(limit, v));
  const dx = (groundAt(terrain, clamp(x + reach), z) - groundAt(terrain, clamp(x - reach), z)) / (2 * reach);
  const dz = (groundAt(terrain, x, clamp(z + reach)) - groundAt(terrain, x, clamp(z - reach))) / (2 * reach);
  const length = Math.hypot(dx, 1, dz);
  return [-dx / length, 1 / length, -dz / length];
}

/**
 * Tileable field of craters from 12 cm to 2 m for the close-up shading. Returns
 * heights in metres over a square of `tileM` metres that repeats seamlessly.
 */
export function microCraterTile(seed, n = 1024, tileM = 24, minD = 0.12, maxD = 2) {
  const random = randomSeed((seed ^ 0x3c6ef372) >>> 0), grid = new Float32Array(n * n), cell = tileM / n;
  const lo = minD ** -2, hi = maxD ** -2, count = Math.round(EQUILIBRIUM_DENSITY * 0.45 * tileM * tileM * (lo - hi));
  for (let k = 0; k < count; k++) {
    const d = (lo - random() * (lo - hi)) ** -0.5, fresh = random() ** 3.5, x = random() * tileM, z = random() * tileM;
    const c = { r: d / 2, depth: d * 0.11 * (0.12 + 0.88 * fresh ** 1.3), rim: 0.03 * d * fresh ** 1.3, sharp: ramp(0.35, 0.9, fresh) };
    const reach = Math.ceil(c.r * 2.4 / cell), cj = Math.round(x / cell), ci = Math.round(z / cell);
    for (let a = -reach; a <= reach; a++) for (let b = -reach; b <= reach; b++) {
      const q = Math.hypot((cj + b) * cell - x, (ci + a) * cell - z) / c.r;
      if (q < 2.4) grid[((ci + a) % n + n) % n * n + ((cj + b) % n + n) % n] += craterHeight(c, q) * (1 - ramp(1.9, 2.4, q));
    }
  }
  return { heights: grid, n, tileM, cell, count };
}
