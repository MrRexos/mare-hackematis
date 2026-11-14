// Reparte el cálculo de misión entre varios workers (uno por núcleo, máx. 8).
// Cada worker recibe solo su franja de filas, así la memoria no se duplica.

const HOUR_MS = 3600 * 1000;

export class MissionEngine {
  constructor(data) {
    const { manifest, layers, horizon, ephem } = data;
    this.grid = manifest.grid;
    this.ephemMeta = manifest.ephem;
    this.horizonMeta = manifest.horizon;
    this.runId = 0;
    const n = this.grid.n;
    const k = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
    const rowsPer = Math.ceil(n / k);
    this.workers = [];
    this.ready = [];
    for (let w = 0; w < k; w++) {
      const r0 = w * rowsPer;
      const r1 = Math.min(n, r0 + rowsPer);
      if (r0 >= r1) break;
      const worker = new Worker(new URL("./mission.worker.js", import.meta.url), { type: "module" });
      const bins = this.horizonMeta.bins;
      this.ready.push(new Promise((res) => {
        worker.addEventListener("message", function onReady(e) {
          if (e.data.type === "ready") { worker.removeEventListener("message", onReady); res(); }
        });
      }));
      worker.postMessage({
        type: "init",
        grid: this.grid,
        rows: [r0, r1],
        elevation: layers.elevation.slice(r0 * n, r1 * n),
        horizon: horizon.slice(r0 * n * bins, r1 * n * bins),
        horizonMeta: this.horizonMeta,
        ephem,
        ephemMeta: this.ephemMeta,
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
    await Promise.all(this.ready);
    const id = ++this.runId;
    const m = this.ephemMeta;
    const stepMs = m.stepSeconds * 1000;
    const startIdx = Math.max(0, Math.floor((params.windowStartMs - m.startUnixMs) / stepMs));
    const landingHours = Math.max(1, Math.round((params.windowEndMs - params.windowStartMs) / HOUR_MS));
    const durationH = Math.max(1, Math.round(params.durationDays * 24));
    if (startIdx + landingHours + durationH > m.count) {
      throw new Error("The mission ends after the last date with ephemeris data.");
    }
    const n = this.grid.n;
    const total = n * n;
    const res = {
      sun: new Float32Array(total), earth: new Float32Array(total), both: new Float32Array(total),
      night: new Float32Array(total), best: new Int32Array(total),
    };
    const done = new Array(this.workers.length).fill(0);
    const p = { startIdx, landingHours, durationH, candidateStepH: params.candidateStepH || 3, weights: params.weights };

    await Promise.all(this.workers.map(({ worker, rows }, w) => new Promise((resolve, reject) => {
      const onMsg = (e) => {
        const d = e.data;
        if (d.id !== id) return;
        if (d.type === "progress") {
          done[w] = d.done;
          onProgress(done.reduce((a, b) => a + b, 0) / n);
        } else if (d.type === "result") {
          worker.removeEventListener("message", onMsg);
          const off = d.rows[0] * n;
          for (const key of Object.keys(res)) res[key].set(d[key], off);
          done[w] = rows[1] - rows[0];
          onProgress(done.reduce((a, b) => a + b, 0) / n);
          resolve();
        }
      };
      worker.addEventListener("message", onMsg);
      worker.onerror = (err) => reject(err);
      worker.postMessage({ type: "run", id, params: p });
    })));

    if (id !== this.runId) return null; // otro cálculo más nuevo lo ha sustituido
    return {
      ...res,
      startIdx, landingHours, durationH,
      startMs: m.startUnixMs + startIdx * stepMs,
      stepMs,
      params,
    };
  }

  dispose() {
    for (const { worker } of this.workers) worker.terminate();
  }
}
