import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { L } from "./ds.js";
import { loadData } from "./data/loadData.js";
import { MissionEngine } from "./engine/missionEngine.js";
import { DEFAULT_LIMITS, DEFAULT_WEIGHTS, exclusionAt, scoreGrid } from "./engine/score.js";
import { findHotspots, nearestSite } from "./engine/hotspots.js";
import { formatLatLon, latLonToXY, pixelXY, xyToLatLon, xyToPixel } from "./engine/geometry.js";
import MapView from "./components/MapView.jsx";
import MissionPanel, { missionProblem } from "./components/MissionPanel.jsx";
import PrioritiesPanel from "./components/PrioritiesPanel.jsx";
import { PlaceDetail, PlaceList } from "./components/SpotsPanel.jsx";
import LearnPage from "./components/LearnPage.jsx";

// La vista 3D (Three.js) solo se descarga cuando se abre.
const Moon3D = lazy(() => import("./components/Moon3D.jsx"));

const DAY_MS = 86400000;
const REGION_HALF_PX = 7; // regiones Artemis III de ~15 × 15 km -> 15 × 15 píxeles de 1 km

// Capas del mapa (máx. 5 opciones en el SegmentedControl, como pide el design system).
const LAYERS = {
  score: { label: "Score", ramp: "score", legend: ["Lower", "Higher"], kind: "both" },
  sun: { label: "Sunlight", ramp: "sun", legend: ["0%", "100%"], kind: "sun" },
  earth: { label: "Earth view", ramp: "earth", legend: ["0%", "100%"], kind: "earth" },
  slope: { label: "Slope", ramp: "slope", legend: ["0°", "30°+"] },
  shadow: { label: "Ice proxy", ramp: "shadow", legend: ["Far", "Near"] },
};

function useMedia(query) {
  const [m, setM] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return m;
}

function defaultMission() {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return { windowStartMs: start, windowEndMs: start + 30 * DAY_MS, durationDays: 14 };
}

export default function App() {
  const mobile = useMedia("(max-width: 767px)");
  const [page, setPage] = useState("explore");
  const [viewMode, setViewMode] = useState("map"); // "map" | "3d"
  const [data, setData] = useState(null);
  const [loadState, setLoadState] = useState({ done: 0, total: 1, error: null });
  const engineRef = useRef(null);

  const [mission, setMission] = useState(defaultMission);
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS);
  const [limits, setLimits] = useState(DEFAULT_LIMITS);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [runError, setRunError] = useState(null);
  const [layerKey, setLayerKey] = useState("sun");
  const [selRef, setSelRef] = useState(null); // {type:"spot",rank} | {type:"site",id} | {type:"pick",p}
  const [hover, setHover] = useState(null);

  // --- Carga de datos y motor ---------------------------------------------
  useEffect(() => {
    loadData((done, total) => setLoadState((s) => ({ ...s, done, total })))
      .then((d) => {
        setData(d);
        if (d.horizon && d.ephem) engineRef.current = new MissionEngine(d);
      })
      .catch((e) => setLoadState((s) => ({ ...s, error: e.message })));
    return () => engineRef.current?.dispose();
  }, []);

  const range = engineRef.current?.range || [0, 0];
  const problem = data && engineRef.current ? missionProblem(mission, range) : null;

  const run = async (w = weights) => {
    if (!engineRef.current || problem) return;
    setRunning(true);
    setRunError(null);
    setProgress(0);
    try {
      const r = await engineRef.current.run({ ...mission, weights: { sun: w.sun, earth: w.earth }, candidateStepH: 3 }, setProgress);
      if (r) {
        setResult(r);
        setLayerKey("score");
      }
    } catch (e) {
      setRunError(e.message);
    } finally {
      setRunning(false);
    }
  };

  // Si cambian los pesos de Sol/Tierra tras un cálculo, el mejor momento de
  // aterrizaje puede cambiar: se recalcula (con un pequeño retardo).
  const lastWeights = useRef(weights);
  useEffect(() => {
    const prev = lastWeights.current;
    lastWeights.current = weights;
    if (!result || (prev.sun === weights.sun && prev.earth === weights.earth)) return;
    const t = setTimeout(() => run(weights), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weights.sun, weights.earth]);

  // --- Puntuación, puntos calientes y regiones -----------------------------
  const score = useMemo(() => (data && result ? scoreGrid(result, data.layers, weights, limits) : null), [data, result, weights, limits]);

  const metricsAt = (p) => (result ? {
    sun: result.sun[p], earth: result.earth[p], both: result.both[p], night: result.night[p], best: result.best[p],
  } : null);

  const spots = useMemo(() => {
    if (!score || !data) return [];
    const grid = data.manifest.grid;
    const sites = data.manifest.sites?.sites || [];
    return findHotspots(score, grid).spots.map((s) => {
      const near = nearestSite(s, sites, grid, latLonToXY);
      const nearTxt = near && near.km < 25 ? ` · ${near.km.toFixed(0)} km from ${near.site.name}` : "";
      return {
        ...s,
        key: `spot-${s.rank}`,
        ref: { type: "spot", rank: s.rank },
        name: `Spot ${String(s.rank).padStart(2, "0")}`,
        score: s.peakScore,
        meta: `${formatLatLon(s.lat, s.lon)}${nearTxt} · ${s.areaKm2.toFixed(0)} km²`,
        metrics: metricsAt(s.peak),
      };
    });
  }, [score, data, result]); // eslint-disable-line react-hooks/exhaustive-deps

  // Regiones Artemis III: mejor píxel de 1 km dentro de su recuadro de ~15 × 15 km.
  const sites = useMemo(() => {
    if (!data) return [];
    const grid = data.manifest.grid;
    const n = grid.n;
    const list = (data.manifest.sites?.sites || []).map((s) => {
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
      const bi = Math.floor(best / n), bj = best % n;
      const [bx, by] = pixelXY(grid, bi, bj);
      const [blat, blon] = xyToLatLon(grid, bx, by);
      return {
        ...s, key: `site-${s.id}`, ref: { type: "site", id: s.id }, score: bestScore, mean, p: best, i: bi, j: bj,
        lat: blat, lon: blon, centre: [s.lat, s.lon],
        meta: score
          ? (Number.isFinite(bestScore) ? `Best 1 km inside the region · region mean ${Math.round(mean)} · ${cnt} of 225 km² pass the limits` : "No 1 km pixel in this region passes your limits")
          : formatLatLon(s.lat, s.lon),
        metrics: score ? metricsAt(best) : null,
      };
    });
    const ranked = [...list].sort((a, b) => (Number.isFinite(b.score) ? b.score : -1) - (Number.isFinite(a.score) ? a.score : -1));
    ranked.forEach((s, k) => { s.rank = Number.isFinite(s.score) ? k + 1 : null; });
    return ranked;
  }, [data, score, result]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lugar seleccionado (se recalcula si cambian los resultados).
  const selected = useMemo(() => {
    if (!selRef || !data) return null;
    const grid = data.manifest.grid;
    if (selRef.type === "spot") {
      const s = spots.find((x) => x.rank === selRef.rank);
      return s ? { ...s, type: "spot", p: s.peak, kindLabel: "Hotspot" } : null;
    }
    if (selRef.type === "site") {
      const s = sites.find((x) => x.id === selRef.id);
      return s ? { ...s, type: "site", kindLabel: "Artemis III region", note: score && Number.isFinite(s.score) ? `Best 1 km pixel inside the ~15 × 15 km region. Region mean ${Math.round(s.mean)}.` : null } : null;
    }
    const p = selRef.p;
    const i = Math.floor(p / grid.n), j = p % grid.n;
    const [x, y] = pixelXY(grid, i, j);
    const [lat, lon] = xyToLatLon(grid, x, y);
    return {
      type: "pick", key: `pick-${p}`, p, i, j, lat, lon, kindLabel: "Your spot", name: "Spot you picked",
      score: score ? score[p] : NaN, metrics: metricsAt(p),
      excluded: result ? exclusionAt(p, result, data.layers, limits) : null,
    };
  }, [selRef, spots, sites, score, data, result, limits]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Valores de la capa activa -------------------------------------------
  const layer = LAYERS[layerKey];
  const values = useMemo(() => {
    if (!data) return null;
    const ly = data.layers;
    switch (layerKey) {
      case "score": return score;
      case "sun": return result ? result.sun : ly.avgSun || null;
      case "earth": return result ? result.earth : ly.avgEarth || null;
      case "slope": return ly.slope || null;
      case "shadow": {
        if (!ly.psrDistKm) return null;
        const out = new Float32Array(ly.psrDistKm.length);
        for (let p = 0; p < out.length; p++) {
          out[p] = ly.psrShare?.[p] > 0.5 ? -1 : Math.max(0, 1 - ly.psrDistKm[p] / limits.iceReachKm);
        }
        return out;
      }
      default: return null;
    }
  }, [data, layerKey, result, score, limits.iceReachKm]);

  const extent = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    if (values) for (const v of values) if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
    return [lo, hi];
  }, [values]);
  const legendEnds = () => {
    if (!values || !Number.isFinite(extent[1])) return ["–", "–"];
    if (layerKey === "score") return [`${Math.round(extent[0])}`, `${Math.round(extent[1])}`];
    if (layerKey === "sun" || layerKey === "earth") return ["0%", `${Math.round(extent[1] * 100)}%`];
    return layer.legend;
  };
  const layerSource = () => {
    if (layerKey === "score") return "Your weights over this mission";
    if ((layerKey === "sun" || layerKey === "earth") && !result) return "Long-term average, LOLA AVGVISIB (18.6 years)";
    if (layerKey === "sun" || layerKey === "earth") return "Best landing time in your window";
    if (layerKey === "slope") return "LOLA LDSM 240 m, median per 1 km";
    return `Hatched: permanent shadow (LOLA LPSR). Brighter: within ${limits.iceReachKm} km`;
  };

  // --- Lectura bajo el cursor ----------------------------------------------
  const hoverInfo = useMemo(() => {
    if (hover == null || !data) return null;
    const grid = data.manifest.grid;
    const i = Math.floor(hover / grid.n), j = hover % grid.n;
    const [x, y] = pixelXY(grid, i, j);
    const [lat, lon] = xyToLatLon(grid, x, y);
    return {
      coords: formatLatLon(lat, lon),
      elevation: data.layers.elevation?.[hover],
      slope: data.layers.slope?.[hover],
      score: score?.[hover],
      sun: result ? result.sun[hover] : data.layers.avgSun?.[hover],
      earth: result?.earth[hover],
    };
  }, [hover, data, score, result]);

  const fmt = (v, d = 0, k = 1) => (Number.isFinite(v) ? (v * k).toFixed(d) : "–");

  const nav = (
    <L.NavRail
      brand="LH"
      brandLabel="Lunar Horizon mission selector"
      orientation={mobile ? "horizontal" : "vertical"}
      active={page}
      onSelect={setPage}
      label="Sections"
      items={[
        { id: "explore", icon: "orbit", label: "Explore" },
        { id: "learn", icon: "book-open", label: "Learn" },
      ]}
    />
  );

  const viewSwitch = (
    <L.SegmentedControl
      label="View"
      size="sm"
      value={viewMode}
      onChange={setViewMode}
      options={[{ value: "map", label: "Map", icon: "layers" }, { value: "3d", label: "3D", icon: "globe" }]}
    />
  );

  const mapView = data ? (
    <MapView
      data={data}
      layer={layer}
      values={values}
      sites={sites}
      spots={spots}
      selected={selected}
      onSelect={setSelRef}
      onHover={setHover}
      onPick={(p) => setSelRef({ type: "pick", p })}
    >
      <L.Panel tone="overlay" padding="compact" className="hud hud--layers">
        <div className="hud__row">
          {viewSwitch}
          <L.SegmentedControl
            label="Map layer"
            size="sm"
            value={layerKey}
            onChange={setLayerKey}
            options={Object.entries(LAYERS).map(([k, v]) => ({ value: k, label: v.label, disabled: k === "score" && !result }))}
          />
        </div>
      </L.Panel>
      <L.Panel tone="overlay" padding="compact" className="hud hud--legend">
        <div className="legend">
          <div className="legend__head">
            {layer.kind ? <L.Icon name={layer.kind === "both" ? "blend" : layer.kind} size={16} className={`lh-k-${layer.kind}`} /> : null}
            <span className="readout-sm">{layer.label}</span>
          </div>
          <div className={`legend__bar legend__bar--${layer.ramp}`} aria-hidden="true" />
          <div className="legend__ends caption lh-sec"><span>{legendEnds()[0]}</span><span>{legendEnds()[1]}</span></div>
          <p className="caption lh-muted legend__src">{layerSource()}</p>
        </div>
      </L.Panel>
      {hoverInfo ? (
        <L.Panel tone="overlay" padding="compact" className="hud hud--hover" aria-live="off">
          <div className="readout-sm">{hoverInfo.coords}</div>
          <div className="hover-grid">
            <L.Readout size="sm" label="Height" value={fmt(hoverInfo.elevation)} unit="m" />
            <L.Readout size="sm" label="Slope" value={fmt(hoverInfo.slope, 1)} unit="°" />
            <L.Readout size="sm" label="Sunlight" kind="sun" value={fmt(hoverInfo.sun, 0, 100)} unit="%" />
            {result ? <L.Readout size="sm" label="Earth" kind="earth" value={fmt(hoverInfo.earth, 0, 100)} unit="%" /> : null}
            {result ? <L.Readout size="sm" label="Score" value={fmt(hoverInfo.score)} /> : null}
          </div>
          <p className="caption lh-muted hover-hint">Click to open this spot</p>
        </L.Panel>
      ) : null}
      {!engineRef.current ? (
        <L.Panel tone="overlay" padding="compact" className="hud hud--center">
          <L.StatusBanner tone="approximate" title="Horizons not built yet">
            The map shows the terrain, but mission scoring needs horizon.u8 and ephem.f32 from the pipeline.
          </L.StatusBanner>
        </L.Panel>
      ) : null}
    </MapView>
  ) : null;

  return (
    <div className={`app ${mobile ? "app--mobile" : ""}`}>
      <div className="app__rail">{nav}</div>
      {page === "learn" && data ? (
        <main className="app__learn"><LearnPage data={data} /></main>
      ) : (
        <>
          <main className="app__viewer">
            {!data ? (
              <div className="viewer viewer--empty" data-theme="dark">
                {loadState.error ? (
                  <L.StatusBanner tone="error" title="Map data not available" action={<L.Button size="sm" onClick={() => location.reload()}>Retry</L.Button>}>
                    {loadState.error}. Run the pipeline to create web/public/data.
                  </L.StatusBanner>
                ) : (
                  <L.StatusBanner tone="loading" title="Loading NASA terrain and ephemeris" progress={loadState.done / loadState.total}>
                    {loadState.done} of {loadState.total} files loaded
                  </L.StatusBanner>
                )}
              </div>
            ) : viewMode === "3d" ? (
              <Suspense fallback={<div className="viewer viewer--empty" data-theme="dark"><L.StatusBanner tone="loading" title="Loading the 3D view" /></div>}>
                <Moon3D data={data} mission={mission} result={result} sites={sites} spots={spots} selected={selected} viewSwitch={viewSwitch} />
              </Suspense>
            ) : (
              mapView
            )}
          </main>
          <aside className="app__side">
            <header className="side__head">
              <p className="eyebrow lh-muted">South Pole · 83.5–90°S · 1 km grid</p>
              <h1 className="display lh-slash side__title">Explore</h1>
            </header>
            <MissionPanel
              mission={mission}
              setMission={setMission}
              range={range}
              onRun={() => run()}
              running={running}
              progress={progress}
              problem={problem || runError}
              observerHeightM={data?.manifest.horizon?.observerHeightM ?? 2}
            />
            {selected && data ? (
              <PlaceDetail place={selected} mission={result} layers={data.layers} weights={weights} limits={limits} onClose={() => setSelRef(null)} />
            ) : null}
            <PlaceList
              eyebrow="02 — Best spots"
              title="Hotspots for this mission"
              places={spots}
              selectedKey={selected?.key}
              onSelect={setSelRef}
              hasMission={!!result}
              empty="Raise the maximum slope or turn off the night limit to see candidates."
              badge={<L.FidelityBadge level="approximate" detail="1 km grid and 5° horizon bins: regional screening, not a certified landing site.">Approximate</L.FidelityBadge>}
            />
            <PlaceList
              eyebrow="03 — Artemis III"
              title="Candidate regions"
              places={sites}
              selectedKey={selected?.key}
              onSelect={setSelRef}
              hasMission={!!result}
              empty="No region passes your limits."
              badge={<L.FidelityBadge level="approximate" detail="NASA publishes ~15 × 15 km regions; centres are approximate.">Approximate</L.FidelityBadge>}
            />
            <PrioritiesPanel weights={weights} setWeights={setWeights} limits={limits} setLimits={setLimits} />
          </aside>
        </>
      )}
    </div>
  );
}
