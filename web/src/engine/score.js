// Puntuación de viabilidad por píxel (0–100). Es una media ponderada simple
// para que se pueda explicar ("Why this score?"), más unos filtros que
// descartan píxeles por completo.
//
//   score = 100 · Σ wᵢ·fᵢ / Σ wᵢ
//
// Factores (todos de 0 a 1):
//   sun     fracción del tiempo de misión con Sol visible (disco)      [misión]
//   earth   fracción del tiempo de misión con la Tierra visible        [misión]
//   terrain 1 − pendiente / pendiente máxima                            [fijo]
//   ice     1 − distancia a sombra permanente / alcance                 [fijo]
//
// Filtros: pendiente > máxima, píxel mayoritariamente en sombra permanente,
// noche más larga que la autonomía de baterías (si se activa).

export const FACTORS = [
  { key: "sun", label: "Sunlight", icon: "sun", kind: "sun", hint: "Share of the mission with the Sun above the terrain" },
  { key: "earth", label: "Earth view", icon: "earth", kind: "earth", hint: "Share of the mission with Earth above the terrain" },
  { key: "terrain", label: "Gentle terrain", icon: "mountain", hint: "Lower slope scores higher" },
  { key: "ice", label: "Near permanent shadow", icon: "moon", hint: "Closer to permanently shadowed regions (where ice may be)" },
];

export const DEFAULT_WEIGHTS = { sun: 4, earth: 3, terrain: 2, ice: 1 };
export const DEFAULT_LIMITS = { maxSlopeDeg: 10, iceReachKm: 10, excludePsr: true, maxNightH: null };

/** Factores 0–1 de un píxel (o null si no hay datos). */
export function factorsAt(p, mission, layers, limits) {
  const slope = layers.slope?.[p];
  const dist = layers.psrDistKm?.[p];
  return {
    sun: mission ? mission.sun[p] : NaN,
    earth: mission ? mission.earth[p] : NaN,
    terrain: Number.isFinite(slope) ? Math.max(0, 1 - slope / limits.maxSlopeDeg) : NaN,
    ice: Number.isFinite(dist) ? Math.max(0, 1 - dist / limits.iceReachKm) : NaN,
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

/** Puntuación de toda la malla. Devuelve Float32Array con NaN = descartado. */
export function scoreGrid(mission, layers, weights, limits) {
  const n = layers.slope.length;
  const out = new Float32Array(n);
  const keys = FACTORS.map((f) => f.key).filter((k) => weights[k] > 0 && (mission || (k !== "sun" && k !== "earth")));
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

/** Desglose "Why this score?" de un píxel. */
export function explainScore(p, mission, layers, weights, limits) {
  const f = factorsAt(p, mission, layers, limits);
  const keys = FACTORS.map((x) => x.key).filter((k) => weights[k] > 0);
  const wsum = keys.reduce((a, k) => a + weights[k], 0) || 1;
  return keys.map((k) => ({ key: k, weight: weights[k], share: weights[k] / wsum, value: f[k], points: (100 * weights[k] * f[k]) / wsum }));
}
