// Worker de cálculo de misión. Cada worker recibe una franja de filas de la
// malla y calcula, para cada píxel y cada hora de la misión, si se ve el Sol
// (fracción del disco) y la Tierra (centro) por encima del horizonte del
// terreno. Después elige el mejor momento de aterrizaje dentro de la ventana.
//
// Mensajes:
//   {type: "init", grid, rows: [r0, r1], elevation, horizon, horizonMeta, ephem, ephemMeta, temp?, tempMeta?}
//   temp (opcional, malla global): curva de temperatura de cada celda por hora local (LRO Diviner).
//   Con ella se devuelve la temperatura media, mínima y máxima de la superficie durante la misión.
//   {type: "run", id, params}  ->  {type: "progress", id, done}  ...  {type: "result", id, ...}

import { DEG, cellUnit, localFrame } from "./geometry.js";

const SUN_RADIUS_KM = 695700;
const EARTH_RADIUS_DEG = 0.95; // radio angular medio de la Tierra vista desde la Luna
const MIN_ELEVATION_SIN = Math.sin(-6 / DEG);
let S = null; // estado del init
let activeRun = null;

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === "init") {
    S = m;
  } else if (m.type === "run") {
    activeRun = m.id;
    run(m.id, m.params);
  } else if (m.type === "cancel" && activeRun === m.id) {
    activeRun = null;
  }
};

async function run(id, p) {
  const { grid, rows, elevation, horizon, horizonMeta, ephem, ephemMeta, temp, tempMeta } = S;
  const n = grid.cols || grid.n; // columnas (malla polar: n × n; malla global: rows × cols)
  const bins = horizonMeta.bins;
  const binDeg = 360 / bins;
  const qs = horizonMeta.scaleDeg;
  const qo = horizonMeta.offsetDeg;
  const h0 = horizonMeta.observerHeightM;

  // --- Horas que cubre el cálculo -----------------------------------------
  // p.startIdx: primera hora posible de aterrizaje (índice en ephem)
  // p.landingHours: nº de horas candidatas de aterrizaje (ventana)
  // p.durationH: duración de la misión en superficie
  // Con periodos largos se muestrea cada `stride` horas (p.strideH) para que el
  // cálculo siga siendo de segundos. Todo lo que sale va en horas.
  const stride = Math.max(1, p.strideH | 0);
  const landS = Math.max(1, Math.ceil(p.landingHours / stride));
  const D = Math.max(1, Math.round(p.durationH / stride));
  const T = landS + D;
  const sunMode = p.sunMode || "any";   // any | centre | whole | fraction
  const earthTol = p.earthMode === "any" ? EARTH_RADIUS_DEG : 0;
  const sun = new Float64Array(T * 3);
  const sunR = new Float64Array(T); // radio angular del Sol (grados)
  const earth = new Float64Array(T * 3);
  const sunLon = new Float64Array(T); // longitud subsolar (grados): da la hora local de cada celda
  for (let t = 0; t < T; t++) {
    const k = Math.min(ephemMeta.count - 1, p.startIdx + t * stride) * 6;
    const sx = ephem[k], sy = ephem[k + 1], sz = ephem[k + 2];
    const sd = Math.hypot(sx, sy, sz);
    sun[t * 3] = sx / sd; sun[t * 3 + 1] = sy / sd; sun[t * 3 + 2] = sz / sd;
    sunR[t] = Math.asin(SUN_RADIUS_KM / sd) * DEG;
    sunLon[t] = Math.atan2(sy, sx) * DEG;
    earth[t * 3] = ephem[k + 3]; earth[t * 3 + 1] = ephem[k + 4]; earth[t * 3 + 2] = ephem[k + 5];
  }

  const [r0, r1] = rows;
  const count = (r1 - r0) * n;
  const out = {
    sun: new Float32Array(count).fill(NaN),
    earth: new Float32Array(count).fill(NaN),
    both: new Float32Array(count).fill(NaN),
    night: new Float32Array(count).fill(NaN),
    best: new Int32Array(count).fill(-1),
  };
  const withTemp = !!(temp && tempMeta && grid.type === "latlon");
  if (withTemp) for (const key of ["tavg", "tmin", "tmax"]) out[key] = new Float32Array(count).fill(NaN);
  const tBins = withTemp ? tempMeta.bins : 0;
  const tScale = withTemp ? tempMeta.scaleK : 0;

  const sunF = new Float32Array(T);
  const earthV = new Uint8Array(T);
  const cumS = new Float64Array(T + 1);
  const cumE = new Float64Array(T + 1);
  const cumB = new Float64Array(T + 1);
  const hor = new Float32Array(bins + 1);
  const step = Math.max(1, p.candidateStepH | 0);
  const wS = p.weights.sun, wE = p.weights.earth;
  const R = grid.radiusM;

  for (let i = r0; i < r1; i++) {
    for (let j = 0; j < n; j++) {
      const local = (i - r0) * n + j;
      const h = elevation[local];
      if (!Number.isFinite(h)) continue;

      // Perfil de horizonte del píxel (grados), con el primer bin repetido al final.
      const hb = local * bins;
      let minHorizon = Infinity, maxHorizon = -Infinity;
      for (let k = 0; k < bins; k++) {
        const height = hor[k] = horizon[hb + k] * qs + qo;
        minHorizon = Math.min(minHorizon, height);
        maxHorizon = Math.max(maxHorizon, height);
      }
      hor[bins] = hor[0];

      const u = cellUnit(grid, i, j);
      const [up, east, north] = localFrame(u);
      const rObs = (R + h + h0) / 1000; // km
      const ox = u[0] * rObs, oy = u[1] * rObs, oz = u[2] * rObs;

      for (let t = 0; t < T; t++) {
        // Sol: misma dirección para toda la región.
        const sx = sun[t * 3], sy = sun[t * 3 + 1], sz = sun[t * 3 + 2];
        const sUp = sx * up[0] + sy * up[1] + sz * up[2];
        let f = 0;
        if (sUp > MIN_ELEVATION_SIN) {
          const sEl = Math.asin(sUp) * DEG;
          const r = sunR[t];
          if (sEl - r > maxHorizon) f = 1;
          else if (sEl + r >= minHorizon) {
            const sAz = Math.atan2(sx * east[0] + sy * east[1], sx * north[0] + sy * north[1] + sz * north[2]) * DEG;
            const a = (sAz < 0 ? sAz + 360 : sAz) / binDeg;
            const k0 = a | 0;
            const w = a - k0;
            const hz = hor[k0] * (1 - w) + hor[k0 + 1] * w;
            const q = (sEl - hz) / r;
            if (sunMode === "any") f = q > -1 ? 1 : 0;
            else if (sunMode === "centre") f = q >= 0 ? 1 : 0;
            else if (sunMode === "whole") f = q >= 1 ? 1 : 0;
            else f = q >= 1 ? 1 : q <= -1 ? 0 : 1 - (Math.acos(q) - q * Math.sqrt(1 - q * q)) / Math.PI;
          }
        }
        sunF[t] = f;

        // Tierra: vector desde el observador (incluye paralaje).
        const ex = earth[t * 3] - ox, ey = earth[t * 3 + 1] - oy, ez = earth[t * 3 + 2] - oz;
        const ed = Math.sqrt(ex * ex + ey * ey + ez * ez);
        const eUp = (ex * up[0] + ey * up[1] + ez * up[2]) / ed;
        let v = 0;
        if (eUp > MIN_ELEVATION_SIN) {
          const eEl = Math.asin(eUp) * DEG + earthTol;
          if (eEl > maxHorizon) v = 1;
          else if (eEl >= minHorizon) {
            const eAz = Math.atan2(ex * east[0] + ey * east[1], ex * north[0] + ey * north[1] + ez * north[2]) * DEG;
            const a = (eAz < 0 ? eAz + 360 : eAz) / binDeg;
            const k0 = a | 0;
            const w = a - k0;
            v = eEl > hor[k0] * (1 - w) + hor[k0 + 1] * w ? 1 : 0;
          }
        }
        earthV[t] = v;
      }

      // Sumas acumuladas para evaluar cualquier ventana [c, c + duración) en O(1).
      for (let t = 0; t < T; t++) {
        cumS[t + 1] = cumS[t] + sunF[t];
        cumE[t + 1] = cumE[t] + earthV[t];
        cumB[t + 1] = cumB[t] + (sunF[t] >= 0.5 && earthV[t] ? 1 : 0);
      }
      let bestC = 0, bestV = -1;
      for (let c = 0; c < landS; c += step) {
        const s = (cumS[c + D] - cumS[c]) / D;
        const ea = (cumE[c + D] - cumE[c]) / D;
        const val = wS * s + wE * ea + 1e-6 * s;
        if (val > bestV) { bestV = val; bestC = c; }
      }
      out.sun[local] = (cumS[bestC + D] - cumS[bestC]) / D;
      out.earth[local] = (cumE[bestC + D] - cumE[bestC]) / D;
      out.both[local] = (cumB[bestC + D] - cumB[bestC]) / D;
      out.best[local] = bestC * stride;

      // Noche continua más larga dentro de la mejor ventana (Sol < 5 % del disco).
      let run = 0, longest = 0;
      for (let t = bestC; t < bestC + D; t++) {
        if (sunF[t] < 0.05) { run += 1; if (run > longest) longest = run; } else run = 0;
      }
      out.night[local] = longest * stride;

      // Temperatura de la superficie durante la misión (Diviner): para cada hora, la hora
      // local de la celda (12 h = Sol en su meridiano) indica el punto de su curva día-noche.
      if (withTemp) {
        const lon = grid.lon0 + (j + 0.5) * grid.stepDeg;
        const tb = local * tBins;
        let sum = 0, lo = Infinity, hi = -Infinity, cnt = 0;
        for (let t = bestC; t < bestC + D; t++) {
          let lt = (12 + (lon - sunLon[t]) / 15) % 24;
          if (lt < 0) lt += 24;
          const f = (lt / 24) * tBins - 0.5;
          const k0 = Math.floor(f);
          const w = f - k0;
          const a = temp[tb + ((k0 + tBins) % tBins)], b = temp[tb + ((k0 + 1) % tBins)];
          if (a === 255 || b === 255) continue;
          const v = (a * (1 - w) + b * w) * tScale;
          sum += v; cnt += 1;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        if (cnt) { out.tavg[local] = sum / cnt; out.tmin[local] = lo; out.tmax[local] = hi; }
      }
    }
    if ((i - r0 + 1) % 4 === 0 && i + 1 < r1) {
      self.postMessage({ type: "progress", id, done: i - r0 + 1 });
      await new Promise((resume) => setTimeout(resume, 0));
      if (activeRun !== id) return;
    }
  }
  self.postMessage({ type: "result", id, rows, ...out }, Object.values(out).map((a) => a.buffer));
}
