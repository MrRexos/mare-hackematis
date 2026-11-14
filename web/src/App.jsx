import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadData } from "./data/loadData.js";
import { MissionEngine } from "./engine/missionEngine.js";
import { DAY_MS, changePeriod, resolveMission, validateTiming } from "./engine/missionTiming.js";
import { DEFAULT_LIMITS, exclusionAt, factorsAt, scoreGrid } from "./engine/score.js";
import { LAYERS } from "./data/mapLayers.js";
import { findHotspots, nearestSite } from "./engine/hotspots.js";
import { formatLatLon, latLonToXY, pixelXY, xyToLatLon, xyToPixel } from "./engine/geometry.js";
import { landingWindows, runs, siteTimeline, windowDetails } from "./engine/timeline.js";
import { Rail, TimeBar, fmtShort } from "./ui/Shell.jsx";
import Home from "./screens/Home.jsx";
import Explore from "./screens/Explore.jsx";
import GlobalExplore from "./screens/GlobalExplore.jsx";
import { loadGlobalManifest } from "./engine/globalScore.js";
import { useGlobalMission } from "./engine/useGlobalMission.js";
import Site from "./screens/Site.jsx";
import Compare from "./screens/Compare.jsx";
import { ExportDialog, SettingsDrawer } from "./screens/Overlays.jsx";
import LearnPage from "./components/LearnPage.jsx";

const H = 3600e3;
const REGION_HALF_PX = 7; // regiones Artemis III de ~15 × 15 km -> 15 × 15 píxeles de 1 km
const ANALYSIS_SCREENS = ["explore", "site", "compare"];

const todayMs = () => {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

/** Periodos posibles según el rango de efemérides. */
function computePeriods(ephem) {
  const t = todayMs();
  const r0 = ephem ? Math.ceil(ephem.startUnixMs / DAY_MS) * DAY_MS : t;
  const r1 = ephem ? Math.floor((ephem.startUnixMs + (ephem.count - 2) * ephem.stepSeconds * 1000) / DAY_MS) * DAY_MS : t + 4 * 365 * DAY_MS;
  const from = Math.min(Math.max(t, r0), r1 - 30 * DAY_MS);
  return {
    range: [r0, r1],
    next12: [from, Math.min(r1, from + 365 * DAY_MS)],
  };
}

const DEFAULT_RULES = { sunMode: "any", earthMode: "centre", observerM: 2 };
const EMPTY_MISSION = { period: null, fromMs: null, toMs: null, durationDays: null, ...DEFAULT_RULES };

/** Nombre corto de un lugar: "NR1", "PCB"… */
function shortNames(names) {
  const used = {};
  return names.map((name) => {
    const words = name.split(/\s+/);
    const last = words[words.length - 1];
    const digit = /^\d+$/.test(last) ? last : "";
    let base = words.filter((w) => /^[A-Z]/.test(w)).map((w) => w[0]).join("").slice(0, 3);
    if (base.length < 2) base = name.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase();
    if (digit) return base + digit;
    if (base.length >= 3) return base;
    used[base] = (used[base] || 0) + 1;
    return base + used[base];
  });
}

export default function App() {
  const [screen, setScreen] = useState("home");
  const [tab, setTab] = useState("overview");
  const [dim, setDim] = useState("2D");
  const [overlay, setOverlay] = useState(null);
  const [data, setData] = useState(null);
  const [loadState, setLoadState] = useState({ done: 0, total: 1, error: null });
  const engineRef = useRef(null);

  const [periods, setPeriods] = useState(() => computePeriods(null));
  const [missionInput, setMissionInput] = useState(EMPTY_MISSION);
  const [destination, setDestination] = useState(null);
  const [weights, setWeights] = useState(null);
  const [limits, setLimits] = useState(DEFAULT_LIMITS);
  const [calculation, setCalculation] = useState(null);
  const [layerKey, setLayerKey] = useState("score");
  const [terrainLayer, setTerrainLayer] = useState("sun");
  const [showIceEvidence, setShowIceEvidence] = useState(false);
  const [selRef, setSelRef] = useState(null); // {type:"spot",rank} | {type:"site",id} | {type:"pick",p}
  const [group, setGroup] = useState("spots");
  const [cmpRefs, setCmpRefs] = useState([]);
  const [timeMs, setTimeMs] = useState(() => todayMs());
  // Luna entera: datos globales ya calculados (si existen) y celda elegida en su malla.
  const [globalManifest, setGlobalManifest] = useState(null);
  const [gSel, setGSel] = useState(null);
  useEffect(() => { loadGlobalManifest().then(setGlobalManifest); }, []);

  const analysisActive = ANALYSIS_SCREENS.includes(screen);
  const mission = useMemo(() => resolveMission(missionInput, periods), [missionInput, periods]);
  const { timingMissing, problem } = validateTiming(mission, periods);
  const destinationReady = destination === "south" || (destination === "moon" && !!globalManifest);
  const timingReady = destinationReady && !timingMissing && !problem;
  const planReady = timingReady && weights != null;
  const planStarted = destination != null || weights != null || mission.period != null || mission.durationDays != null;
  const openSettings = () => setOverlay(analysisActive ? "dates" : "rules");
  const openWeights = () => setOverlay("weights");
  const go = useCallback((s) => {
    setScreen(ANALYSIS_SCREENS.includes(s) && !planReady ? "home" : s);
    window.scrollTo(0, 0);
  }, [planReady]);
  const closeOverlay = () => setOverlay(null);

  // --- Carga de datos y motor ---------------------------------------------
  useEffect(() => {
    loadData((done, total) => setLoadState((s) => ({ ...s, done, total })))
      .then((d) => {
        if (d.horizon && d.ephem) engineRef.current = new MissionEngine(d);
        setPeriods(computePeriods(d.manifest.ephem));
        setData(d);
      })
      .catch((e) => setLoadState((s) => ({ ...s, error: e.message })));
    return () => engineRef.current?.dispose();
  }, []);

  const engineReady = !!engineRef.current;
  // --- Mission setters -------------------------------------------------------
  const chooseDestination = (value) => {
    if (value === destination) return;
    setDestination(value);
    setWeights(null);
    if (value === "moon") fixedOnlyDates();
  };
  // La Luna entera solo trabaja con fecha fija de aterrizaje: si la misión estaba en modo
  // búsqueda se pasa a fecha fija, empezando el primer día del rango que había.
  const fixedOnlyDates = () => setMissionInput((m) => (m.period && m.period !== "fixed"
    ? { ...changePeriod(m, "fixed"), fromMs: resolveMission(m, periods).fromMs ?? null } : m));
  // Pestañas South Pole / Whole Moon de Explore: cambian de región sin rehacer el plan.
  const setRegion = (value) => {
    if (value === destination) return;
    setDestination(value);
    if (value === "moon") fixedOnlyDates();
  };
  const setPeriod = (period) => setMissionInput((m) => changePeriod(m, period));
  const updateMission = (changes) => setMissionInput((m) => ({ ...m, ...changes }));
  const applySettings = ({ input, weights, limits }) => {
    setMissionInput(input);
    setWeights(weights);
    setLimits(limits);
    closeOverlay();
  };
  const selectFirst = useRef(true);
  const resetPlan = () => {
    setMissionInput(EMPTY_MISSION);
    setDestination(null);
    setWeights(null);
    setLimits(DEFAULT_LIMITS);
    setCalculation(null);
    setSelRef(null);
    setGSel(null);
    setCmpRefs([]);
    selectFirst.current = true;
    setOverlay(null);
    go("home");
  };
  const landEndMs = planReady ? Math.max(mission.fromMs + H, mission.toMs - mission.durationDays * DAY_MS) : null;

  // --- Cálculo automático (con un pequeño retardo) -------------------------
  const request = useMemo(() => ({
    windowStartMs: mission.fromMs,
    windowEndMs: landEndMs,
    durationDays: mission.durationDays,
    weights: { sun: weights?.sun, earth: weights?.earth },
    sunMode: mission.sunMode,
    earthMode: mission.earthMode,
  }), [mission.fromMs, landEndMs, mission.durationDays, weights?.sun, weights?.earth, mission.sunMode, mission.earthMode]);
  const current = calculation?.request === request ? calculation : null;
  const result = planReady ? current?.result ?? null : null;
  const runError = planReady ? current?.error ?? null : null;
  const settled = !!(result || runError);
  const moon = destination === "moon" && !!globalManifest; // región activa: Luna entera
  // En la Luna entera calcula su propio motor (useGlobalMission): el del polo sur no arranca.
  const running = analysisActive && engineReady && planReady && !settled && !moon;
  const progress = current?.progress ?? 0;

  useEffect(() => {
    const engine = engineRef.current;
    if (!running) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await engine.run(request, (progress) => {
          if (!cancelled) setCalculation({ request, progress });
        });
        if (result && !cancelled) setCalculation({ request, result, progress: 1 });
      } catch (e) {
        if (!cancelled) setCalculation({ request, error: e.message });
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      engine.cancel();
      setCalculation((current) => current?.request === request && !current.result && !current.error ? null : current);
    };
  }, [running, request]);

  // --- Luna entera: mismo cálculo con la malla global (lo comparten Explore, Mare y Compare).
  const G = useGlobalMission({ gm: globalManifest, data, request, problem: planReady ? problem : "Plan not ready",
    weights: weights || {}, limits, active: moon && planReady && analysisActive });

  // --- Puntuación, puntos calientes y regiones -----------------------------
  const score = useMemo(() => (data && result ? scoreGrid(result, data.layers, weights, limits) : null), [data, result, weights, limits]);

  const metricsAt = (p) => (result ? { sun: result.sun[p], earth: result.earth[p], both: result.both[p], night: result.night[p], best: result.best[p] } : null);
  const factors100 = (p) => {
    const f = factorsAt(p, result, data.layers, limits);
    const o = {};
    for (const k of Object.keys(f)) o[k] = Number.isFinite(f[k]) ? f[k] * 100 : null;
    return o;
  };
  const placeBase = (p, extra) => {
    const grid = data.manifest.grid;
    const i = Math.floor(p / grid.n), j = p % grid.n;
    const [x, y] = pixelXY(grid, i, j);
    const [lat, lon] = xyToLatLon(grid, x, y);
    return { p, i, j, lat, lon, coords: formatLatLon(lat, lon), factors: factors100(p), metrics: metricsAt(p), ...extra };
  };

  const spots = useMemo(() => {
    if (!score || !data) return [];
    const grid = data.manifest.grid;
    const sites = data.manifest.sites?.sites || [];
    return findHotspots(score, grid).spots.map((s) => {
      const near = nearestSite(s, sites, grid, latLonToXY);
      return {
        ...placeBase(s.peak, {}),
        ...s,
        key: `spot-${s.rank}`,
        ref: { type: "spot", rank: s.rank },
        name: `Hotspot ${String(s.rank).padStart(2, "0")}`,
        short: `HS${s.rank}`,
        shape: "square",
        kindLabel: "Hotspot",
        score: s.peakScore,
        note: `${s.areaKm2.toFixed(0)} km² above the top-3 % score${near && near.km < 25 ? ` · ${near.km.toFixed(0)} km from ${near.site.name}` : ""}.`,
      };
    });
  }, [score, data, result, limits]); // eslint-disable-line react-hooks/exhaustive-deps

  // Regiones Artemis III: mejor píxel de 1 km dentro de su recuadro de ~15 × 15 km.
  const sites = useMemo(() => {
    if (!data) return [];
    const grid = data.manifest.grid;
    const n = grid.n;
    const raw = data.manifest.sites?.sites || [];
    const shorts = shortNames(raw.map((s) => s.name));
    const list = raw.map((s, k) => {
      const [x, y] = latLonToXY(grid, s.lat, s.lon);
      const [fi, fj] = xyToPixel(grid, x, y);
      const i0 = Math.round(fi), j0 = Math.round(fj);
      let best = i0 * n + j0, bestScore = NaN, sum = 0, cnt = 0;
      if (score) {
        for (let i = i0 - REGION_HALF_PX; i <= i0 + REGION_HALF_PX; i++) {
          for (let j = j0 - REGION_HALF_PX; j <= j0 + REGION_HALF_PX; j++) {
            if (i < 0 || j < 0 || i >= n || j >= n) continue;
            const v = score[i * n + j];
            if (!Number.isFinite(v)) continue;
            sum += v; cnt += 1;
            if (!(v <= bestScore)) { bestScore = v; best = i * n + j; }
          }
        }
      }
      const mean = cnt ? sum / cnt : NaN;
      return {
        ...placeBase(best, {}),
        id: s.id, name: s.name, short: shorts[k], shape: "circle", kindLabel: "Artemis III region",
        key: `site-${s.id}`, ref: { type: "site", id: s.id }, score: bestScore, mean, centre: [s.lat, s.lon],
        excluded: score && !Number.isFinite(bestScore) ? "No 1 km pixel in this region passes your limits" : null,
        note: score && Number.isFinite(bestScore) ? `Best 1 km pixel inside the ~15 × 15 km region. Region mean ${Math.round(mean)} · ${cnt} of 225 km² pass the limits.` : null,
      };
    });
    const ranked = [...list].sort((a, b) => (Number.isFinite(b.score) ? b.score : -1) - (Number.isFinite(a.score) ? a.score : -1));
    ranked.forEach((s, k) => { s.rank = Number.isFinite(s.score) ? k + 1 : null; });
    return ranked;
  }, [data, score, result, limits]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const candidates = [...spots]; candidates.label = "Calculated candidates";
    const references = [...sites]; references.label = "Artemis III references";
    return { spots: candidates, artemis: references };
  }, [sites, spots]);

  const resolve = useCallback((ref) => {
    if (!ref || !data) return null;
    if (ref.type === "spot") return spots.find((x) => x.rank === ref.rank) || null;
    if (ref.type === "site") return sites.find((x) => x.id === ref.id) || null;
    return {
      ...placeBase(ref.p, {}),
      type: "pick", key: `pick-${ref.p}`, ref, name: "Your spot", short: "YOU", shape: "diamond", kindLabel: "Your spot",
      score: score ? score[ref.p] : NaN,
      excluded: result ? exclusionAt(ref.p, result, data.layers, limits) : null,
    };
  }, [spots, sites, data, score, result, limits]); // eslint-disable-line react-hooks/exhaustive-deps

  const southSelected = useMemo(() => {
    const s = resolve(selRef);
    return s ? { ...s, type: s.type || selRef.type } : null;
  }, [resolve, selRef]);
  // En la Luna entera el lugar es una celda de la malla global ({type: "gcell", p}).
  const resolveAny = (ref) => (ref?.type === "gcell" ? G.placeOf(ref.p) : resolve(ref));
  const selected = moon ? (gSel != null ? G.placeOf(gSel) : null) : southSelected;
  const selectRef = (ref) => (ref?.type === "gcell" ? setGSel(ref.p) : setSelRef(ref));

  const firstPlace = groups[group][0];
  useEffect(() => {
    if (!moon && analysisActive && selectFirst.current && Number.isFinite(firstPlace?.score)) {
      selectFirst.current = false;
      setSelRef((r) => r || firstPlace.ref);
    }
  }, [moon, analysisActive, firstPlace]);

  // --- Comparar ----------------------------------------------------------------
  const refKey = (r) => (r.type === "gcell" ? `gcell-${r.p}` : r.type === "spot" ? `spot-${r.rank}` : r.type === "site" ? `site-${r.id}` : `pick-${r.p}`);
  const inCmp = (place) => !!place && cmpRefs.some((r) => refKey(r) === place.key);
  const toggleCmp = (place) => setCmpRefs((list) => {
    if (list.some((r) => refKey(r) === place.key)) return list.filter((r) => refKey(r) !== place.key);
    const g = place.ref.type === "gcell"; // máximo 4 por región
    return list.filter((r) => (r.type === "gcell") === g).length >= 4 ? list : [...list, place.ref];
  });
  // Cada región compara sus propios lugares (los del polo sur y los de la Luna entera no se mezclan).
  const cmpPlaces = cmpRefs.filter((r) => (r.type === "gcell") === moon).map(resolveAny).filter(Boolean);
  const gPlaces = moon ? G.spots.map((sp) => G.placeOf(sp.p)) : [];
  const ranked = moon ? gPlaces : (groups[group] || []).filter((p) => Number.isFinite(p.score));
  const addBest3 = () => setCmpRefs((list) => [...list.filter((r) => (r.type === "gcell") !== moon), ...ranked.slice(0, 3).map((p) => p.ref)]);

  // --- Serie temporal del lugar seleccionado ---------------------------------
  const modes = { sunMode: mission.sunMode, earthMode: mission.earthMode };
  const showTimeline = analysisActive && planReady;
  const tdata = moon ? G.gdata : data; // datos del punto: malla global o polo sur
  const tl = useMemo(() => (showTimeline && selected && tdata?.ephem && tdata?.horizon ? siteTimeline(tdata, selected.p, mission.fromMs, mission.toMs, modes) : null),
    [showTimeline, selected?.p, tdata, mission.fromMs, mission.toMs, mission.sunMode, mission.earthMode]); // eslint-disable-line react-hooks/exhaustive-deps
  const lw = useMemo(() => (tl ? landingWindows(tl, mission.durationDays * 24, { sun: weights.sun, earth: weights.earth }, landEndMs) : null),
    [tl, mission.durationDays, weights?.sun, weights?.earth, landEndMs]);
  const toMs = (rr) => rr.map(([a, b]) => [tl.startMs + a * H, tl.startMs + b * H]);
  const windowsMs = tl && lw ? toMs(lw.windows) : [];
  // Solo la MEJOR ventana: la tarjeta, la nota y las barras de Sol/Tierra hablan
  // siempre de la misma misión. Otras fechas: modo "I have a landing date" o "Good days".
  const curWin = useMemo(() => windowDetails(tl, lw).find((w) => w.isBest) || null, [tl, lw]);
  const missionWin = tl && lw && curWin ? [tl.startMs + curWin.start * H, tl.startMs + (curWin.start + lw.D) * H] : null;
  const lanes = useMemo(() => (tl ? { sun: runs(tl.sun).map(([a, b]) => [tl.startMs + a * H, tl.startMs + b * H]), earth: runs(tl.earth).map(([a, b]) => [tl.startMs + a * H, tl.startMs + b * H]) } : null), [tl]);

  // Serie de cualquier lugar (Compare), con caché.
  const tlCache = useRef(new Map());
  const timelineFor = useCallback((place) => {
    if (!planReady || !place || !tdata?.ephem || !tdata?.horizon) return null;
    const k = `${moon ? "g" : "s"}${place.p}|${mission.fromMs}|${mission.toMs}|${mission.sunMode}|${mission.earthMode}`;
    if (!tlCache.current.has(k)) {
      if (tlCache.current.size > 24) tlCache.current.clear();
      tlCache.current.set(k, siteTimeline(tdata, place.p, mission.fromMs, mission.toMs, modes));
    }
    return tlCache.current.get(k);
  }, [planReady, tdata, moon, mission.fromMs, mission.toMs, mission.sunMode, mission.earthMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // El reloj compartido salta al inicio de la mejor ventana al cambiar de lugar.
  const winStart = missionWin?.[0];
  useEffect(() => { if (winStart != null) setTimeMs(winStart); }, [selected?.key, winStart]);
  useEffect(() => {
    if (planReady) setTimeMs((t) => Math.min(mission.toMs, Math.max(mission.fromMs, t)));
  }, [planReady, mission.fromMs, mission.toMs]);

  // --- Valores de las capas -------------------------------------------------
  const cache = useMemo(() => new Map(), [data, result, score, limits.iceReachKm]);
  const valuesFor = useCallback((key) => {
    if (!data) return null;
    if (cache.has(key)) return cache.get(key);
    const ly = data.layers;
    let v = null;
    switch (key) {
      case "score": v = score; break;
      case "sun": v = result ? result.sun : ly.avgSun || null; break;
      case "earth": v = result ? result.earth : ly.avgEarth || null; break;
      case "elevation": v = ly.elevation || null; break;
      case "slope": v = ly.slope || null; break;
      case "rough": v = ly.roughness || null; break;
      case "temp": v = ly.tempAvgK || null; break;
      case "shadow": {
        // Trama = sombra permanente (LOLA LPSR); brillo = cercanía a hielo estable a ≤ 0,5 m (Diviner).
        if (!ly.iceDistKm) break;
        v = new Float32Array(ly.iceDistKm.length);
        for (let p = 0; p < v.length; p++) {
          const d = ly.iceDistKm[p];
          v[p] = ly.psrShare?.[p] > 0.5 ? -1 : Number.isFinite(d) ? Math.max(0, 1 - d / limits.iceReachKm) : NaN;
        }
        break;
      }
      default: break;
    }
    cache.set(key, v);
    return v;
  }, [cache, data, score, result, limits.iceReachKm]);
  const legendFor = (key, values) => {
    let lo = Infinity, hi = -Infinity;
    if (values) for (const v of values) if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (!values || !Number.isFinite(hi)) return ["–", "–"];
    if (key === "score") return [`${Math.round(lo)}`, `${Math.round(hi)}`];
    if (key === "sun" || key === "earth") return ["0%", `${Math.round(hi * 100)}%`];
    if (key === "temp") return [`${Math.round(lo)} K`, `${Math.round(hi)} K`];
    if (key === "elevation") return [`${(lo / 1000).toFixed(1)} km`, `${(hi / 1000).toFixed(1)} km`];
    return LAYERS[key].legend;
  };
  const values = valuesFor(layerKey);

  // --- Lista de navegación de la ficha --------------------------------------
  const siteList = moon ? gPlaces : selected?.type === "spot" ? spots : sites;
  const stepSite = (d) => {
    if (!siteList.length) return;
    const k = siteList.findIndex((p) => p.key === selected?.key);
    const next = siteList[(k + d + siteList.length) % siteList.length];
    selectRef(next.ref);
  };
  const rankInfo = moon ? (selected?.rank ? { rank: selected.rank, total: gPlaces.length } : null)
    : selected && (selected.type === "site" || selected.type === "spot") && Number.isFinite(selected.score)
    ? { rank: siteList.findIndex((p) => p.key === selected.key) + 1, total: siteList.filter((p) => Number.isFinite(p.score)).length }
    : null;
  const v = data?.validation?.horizons?.maxArcmin;
  const validation = v ? `JPL Horizons · ≤ ${Math.max(v.sun, v.earth).toFixed(3)}′` : "JPL Horizons";

  // Fechas de misión de una celda: en modo búsqueda cada celda tiene las suyas.
  const datesFor = (p) => {
    if (!result || p == null) return null;
    const b = result.best[p];
    if (!(b >= 0)) return null;
    const a = result.startMs + b * result.stepMs;
    return `${fmtShort(a)} → ${fmtShort(a + result.durationH * H)}`;
  };

  const RailEl = <Rail screen={screen} go={go} canAnalyze={planReady} onMission={openSettings} onExport={planReady && data ? () => setOverlay("export") : undefined} />;
  const TimeBarEl = planReady && (
    <TimeBar startMs={mission.fromMs} endMs={mission.toMs} timeMs={timeMs} setTimeMs={setTimeMs} windows={windowsMs} missionWin={missionWin} lanes={lanes} />
  );

  const app = {
    data, result: moon ? G.result : result, running, progress, runError, problem, loadState, engineReady,
    places: [...sites, ...spots], groups, group, setGroup, selected, selectionKey: moon ? (gSel != null ? `gcell-${gSel}` : null) : selRef ? refKey(selRef) : null,
    setSelRef: selectRef, weights, setWeights, limits, setLimits,
    layerKey, setLayerKey, layer: LAYERS[layerKey], values, legendEnds: legendFor(layerKey, values), valuesFor, legendFor,
    terrainLayer, setTerrainLayer, showIceEvidence, setShowIceEvidence,
    dim, setDim, mission, periods, setPeriod, updateMission,
    destination, destinationReady, chooseDestination, timingMissing, timingReady, planReady, planStarted, resetPlan,
    openSettings, openWeights, go, tab, setTab,
    cmp: cmpRefs, toggleCmp, inCmp, cmpPlaces, addBest3, canAddBest: ranked.length > 0,
    timeMs, setTimeMs, Rail: RailEl, TimeBarEl,
    moonMission: { windowStartMs: mission.fromMs, windowEndMs: landEndMs, durationDays: mission.durationDays },
    sitesForMap: sites, spotsForMap: spots,
    tl, lw, siteList, stepSite, rankInfo, validation, timelineFor, region: moon ? "Whole Moon" : "South Pole",
    regionId: moon ? "moon" : "south", setRegion, globalManifest, globalReady: !!globalManifest,
    moon, G, gdata: G.gdata, gSel, setGSel, request,
    datesFor, fixedDates: mission.period === "fixed",
    curWin,
    exportPlaces: cmpPlaces.length ? cmpPlaces : ranked,
  };

  let page;
  const showPlanner = screen === "home" || (analysisActive && !planReady);
  if (showPlanner) {
    page = <Home app={app} />;
  } else if (screen === "site") {
    page = <Site app={app} />;
  } else if (screen === "compare") {
    page = <Compare app={app} />;
  } else if (screen === "learn") {
    page = (
      <div className="shell">
        {RailEl}
        <main className="shell__main">{data ? <div className="card card--flush"><LearnPage data={data} /></div> : null}</main>
      </div>
    );
  } else if (moon) {
    page = <GlobalExplore app={app} />;
  } else {
    page = <Explore app={app} />;
  }

  return (
    <>
      {analysisActive && !showPlanner ? <div className="analysis-enter">{page}</div> : page}
      {overlay === "export"
        ? planReady && data && <ExportDialog app={app} onClose={closeOverlay} />
        : overlay && <SettingsDrawer initialSection={overlay} rulesOnly={!analysisActive} region={app.region}
          fixedOnly={moon} input={missionInput} periods={periods} weights={weights} limits={limits} defaultRules={DEFAULT_RULES}
          onApply={applySettings} onClose={closeOverlay} />}
    </>
  );
}
