// Worker de cálculo de misión. Cada worker recibe una franja de filas de la
// malla y calcula, para cada píxel y cada hora de la misión, si se ve el Sol
// (fracción del disco) y la Tierra (centro) por encima del horizonte del
// terreno. Después elige el mejor momento de aterrizaje dentro de la ventana.
//
// Mensajes:
//   {type: "init", grid, rows: [r0, r1], elevation, horizon, horizonMeta, ephem, ephemMeta}
//   {type: "run", id, params}  ->  {type: "progress", id, done}  ...  {type: "result", id, ...}

import { DEG, localFrame, pixelXY, xyToUnit } from "./geometry.js";

const SUN_RADIUS_KM = 695700;
const EARTH_RADIUS_DEG = 0.95; // radio angular medio de la Tierra vista desde la Luna
let S = null; // estado del init

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === "init") {
    S = m;
    self.postMessage({ type: "ready" });
  } else if (m.type === "run") {
    run(m.id, m.params);
  }
};

function run(id, p) {
  const { grid, rows, elevation, horizon, horizonMeta, ephem, ephemMeta } = S;
  const n = grid.n;
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
  for (let t = 0; t < T; t++) {
    const k = Math.min(ephemMeta.count - 1, p.startIdx + t * stride) * 6;
    const sx = ephem[k], sy = ephem[k + 1], sz = ephem[k + 2];
    const sd = Math.hypot(sx, sy, sz);
    sun[t * 3] = sx / sd; sun[t * 3 + 1] = sy / sd; sun[t * 3 + 2] = sz / sd;
    sunR[t] = Math.asin(SUN_RADIUS_KM / sd) * DEG;
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
      for (let k = 0; k < bins; k++) hor[k] = horizon[hb + k] * qs + qo;
      hor[bins] = hor[0];

      const [x, y] = pixelXY(grid, i, j);
      const u = xyToUnit(R, x, y);
      const [up, east, north] = localFrame(u);
      const rObs = (R + h + h0) / 1000; // km
      const ox = u[0] * rObs, oy = u[1] * rObs, oz = u[2] * rObs;

      for (let t = 0; t < T; t++) {
        // Sol: misma dirección para toda la región.
        const sx = sun[t * 3], sy = sun[t * 3 + 1], sz = sun[t * 3 + 2];
        const sUp = sx * up[0] + sy * up[1] + sz * up[2];
        const sEl = Math.asin(sUp) * DEG;
        let f = 0;
        if (sEl > -6) {
          const sAz = Math.atan2(sx * east[0] + sy * east[1], sx * north[0] + sy * north[1] + sz * north[2]) * DEG;
          const a = (sAz + 360) % 360 / binDeg;
          const k0 = a | 0;
          const w = a - k0;
          const hz = hor[k0] * (1 - w) + hor[k0 + 1] * w;
          const r = sunR[t];
          const q = (sEl - hz) / r;
          if (sunMode === "any") f = q > -1 ? 1 : 0;
          else if (sunMode === "centre") f = q >= 0 ? 1 : 0;
          else if (sunMode === "whole") f = q >= 1 ? 1 : 0;
          else f = q >= 1 ? 1 : q <= -1 ? 0 : 1 - (Math.acos(q) - q * Math.sqrt(1 - q * q)) / Math.PI;
        }
        sunF[t] = f;

        // Tierra: vector desde el observador (incluye paralaje).
        const ex = earth[t * 3] - ox, ey = earth[t * 3 + 1] - oy, ez = earth[t * 3 + 2] - oz;
        const ed = Math.hypot(ex, ey, ez);
        const eEl = Math.asin((ex * up[0] + ey * up[1] + ez * up[2]) / ed) * DEG;
        let v = 0;
        if (eEl > -6) {
          const eAz = Math.atan2(ex * east[0] + ey * east[1], ex * north[0] + ey * north[1] + ez * north[2]) * DEG;
          const a = (eAz + 360) % 360 / binDeg;
          const k0 = a | 0;
          const w = a - k0;
          v = eEl + earthTol > hor[k0] * (1 - w) + hor[k0 + 1] * w ? 1 : 0;
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
    }
    if ((i - r0) % 8 === 7) self.postMessage({ type: "progress", id, done: i - r0 + 1 });
  }
  self.postMessage({ type: "result", id, rows, ...out }, [out.sun.buffer, out.earth.buffer, out.both.buffer, out.night.buffer, out.best.buffer]);
}
