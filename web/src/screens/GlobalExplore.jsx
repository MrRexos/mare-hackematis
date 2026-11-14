// 02 Explore · Whole Moon: mapa de calor de toda la Luna con las matrices globales
// (luz de la rama pol, Tierra de la rama Nil, pendiente de la rama Jan).
// El polo sur sigue usando Explore.jsx y su motor horario, sin cambios.

import { useEffect, useMemo, useState } from "react";
import GlobalMap, { viridisCss } from "../components/GlobalMap.jsx";
import { Icon, Btn, Card, Tabs, FactorGrid, Shape, cx } from "../ui/kit.jsx";
import { MissionChip } from "../ui/Shell.jsx";
import { GOALS } from "./Explore.jsx";
import { PRESETS, presetOf } from "../engine/score.js";
import {
  GLOBAL_FACTORS, cellLatLon, fmtLatLon, globalExclusionAt, globalFactorsAt, globalHotspots, globalScore, layerFor,
} from "../engine/globalScore.js";

const DAY_MS = 86400000;
const fmtDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const daysTxt = (cov, m) => {
  const total = Math.round((m.toMs - m.fromMs) / DAY_MS);
  const d = Math.round(cov * total * 10) / 10;
  return `${d} of ${total} days`;
};

const VIEW = {
  sun: { label: "Sunlight", unit: "%", fmt: (v) => `${Math.round(v * 100)}%`, extent: () => [0, 1] },
  earth: { label: "Earth view", unit: "%", fmt: (v) => `${Math.round(v * 100)}%`, extent: () => [0, 1] },
  slope: { label: "Slope", unit: "°", fmt: (v) => `${v.toFixed(1)}°`, extent: () => [0, 30], invert: true },
  night: { label: "Longest night", unit: "h", fmt: (v) => `${Math.round(v)} h`, extent: (a) => [0, maxOf(a) || 1], invert: true },
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
  const { globalManifest: gm, mission, weights, setWeights, limits, openSettings, go, Rail, regionId: region, setRegion, useDates } = app;
  const grid = gm.grid;
  const [L, setL] = useState({});
  const [info, setInfo] = useState({});
  const [loading, setLoading] = useState(true);
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

  // Capas para las fechas de la misión (media ponderada por horas de los periodos que tocan).
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all(Object.entries(gm.layers).map(async ([k, layer]) => [k, await layerFor(layer, mission.fromMs, mission.toMs)]))
      .then((list) => {
        if (!alive) return;
        const vals = {}, inf = {};
        for (const [k, r] of list) { vals[k] = r.values; inf[k] = r; }
        setL(vals);
        setInfo(inf);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [gm, mission.fromMs, mission.toMs]);

  const { score, keys } = useMemo(() => globalScore(L, weights, limits), [L, weights, limits]);
  const spots = useMemo(() => globalHotspots(score, grid, 10, 5), [score, grid]);
  const scoreExtent = useMemo(() => extentOf(score), [score]);

  const values = layerKey === "score" ? score : L[layerKey];
  const extent = layerKey === "score" ? scoreExtent : VIEW[layerKey].extent(values);
  const invert = layerKey !== "score" && VIEW[layerKey].invert;

  const missing = Object.entries(gm.layers).filter(([k]) => !L[k] && !loading).map(([k]) => k);
  const timeLayers = Object.entries(gm.layers).filter(([, l]) => l.kind !== "static");
  const allPeriods = [...new Set(timeLayers.flatMap(([, l]) => Object.entries(l.periods).filter(([pid]) => pid !== "static").map(([, p]) => p)))];

  const cellCard = (p, name) => {
    const [lat, lon] = cellLatLon(grid, p);
    const f = globalFactorsAt(p, L, limits);
    const f100 = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Number.isFinite(v) ? v * 100 : null]));
    return { p, lat, lon, name, coords: fmtLatLon(lat, lon), score: score[p], factors: f100, excluded: globalExclusionAt(p, L, limits) };
  };
  const best = spots[0] ? cellCard(spots[0].p, "Best cell 01") : null;
  const selected = sel != null ? cellCard(sel, spots.findIndex((s) => s.p === sel) >= 0 ? `Best cell ${String(spots.findIndex((s) => s.p === sel) + 1).padStart(2, "0")}` : "Your cell") : null;
  const goal = presetOf(weights);
  const partial = Object.entries(info).map(([k, r]) => (gm.layers[k].kind !== "static" && r.used?.length && r.coverage < 0.95 ? r : null)).find(Boolean) || null;
  const ignored = Object.entries(weights).filter(([k, w]) => w > 0 && !GLOBAL_FACTORS.includes(k)).map(([k]) => k);

  const layerBar = (
    <div className="overlay layerbar">
      <Icon name="layers" size={16} />
      <span style={{ width: 6 }} />
      {[["score", { label: "Score" }], ...Object.entries(VIEW).filter(([k]) => gm.layers[k])].map(([k, v]) => (
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
                  <div className="coords">{selected.coords} · cell 0.25° (~7.6 km at the equator)</div>
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
              {!loading && partial ? (
                <div className="overlay mapnote">
                  <Icon name="alert" size={14} />
                  Data for {daysTxt(partial.coverage, mission)} of your dates ({partial.used.join(", ")}). The map shows those days only; compute more days or narrow your dates.
                </div>
              ) : null}
              {loading ? (
                <div className="overlay mapnote"><Icon name="loader" size={14} className="spin" />Loading whole-Moon layers…</div>
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
                {error ? (
                  <div className="state state--left"><Icon name="alert" size={16} style={{ color: "var(--danger)" }} /><span className="state__title">Could not load the layers</span><span className="state__text">{error}</span></div>
                ) : missing.length && timeLayers.some(([k]) => missing.includes(k)) ? (
                  <div className="state state--left">
                    <Icon name="calendar" size={16} />
                    <span className="state__title">No data for these dates</span>
                    <span className="state__text">
                      {missing.map((k) => VIEW[k]?.label || k).join(", ")}: nothing computed between {fmtDay(mission.fromMs)} and {fmtDay(mission.toMs)}.
                      {allPeriods.length ? ` Computed: ${allPeriods.map((p) => `${p.start.slice(0, 10)}${p.end && Date.parse(p.end) - Date.parse(p.start) > DAY_MS ? ` → ${p.end.slice(0, 10)}` : ""}`).join(", ")}.` : ""}
                    </span>
                    {allPeriods.length ? (
                      <Btn size="sm" icon="calendar" onClick={() => useDates(Date.parse(allPeriods[0].start), Date.parse(allPeriods[0].end) - DAY_MS)}>Use {allPeriods[0].start.slice(0, 10)}</Btn>
                    ) : null}
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
                        <span className="coords">0.25° cell</span>
                      </span>
                      <span className="best__score"><span>{Math.round(best.score)}</span><span className="muted-11">/100</span></span>
                    </button>
                    <FactorGrid values={best.factors} />
                  </>
                )}
                <div className="muted-11">
                  {Object.entries(info).map(([k, r]) => (r.used?.length ? (
                    <div key={k}>{VIEW[k]?.label || k} ({gm.layers[k].branch}): {r.used.join(", ")}{gm.layers[k].kind !== "static" && r.coverage < 0.999 ? ` · ${daysTxt(r.coverage, mission)} of your dates` : ""}</div>
                  ) : null))}
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
