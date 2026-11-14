// 02 Explore · Whole Moon: mapa de calor de toda la Luna para las fechas de la misión.
// La luz, la Tierra visible y la noche más larga se calculan al momento en el navegador
// (mismo motor que el polo sur) con los horizontes globales ya trazados; la pendiente es
// la malla de la rama Jan. De momento solo con fecha fija de aterrizaje.
// El polo sur sigue usando Explore.jsx, sin cambios.

import { useEffect, useMemo, useState } from "react";
import GlobalMap, { viridisCss } from "../components/GlobalMap.jsx";
import { Icon, Btn, Card, Tabs, FactorGrid, Shape, cx } from "../ui/kit.jsx";
import { MissionChip, fmtShort } from "../ui/Shell.jsx";
import { GOALS } from "./Explore.jsx";
import { PRESETS, presetOf } from "../engine/score.js";
import {
  GLOBAL_FACTORS, cellLatLon, fmtLatLon, globalEngine, globalExclusionAt, globalFactorsAt, globalHotspots, globalScore, loadGlobalStatic,
} from "../engine/globalScore.js";

const VIEW = {
  sun: { label: "Sunlight", unit: "%", fmt: (v) => `${Math.round(v * 100)}%`, extent: () => [0, 1] },
  earth: { label: "Earth view", unit: "%", fmt: (v) => `${Math.round(v * 100)}%`, extent: () => [0, 1] },
  slope: { label: "Slope", unit: "°", fmt: (v) => `${v.toFixed(1)}°`, extent: () => [0, 30], invert: true },
  night: { label: "Longest night", unit: "h", fmt: (v) => (v >= 48 ? `${(v / 24).toFixed(1)} d` : `${Math.round(v)} h`), extent: (a) => [0, maxOf(a) || 1], invert: true },
};

function maxOf(a) {
  let hi = -Infinity;
  if (a) for (const v of a) if (v > hi) hi = v;
  return Number.isFinite(hi) ? hi : null;
}
function extentOf(a) {
  let lo = Infinity, hi = -Infinity;
  if (a) for (const v of a) if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return Number.isFinite(hi) ? [lo, hi] : [0, 1];
}

export function RegionTabs({ region, setRegion, globalReady }) {
  return (
    <Tabs
      label="Region"
      value={region}
      onChange={(r) => (r === "moon" && !globalReady ? null : setRegion(r))}
      options={[{ value: "south", label: "South Pole", icon: "crosshair" }, { value: "moon", label: "Whole Moon", icon: "globe" }]}
    />
  );
}

export default function GlobalExplore({ app }) {
  const { globalManifest: gm, data, mission, request, problem, weights, setWeights, limits, openSettings, go, Rail, regionId: region, setRegion } = app;
  const grid = gm.grid;
  const [stat, setStat] = useState(null);   // horizontes, elevación y pendiente (una sola descarga)
  const [calc, setCalc] = useState(null);   // { request, progress, result, error, ms }
  const [error, setError] = useState(null);
  const [layerKey, setLayerKey] = useState("score");
  const [sel, setSel] = useState(null);
  const [hover, setHover] = useState(null);
  const [hillshade, setHillshade] = useState(null);

  useEffect(() => {
    if (!gm.hillshade) return;
    const img = new Image();
    img.onload = () => setHillshade(img);
    img.src = `${import.meta.env.BASE_URL}data/${gm.hillshade}`;
  }, [gm.hillshade]);

  useEffect(() => {
    let alive = true;
    loadGlobalStatic(gm).then((st) => alive && setStat(st)).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [gm]);

  // Cálculo para las fechas de la misión: Sol y Tierra contra el horizonte de cada celda, hora a hora.
  const ready = !!(stat && data?.ephem);
  useEffect(() => {
    if (!ready || problem) return undefined;
    const engine = globalEngine(gm, stat, data.ephem, data.manifest.ephem);
    let cancelled = false;
    const timer = setTimeout(async () => {
      const t0 = performance.now();
      try {
        const result = await engine.run(request, (progress) => { if (!cancelled) setCalc({ request, progress }); });
        if (result && !cancelled) setCalc({ request, result, progress: 1, ms: performance.now() - t0 });
      } catch (e) {
        if (!cancelled) setCalc({ request, error: e.message });
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); engine.cancel(); };
  }, [ready, request, problem, gm, stat, data]);

  const current = calc?.request === request ? calc : null;
  const result = problem ? null : current?.result ?? null;
  const runError = problem ? null : current?.error ?? null;
  const loading = !error && !problem && !runError && !result;
  const progress = current?.progress ?? 0;

  const L = useMemo(() => (result ? { sun: result.sun, earth: result.earth, night: result.night, slope: stat?.slope || null } : {}), [result, stat]);

  const { score, keys } = useMemo(() => globalScore(L, weights, limits), [L, weights, limits]);
  const spots = useMemo(() => globalHotspots(score, grid, 10, 5), [score, grid]);
  const scoreExtent = useMemo(() => extentOf(score), [score]);

  const values = layerKey === "score" ? score : L[layerKey];
  const extent = layerKey === "score" ? scoreExtent : VIEW[layerKey].extent(values);
  const invert = layerKey !== "score" && VIEW[layerKey].invert;

  const cellCard = (p, name) => {
    const [lat, lon] = cellLatLon(grid, p);
    const f = globalFactorsAt(p, L, limits);
    const f100 = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Number.isFinite(v) ? v * 100 : null]));
    return { p, lat, lon, name, coords: fmtLatLon(lat, lon), score: score[p], factors: f100, excluded: globalExclusionAt(p, L, limits) };
  };
  const best = spots[0] ? cellCard(spots[0].p, "Best cell 01") : null;
  const selected = sel != null ? cellCard(sel, spots.findIndex((s) => s.p === sel) >= 0 ? `Best cell ${String(spots.findIndex((s) => s.p === sel) + 1).padStart(2, "0")}` : "Your cell") : null;
  const goal = presetOf(weights);
  const ignored = Object.entries(weights).filter(([k, w]) => w > 0 && !GLOBAL_FACTORS.includes(k)).map(([k]) => k);

  const layerBar = (
    <div className="overlay layerbar">
      <Icon name="layers" size={16} />
      <span style={{ width: 6 }} />
      {[["score", { label: "Score" }], ...Object.entries(VIEW)].map(([k, v]) => (
        <button key={k} type="button" aria-pressed={layerKey === k} disabled={k !== "score" && !L[k]}
          className={cx("layerbar__b", layerKey === k && "is-on")} onClick={() => setLayerKey(k)}>
          {layerKey === k ? <Icon name="check" size={12} /> : null}
          {v.label}
        </button>
      ))}
    </div>
  );

  const hoverBox = hover ? (() => {
    const c = cellCard(hover.p, "");
    return (
      <div className="overlay gtip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
        <div className="num-13">{c.coords}</div>
        <div>Score: <b>{Number.isFinite(c.score) ? Math.round(c.score) : "–"}</b>{c.excluded ? ` · ${c.excluded}` : ""}</div>
        {Object.keys(VIEW).filter((k) => L[k]).map((k) => (
          <div key={k}>{VIEW[k].label}: {Number.isFinite(L[k][hover.p]) ? VIEW[k].fmt(L[k][hover.p]) : "no data"}</div>
        ))}
      </div>
    );
  })() : null;

  const legendEnds = layerKey === "score"
    ? [`${Math.round(extent[0])}`, `${Math.round(extent[1])}`]
    : (invert ? [extent[1], extent[0]] : extent).map((v) => VIEW[layerKey].fmt(v));

  return (
    <div className="shell">
      {Rail}
      <main className="shell__main shell__main--fit">
        <header className="pagehead">
          <h1 className="h-page">Explore/</h1>
          <RegionTabs region={region} setRegion={setRegion} globalReady />
          <div className="grow" />
          <MissionChip mission={mission} onClick={openSettings} />
        </header>

        <div className="explore">
          <section aria-label="Whole Moon map" className="mapsec">
            <GlobalMap
              grid={grid}
              hillshade={hillshade}
              values={values}
              extent={extent}
              invert={invert}
              spots={spots}
              selectedP={sel}
              onSelect={setSel}
              onHover={(p, e) => {
                if (p == null || !e) return setHover(null);
                const r = e.currentTarget.getBoundingClientRect();
                return setHover({ p, x: e.clientX - r.left, y: e.clientY - r.top });
              }}
            >
              {layerBar}
              {hoverBox}
              {selected ? (
                <div className="overlay selcard">
                  <div className="row-8">
                    <Shape kind="square" selected />
                    <span className="num-15 grow ellipsis">{selected.name}</span>
                    <span className="num-15">{Number.isFinite(selected.score) ? Math.round(selected.score) : "–"}</span>
                  </div>
                  <div className="coords">{selected.coords} · {grid.stepDeg}° cell (~{Math.round(grid.stepDeg * 30.3)} km at the equator)</div>
                  {selected.excluded ? <div className="note-12"><Icon name="info" size={12} />{selected.excluded}</div> : null}
                  <FactorGrid values={selected.factors} />
                  <div className="row-6"><div className="grow" /><Btn size="sm" variant="ghost" icon="x" onClick={() => setSel(null)}>Clear</Btn></div>
                </div>
              ) : null}
              <div className="overlay glegend" aria-label="Legend">
                <span className="lbl">{layerKey === "score" ? "Score" : VIEW[layerKey].label}</span>
                <span className="glegend__ramp" style={{ background: viridisCss() }} />
                <span className="glegend__ends"><span>{legendEnds[0]}</span><span>{legendEnds[1]}</span></span>
                <span className="glegend__na"><i />Excluded / no data</span>
              </div>
              {loading ? (
                <div className="overlay mapnote"><Icon name="loader" size={14} className="spin" />
                  {ready ? `Computing Sun and Earth for every cell… ${Math.round(progress * 100)}%` : "Loading whole-Moon horizons…"}
                </div>
              ) : null}
            </GlobalMap>
          </section>

          <aside aria-label="Ranking" className="rank">
            <Card pad="md" className="rank__goal">
              <div className="stack-10">
                <div className="row-base">
                  <span className="lbl">Goal</span>
                  <div className="grow" />
                  <button type="button" className="linkbtn linkbtn--12" onClick={() => go("priorities")}>Weights<Icon name="chevron-right" size={12} /></button>
                </div>
                <Tabs label="Goal" value={goal} onChange={(g) => setWeights({ ...PRESETS[g] })} options={GOALS.map((g) => ({ value: g, label: g }))} className="tabs--block" />
                <span className="muted-11">
                  Scored with {keys.length ? keys.map((k) => VIEW[k].label).join(", ") : "nothing yet"}.
                  {ignored.length ? ` ${ignored.length} other weights have no whole-Moon data and are not used here.` : ""}
                </span>
              </div>
            </Card>

            <Card pad="md2" className="rank__best">
              <div className="stack-14">
                <div className="row-8"><span className="lbl">Best on the whole Moon</span></div>
                {error || runError ? (
                  <div className="state state--left"><Icon name="alert" size={16} style={{ color: "var(--danger)" }} /><span className="state__title">{error ? "Could not load the whole-Moon data" : "Could not compute this mission"}</span><span className="state__text">{error || runError}</span></div>
                ) : problem ? (
                  <div className="state state--left">
                    <Icon name="calendar" size={16} />
                    <span className="state__title">Check the mission dates</span>
                    <span className="state__text">{problem}</span>
                    <Btn size="sm" icon="sliders" onClick={openSettings}>Mission settings</Btn>
                  </div>
                ) : !best ? (
                  <div className="state state--left">
                    <span className="state__title">{loading ? "Scoring" : "No cell passes your limits"}</span>
                    {!loading ? <Btn size="sm" icon="sliders" onClick={openSettings}>Mission settings</Btn> : null}
                  </div>
                ) : (
                  <>
                    <button type="button" className="best" onClick={() => setSel(best.p)}>
                      <span className="best__text">
                        <span className="best__rank">01</span>
                        <span className="best__name">{best.coords}</span>
                        <span className="coords">{grid.stepDeg}° cell</span>
                      </span>
                      <span className="best__score"><span>{Math.round(best.score)}</span><span className="muted-11">/100</span></span>
                    </button>
                    <FactorGrid values={best.factors} />
                  </>
                )}
                <div className="muted-11">
                  <div>Sunlight, Earth view and longest night: computed in your browser for {fmtShort(mission.fromMs)} → {fmtShort(mission.toMs)}{current?.ms ? ` (${(current.ms / 1000).toFixed(1)} s)` : ""}.</div>
                  <div>Terrain horizons from LOLA LDEM_64, one per {grid.stepDeg}° cell · Sun and Earth from SPICE DE440 · slope from the 1 km grid (Jan, T1).</div>
                </div>
              </div>
            </Card>

            <Card pad="sm" className="rank__list">
              <div className="stack-10">
                <div className="row-8 px-4"><h2 className="h-sm">Ranking/</h2><span className="muted-11">cells ≥ 5° apart</span></div>
                <div className="rows">
                  {spots.slice(1).map((s, k) => (
                    <div key={s.p} className={cx("rrow", sel === s.p && "is-sel")}>
                      <span className="rrow__rank">{String(k + 2).padStart(2, "0")}</span>
                      <button type="button" className="rrow__main" onClick={() => setSel(s.p)}>
                        <span className="rrow__text"><span className="row-6"><Shape kind="square" /><span className="rrow__name">{fmtLatLon(s.lat, s.lon)}</span></span></span>
                      </button>
                      <span className="rrow__score">{Math.round(s.score)}</span>
                    </div>
                  ))}
                  {spots.length <= 1 && !loading ? <p className="muted-12 px-4">Nothing to rank yet.</p> : null}
                </div>
              </div>
            </Card>
          </aside>
        </div>
      </main>
    </div>
  );
}
