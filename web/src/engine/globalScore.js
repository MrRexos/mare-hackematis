// Vista "Whole Moon": capas globales W4 (1440 × 720, 0,25°) que genera
// pipeline/moonsite/web_global.py a partir de las matrices G1K del contrato.
//
//   sun    sun.visible_fraction.mean    (T3, rama pol)  fracción 0-1 por periodo
//   night  sun.longest_night_h.max      (T3, rama pol)  horas por periodo
//   earth  earth.visible_fraction.mean  (T4, rama Nil)  fracción 0-1 por periodo
//   slope  terrain.slope                (T1, rama Jan)  grados, estática
//
// Puntuación (la misma regla que el polo sur, score.js):
//   score = 100 · Σ wᵢ·fᵢ / Σ wᵢ, solo con los factores que tienen capa global.
//   sun, earth: fracción del periodo; slope: 1 − pendiente / pendiente máxima.
// Filtros: pendiente > máxima, noche más larga que la autonomía (si se activa).

const BASE = `${import.meta.env.BASE_URL}data/`;

export const GLOBAL_FACTORS = ["sun", "earth", "slope"];

/** Manifest de las capas globales, o null si todavía no se han generado. */
export async function loadGlobalManifest() {
  try {
    const r = await fetch(`${BASE}global/manifest.json`);
    if (!r.ok) return null;
    const m = await r.json();
    return m && m.layers && Object.keys(m.layers).length ? m : null;
  } catch {
    return null;
  }
}

const bufCache = new Map();
async function getF32(file) {
  if (!bufCache.has(file)) {
    bufCache.set(file, fetch(BASE + file).then((r) => {
      if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
      return r.arrayBuffer();
    }).then((b) => new Float32Array(b)));
  }
  return bufCache.get(file);
}

/**
 * Periodos de una capa que caen en [fromMs, toMs) y su peso (horas de solape).
 * Si la capa es estática, devuelve "static". Si ningún periodo solapa, devuelve [].
 */
export function periodsFor(layer, fromMs, toMs) {
  const out = [];
  for (const [pid, p] of Object.entries(layer.periods || {})) {
    if (pid === "static" || !p.start) {
      out.push({ pid, w: 1, start: null, end: null });
      continue;
    }
    const a = Date.parse(p.start), b = Date.parse(p.end);
    const w = Math.max(0, Math.min(b, toMs) - Math.max(a, fromMs));
    if (w > 0) out.push({ pid, w, start: a, end: b });
  }
  // Si hay una media larga (p. ej. 2026-2030) y periodos cortos, se usan los cortos.
  const shortOnes = out.filter((x) => x.end && x.end - x.start < 400 * 86400e3);
  return shortOnes.length ? shortOnes : out;
}

/** Combina los periodos de una capa en un solo Float32Array (media ponderada o máximo). */
export async function layerFor(layer, fromMs, toMs) {
  const sel = periodsFor(layer, fromMs, toMs);
  if (!sel.length) return { values: null, used: [] };
  const arrays = await Promise.all(sel.map((s) => getF32(layer.periods[s.pid].file)));
  const n = arrays[0].length;
  const out = new Float32Array(n);
  if (layer.combine === "max") {
    out.fill(NaN);
    for (const a of arrays) for (let p = 0; p < n; p++) if (!(a[p] <= out[p])) out[p] = Number.isFinite(a[p]) ? a[p] : out[p];
  } else {
    const wsum = sel.reduce((s, x) => s + x.w, 0);
    for (let p = 0; p < n; p++) {
      let s = 0, ok = true;
      for (let k = 0; k < arrays.length; k++) {
        const v = arrays[k][p];
        if (!Number.isFinite(v)) { ok = false; break; }
        s += v * sel[k].w;
      }
      out[p] = ok ? s / wsum : NaN;
    }
  }
  const covered = sel.reduce((s, x) => s + (x.start == null ? 0 : Math.min(x.end, toMs) - Math.max(x.start, fromMs)), 0);
  return { values: out, used: sel.map((x) => x.pid), coverage: Math.min(1, covered / Math.max(1, toMs - fromMs)) };
}

/** Factores 0-1 de una celda. */
export function globalFactorsAt(p, L, limits) {
  const slope = L.slope?.[p];
  return {
    sun: L.sun ? L.sun[p] : null,
    earth: L.earth ? L.earth[p] : null,
    slope: L.slope ? (Number.isFinite(slope) ? Math.max(0, 1 - slope / limits.maxSlopeDeg) : NaN) : null,
    relief: null, ice: null, temp: null, impacts: null, rad: null, sci: null,
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
  const keys = GLOBAL_FACTORS.filter((k) => L[k] && (weights[k] || 0) > 0);
  const n = (L.sun || L.earth || L.slope)?.length || 0;
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
