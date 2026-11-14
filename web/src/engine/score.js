// Puntuación de viabilidad por píxel (0–100). Es una media ponderada simple
// para que se pueda explicar ("Why this score?"), más unos filtros que
// descartan píxeles por completo.
//
//   score = 100 · Σ wᵢ·fᵢ / Σ wᵢ      (pesos en %, suman 100)
//
// Factores con datos (todos de 0 a 1):
//   sun     fracción de la misión con Sol visible                    [misión]
//   earth   fracción de la misión con la Tierra visible              [misión]
//   slope   1 − pendiente / pendiente máxima                          [LOLA]
//   relief  1 − desnivel local (3 × 3 km) / 600 m                     [LOLA]
//   ice     1 − distancia a sombra permanente / alcance               [LOLA]
// La temperatura se muestra, pero no puntúa (peso 0) hasta tener una fuente.
//
// Filtros: pendiente > máxima, píxel mayoritariamente en sombra permanente,
// noche más larga que la autonomía de baterías (si se activa).

export const RELIEF_MAX_M = 600;

export const FACTORS = [
  { key: "sun", label: "Sunlight", icon: "sun", color: "var(--sun)", hint: "Share of the mission with the Sun above the terrain" },
  { key: "earth", label: "Earth contact", icon: "earth", color: "var(--earth)", hint: "Share of the mission with Earth above the terrain" },
  { key: "slope", label: "Slope", icon: "slope", color: "#8bd17c", hint: "Lower slope scores higher (LOLA, 240 m baseline)" },
  { key: "relief", label: "Terrain", icon: "stone", color: "#b39ddb", hint: "Smaller height range in the surrounding 3 × 3 km scores higher" },
  { key: "temp", label: "Temperature", icon: "thermometer", color: "#f28b54", noData: true, hint: "No temperature data in this build" },
  { key: "ice", label: "Water ice", icon: "droplet", color: "#4fd1c5", hint: "Closer to permanently shadowed regions, where ice may be" },
];
export const FACTOR_KEYS = FACTORS.map((f) => f.key);
export const SCORED_KEYS = FACTORS.filter((f) => !f.noData).map((f) => f.key);

// Pesos relativos de los perfiles. Los factores con datos se normalizan al 100 %.
const RAW_PRESETS = {
  Balanced: { sun: 12, earth: 11, slope: 11, relief: 11, temp: 11, ice: 11 },
  "Power first": { sun: 36, earth: 8, slope: 8, relief: 8, temp: 8, ice: 8 },
  "Earth contact first": { sun: 8, earth: 36, slope: 8, relief: 8, temp: 8, ice: 8 },
  Colonize: { sun: 18, earth: 14, slope: 10, relief: 8, temp: 12, ice: 18 },
  Research: { sun: 10, earth: 10, slope: 8, relief: 6, temp: 6, ice: 12 },
  "Safe landing": { sun: 10, earth: 10, slope: 30, relief: 24, temp: 6, ice: 3 },
};

/** Reparte `total` entre las claves de forma proporcional a `w` (resto mayor). */
function apportion(w, keys, total = 100) {
  const sum = keys.reduce((s, k) => s + (w[k] || 0), 0);
  const out = Object.fromEntries(FACTOR_KEYS.map((k) => [k, 0]));
  if (!keys.length) return out;
  const raw = {};
  let acc = 0;
  for (const k of keys) {
    raw[k] = sum > 0 ? ((w[k] || 0) * total) / sum : total / keys.length;
    out[k] = Math.floor(raw[k]);
    acc += out[k];
  }
  const order = [...keys].sort((a, b) => (raw[b] % 1) - (raw[a] % 1));
  for (let r = total - acc, i = 0; r > 0; r--, i++) out[order[i % order.length]] += 1;
  return out;
}

export const PRESETS = Object.fromEntries(Object.entries(RAW_PRESETS).map(([k, v]) => [k, apportion(v, SCORED_KEYS)]));
export const DEFAULT_WEIGHTS = PRESETS.Balanced;
export const DEFAULT_LIMITS = { maxSlopeDeg: 10, iceReachKm: 10, excludePsr: true, maxNightH: null };

/** Mueve un peso y reparte el resto entre los demás factores con datos (suma 100). */
export function rebalance(w, key, value) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const others = SCORED_KEYS.filter((k) => k !== key);
  const rest = apportion(w, others, 100 - v);
  return { ...rest, [key]: v };
}

export function presetOf(w) {
  return Object.keys(PRESETS).find((p) => FACTOR_KEYS.every((k) => (PRESETS[p][k] || 0) === (w[k] || 0))) || null;
}

/** Desnivel local (m): máximo − mínimo de la elevación en la ventana 3 × 3 km. */
export function reliefLayer(elevation, n) {
  const out = new Float32Array(n * n).fill(NaN);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    let lo = Infinity, hi = -Infinity;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= n || b >= n) continue;
      const e = elevation[a * n + b];
      if (!Number.isFinite(e)) continue;
      if (e < lo) lo = e;
      if (e > hi) hi = e;
    }
    if (hi >= lo) out[i * n + j] = hi - lo;
  }
  return out;
}

/** Factores 0–1 de un píxel (NaN si no hay datos; null si el factor no tiene fuente). */
export function factorsAt(p, mission, layers, limits) {
  const slope = layers.slope?.[p];
  const dist = layers.psrDistKm?.[p];
  const rel = layers.relief?.[p];
  return {
    sun: mission ? mission.sun[p] : NaN,
    earth: mission ? mission.earth[p] : NaN,
    slope: Number.isFinite(slope) ? Math.max(0, 1 - slope / limits.maxSlopeDeg) : NaN,
    relief: Number.isFinite(rel) ? Math.max(0, 1 - rel / RELIEF_MAX_M) : NaN,
    ice: Number.isFinite(dist) ? Math.max(0, 1 - dist / limits.iceReachKm) : NaN,
    temp: null,
  };
}

/** Motivo por el que un píxel queda descartado, o null. */
export function exclusionAt(p, mission, layers, limits) {
  const slope = layers.slope?.[p];
  if (!Number.isFinite(slope)) return "No terrain data";
  if (slope > limits.maxSlopeDeg) return `Slope ${slope.toFixed(0)}° is above ${limits.maxSlopeDeg}°`;
  if (limits.excludePsr && layers.psrShare?.[p] > 0.5) return "Mostly in permanent shadow";
  if (mission && limits.maxNightH != null && mission.night[p] > limits.maxNightH) return "Night longer than battery autonomy";
  if (mission && !Number.isFinite(mission.sun[p])) return "No horizon data";
  return null;
}

/** Puntuación a partir de factores 0–1 ya calculados (sin filtros). */
export function scoreFromFactors(f, weights) {
  let s = 0, ws = 0;
  for (const k of SCORED_KEYS) {
    const w = weights[k] || 0;
    if (!w || !Number.isFinite(f[k])) continue;
    s += w * f[k];
    ws += w;
  }
  return ws ? (100 * s) / ws : NaN;
}

/** Puntuación de toda la malla. Devuelve Float32Array con NaN = descartado. */
export function scoreGrid(mission, layers, weights, limits) {
  const n = layers.slope.length;
  const out = new Float32Array(n);
  const keys = SCORED_KEYS.filter((k) => weights[k] > 0 && (mission || (k !== "sun" && k !== "earth")));
  const wsum = keys.reduce((a, k) => a + weights[k], 0) || 1;
  for (let p = 0; p < n; p++) {
    if (exclusionAt(p, mission, layers, limits)) { out[p] = NaN; continue; }
    const f = factorsAt(p, mission, layers, limits);
    let s = 0;
    let ok = true;
    for (const k of keys) {
      if (!Number.isFinite(f[k])) { ok = false; break; }
      s += weights[k] * f[k];
    }
    out[p] = ok ? (100 * s) / wsum : NaN;
  }
  return out;
}
