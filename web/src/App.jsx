import { useEffect, useMemo, useRef, useState } from "react";
import { L } from "./ds.js";
import { loadData } from "./data/loadData.js";
import { MissionEngine } from "./engine/missionEngine.js";
import { DEFAULT_LIMITS, DEFAULT_WEIGHTS, scoreGrid } from "./engine/score.js";
import { findHotspots, nearestSite } from "./engine/hotspots.js";
import { formatLatLon, latLonToXY, pixelXY, xyToLatLon } from "./engine/geometry.js";
import MapView from "./components/MapView.jsx";
import MissionPanel, { missionProblem } from "./components/MissionPanel.jsx";
import PrioritiesPanel from "./components/PrioritiesPanel.jsx";
import { SpotDetail, SpotsPanel } from "./components/SpotsPanel.jsx";
import LearnPage from "./components/LearnPage.jsx";

const DAY_MS = 86400000;

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
  const [selected, setSelected] = useState(null);
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
        setSelected(null);
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

  // --- Puntuación y puntos calientes ---------------------------------------
  const score = useMemo(() => (data && result ? scoreGrid(result, data.layers, weights, limits) : null), [data, result, weights, limits]);

  const spots = useMemo(() => {
    if (!score || !data) return [];
    const grid = data.manifest.grid;
    const sites = data.manifest.sites?.sites || [];
    return findHotspots(score, grid).spots.map((s) => {
      const near = nearestSite(s, sites, grid, latLonToXY);
      const nearTxt = near && near.km < 25 ? ` · ${near.km.toFixed(0)} km from ${near.site.name}` : "";
      return {
        ...s,
        name: `Spot ${String(s.rank).padStart(2, "0")}`,
        meta: `${formatLatLon(s.lat, s.lon)}${nearTxt} · ${s.areaKm2.toFixed(0)} km²`,
        metrics: {
          sun: result.sun[s.peak], earth: result.earth[s.peak], both: result.both[s.peak],
          night: result.night[s.peak], best: result.best[s.peak],
          slope: data.layers.slope[s.peak], psrDistKm: data.layers.psrDistKm[s.peak],
        },
      };
    });
  }, [score, data, result]);

  useEffect(() => {
    if (selected && !spots.find((s) => s.rank === selected.rank && s.peak === selected.peak)) setSelected(null);
  }, [spots, selected]);

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
            ) : (
              <MapView
                data={data}
                layer={layer}
                values={values}
                sites={data.manifest.sites?.sites || []}
                spots={spots}
                selected={selected}
                onSelect={setSelected}
                onHover={setHover}
              >
                <L.Panel tone="overlay" padding="compact" className="hud hud--layers">
                  <L.SegmentedControl
                    label="Map layer"
                    size="sm"
                    value={layerKey}
                    onChange={setLayerKey}
                    options={Object.entries(LAYERS).map(([k, v]) => ({ value: k, label: v.label, disabled: k === "score" && !result }))}
                  />
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
            <SpotsPanel spots={spots} selected={selected} onSelect={setSelected} hasMission={!!result} />
            {selected && result ? <SpotDetail spot={selected} mission={result} layers={data.layers} weights={weights} limits={limits} /> : null}
            <PrioritiesPanel weights={weights} setWeights={setWeights} limits={limits} setLimits={setLimits} />
          </aside>
        </>
      )}
    </div>
  );
}
