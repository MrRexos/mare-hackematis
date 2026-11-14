// Serie temporal de UN píxel: Sol y Tierra hora a hora durante todo el periodo.
// Es el mismo cálculo que el worker (mismos horizontes LOLA y efemérides SPICE),
// pero para un solo punto, así que cabe en el hilo principal (pocos ms por año).
//
// Con ella se dibujan la TimeBar (ventanas, carriles de Sol y Tierra), la tarjeta
// "Now", los eventos (ocaso, salida de la Tierra…) y los "Good days".

import { DEG, cellUnit, localFrame } from "./geometry.js";

const SUN_RADIUS_KM = 695700;
const EARTH_RADIUS_DEG = 0.95;
const HOUR_MS = 3600e3;

/** Contexto fijo de un píxel: marco local, horizonte, posición del observador. */
export function pixelContext(data, p) {
  const { manifest, layers, horizon } = data;
  const grid = manifest.grid;
  const hm = manifest.horizon;
  const n = grid.cols || grid.n; // malla polar (n × n) o global (rows × cols)
  const bins = hm.bins;
  const i = Math.floor(p / n), j = p % n;
  const hor = new Float32Array(bins + 1);
  for (let k = 0; k < bins; k++) hor[k] = horizon[p * bins + k] * hm.scaleDeg + hm.offsetDeg;
  hor[bins] = hor[0];
  const u = cellUnit(grid, i, j);
  const [up, east, north] = localFrame(u);
  const h = layers.elevation[p];
  const rObs = (grid.radiusM + (Number.isFinite(h) ? h : 0) + hm.observerHeightM) / 1000;
  return { hor, bins, binDeg: 360 / bins, up, east, north, o: [u[0] * rObs, u[1] * rObs, u[2] * rObs] };
}

/** Altura del horizonte (°) en un acimut (°, horario desde el norte). */
export function horizonAt(ctx, azDeg) {
  const a = ((azDeg % 360) + 360) % 360 / ctx.binDeg;
  const k0 = a | 0;
  const w = a - k0;
  return ctx.hor[k0] * (1 - w) + ctx.hor[k0 + 1] * w;
}

function azEl(ctx, vx, vy, vz) {
  const d = Math.hypot(vx, vy, vz);
  const { up, east, north } = ctx;
  const el = Math.asin((vx * up[0] + vy * up[1] + vz * up[2]) / d) * DEG;
  const az = Math.atan2(vx * east[0] + vy * east[1], vx * north[0] + vy * north[1] + vz * north[2]) * DEG;
  return [(az + 360) % 360, el];
}

/**
 * Serie horaria de un píxel entre startMs y endMs.
 * opts.sunMode: any | centre | whole ; opts.earthMode: centre | any
 */
export function siteTimeline(data, p, startMs, endMs, opts = {}) {
  const em = data.manifest.ephem;
  const ephem = data.ephem;
  const ctx = pixelContext(data, p);
  const i0 = Math.max(0, Math.round((startMs - em.startUnixMs) / HOUR_MS));
  const i1 = Math.min(em.count - 1, Math.round((endMs - em.startUnixMs) / HOUR_MS));
  const N = Math.max(1, i1 - i0);
  const sun = new Uint8Array(N), earth = new Uint8Array(N);
  const sunAz = new Float32Array(N), sunEl = new Float32Array(N), earthAz = new Float32Array(N), earthEl = new Float32Array(N);
  const sunMode = opts.sunMode || "any";
  const eTol = opts.earthMode === "any" ? EARTH_RADIUS_DEG : 0;
  for (let t = 0; t < N; t++) {
    const k = (i0 + t) * 6;
    const sx = ephem[k], sy = ephem[k + 1], sz = ephem[k + 2];
    const [saz, sel] = azEl(ctx, sx, sy, sz);
    const r = Math.asin(SUN_RADIUS_KM / Math.hypot(sx, sy, sz)) * DEG;
    const q = (sel - horizonAt(ctx, saz)) / r;
    sun[t] = sunMode === "centre" ? q >= 0 : sunMode === "whole" ? q >= 1 : q > -1;
    sunAz[t] = saz; sunEl[t] = sel;
    const [eaz, eel] = azEl(ctx, ephem[k + 3] - ctx.o[0], ephem[k + 4] - ctx.o[1], ephem[k + 5] - ctx.o[2]);
    earth[t] = eel + eTol > horizonAt(ctx, eaz);
    earthAz[t] = eaz; earthEl[t] = eel;
  }
  return { startMs: em.startUnixMs + i0 * HOUR_MS, n: N, sun, earth, sunAz, sunEl, earthAz, earthEl, ctx };
}

/** Índice de hora (0..n-1) de un instante. */
export function hourIndex(tl, ms) {
  return Math.max(0, Math.min(tl.n - 1, Math.round((ms - tl.startMs) / HOUR_MS)));
}

/** Tramos [a, b) donde arr[t] vale `value`. */
export function runs(arr, value = 1, a0 = 0, a1 = arr.length) {
  const out = [];
  let s = -1;
  for (let t = a0; t < a1; t++) {
    const on = !!arr[t] === !!value;
    if (on && s < 0) s = t;
    if (!on && s >= 0) { out.push([s, t]); s = -1; }
  }
  if (s >= 0) out.push([s, a1]);
  return out;
}

/**
 * Valor de misión para cada hora de aterrizaje posible (mismo criterio que el
 * worker) y las "ventanas": horas de aterrizaje que dan ≥ 95 % del mejor valor.
 */
export function landingWindows(tl, durationH, weights, landEndMs) {
  const D = Math.max(1, Math.round(durationH));
  const last = Math.min(tl.n - D, hourIndex(tl, landEndMs ?? tl.startMs + (tl.n - D) * HOUR_MS));
  if (last < 0) return { best: -1, value: new Float32Array(0), windows: [], D };
  const cs = new Float64Array(tl.n + 1), ce = new Float64Array(tl.n + 1);
  for (let t = 0; t < tl.n; t++) { cs[t + 1] = cs[t] + tl.sun[t]; ce[t + 1] = ce[t] + tl.earth[t]; }
  const wS = weights.sun ?? 1, wE = weights.earth ?? 1;
  const value = new Float32Array(last + 1);
  let best = 0, bestV = -1;
  for (let c = 0; c <= last; c++) {
    const v = wS * (cs[c + D] - cs[c]) / D + wE * (ce[c + D] - ce[c]) / D + 1e-6 * (cs[c + D] - cs[c]) / D;
    value[c] = v;
    if (v > bestV) { bestV = v; best = c; }
  }
  const good = new Uint8Array(last + 1);
  for (let c = 0; c <= last; c++) good[c] = value[c] >= bestV * 0.95 ? 1 : 0;
  const share = (a, b, arr) => { let s = 0; for (let t = a; t < b; t++) s += arr[t]; return s / Math.max(1, b - a); };
  return {
    best, D, value, windows: runs(good),
    sun: share(best, best + D, tl.sun), earth: share(best, best + D, tl.earth),
  };
}

/**
 * Detalle de cada ventana (tramo de horas de aterrizaje que dan ≥ 95 % del mejor
 * valor): su mejor hora de aterrizaje dentro del tramo y el % de Sol y Tierra
 * de la misión que empieza a esa hora.
 */
export function windowDetails(tl, lw) {
  if (!tl || !lw || lw.best < 0) return [];
  const share = (a, b, arr) => { let s = 0; for (let t = a; t < b; t++) s += arr[t]; return s / Math.max(1, b - a); };
  return lw.windows.map(([a, b]) => {
    let start = a;
    for (let c = a; c < b; c++) if (lw.value[c] > lw.value[start]) start = c;
    return { a, b, start, sun: share(start, start + lw.D, tl.sun), earth: share(start, start + lw.D, tl.earth), isBest: lw.best >= a && lw.best < b };
  });
}

/** Horas al día con Sol ("sun"), con la Tierra a la vista ("earth") o con ambos ("both"). */
export function hoursPerDay(tl, kind = "both") {
  const days = Math.ceil(tl.n / 24);
  const out = new Uint8Array(days);
  for (let t = 0; t < tl.n; t++) {
    const on = kind === "sun" ? tl.sun[t] : kind === "earth" ? tl.earth[t] : tl.sun[t] && tl.earth[t];
    if (on) out[(t / 24) | 0] += 1;
  }
  return out;
}

/** Horas al día con Sol y Tierra a la vez (para "Good days" y Compare). */
export function goodHoursPerDay(tl) {
  return hoursPerDay(tl, "both");
}

/** Siguiente cambio de estado (Sol o Tierra) a partir de la hora t. */
export function nextChange(arr, t) {
  const v = arr[t];
  for (let k = t + 1; k < arr.length; k++) if (arr[k] !== v) return k;
  return -1;
}

/** Brújula en texto: "NE · 62°". */
export function compass(azDeg) {
  const names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return `${names[Math.round(azDeg / 45) % 8]} · ${Math.round(azDeg)}°`;
}
