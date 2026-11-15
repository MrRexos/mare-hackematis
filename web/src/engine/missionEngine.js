// Reparte el cálculo de misión entre varios workers (uno por núcleo, máx. 8).
// Cada worker recibe solo su franja de filas, así la memoria no se duplica.

const HOUR_MS = 3600 * 1000;

export class MissionEngine {
  constructor(data) {
    const { manifest, layers, horizon, ephem, temp, horizonSub } = data;
    this.tempMeta = temp ? manifest.thermal : null; // curva de temperatura por hora local (LRO Diviner)
    this.grid = manifest.grid;
    this.ephemMeta = manifest.ephem;
    this.horizonMeta = manifest.horizon;
    this.runId = 0;
    this.active = null;
    const n = this.grid.cols || this.grid.n;      // columnas
    const nRows = this.grid.rows || this.grid.n;  // filas
    this.cols = n;
    this.rows = nRows;
    // Subpuntos (malla global): en las filas de alta latitud cada celda lleva sub.n × sub.n
    // horizontes. subIdx[fila] = posición de la fila dentro de horizonSub, o −1 si no tiene.
    const sub = horizonSub ? this.horizonMeta.sub : null;
    const subIdx = new Int32Array(nRows).fill(-1);
    if (sub) { let c = 0; for (const [a, b] of sub.rowRanges) for (let r = a; r < b; r++) subIdx[r] = c++; }
    const k = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
    // Reparto de filas entre workers por coste (no por número): una fila con subpuntos cuesta
    // sub.n² veces más. Sin subpuntos el reparto queda en franjas iguales, como siempre.
    const cost = (r) => (subIdx[r] >= 0 ? sub.n * sub.n : 1);
    let totalCost = 0;
    for (let r = 0; r < nRows; r++) totalCost += cost(r);
    const cuts = [0];
    for (let r = 0, acc = 0; r < nRows && cuts.length < k; r++) {
      acc += cost(r);
      if (acc >= (totalCost * cuts.length) / k) cuts.push(r + 1);
    }
    cuts.push(nRows);
    this.workers = [];
    for (let w = 0; w + 1 < cuts.length; w++) {
      const r0 = cuts[w];
      const r1 = cuts[w + 1];
      if (r0 >= r1) continue;
      const worker = new Worker(new URL("./mission.worker.js", import.meta.url), { type: "module" });
      const bins = this.horizonMeta.bins;
      // Solo la parte de horizonSub que toca a las filas de este worker.
      let subBase = 0, subPart = null;
      if (sub) {
        let lo = Infinity, hi = -1;
        for (let r = r0; r < r1; r++) if (subIdx[r] >= 0) { lo = Math.min(lo, subIdx[r]); hi = Math.max(hi, subIdx[r]); }
        if (hi >= 0) {
          const per = n * sub.n * sub.n * bins;
          subBase = lo;
          subPart = horizonSub.slice(lo * per, (hi + 1) * per);
        }
      }
      worker.postMessage({
        type: "init",
        grid: this.grid,
        rows: [r0, r1],
        elevation: layers.elevation.slice(r0 * n, r1 * n),
        horizon: horizon.slice(r0 * n * bins, r1 * n * bins),
        horizonMeta: this.horizonMeta,
        ephem,
        ephemMeta: this.ephemMeta,
        temp: this.tempMeta ? temp.slice(r0 * n * this.tempMeta.bins, r1 * n * this.tempMeta.bins) : null,
        tempMeta: this.tempMeta,
        sub: subPart ? { n: sub.n, base: subBase, idx: subIdx.slice(r0, r1), horizon: subPart } : null,
      });
      this.workers.push({ worker, rows: [r0, r1] });
    }
  }

  /** Rango de fechas (ms UTC) en el que hay efemérides. */
  get range() {
    const m = this.ephemMeta;
    return [m.startUnixMs, m.startUnixMs + m.count * m.stepSeconds * 1000];
  }

  /**
   * params: { windowStartMs, windowEndMs, durationDays, weights: {sun, earth}, candidateStepH }
   * onProgress(fraction). Devuelve una promesa con los resultados de toda la malla.
   */
  async run(params, onProgress = () => {}) {
    this.cancel();
    const id = ++this.runId;
    const m = this.ephemMeta;
    const stepMs = m.stepSeconds * 1000;
    const startIdx = Math.max(0, Math.floor((params.windowStartMs - m.startUnixMs) / stepMs));
    const landingHours = Math.max(1, Math.round((params.windowEndMs - params.windowStartMs) / HOUR_MS));
    const durationH = Math.max(1, Math.round(params.durationDays * 24));
    if (startIdx + landingHours + durationH > m.count) {
      throw new Error("The mission ends after the last date with ephemeris data.");
    }
    const n = this.cols;
    const total = n * this.rows;
    const res = {
      sun: new Float32Array(total), earth: new Float32Array(total), both: new Float32Array(total),
      night: new Float32Array(total), best: new Int32Array(total),
    };
    if (this.tempMeta) for (const key of ["tavg", "tmin", "tmax", "tfit"]) res[key] = new Float32Array(total);
    const done = new Array(this.workers.length).fill(0);
    // Unas ~2600 muestras por píxel: 1 h en ventanas cortas, 3-4 h en un año, más en varios años.
    const strideH = Math.max(1, Math.ceil((landingHours + durationH) / 2600));
    const p = {
      startIdx, landingHours, durationH, strideH, candidateStepH: params.candidateStepH || 1, weights: params.weights,
      sunMode: params.sunMode, earthMode: params.earthMode, tempBand: params.tempBand,
    };

    return new Promise((resolve, reject) => {
      const listeners = [];
      const finish = (result, error) => {
        this.active = null;
        for (const { worker, onMessage, onError } of listeners) {
          worker.removeEventListener("message", onMessage);
          worker.removeEventListener("error", onError);
          if (!result) worker.postMessage({ type: "cancel", id });
        }
        if (error) reject(error);
        else resolve(result);
      };
      this.active = { cancel: () => finish(null) };
      let remaining = this.workers.length;
      this.workers.forEach(({ worker, rows }, index) => {
        const onMessage = ({ data }) => {
          if (data.id !== id) return;
          if (data.type === "progress") {
            done[index] = data.done;
          } else if (data.type === "result") {
            const off = rows[0] * n;
            for (const key of Object.keys(res)) res[key].set(data[key], off);
            done[index] = rows[1] - rows[0];
            remaining -= 1;
            if (remaining === 0) {
              finish({ ...res, startIdx, landingHours, durationH, strideH, startMs: m.startUnixMs + startIdx * stepMs, stepMs, params });
              return;
            }
          }
          onProgress(done.reduce((sum, count) => sum + count, 0) / this.rows);
        };
        const onError = (e) => finish(null, new Error(e.message || "Mission calculation failed."));
        listeners.push({ worker, onMessage, onError });
        worker.addEventListener("message", onMessage);
        worker.addEventListener("error", onError);
        worker.postMessage({ type: "run", id, params: p });
      });
    });
  }

  cancel() {
    this.active?.cancel();
  }

  dispose() {
    this.cancel();
    for (const { worker } of this.workers) worker.terminate();
  }
}
