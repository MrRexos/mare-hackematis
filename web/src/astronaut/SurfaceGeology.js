import { seedAt } from "./coordinates.js";
import { craterPopulation, reliefOptions, valueNoise } from "./SurfaceRelief.js";

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

/** How thickly a blocky crater strews rock at `q` radii from its centre. */
export function ejectaDensity(q) {
  return q < 1 ? 0.3 + 0.7 * ramp(0.25, 1, q) : q < 1.2 ? 1 : q < 4.2 ? (1.2 / q) ** 2.6 * (1 - ramp(3.4, 4.2, q)) : 0;
}

// Decorative geology only: where rock lies and how gravelly the soil looks. It
// follows the generated craters, because on the Moon rock comes from impacts:
// young craters keep blocks on their rims and rays, old ground is bare.
export function createSurfaceGeology(lat, lon, { craters, resolutionM = 240 } = {}) {
  const seed = seedAt(lat, lon), population = craters ?? craterPopulation(seed, reliefOptions(resolutionM)), fields = [];
  for (const c of population) {
    if (c.d < 5 || c.fresh < 0.45) continue;
    const luck = hash(c.x * 0.37, c.z * 0.37, seed + 911);
    // Larger craters dig below the regolith and bring up more and bigger blocks.
    let blocky = c.fresh * (0.35 + 0.65 * ramp(8, 70, c.d)) * (0.4 + 0.6 * luck);
    const landmark = c.fresh > 0.85 && Math.hypot(c.x, c.z) < 46 && c.d >= 8;
    if (landmark) blocky = Math.max(blocky, 0.7);
    if (blocky < 0.2) continue;
    fields.push({ x: c.x, z: c.z, r: c.r, d: c.d, blocky, landmark, phase: luck * 40 });
  }
  // Ejecta leaves in rays, not as an even ring.
  const ray = (field, angle) => 0.25 + 0.75 * ramp(0.2, 0.82, valueNoise(Math.cos(angle) * 1.15 + field.phase, Math.sin(angle) * 1.15 - field.phase, seed));
  const cell = 80, index = new Map();
  for (const field of fields) {
    const reach = field.r * 4.2;
    for (let iz = Math.floor((field.z - reach) / cell); iz <= Math.floor((field.z + reach) / cell); iz++) {
      for (let ix = Math.floor((field.x - reach) / cell); ix <= Math.floor((field.x + reach) / cell); ix++) {
        const key = `${ix},${iz}`; if (!index.has(key)) index.set(key, []); index.get(key).push(field);
      }
    }
  }
  const sample = (x, z) => {
    let rocky = 0;
    for (const field of index.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`) || []) {
      const dx = x - field.x, dz = z - field.z, q = Math.hypot(dx, dz) / field.r;
      if (q >= 4.2) continue;
      rocky = Math.max(rocky, ejectaDensity(q) * field.blocky * ray(field, Math.atan2(dz, dx)));
    }
    const broad = surfaceNoise(x / 94, z / 94, seed), broken = surfaceNoise(x / 7, z / 7, seed + 73);
    // Away from craters some stretches of regolith are simply more pebbly than others.
    const pebbly = 0.14 * ramp(0.55, 0.9, surfaceNoise(x / 55 + 5, z / 55 - 3, seed + 401));
    return { rocky: Math.max(rocky * (0.6 + broken * 0.4), pebbly), broad, broken };
  };
  const surfaceRockiness = (x, z, field = sample(x, z)) => {
    // Gravelly soil thins out in wisps so sand runs through it instead of outlining a spot.
    const wisps = surfaceNoise(x / 5.7 + 13, z / 5.7 - 9, seed + 127) * 0.65 + surfaceNoise(x / 14 + 7, z / 14 - 13, seed + 173) * 0.35;
    return ramp(0.03, 0.66, field.rocky) * (0.35 + 0.65 * ramp(0.1, 0.9, wisps)) * (0.6 + field.broken * 0.4);
  };
  const landmark = fields.filter((field) => field.landmark).sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0] || null;
  return { seed, craters: population, fields, landmark, ray, sample, surfaceRockiness };
}
