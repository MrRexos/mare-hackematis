// 02 Explore · Whole Moon: la misma pantalla que el polo sur (Explore.jsx) para toda la Luna.
// Mismo esquema: barra de capas, ficha del punto, leyenda, bandeja de comparar y, a la
// derecha, objetivo, mejor lugar y ranking. Cambian los datos: malla global de 0,5°, con la
// luz, la Tierra y la temperatura calculadas al momento para las fechas de la misión
// (useGlobalMission). De momento solo con fecha fija de aterrizaje.

import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import GlobalMap from "../components/GlobalMap.jsx";
import { Icon, Btn, Card, Tabs, Fidelity, FactorGrid, FactorSpark, Shape, IconBtn, cx } from "../ui/kit.jsx";
import { MissionChip, fmtShort } from "../ui/Shell.jsx";
import { CompareTray } from "./Explore.jsx";
import { ROUGH_MAX_M, presetOf } from "../engine/score.js";
// El globo 3D (three.js y sus texturas) solo se descarga si se abre la vista 3D.
const MoonGlobe = lazy(() => import("../components/MoonGlobe.jsx"));

import { GLOBAL_FACTORS, TEMP_BAND, WATER_FULL_WT_PCT, cellLatLon, fmtLatLon } from "../engine/globalScore.js";

const PDS = "https://pds-geosciences.wustl.edu/lro/";
const LOLA = `${PDS}lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/`;
const DIVINER = `${PDS}urn-nasa-pds-lro_diviner_derived1/data_derived_gcp/`;
const DE440 = "https://ssd.jpl.nasa.gov/planets/eph_export.html";
const percent = (v) => `${Math.round(v * 100)}%`;

/** Capas del mapa, con el mismo formato que las del polo sur (data/mapLayers.js). `key` = dato en G.L. */
const LAYERS = {
  score: {
    label: "Mission score", short: "Score", ramp: "score", legend: ["Lower", "Higher"], format: (v) => `${Math.round(v)}/100`,
    description: "Suitability from 0 to 100, computed from the six weighted mission factors. The active limits can exclude a cell from the map.",
    sources: [],
  },
  sun: {
    label: "Sun visibility", short: "Sun", ramp: "sun", legend: ["0%", "100%"], format: percent,
    description: "Share of the surface stay when the Sun clears the terrain horizon of the cell, computed in your browser for the mission dates. One horizon per 0.5° cell; four above 60° latitude.",
    sources: [["NASA PDS · LOLA LDEM_64", `${LOLA}ldem_64.lbl`], ["JPL DE440 ephemerides", DE440]],
  },
  earth: {
    label: "Earth visibility", short: "Earth", ramp: "earth", legend: ["0%", "100%"], format: percent,
    description: "Share of the surface stay with Earth above the terrain horizon of the cell, computed for the mission dates. A radio link also requires an available ground station and suitable equipment.",
    sources: [["NASA PDS · LOLA LDEM_64", `${LOLA}ldem_64.lbl`], ["JPL DE440 ephemerides", DE440]],
  },
  elev: {
    label: "Terrain elevation", short: "Elevation", ramp: "elevation", format: (v) => `${Math.round(v).toLocaleString("en-US")} m`,
    legendOf: (lo, hi) => [`${(lo / 1000).toFixed(1)} km`, `${(hi / 1000).toFixed(1)} km`],
    description: "Height at the centre of the 0.5° cell, relative to the Moon’s 1,737.4 km reference sphere.",
    sources: [["NASA PDS · LOLA LDEM_64", `${LOLA}ldem_64.lbl`]],
  },
  slope: {
    label: "Terrain slope", short: "Slope", ramp: "slope", legend: ["0°", "30°+"], format: (v) => `${v.toFixed(1)}°`,
    description: "Mean slope of the 1 km cells inside each 0.5° cell (about 15 km at the equator). Small steep areas are averaged out at this scale.",
    sources: [["USGS · LOLA global DEM 118 m", "https://astrogeology.usgs.gov/search/map/moon_lro_lola_dem_118m"]],
  },
  rough: {
    label: "Terrain roughness", short: "Roughness", ramp: "rough", legend: ["0 m", `${ROUGH_MAX_M} m+`], format: (v) => `${v.toFixed(2)} m`,
    description: "Typical variation in height after fitting a local plane to the laser measurements. Median of the LOLA global roughness samples inside the cell; the same quantity and scoring rule as the south pole.",
    sources: [["NASA PDS · LOLA LDRM_16", `${LOLA}ldrm_16.lbl`]],
  },
  temp: {
    label: "Mean surface temperature", short: "Surface temp.", ramp: "temp", format: (v) => `${Math.round(v)} K`,
    legendOf: (lo, hi) => [`${Math.round(lo)} K`, `${Math.round(hi)} K`],
    description: `Mean surface temperature during the mission, from LRO Diviner measurements read at each cell's local time, hour by hour. The score is the share of hours in a workable range: full marks from ${TEMP_BAND.mildK} to ${TEMP_BAND.hotOkK} K, none below ${TEMP_BAND.coldK} K or above ${TEMP_BAND.hotMaxK} K.`,
    sources: [["NASA PDS · Diviner Global Cumulative Products", DIVINER]],
  },
  water: {
    label: "Water equivalent", short: "Water", ramp: "water", max: WATER_FULL_WT_PCT, legend: ["0 wt%", `${WATER_FULL_WT_PCT} wt%+`], format: (v) => `${v.toFixed(3)} wt%`,
    description: `Water-equivalent hydrogen from Lunar Prospector, only attributed to ice above 70° latitude. True footprint 60–150 km, so crater-scale deposits look diluted. Full marks at ${WATER_FULL_WT_PCT} wt%.`,
    sources: [["NASA PDS · Lunar Prospector special products", "https://pds-geosciences.wustl.edu/missions/lunarp/reduced_special.html"]],
  },
};
const MAP_LAYERS = Object.keys(LAYERS);
/** El globo 3D lleva las mismas capas que el mapa 2D, además de la foto sola. */
const GLOBE_LAYERS = MAP_LAYERS;
const PHOTO = { label: "Photograph of the Moon", short: "Photo" };

/** Lecturas extra de la ficha del punto (no son capas de mapa). */
const POINT_FIELDS = [
  ["elev", "Elevation", LAYERS.elev.format],
  ["tmin", "Coldest", (v) => `${Math.round(v)} K`],
  ["tmax", "Hottest", (v) => `${Math.round(v)} K`],
  ["psr", "Permanent shadow", percent],
  ["night", "Longest night", (v) => (v >= 48 ? `${(v / 24).toFixed(1)} d` : `${Math.round(v)} h`)],
];

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

/** Recorte del relieve alrededor de una celda (miniatura del ranking), como Thumb del polo sur. */
function GlobalThumb({ place, hillshadeUrl, size = 44, deg = 24, radius = 10 }) {
  if (!place || !hillshadeUrl) return <span className="thumb" style={{ width: size, height: size, borderRadius: radius }} />;
  const w = size * (360 / deg), h = w / 2;
  const x = ((place.lon + 180) / 360) * w - size / 2;
  const y = ((90 - place.lat) / 180) * h - size / 2;
  return (
    <span className="thumb" aria-hidden="true"
      style={{ width: size, height: size, borderRadius: radius, backgroundImage: `url(${hillshadeUrl})`, backgroundSize: `${w}px ${h}px`, backgroundPosition: `${-x}px ${-y}px` }}>
      <i />
    </span>
  );
}

function CompareToggle({ inCmp, onClick, size = "md" }) {
  return <Btn variant="secondary" size={size} icon={inCmp ? "check" : "plus"} aria-pressed={inCmp} onClick={onClick}>Compare</Btn>;
}

export default function GlobalExplore({ app }) {
  const {
    globalManifest: gm, G, mission, problem, weights, openSettings, openWeights, go, Rail,
    regionId: region, setRegion, gSel: sel, setGSel: setSel, inCmp, toggleCmp, cmpPlaces, dim, setDim,
  } = app;
  const is3D = dim === "3D" && !!gm.globe; // globo de la Luna, sin capas de datos
  const grid = gm.grid;
  const { L, score, keys, spots, error, runError, loading, progress, ready, result } = G;
  const [layerKey, setLayerKey] = useState("score");
  const [globeKey, setGlobeKey] = useState("photo"); // capa del globo 3D; "photo" = la Luna tal cual
  const [hoverP, setHoverP] = useState(null);
  const [hillshade, setHillshade] = useState(null);
  const sources = useRef(null);
  const hillshadeUrl = gm.hillshade ? `${import.meta.env.BASE_URL}data/${gm.hillshade}` : null;

  useEffect(() => {
    if (!hillshadeUrl) return;
    const img = new Image();
    img.onload = () => setHillshade(img);
    img.src = hillshadeUrl;
  }, [hillshadeUrl]);

  const layerKeys = MAP_LAYERS.filter((k) => k === "score" || (k === "temp" ? gm.thermal : k === "water" || k === "rough" ? gm.layers?.[k] : true));
  const valuesOf = (key) => (key === "score" ? score : L[key] || null);
  const endsOf = (ly, vals) => {
    if (!vals || ly.legend) return ly.legend || ["–", "–"];
    let lo = Infinity, hi = -Infinity;
    for (const v of vals) if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
    return Number.isFinite(hi) ? ly.legendOf(lo, hi) : ["–", "–"];
  };
  const layer = LAYERS[layerKey];
  const values = valuesOf(layerKey);
  const legendEnds = endsOf(layer, values);
  // Globo 3D: foto sola, o una de sus capas encima.
  const globeKeys = ["photo", ...GLOBE_LAYERS.filter((k) => layerKeys.includes(k))];
  const globeLayer = globeKey !== "photo" && globeKeys.includes(globeKey) ? LAYERS[globeKey] : null;
  const globeValues = globeLayer ? valuesOf(globeKey) : null;

  /** Barra de capas (la misma en 2D y en 3D). */
  const layerBar = (keys, active, pick) => (
    <div className="map-controls__row">
      <div className="overlay layerbar" role="group" aria-label="Map layer">
        <Icon name="layers" size={16} />
        {keys.map((key) => {
          const ly = LAYERS[key] || PHOTO;
          return (
            <button key={key} type="button" className={cx("layerbar__b", active === key && "is-on")}
              aria-label={ly.label} title={ly.label} aria-pressed={active === key} onClick={() => pick(key)}>
              <span className="layerbar__check">{active === key && <Icon name="check" size={12} />}</span>
              {ly.short}
            </button>
          );
        })}
      </div>
      <div className="overlay map-controls__extras">
        <IconBtn icon="info" label="Layer sources and meaning" variant="ghost" size={32} onClick={() => sources.current.showModal()} />
      </div>
    </div>
  );
  /** Leyenda desplegable de una capa. */
  const legend = (ly, ends, isScore) => (
    <details className="overlay map-legend">
      <summary aria-label="Map legend" title="Map legend"><Icon name="layers" size={17} /></summary>
      <div className="overlay legend__pop">
        <div className="legend__row"><Shape kind="square" />Best cell</div>
        <div className="legend__row"><Icon name="crosshair" size={12} />Selected point</div>
        <div className="legend__ramp">
          <span className="legend__name">{ly.label}</span>
          <div className={cx("ramp", `ramp--${ly.ramp === "water" ? "earth" : ly.ramp}`)} style={ly.ramp === "water" ? { background: "linear-gradient(90deg, transparent, #4fd1c5)" } : undefined} />
          <div className="legend__ends"><span>{ends[0]}</span><span>{ends[1]}</span></div>
        </div>
        {isScore ? <div className="legend__row">Cells left out by your limits have no colour</div> : null}
      </div>
    </details>
  );

  const places = spots.map((s) => G.placeOf(s.p));
  const best = places[0] || null;
  const rest = places.slice(1);
  const selected = sel != null ? G.placeOf(sel) : null;
  const goal = presetOf(weights);
  const dates = result ? `${fmtShort(mission.fromMs)} → ${fmtShort(mission.toMs)}` : null;
  const openSite = (place) => { setSel(place.p); app.setTab("overview"); go("site"); };
  const ignored = Object.entries(weights).filter(([k, w]) => w > 0 && !GLOBAL_FACTORS.includes(k)).length;

  // Ficha del punto: el que está bajo el cursor o, si no hay, el seleccionado (como en el polo sur).
  const pointP = hoverP ?? selected?.p;
  const pending = layerKey === "score" && loading;
  const readout = pointP != null ? (() => {
    const hovering = hoverP != null;
    const v = values ? values[pointP] : NaN;
    const reading = pending ? "Calculating…" : Number.isFinite(v) ? layer.format(v) : layerKey === "score" ? "Left out" : "No data";
    const excluded = hovering ? null : selected.excluded;
    return (
      <section className="overlay map-readout" aria-label={hovering ? "Point under cursor" : "Selected point"} onPointerEnter={selected ? () => setHoverP(null) : undefined}>
        <div className="row-8">
          <span className="num-13 grow ellipsis">{hovering ? "Point under cursor" : selected.name}</span>
          <span className="coords">{hovering ? fmtLatLon(...cellLatLon(grid, pointP)) : selected.coords}</span>
        </div>
        <div className="row-8">
          <span className="muted-12 grow">{layer.label}</span>
          <strong className="num-15">{reading}</strong>
        </div>
        {!pending && ["score", "sun", "earth", "temp"].includes(layerKey) && dates ? (
          <div className="row-8"><span className="muted-12 grow">Your dates</span><span className="num-13">{dates}</span></div>
        ) : null}
        {!hovering ? POINT_FIELDS.filter(([k]) => L[k] && Number.isFinite(L[k][pointP])).map(([k, name, fmt]) => (
          <div key={k} className="row-8"><span className="muted-12 grow">{name}</span><span className="num-13">{fmt(L[k][pointP])}</span></div>
        )) : null}
        {excluded && layerKey === "score" ? <div className="note-12"><Icon name="info" size={12} />{excluded}</div> : null}
        {selected && !hovering ? (
          <div className="row-6">
            <Btn variant="primary" size="sm" iconRight="arrow-right" onClick={() => openSite(selected)}>Open site</Btn>
            <CompareToggle size="sm" inCmp={inCmp(selected)} onClick={() => toggleCmp(selected)} />
            <div className="grow" />
            <IconBtn icon="x" label="Clear selection" variant="ghost" size={32} onClick={() => setSel(null)} />
          </div>
        ) : null}
      </section>
    );
  })() : null;

  return (
    <div className="shell">
      {Rail}
      <main className="shell__main shell__main--fit">
        <header className="pagehead">
          <h1 className="h-page">Explore/</h1>
          {gm.globe ? <Tabs label="View" value={is3D ? "3D" : "2D"} onChange={(value) => { setHoverP(null); setDim(value); }} options={[{ value: "2D", label: "2D", icon: "map" }, { value: "3D", label: "3D", icon: "globe" }]} /> : null}
          <RegionTabs region={region} setRegion={setRegion} globalReady />
          <div className="grow" />
          <MissionChip mission={mission} onClick={openSettings} />
        </header>

        <div className="explore">
          <div className="explore-map">
            <section aria-label="Moon map" className="mapsec" data-theme="dark">
              {is3D ? (
                <Suspense fallback={<div className="mapsec__center"><div className="state"><Icon name="loader" size={16} className="spin" /><span className="state__title">Loading the 3D view</span></div></div>}>
                  <MoonGlobe globe={gm.globe} grid={grid} places={places} selected={selected} onSelect={setSel}
                    overlay={globeLayer && globeValues ? { layer: globeLayer, values: globeValues } : null}>
                    <CompareTray items={cmpPlaces} onRemove={toggleCmp} onOpen={() => go("compare")} />
                  </MoonGlobe>
                  <div className="map-controls">{layerBar(globeKeys, globeLayer ? globeKey : "photo", setGlobeKey)}</div>
                  {globeLayer ? legend(globeLayer, endsOf(globeLayer, globeValues), globeKey === "score") : null}
                  {selected ? (
                    // Celda elegida en el globo: las mismas acciones que la ficha del mapa 2D.
                    <div className="overlay map-readout sel3d" role="region" aria-label={`Selected: ${selected.name}`}>
                      <div className="row-8">
                        <Shape kind={selected.shape} />
                        <b className="grow">{selected.name}</b>
                        <span className="num-15">{Number.isFinite(selected.score) ? Math.round(selected.score) : "–"}</span>
                      </div>
                      <span className="coords">{selected.coords}</span>
                      {globeLayer && globeKey !== "score" ? (
                        <div className="row-8">
                          <span className="muted-12 grow">{globeLayer.label}</span>
                          <strong className="num-13">{globeValues && Number.isFinite(globeValues[selected.p]) ? globeLayer.format(globeValues[selected.p]) : loading ? "Calculating…" : "No data"}</strong>
                        </div>
                      ) : null}
                      {selected.excluded ? <div className="note-12"><Icon name="info" size={12} />{selected.excluded}</div> : null}
                      <div className="row-6">
                        <Btn variant="primary" size="sm" iconRight="arrow-right" onClick={() => openSite(selected)}>Open site</Btn>
                        <CompareToggle size="sm" inCmp={inCmp(selected)} onClick={() => toggleCmp(selected)} />
                        <div className="grow" />
                        <IconBtn icon="x" label="Clear selection" variant="ghost" size={32} onClick={() => setSel(null)} />
                      </div>
                    </div>
                  ) : null}
                </Suspense>
              ) : (
                <>
                <GlobalMap grid={grid} hillshade={hillshade} layer={layer} values={values} spots={spots} selectedP={sel}
                  onSelect={setSel} onHover={(p) => setHoverP(p ?? null)}>
                  <CompareTray items={cmpPlaces} onRemove={toggleCmp} onOpen={() => go("compare")} />
                  {error ? (
                    <div className="overlay mapnote"><Icon name="alert" size={14} />Whole-Moon data could not be loaded: {error}</div>
                  ) : !ready ? (
                    <div className="overlay mapnote"><Icon name="loader" size={14} className="spin" />Loading whole-Moon terrain horizons…</div>
                  ) : null}
                </GlobalMap>

                <div className="map-controls">
                  {layerBar(layerKeys, layerKey, setLayerKey)}
                  {readout}
                </div>

                {legend(layer, legendEnds, layerKey === "score")}

                </>
              )}

              {createPortal(<dialog className="layer-info" ref={sources} aria-labelledby="gmap-layer-info-title">
                <div className="layer-info__head">
                  <h2 id="gmap-layer-info-title" className="h-lg">Map layers and sources</h2>
                  <IconBtn icon="x" label="Close layer sources" variant="ghost" onClick={() => sources.current.close()} />
                </div>
                <div className="layer-info__body">
                  {layerKeys.map((key) => {
                    const { label, description, sources: links } = LAYERS[key];
                    return (
                      <section key={key} className={cx("layer-info__item", (is3D ? globeKey : layerKey) === key && "layer-info__item--current")}>
                        <h3>{label}</h3>
                        <p>{description}</p>
                        {links.length > 0 && (
                          <div className="layer-info__links">
                            {links.map(([name, url]) => <a key={url} href={url} target="_blank" rel="noreferrer">{name}<Icon name="external-link" size={12} /></a>)}
                          </div>
                        )}
                      </section>
                    );
                  })}
                  <section className="layer-info__item">
                    <h3>3D globe</h3>
                    <p>
                      Photograph: LROC Wide Angle Camera global mosaic, 100 m per pixel (NASA/GSFC/Arizona State University). Relief: LOLA, exaggerated six times.
                      Above 80° latitude the mosaic has no usable data and the globe shows shaded LOLA relief instead. The globe can also carry any of the map layers, with the same colours as the 2D map.
                    </p>
                  </section>
                  <section className="layer-info__item">
                    <h3>Whole-Moon grid</h3>
                    <p>
                      {grid.stepDeg}° cells (about {Math.round(grid.stepDeg * 30.3)} km at the equator). Sun, Earth and temperature are computed in your browser for the mission dates;
                      slope, roughness, elevation, water and permanent shadow are fixed properties of the terrain. The limit “Leave out permanent shadow” drops cells
                      with more than 50% in permanent shadow (LOLA). For 1 km detail near the south pole, switch to South Pole.
                    </p>
                  </section>
                </div>
              </dialog>, document.body)}
            </section>
          </div>

          <aside aria-label="Ranking" className="rank">
            <Card pad="md" className="rank__goal">
              <div className="stack-10">
                <div className="row-base">
                  <span className="lbl">Scoring profile</span>
                  <div className="grow" />
                  <button type="button" className="linkbtn linkbtn--12" onClick={openWeights}>Edit weights<Icon name="chevron-right" size={12} /></button>
                </div>
                <span className="num-15">{goal || "Custom weights"}</span>
                {ignored || (result && keys.length < GLOBAL_FACTORS.length) ? (
                  <span className="muted-11">Scored with {keys.length} of 6 factors; the rest have no whole-Moon data or zero weight.</span>
                ) : null}
              </div>
            </Card>

            <Card pad="md2" className="rank__best">
              <div className="stack-14">
                <div className="row-8">
                  <span className="lbl">Best</span>
                  <span className="muted-11">{goal || "Custom weights"}</span>
                  <div className="grow" />
                  {loading || best ? <Fidelity level={loading ? "processing" : "computed"} /> : null}
                </div>
                {problem || runError ? (
                  <div className="state state--left">
                    <Icon name="alert" size={16} style={{ color: "var(--danger)" }} />
                    <span className="state__title">No valid window</span>
                    <span className="state__text">{problem || runError}</span>
                    <Btn size="sm" icon="sliders" onClick={openSettings}>Mission settings</Btn>
                  </div>
                ) : error ? (
                  <p className="muted-12">Map data could not be loaded.</p>
                ) : loading ? (
                  <div className="state state--left" aria-label="Mission calculation">
                    <span className="row-8"><Icon name="loader" size={16} className="spin" /><span className="state__title">{ready ? "Scoring" : "Loading map data"}</span>{ready && <span className="muted-12">{Math.floor(progress * 100)}%</span>}</span>
                    {ready && <div className="progress" role="progressbar" aria-label="Mission calculation" aria-valuenow={Math.floor(progress * 100)}><span style={{ width: `${progress * 100}%` }} /></div>}
                  </div>
                ) : !best ? (
                  <p className="muted-12">{result ? "No cell passes the current limits." : "Mission results unavailable."}</p>
                ) : (
                  <>
                    <button type="button" className="best" onClick={() => setSel(best.p)}>
                      <GlobalThumb place={best} hillshadeUrl={hillshadeUrl} size={76} radius={14} />
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
                    {dates ? (
                      <div className="row-8">
                        <Icon name="calendar" size={14} />
                        <span className="num-13">{dates}</span>
                        <span className="muted-11">{mission.durationDays} d</span>
                      </div>
                    ) : null}
                    <FactorGrid values={best.factors} />
                    <div className="row-8">
                      <Btn variant="primary" iconRight="arrow-right" onClick={() => openSite(best)}>Open site</Btn>
                      <CompareToggle inCmp={inCmp(best)} onClick={() => toggleCmp(best)} />
                    </div>
                  </>
                )}
              </div>
            </Card>

            <Card pad="sm" className="rank__list">
              <div className="stack-10">
                <div className="row-8 px-4"><h2 className="h-sm">Ranking/</h2></div>
                <div className="row-6 px-4 wrap">
                  <span className="chip is-on">Best cells<span className="chip__n">{places.length}</span></span>
                </div>
                <div className="rows">
                  {rest.length === 0 && !loading ? <p className="muted-12 px-4">Nothing to rank yet.</p> : null}
                  {rest.map((p, k) => (
                    <div key={p.key} className={cx("rrow", sel === p.p && "is-sel")}>
                      <span className="rrow__rank">{String(k + 2).padStart(2, "0")}</span>
                      <button type="button" className="rrow__main" onClick={() => setSel(p.p)}>
                        <GlobalThumb place={p} hillshadeUrl={hillshadeUrl} />
                        <span className="rrow__text">
                          <span className="row-6"><Shape kind={p.shape} /><span className="rrow__name">{p.coords}</span></span>
                          <FactorSpark values={p.factors} />
                        </span>
                      </button>
                      <span className="rrow__score">{Number.isFinite(p.score) ? Math.round(p.score) : "–"}</span>
                      <button type="button" className={cx("ibtn ibtn--outline", inCmp(p) && "is-on")} style={{ width: 32, height: 32 }}
                        aria-label={inCmp(p) ? `Remove ${p.name} from compare` : `Add ${p.name} to compare`} aria-pressed={inCmp(p)} onClick={() => toggleCmp(p)}>
                        <Icon name={inCmp(p) ? "check" : "plus"} size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          </aside>
        </div>
      </main>
    </div>
  );
}
