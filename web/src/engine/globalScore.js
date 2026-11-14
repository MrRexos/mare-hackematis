// Vista "Whole Moon": Luna entera en una malla lat/lon de 0,5° (720 × 360).
//
// La luz, la Tierra visible y la noche más larga se calculan AL MOMENTO para las fechas
// de la misión, con el mismo motor que el polo sur (missionEngine + workers): cada celda
// tiene su horizonte ya trazado (global/horizon.u8, 72 acimuts) y el navegador solo
// compara, hora a hora, el Sol y la Tierra con ese horizonte. Con "best dates" cada celda
// se queda con su mejor ventana dentro del periodo (por ejemplo, un mes).
//
// Lo que no depende de la fecha viene ya calculado por pipeline/moonsite/web_global.py:
//   horizon    horizonte del terreno por celda          (LOLA LDEM_64)
//   elevation  altura del centro de la celda            (LOLA LDEM_64)
//   slope      pendiente media de la celda, en grados   (terrain.slope G1K, T1 · Jan)
//   thermal    temperatura medida de cada celda según la hora local (LRO Diviner): con ella el
//              motor da la temperatura media, mínima y máxima de la superficie durante la misión
//
// Puntuación (la misma regla que el polo sur, score.js):
//   score = 100 · Σ wᵢ·fᵢ / Σ wᵢ, solo con los factores que tienen datos globales.
//   sun, earth: fracción de la misión; slope: 1 − pendiente / pendiente máxima;
//   temp: confort térmico, hora a hora. Cada hora de la misión puntúa según la temperatura de
//   la superficie (ver TEMP_BAND) y el factor es la media de esas notas: así una noche a 95 K
//   y un mediodía a 390 K penalizan los dos, aunque la media de ambos parezca templada.
// Filtros: pendiente > máxima, noche más larga que la autonomía (si se activa).

import { MissionEngine } from "./missionEngine.js";
import { TEMP_COLD_K, TEMP_MILD_K } from "./score.js";

const BASE = `${import.meta.env.BASE_URL}data/`;

export const GLOBAL_FACTORS = ["sun", "earth", "slope", "temp"];

/**
 * Nota de una hora según la temperatura de la superficie (K):
 *   ≤ coldK → 0 · sube hasta 1 en mildK · 1 hasta hotOkK · baja hasta 0 en hotMaxK.
 * El lado frío es el mismo del polo sur (score.js). El lado caliente penaliza el mediodía
 * lunar: 350 K (77 °C) aún puntúa 1; 400 K (127 °C), por encima del máximo ecuatorial, 0.
 */
export const TEMP_BAND = { coldK: TEMP_COLD_K, mildK: TEMP_MILD_K, hotOkK: 350, hotMaxK: 400 };

/** Manifest de los datos globales, o null si todavía no se han generado. */
export async function loadGlobalManifest() {
  try {
    const r = await fetch(`${BASE}global/manifest.json`);
    if (!r.ok) return null;
    const m = await r.json();
    return m && m.horizon && m.elevation && m.grid?.type === "latlon" ? m : null;
  } catch {
    return null;
  }
}

async function getBuffer(file) {
  const r = await fetch(BASE + file);
  if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
  return r.arrayBuffer();
}

let staticPromise = null;
/** Horizontes, elevación y pendiente (se descargan una sola vez). */
export function loadGlobalStatic(gm) {
  if (!staticPromise) {
    const slopeFile = gm.layers?.slope?.periods?.static?.file;
    staticPromise = Promise.all([
      getBuffer(gm.horizon.file).then((b) => new Uint8Array(b)),
      getBuffer(gm.elevation.file).then((b) => new Float32Array(b)),
      slopeFile ? getBuffer(slopeFile).then((b) => new Float32Array(b)) : null,
      gm.thermal ? getBuffer(gm.thermal.file).then((b) => new Uint8Array(b)) : null,
    ]).then(([horizon, elevation, slope, temp]) => ({ horizon, elevation, slope, temp }))
      .catch((e) => { staticPromise = null; throw e; });
  }
  return staticPromise;
}

let engine = null;
/** Motor de misión de la Luna entera (el mismo del polo sur, con la malla global). */
export function globalEngine(gm, stat, ephem, ephemMeta) {
  if (!engine) {
    engine = new MissionEngine({
      manifest: { grid: gm.grid, ephem: ephemMeta, horizon: gm.horizon, thermal: gm.thermal },
      layers: { elevation: stat.elevation },
      horizon: stat.horizon,
      temp: stat.temp,
      ephem,
    });
  }
  return engine;
}

/** Factores 0-1 de una celda. */
export function globalFactorsAt(p, L, limits) {
  const slope = L.slope?.[p];
  return {
    sun: L.sun ? L.sun[p] : null,
    earth: L.earth ? L.earth[p] : null,
    slope: L.slope ? (Number.isFinite(slope) ? Math.max(0, 1 - slope / limits.maxSlopeDeg) : NaN) : null,
    temp: L.tfit ? L.tfit[p] : null,
    // Sin malla global todavía: se muestran como «–» en la ficha de la celda.
    rough: null, ice: null,
  };
}

export function globalExclusionAt(p, L, limits) {
  const slope = L.slope?.[p];
  if (L.slope && !Number.isFinite(slope)) return "No terrain data";
  if (L.slope && slope > limits.maxSlopeDeg) return `Mean slope ${slope.toFixed(1)}° is above ${limits.maxSlopeDeg}°`;
  if (L.night && limits.maxNightH != null && L.night[p] > limits.maxNightH) return "Night longer than battery autonomy";
  return null;
}

/** Puntuación 0-100 de toda la malla W4 (NaN = descartado o sin datos). */
export function globalScore(L, weights, limits) {
  const keys = GLOBAL_FACTORS.filter((k) => L[k === "temp" ? "tfit" : k] && (weights[k] || 0) > 0);
  const n = (L.sun || L.earth || L.slope || L.tfit)?.length || 0;
  const out = new Float32Array(n).fill(NaN);
  if (!keys.length) return { score: out, keys };
  const wsum = keys.reduce((s, k) => s + weights[k], 0);
  for (let p = 0; p < n; p++) {
    if (globalExclusionAt(p, L, limits)) continue;
    const f = globalFactorsAt(p, L, limits);
    let s = 0, ok = true;
    for (const k of keys) {
      if (!Number.isFinite(f[k])) { ok = false; break; }
      s += weights[k] * f[k];
    }
    if (ok) out[p] = (100 * s) / wsum;
  }
  return { score: out, keys };
}

export function cellLatLon(grid, p) {
  const i = Math.floor(p / grid.cols), j = p % grid.cols;
  return [grid.lat0 - (i + 0.5) * grid.stepDeg, grid.lon0 + (j + 0.5) * grid.stepDeg];
}

function angDeg(a1, o1, a2, o2) {
  const r = Math.PI / 180;
  const s = Math.sin((a2 - a1) * r / 2) ** 2 + Math.cos(a1 * r) * Math.cos(a2 * r) * Math.sin((o2 - o1) * r / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(s))) / r;
}

/** Mejores celdas, separadas al menos `sepDeg` grados (≈ 30 km por grado). */
export function globalHotspots(score, grid, count = 10, sepDeg = 5) {
  const idx = [];
  for (let p = 0; p < score.length; p++) if (Number.isFinite(score[p])) idx.push(p);
  idx.sort((a, b) => score[b] - score[a]);
  const out = [];
  for (const p of idx) {
    const [lat, lon] = cellLatLon(grid, p);
    if (out.every((o) => angDeg(lat, lon, o.lat, o.lon) >= sepDeg)) out.push({ p, lat, lon, score: score[p] });
    if (out.length >= count) break;
  }
  return out;
}

export function fmtLatLon(lat, lon) {
  return `${Math.abs(lat).toFixed(2)}°${lat < 0 ? "S" : "N"} ${Math.abs(lon).toFixed(2)}°${lon < 0 ? "W" : "E"}`;
}
