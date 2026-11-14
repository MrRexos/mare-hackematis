// Estado de la vista "Whole Moon", compartido por Explore, Mare y Compare.
//
// Descarga una vez los datos fijos (horizontes, elevación, pendiente, rugosidad, sombra
// permanente, agua, curva de temperatura), lanza el cálculo de la misión cuando la región
// activa es la Luna entera y da la puntuación, las mejores celdas y un objeto `gdata` con
// la misma forma que los datos del polo sur ({ manifest, layers, horizon, ephem }), para que
// la serie temporal de un punto (timeline.js) y las fichas funcionen igual en las dos regiones.

import { useEffect, useMemo, useState } from "react";
import {
  TEMP_BAND, cellLatLon, fmtLatLon, globalEngine, globalExclusionAt, globalFactorsAt, globalHotspots, globalScore, loadGlobalStatic,
} from "./globalScore.js";

const EMPTY = Object.freeze({});

export function useGlobalMission({ gm, data, request, problem, weights, limits, active }) {
  const [stat, setStat] = useState(null);
  const [calc, setCalc] = useState(null);   // { request, progress, result, error, ms }
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!gm || !active || stat) return undefined;
    let alive = true;
    loadGlobalStatic(gm).then((st) => alive && setStat(st)).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [gm, active, stat]);

  const ready = !!(gm && stat && data?.ephem);
  useEffect(() => {
    if (!ready || !active || problem) return undefined;
    const engine = globalEngine(gm, stat, data.ephem, data.manifest.ephem);
    let cancelled = false;
    const timer = setTimeout(async () => {
      const t0 = performance.now();
      try {
        const result = await engine.run({ ...request, tempBand: TEMP_BAND }, (progress) => { if (!cancelled) setCalc({ request, progress }); });
        if (result && !cancelled) setCalc({ request, result, progress: 1, ms: performance.now() - t0 });
      } catch (e) {
        if (!cancelled) setCalc({ request, error: e.message });
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); engine.cancel(); };
  }, [ready, active, request, problem, gm, stat, data]);

  const current = calc?.request === request ? calc : null;
  const result = problem ? null : current?.result ?? null;
  const runError = problem ? null : current?.error ?? null;

  // Capas por celda: las de la misión (según las fechas) y las fijas del terreno.
  const L = useMemo(() => (result && stat ? {
    sun: result.sun, earth: result.earth, night: result.night,
    temp: result.tavg || null, tmin: result.tmin || null, tmax: result.tmax || null, tfit: result.tfit || null,
    slope: stat.slope || null, water: stat.water || null, rough: stat.rough || null, psr: stat.psr || null, elev: stat.elevation || null,
  } : EMPTY), [result, stat]);

  const { score, keys } = useMemo(() => globalScore(L, weights, limits), [L, weights, limits]);
  const spots = useMemo(() => (gm ? globalHotspots(score, gm.grid, 10, 5) : []), [score, gm]);

  const gdata = useMemo(() => (ready ? {
    manifest: { grid: gm.grid, ephem: data.manifest.ephem, horizon: gm.horizon },
    layers: { elevation: stat.elevation, slope: stat.slope, roughness: stat.rough, psrShare: stat.psr, water: stat.water },
    horizon: stat.horizon,
    ephem: data.ephem,
  } : null), [ready, gm, stat, data]);

  /** Ficha de una celda, con la misma forma que los lugares del polo sur. */
  const placeOf = (p) => {
    if (!gm || p == null) return null;
    const [lat, lon] = cellLatLon(gm.grid, p);
    const f = globalFactorsAt(p, L, limits);
    const factors = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Number.isFinite(v) ? v * 100 : null]));
    const rank = spots.findIndex((s) => s.p === p) + 1;
    return {
      p, lat, lon, coords: fmtLatLon(lat, lon), factors,
      metrics: result ? { sun: result.sun[p], earth: result.earth[p], both: result.both[p], night: result.night[p], best: result.best[p] } : null,
      type: "gcell", key: `gcell-${p}`, ref: { type: "gcell", p },
      name: rank ? `Best cell ${String(rank).padStart(2, "0")}` : "Your cell",
      short: rank ? `C${String(rank).padStart(2, "0")}` : "YOU",
      shape: rank ? "square" : "diamond",
      kindLabel: rank ? "Best cell on the whole Moon" : "Cell you picked",
      rank: rank || null,
      score: score.length ? score[p] : NaN,
      excluded: result ? globalExclusionAt(p, L, limits) : null,
      note: `${gm.grid.stepDeg}° cell (~${Math.round(gm.grid.stepDeg * 30.3)} km at the equator). Sunlight and Earth view use the terrain horizon at the cell centre.`,
    };
  };

  return {
    stat, result, runError, error, ms: current?.ms ?? null, progress: current?.progress ?? 0,
    loading: !!active && !error && !problem && !runError && !result, ready,
    L, score, keys, spots, gdata, placeOf,
  };
}
