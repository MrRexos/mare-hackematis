// Puntuación de viabilidad por píxel (0–100) del módulo polo sur. Es una media
// ponderada simple para que se pueda explicar ("Why this score?"), más unos
// filtros que descartan píxeles por completo.
//
//   score = 100 · Σ wᵢ·fᵢ / Σ wᵢ      (pesos en %, suman 100)
//
// Solo hay factores con datos oficiales verificados (todos de 0 a 1):
//   sun    fracción de la misión con Sol visible                   [cálculo: LOLA + SPICE]
//   earth  fracción de la misión con la Tierra visible             [cálculo: LOLA + SPICE]
//   slope  1 − pendiente / pendiente máxima                         [LOLA LDSM]
//   rough  1 − rugosidad / ROUGH_MAX_M                              [LOLA LDRM]
//   temp   confort térmico: fracción de horas de la misión con temperatura de superficie
//          trabajable, hora a hora según la hora local (igual que en la Luna entera) [LRO Diviner GCP]
//   ice    1 − distancia a hielo estable a ≤ 0,5 m / alcance        [LRO Diviner PRP]
// Radiación, impactos y valor científico se quitaron: no hay mapas oficiales por sitio.
//
// Filtros: pendiente > máxima, píxel mayoritariamente en sombra permanente (LOLA LPSR),
// noche más larga que la autonomía de baterías (si se activa).

/** Rugosidad (m) a la que el factor llega a 0. LOLA LDRM: desviación de alturas a 30–120 m. */
export const ROUGH_MAX_M = 1.5;
/** Temperatura de la superficie (K) que corresponde a factor 0 y a factor 1 por el lado frío. */
export const TEMP_COLD_K = 50;
export const TEMP_MILD_K = 250;
/**
 * Nota de una hora según la temperatura de la superficie (K), la misma en el polo sur y en la
 * Luna entera: ≤ coldK → 0 · sube hasta 1 en mildK · 1 hasta hotOkK · baja hasta 0 en hotMaxK.
 * 350 K (77 °C) aún puntúa 1; 400 K (127 °C), por encima del máximo ecuatorial, 0.
 */
export const TEMP_BAND = { coldK: TEMP_COLD_K, mildK: TEMP_MILD_K, hotOkK: 350, hotMaxK: 400 };

export const FACTORS = [
  { key: "sun", label: "Sun visibility", icon: "sun", color: "var(--sun)", hint: "Share of the mission with the Sun above the terrain (LOLA + SPICE)" },
  { key: "earth", label: "Earth visibility", icon: "earth", color: "var(--earth)", hint: "Share of the mission with Earth above the terrain (LOLA + SPICE)" },
  { key: "slope", label: "Slope", icon: "slope", color: "#8bd17c", hint: "Lower slope scores higher (LOLA LDSM, 240 m)" },
  { key: "rough", label: "Roughness", icon: "relief", color: "#b39ddb", hint: `Smoother ground scores higher; 0 at ${ROUGH_MAX_M} m (LOLA LDRM, 30–120 m baseline)` },
  { key: "temp", label: "Thermal comfort", icon: "thermometer", color: "#f28b54", hint: `Share of mission hours with a workable surface temperature: ${TEMP_COLD_K} K → 0, ${TEMP_MILD_K}–${TEMP_BAND.hotOkK} K → 1, ${TEMP_BAND.hotMaxK} K → 0 (LRO Diviner)` },
  { key: "ice", label: "Modelled ice proximity", icon: "droplet", color: "#4fd1c5", hint: "Distance to terrain where ice could persist within 0.5 m (LRO Diviner)" },
];
export const FACTOR_KEYS = FACTORS.map((f) => f.key);
export const SCORED_KEYS = FACTOR_KEYS;

// Perfiles (en %).
const RAW_PRESETS = {
  Balanced: { sun: 22, earth: 18, slope: 16, rough: 14, temp: 12, ice: 18 },
  "Power first": { sun: 50, earth: 10, slope: 12, rough: 10, temp: 10, ice: 8 },
  "Earth contact first": { sun: 12, earth: 50, slope: 12, rough: 10, temp: 8, ice: 8 },
  Colonize: { sun: 24, earth: 16, slope: 12, rough: 10, temp: 14, ice: 24 },
  "Ice prospecting": { sun: 18, earth: 10, slope: 10, rough: 8, temp: 4, ice: 50 },
  "Safe landing": { sun: 12, earth: 12, slope: 34, rough: 30, temp: 6, ice: 6 },
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
// minEarthPct: % mínimo de la misión con la Tierra visible (enlace directo); null = sin límite.
export const DEFAULT_LIMITS = { maxSlopeDeg: 10, iceReachKm: 10, excludePsr: true, maxNightH: null, minEarthPct: null };

/** Mueve un peso y reparte el resto entre los demás factores (suma 100). */
export function rebalance(w, key, value) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const others = SCORED_KEYS.filter((k) => k !== key);
  const rest = apportion(w, others, 100 - v);
  return { ...rest, [key]: v };
}

export function presetOf(w) {
  return Object.keys(PRESETS).find((p) => FACTOR_KEYS.every((k) => (PRESETS[p][k] || 0) === (w[k] || 0))) || null;
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Factores 0–1 de un píxel (NaN si falta el dato). */
export function factorsAt(p, mission, layers, limits) {
  const slope = layers.slope?.[p];
  const rough = layers.roughness?.[p];
  const tavg = layers.tempAvgK?.[p];
  const iceKm = layers.iceDistKm?.[p];
  return {
    sun: mission ? mission.sun[p] : NaN,
    earth: mission ? mission.earth[p] : NaN,
    slope: Number.isFinite(slope) ? clamp01(1 - slope / limits.maxSlopeDeg) : NaN,
    rough: Number.isFinite(rough) ? clamp01(1 - rough / ROUGH_MAX_M) : NaN,
    // Con misión calculada: nota hora a hora (mission.tfit). Sin ella, la media anual del subsuelo.
    temp: mission?.tfit ? mission.tfit[p] : Number.isFinite(tavg) ? clamp01((tavg - TEMP_COLD_K) / (TEMP_MILD_K - TEMP_COLD_K)) : NaN,
    ice: Number.isFinite(iceKm) ? clamp01(1 - iceKm / limits.iceReachKm) : NaN,
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
  if (mission && limits.minEarthPct != null && mission.earth[p] * 100 < limits.minEarthPct) return `Earth in view ${Math.round(mission.earth[p] * 100)}% of the mission, below ${limits.minEarthPct}%`;
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
