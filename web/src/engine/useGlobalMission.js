// Estado de la vista "Whole Moon", compartido por Explore, Mare y Compare.
//
// Descarga una vez los datos fijos (horizontes, elevación, pendiente, rugosidad, sombra
// permanente, agua, curva de temperatura), lanza el cálculo de la misión cuando la región
// activa es la Luna entera y da la puntuación, las mejores celdas y un objeto `gdata` con
// la misma forma que los datos del polo sur ({ manifest, layers, horizon, ephem }), para que
// la serie temporal de un punto (timeline.js) y las fichas funcionen igual en las dos regiones.
//
// Referencias (gm.sites: los alunizajes Apollo): cada una es la celda que contiene el punto.
// `refs` las da ya puntuadas y ordenadas, como las regiones Artemis III del polo sur.

import { useEffect, useMemo, useState } from "react";
import {
  TEMP_BAND, cellAt, cellLatLon, fmtLatLon, globalEngine, globalExclusionAt, globalFactorsAt, globalHotspots, globalScore, loadGlobalStatic,
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

  // Sitios de referencia del manifest, cada uno con su celda y la etiqueta de su grupo.
  const refSites = useMemo(() => {
    if (!gm?.sites?.sites) return [];
    const kinds = Object.fromEntries((gm.sites.groups || []).map((g) => [g.id, g.kind || g.label]));
    return gm.sites.sites.map((s) => ({ ...s, p: cellAt(gm.grid, s.lat, s.lon), kind: kinds[s.group] || "Reference site" }));
  }, [gm]);

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
    const site = refSites.find((s) => s.p === p) || null;
    const cell = `${gm.grid.stepDeg}° cell (~${Math.round(gm.grid.stepDeg * 30.3)} km at the equator)`;
    return {
      p, lat, lon, coords: fmtLatLon(lat, lon), factors,
      metrics: result ? { sun: result.sun[p], earth: result.earth[p], both: result.both[p], night: result.night[p], best: result.best[p] } : null,
      type: "gcell", key: `gcell-${p}`, ref: { type: "gcell", p },
      // Mismos nombres que en el polo sur: "Hotspot NN"; las coordenadas van aparte. La celda de
      // un sitio de referencia lleva su nombre, salvo que además sea una de las mejores celdas.
      name: rank ? `Hotspot ${String(rank).padStart(2, "0")}` : site ? site.name : "Your spot",
      short: rank ? `HS${rank}` : site ? site.short || site.name : "YOU",
      shape: rank ? "square" : site ? "circle" : "diamond",
      kindLabel: rank ? "Calculated candidate" : site ? site.kind : "Your spot",
      rank: rank || null,
      site,
      // Punto exacto del sitio de referencia, para el marcador (la nota es la de toda la celda).
      centre: site && !rank ? [site.lat, site.lon] : null,
      score: score.length ? score[p] : NaN,
      excluded: result ? globalExclusionAt(p, L, limits) : null,
      note: `${site ? `${cell} that contains the ${site.name} landing site` : cell}. Sunlight and Earth view use the terrain horizon at the cell centre.`,
    };
  };

  // Referencias como lugares, de mayor a menor nota (sin nota, al final).
  const points = (place) => (Number.isFinite(place.score) ? place.score : -1);
  const refs = refSites.map((s) => ({
    ...placeOf(s.p), name: s.name, short: s.short || s.name, shape: "circle", kindLabel: s.kind, rank: null, centre: [s.lat, s.lon],
  })).sort((a, b) => points(b) - points(a));

  return {
    stat, result, runError, error, ms: current?.ms ?? null, progress: current?.progress ?? 0,
    loading: !!active && !error && !problem && !runError && !result, ready,
    L, score, keys, spots, refs, gdata, placeOf,
  };
}
