// 02 Explore: mapa del polo sur (2D) o vista 3D, ranking y bandeja de comparar.

import { Suspense, lazy, useState } from "react";
import MapView from "../components/MapView.jsx";
import { Icon, Btn, Card, Tabs, Fidelity, FactorGrid, FactorSpark, Shape, IconBtn, cx } from "../ui/kit.jsx";
import { MissionChip, fmtShort } from "../ui/Shell.jsx";
import { PRESETS, presetOf } from "../engine/score.js";
import { RegionTabs } from "./GlobalExplore.jsx";

const Moon3D = lazy(() => import("../components/Moon3D.jsx"));

export const GOALS = ["Balanced", "Power first", "Earth contact first"];

/** Recorte del relieve LOLA alrededor de un lugar (miniatura del ranking). */
export function Thumb({ place, size = 44, km = 24, n = 400, radius = 10 }) {
  if (!place) return <span className="thumb" style={{ width: size, height: size, borderRadius: radius }} />;
  const full = size * (n / km);
  const x = ((place.j + 0.5) / n) * full - size / 2;
  const y = ((place.i + 0.5) / n) * full - size / 2;
  return (
    <span
      className="thumb"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundImage: `url(${import.meta.env.BASE_URL}data/hillshade.png)`,
        backgroundSize: `${full}px ${full}px`,
        backgroundPosition: `${-x}px ${-y}px`,
      }}
    >
      <i />
    </span>
  );
}

export function windowText(place, result) {
  if (!place?.metrics || !result) return null;
  const a = result.startMs + place.metrics.best * result.stepMs;
  return `${fmtShort(a)} → ${fmtShort(a + result.durationH * 3600e3)}`;
}

function CompareToggle({ inCmp, onClick, size = "md", label = "Compare" }) {
  return (
    <Btn variant="secondary" size={size} icon={inCmp ? "check" : "plus"} aria-pressed={inCmp} onClick={onClick}>{label}</Btn>
  );
}

export function Legend({ layer, legendEnds }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="legend" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      {open ? (
        <div role="tooltip" className="overlay legend__pop">
          <span className="lbl">Legend</span>
          <div className="legend__row"><Shape kind="circle" /><span>Artemis III region</span></div>
          <div className="legend__row"><Shape kind="square" /><span>Hotspot</span></div>
          <div className="legend__row"><Icon name="crosshair" size={12} /><span>Your spot</span></div>
          {layer ? (
            <div className="legend__ramp">
              <span className="legend__name">{layer.label}</span>
              <div className={`ramp ramp--${layer.ramp}`} />
              <div className="legend__ends"><span>{legendEnds[0]}</span><span>{legendEnds[1]}</span></div>
            </div>
          ) : null}
        </div>
      ) : null}
      <IconBtn icon="info" label="Legend" variant="overlay" onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} />
    </div>
  );
}

export function CompareTray({ items, onRemove, onOpen }) {
  return (
    <div role="region" aria-label="Compare tray" className="overlay tray">
      <Icon name="compare" size={16} />
      <span className="tray__title">Compare</span>
      <span className="tray__count">{items.length}/4</span>
      {items.map((p) => (
        <span key={p.key} className="tray__chip">
          {p.short}
          <button type="button" className="ibtn ibtn--ghost" style={{ width: 24, height: 24 }} aria-label={`Remove ${p.name}`} onClick={() => onRemove(p)}><Icon name="x" size={14} /></button>
        </span>
      ))}
      {Array.from({ length: Math.max(0, 3 - items.length) }, (_, k) => <span key={k} aria-hidden="true" className="tray__empty" />)}
      <Btn variant="primary" size="sm" iconRight="arrow-right" onClick={onOpen} disabled={!items.length}>Open</Btn>
    </div>
  );
}

export default function Explore({ app }) {
  const {
    data, result, running, progress, runError, problem, loadState, engineReady,
    places, groups, group, setGroup, selected, setSelRef, weights, setWeights,
    layerKey, setLayerKey, LAYERS, layer, values, legendEnds,
    dim, setDim, mission, openSettings, go, cmp, toggleCmp, inCmp, cmpPlaces,
    timeMs, setTimeMs, Rail, TimeBarEl, moonMission, sitesForMap, spotsForMap,
  } = app;

  const goal = presetOf(weights);
  const list = groups[group] || [];
  const ranked = list.filter((p) => Number.isFinite(p.score));
  const best = ranked[0] || null;
  const rest = (ranked.length ? ranked.slice(1) : list.slice(1));
  const sel = selected;
  const n = data?.manifest.grid.n || 400;

  const scoring = !result && engineReady && !problem && !runError;

  const mapLayerBar = (
    <div className="overlay layerbar">
      <Icon name="layers" size={16} />
      <span style={{ width: 6 }} />
      {Object.entries(LAYERS).map(([k, v]) => (
        <button
          key={k}
          type="button"
          aria-pressed={layerKey === k}
          disabled={k === "score" && !result}
          className={cx("layerbar__b", layerKey === k && "is-on")}
          onClick={() => setLayerKey(k)}
        >
          {layerKey === k ? <Icon name="check" size={12} /> : null}
          {v.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="shell">
      {Rail}
      <main className="shell__main shell__main--fit">
        <header className="pagehead">
          <h1 className="h-page">Explore/</h1>
          <Tabs label="View" value={dim} onChange={setDim} options={[{ value: "2D", label: "2D", icon: "map" }, { value: "3D", label: "3D", icon: "globe" }]} />
          {app.globalReady ? <RegionTabs region={app.region} setRegion={app.setRegion} globalReady /> : null}
          <div className="grow" />
          <MissionChip mission={mission} onClick={openSettings} />
        </header>

        <div className="explore">
          <section aria-label="Moon map" className="mapsec">
            {!data ? (
              <div className="mapsec__center">
                {loadState.error ? (
                  <div className="state">
                    <Icon name="alert" size={16} style={{ color: "var(--danger)" }} />
                    <span className="state__title">Map unavailable</span>
                    <span className="state__text">{loadState.error}. Run the pipeline to create web/public/data.</span>
                    <Btn size="sm" icon="refresh" onClick={() => location.reload()}>Retry</Btn>
                  </div>
                ) : (
                  <div className="state">
                    <Icon name="loader" size={16} className="spin" />
                    <span className="state__title">Loading NASA terrain and ephemeris</span>
                    <div className="progress"><span style={{ width: `${(loadState.done / loadState.total) * 100}%` }} /></div>
                    <span className="state__text">{loadState.done} of {loadState.total} files</span>
                  </div>
                )}
              </div>
            ) : dim === "3D" ? (
              <Suspense fallback={<div className="mapsec__center"><div className="state"><Icon name="loader" size={16} className="spin" /><span className="state__title">Loading the 3D view</span></div></div>}>
                <Moon3D data={data} mission={moonMission} result={result} sites={sitesForMap} spots={spotsForMap} selected={sel} timeMs={timeMs} onTimeChange={setTimeMs} />
              </Suspense>
            ) : (
              <MapView
                data={data}
                layer={layer}
                values={values}
                sites={sitesForMap}
                spots={spotsForMap}
                selected={sel}
                onSelect={setSelRef}
                onPick={(p) => setSelRef({ type: "pick", p })}
              >
                {mapLayerBar}
                {sel ? (
                  <div className="overlay selcard">
                    <div className="row-8">
                      <Shape kind={sel.shape} selected />
                      <span className="num-15 grow ellipsis">{sel.name}</span>
                      <span className="num-15">{Number.isFinite(sel.score) ? Math.round(sel.score) : "–"}</span>
                    </div>
                    <div className="coords">{sel.coords}</div>
                    {sel.excluded ? <div className="note-12"><Icon name="info" size={12} />{sel.excluded}</div> : null}
                    <FactorGrid values={sel.factors} />
                    <div className="row-6">
                      <Btn variant="primary" size="sm" iconRight="arrow-right" onClick={() => go("site")}>Open site</Btn>
                      <CompareToggle size="sm" inCmp={inCmp(sel)} onClick={() => toggleCmp(sel)} />
                      <div className="grow" />
                      <IconBtn icon="x" label="Clear selection" variant="ghost" size={32} onClick={() => setSelRef(null)} />
                    </div>
                  </div>
                ) : null}
                <Legend layer={layer} legendEnds={legendEnds} />
                <CompareTray items={cmpPlaces} onRemove={toggleCmp} onOpen={() => go("compare")} />
                {!engineReady ? (
                  <div className="overlay mapnote">
                    <Icon name="alert" size={14} />
                    Horizons not built yet: the map shows the terrain, but mission scoring needs horizon.u8 and ephem.f32.
                  </div>
                ) : null}
              </MapView>
            )}
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
              </div>
            </Card>

            <Card pad="md2" className="rank__best">
              <div className="stack-14">
                <div className="row-8">
                  <span className="lbl">Best</span>
                  <span className="muted-11">{goal || "Custom weights"}</span>
                  <div className="grow" />
                  <Fidelity level={scoring || running ? "processing" : "computed"} />
                </div>
                {problem || runError ? (
                  <div className="state state--left">
                    <Icon name="alert" size={16} style={{ color: "var(--danger)" }} />
                    <span className="state__title">No valid window</span>
                    <span className="state__text">{problem || runError}</span>
                    <Btn size="sm" icon="sliders" onClick={openSettings}>Mission settings</Btn>
                  </div>
                ) : scoring || !best ? (
                  <div className="state state--left">
                    <span className="row-8"><Icon name="loader" size={16} className="spin" /><span className="state__title">Scoring</span><span className="muted-12">{Math.round(progress * 100)}%</span></span>
                    <div className="progress"><span style={{ width: `${progress * 100}%` }} /></div>
                    <span className="state__text">Sun and Earth over the terrain, every 1 km pixel.</span>
                  </div>
                ) : (
                  <>
                    <button type="button" className="best" onClick={() => setSelRef(best.ref)}>
                      <Thumb place={best} size={76} radius={14} n={n} />
                      <span className="best__text">
                        <span className="best__rank">01</span>
                        <span className="best__name">{best.name}</span>
                        <span className="coords">{best.coords}</span>
                      </span>
                      <span className="best__score">
                        <span>{Math.round(best.score)}</span>
                        <span className="muted-11">/100</span>
                      </span>
                    </button>
                    {windowText(best, result) ? (
                      <div className="row-8">
                        <Icon name="calendar" size={14} />
                        <span className="num-13">{windowText(best, result)}</span>
                        <span className="muted-11">{mission.durationDays} d</span>
                      </div>
                    ) : null}
                    <FactorGrid values={best.factors} />
                    <div className="row-8">
                      <Btn variant="primary" iconRight="arrow-right" onClick={() => { setSelRef(best.ref); go("site"); }}>Open site</Btn>
                      <CompareToggle inCmp={inCmp(best)} onClick={() => toggleCmp(best)} />
                    </div>
                  </>
                )}
              </div>
            </Card>

            <Card pad="sm" className="rank__list">
              <div className="stack-10">
                <div className="row-8 px-4">
                  <h2 className="h-sm">Ranking/</h2>
                </div>
                <div className="row-6 px-4 wrap">
                  {Object.entries(groups).map(([id, g]) => (
                    <button key={id} type="button" className={cx("chip", group === id && "is-on")} aria-pressed={group === id} onClick={() => setGroup(id)}>
                      {g.label}<span className="chip__n">{g.length}</span>
                    </button>
                  ))}
                </div>
                <div className="rows">
                  {rest.length === 0 && !scoring ? (
                    <p className="muted-12 px-4">{group === "spots" ? "No hotspot passes your limits. Raise the maximum slope in Mission settings." : "Nothing to rank yet."}</p>
                  ) : null}
                  {rest.map((p, k) => (
                    <div key={p.key} className={cx("rrow", sel?.key === p.key && "is-sel")}>
                      <span className="rrow__rank">{String((ranked.length ? 2 : 2) + k).padStart(2, "0")}</span>
                      <button type="button" className="rrow__main" onClick={() => setSelRef(p.ref)}>
                        <Thumb place={p} n={n} />
                        <span className="rrow__text">
                          <span className="row-6"><Shape kind={p.shape} /><span className="rrow__name">{p.name}</span></span>
                          <FactorSpark values={p.factors} />
                        </span>
                      </button>
                      <span className="rrow__score">{Number.isFinite(p.score) ? Math.round(p.score) : "–"}</span>
                      <button type="button" className={cx("ibtn ibtn--outline", inCmp(p) && "is-on")} style={{ width: 32, height: 32 }} aria-label={inCmp(p) ? `Remove ${p.name} from compare` : `Add ${p.name} to compare`} aria-pressed={inCmp(p)} onClick={() => toggleCmp(p)}>
                        <Icon name={inCmp(p) ? "check" : "plus"} size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          </aside>
        </div>
        {TimeBarEl}
      </main>
    </div>
  );
}

