import { randomSeed, seedAt } from "./coordinates.js";

const smooth = (t) => t * t * (3 - 2 * t);
const mix = (a, b, t) => a + (b - a) * t;
const ramp = (lo, hi, value) => smooth(Math.max(0, Math.min(1, (value - lo) / (hi - lo))));
const hash = (x, z, seed) => {
  const n = Math.sin(x * 127.1 + z * 311.7 + seed % 8191) * 43758.5453;
  return n - Math.floor(n);
};
export function surfaceNoise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z), u = smooth(x - ix), v = smooth(z - iz);
  return mix(mix(hash(ix, iz, seed), hash(ix + 1, iz, seed), u), mix(hash(ix, iz + 1, seed), hash(ix + 1, iz + 1, seed), u), v);
}

// Decorative geology only. This field affects reflectance and rock abundance,
// never measured elevation. Elongated ejecta patches leave broad open plains.
export function createSurfaceGeology(lat, lon) {
  const seed = seedAt(lat, lon), random = randomSeed(seed ^ 0x713b), patches = [];
  for (let k = 0; k < 19; k++) {
    const angle = random() * Math.PI * 2;
    patches.push({ x: k === 0 ? 24 : k === 1 ? -42 : (random() - 0.5) * 880,
      z: k === 0 ? -32 : k === 1 ? 27 : (random() - 0.5) * 880,
      a: 17 + random() * 34, b: 9 + random() * 19, cos: Math.cos(angle), sin: Math.sin(angle), abundance: 0.65 + random() * 0.35 });
  }
  const sample = (x, z) => {
    let rocky = 0;
    for (const p of patches) {
      const dx = x - p.x, dz = z - p.z;
      const u = (dx * p.cos + dz * p.sin) / p.a, v = (-dx * p.sin + dz * p.cos) / p.b;
      rocky = Math.max(rocky, Math.exp(-(u * u + v * v) * 1.5) * p.abundance);
    }
    const broad = surfaceNoise(x / 94, z / 94, seed), broken = surfaceNoise(x / 7, z / 7, seed + 73);
    return { rocky: rocky * (0.6 + broken * 0.4), broad, broken };
  };
  const surfaceRockiness = (x, z, field = sample(x, z)) => {
    // Dispersed wisps replace the saturated oval. Broad, warped falloff and
    // smaller gaps let sand run through the scree instead of outlining a spot.
    const wx = x + (surfaceNoise(x / 19 + 17, z / 19 - 9, seed + 31) - 0.5) * 11;
    const wz = z + (surfaceNoise(x / 17 - 11, z / 17 + 13, seed + 37) - 0.5) * 9;
    const along = wx * 0.6 - wz * 0.8, across = wx * 0.8 + wz * 0.6;
    const nearby = Math.exp(-(((along - 18) / 22) ** 2 + ((across - 4) / 14) ** 2));
    const wisps = surfaceNoise(x / 5.7 + 13, z / 5.7 - 9, seed + 127) * 0.65
      + surfaceNoise(x / 14 + 7, z / 14 - 13, seed + 173) * 0.35;
    const breakup = 0.15 + ramp(0.18, 0.82, wisps) * 0.85;
    return Math.max(ramp(0.03, 0.50, field.rocky) * (0.48 + field.broken * 0.52), nearby * breakup * 0.9);
  };
  return { seed, patches, sample, surfaceRockiness };
}
