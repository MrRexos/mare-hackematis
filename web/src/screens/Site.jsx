// 03 Site: ficha de un lugar con pestañas Overview, Sky & Time, Terrain y Lander's View.
// En la Luna entera (app.moon) el lugar es una celda de la malla global: se muestran Overview
// y Sky & Time con sus datos; Terrain y Lander's View son del mapa polar de 1 km (polo sur o
// polo norte) y no aplican.

import { Suspense, lazy, useMemo, useState } from "react";
import MapView from "../components/MapView.jsx";
import MapControls, { MapPointReadout } from "../components/MapControls.jsx";
import { GROUND_GROUPS } from "../data/mapLayers.js";
import iceDetections from "../data/iceDetections.json";
import { Icon, Btn, Card, CardHead, Tabs, Fidelity, Shape, IconBtn, cx } from "../ui/kit.jsx";
import { MissionChip, ProfileChip, fmtShort, fmtHM, fmtIso } from "../ui/Shell.jsx";
import { FACTORS, presetOf } from "../engine/score.js";
import { compass, goodHoursPerDay, hoursPerDay, hourIndex, nextChange, runs } from "../engine/timeline.js";
import { formatDuration, pixelXY } from "../engine/geometry.js";

const Moon3D = lazy(() => import("../components/Moon3D.jsx"));
const AstronautMode = lazy(() => import("../astronaut/AstronautMode.jsx"));
const H = 3600e3;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function Stat({ label, value, unit, sub, icon, iconColor }) {
  return (
    <div className="stat">
      <span className="lbl">{icon ? <Icon name={icon} size={12} style={{ color: iconColor }} /> : null}{label}</span>
      <span className="stat__v"><b>{value}</b>{unit ? <span className="unit">{unit}</span> : null}</span>
      {sub ? <span className="muted-12">{sub}</span> : null}
    </div>
  );
}

function UpTag({ up }) {
  return <span className={cx("uptag", up ? "is-up" : "is-down")}>{up ? "Up" : "Down"}</span>;
}

/** En la Luna entera dos factores miden otra cosa que en los polos: se les cambia el nombre. */
export const MOON_FACTOR_LABELS = {
  temp: ["Thermal comfort", "Share of mission hours with a workable surface temperature (LRO Diviner)"],
  ice: ["Water", "Water-equivalent hydrogen (Lunar Prospector); only above 70° latitude"],
};

/** Rejilla de propiedades: nombre, valor y barra (Overview y Compare). */
export function PropGrid({ values, labels }) {
  return (
    <div className="props">
      {FACTORS.map((f) => {
        const v = values?.[f.key];
        const ok = Number.isFinite(v);
        return (
          <div key={f.key} className={cx("props__item", !ok && "is-off")} title={ok ? labels?.[f.key]?.[1] || f.hint : `${labels?.[f.key]?.[0] || f.label}: no data yet`}>
            <div className="row-8">
              <Icon name={f.icon} size={14} style={{ color: ok ? f.color : undefined }} />
              <span className="props__name">{labels?.[f.key]?.[0] || f.label}</span>
              <span className="props__v">{ok ? Math.round(v) : "–"}</span>
            </div>
            <div className="bar">{ok ? <div className="bar__fill" style={{ width: `${v}%`, background: f.color }} /> : null}</div>
          </div>
        );
      })}
    </div>
  );
}

const GOOD_DAY_KINDS = ["sun", "earth", "both"];
const DAY_ROWS = {
  sun: { label: "Sun", icon: "sun", aria: "Hours per day with the Sun in view" },
  earth: { label: "Earth", icon: "earth", aria: "Hours per day with Earth in view (direct contact)" },
  both: { label: "Both", icon: "blend", aria: "Hours per day with both Sun and Earth in view" },
};

/** Tiras de "días buenos": horas al día con Sol, con la Tierra o con ambos (una tira por tipo). */
export function GoodDays({ tl, missionWin, compact, kinds }) {
  if (kinds) return <GoodDaysRows tl={tl} missionWin={missionWin} kinds={kinds} />;
  return <GoodDaysStrip tl={tl} missionWin={missionWin} compact={compact} />;
}

function GoodDaysRows({ tl, missionWin, kinds }) {
  const all = useMemo(() => kinds.map((k) => [k, hoursPerDay(tl, k)]), [tl, kinds]);
  // Si la Tierra no cambia en todo el periodo (siempre a la vista, o nunca), su tira y la de
  // "ambos" no aportan nada: se sustituyen por una frase. Ocurre en casi toda la Luna entera.
  const earthDays = all.find(([k]) => k === "earth")?.[1];
  const steady = earthDays?.length && earthDays.every((h) => h === earthDays[0]) && (earthDays[0] === 0 || earthDays[0] === 24) ? earthDays[0] : null;
  const rows = steady == null ? all : all.filter(([k]) => k === "sun");
  const span = tl.n * H;
  const pct = (ms) => `${(((ms - tl.startMs) / span) * 100).toFixed(3)}%`;
  const months = [];
  const d0 = new Date(tl.startMs);
  for (let y = d0.getUTCFullYear(), m = d0.getUTCMonth() + 1; ; m++) {
    if (m > 11) { m = 0; y++; }
    const t = Date.UTC(y, m, 1);
    if (t >= tl.startMs + span) break;
    months.push({ t, label: span > 500 * 86400e3 ? (m === 0 ? String(y) : "") : MONTHS[m] });
  }
  return (
    <div className="gdays gdays--rows">
      <p className="muted-12 gdays__help">
        Each column is one day; the brighter it is, the more hours that day (0–24 h).
        {steady == null
          ? <><b> Sun</b> means power for the panels, <b>Earth</b> means direct radio contact, <b>Both</b> is the ideal state.</>
          : <><b> Sun</b> means power for the panels. <b>Earth</b> is {steady === 24 ? "in view all day, every day of this period, so direct radio contact never drops" : "never in view in this period, so there is no direct radio contact"}.</>}
        {" "}The outlined box is the best mission window.
      </p>
      <div className="gdays__row gdays__row--axis" aria-hidden="true">
        <span />
        <div className="gdays__months">{months.map((m) => (m.label ? <span key={m.t} style={{ left: pct(m.t) }}>{m.label}</span> : null))}</div>
      </div>
      {rows.map(([k, days]) => (
        <div key={k} className="gdays__row">
          <span className="gdays__name"><Icon name={DAY_ROWS[k].icon} size={14} style={{ color: `var(--${k})` }} />{DAY_ROWS[k].label}</span>
          <div className="gdays__strip gdays__strip--row" role="img" aria-label={DAY_ROWS[k].aria}>
            {Array.from(days, (h, i) => <span key={i} style={{ background: `var(--${k})`, opacity: 0.08 + 0.92 * (h / 24) }} title={`${DAY_ROWS[k].label} · ${fmtShort(tl.startMs + i * 24 * H)}: ${h} h`} />)}
            {missionWin ? <i className="gdays__mission" style={{ left: pct(missionWin[0]), width: `max(3px, calc(${pct(missionWin[1])} - ${pct(missionWin[0])}))` }} /> : null}
          </div>
        </div>
      ))}
      <div className="gdays__legend">
        <span>0 h</span><span className="gdays__ramp gdays__ramp--neutral" /><span>24 h per day</span>
        <div className="grow" />
        <span className="gdays__key"><i />Mission</span>
      </div>
    </div>
  );
}

/** Tira única (Sol y Tierra a la vez), usada en vistas compactas. */
function GoodDaysStrip({ tl, missionWin, compact }) {
  const days = useMemo(() => goodHoursPerDay(tl), [tl]);
  const span = tl.n * H;
  const pct = (ms) => `${(((ms - tl.startMs) / span) * 100).toFixed(3)}%`;
  const months = [];
  const d0 = new Date(tl.startMs);
  for (let y = d0.getUTCFullYear(), m = d0.getUTCMonth() + 1; ; m++) {
    if (m > 11) { m = 0; y++; }
    const t = Date.UTC(y, m, 1);
    if (t >= tl.startMs + span) break;
    months.push({ t, label: span > 500 * 86400e3 ? (m === 0 ? String(y) : "") : MONTHS[m] });
  }
  return (
    <div className={cx("gdays", compact && "gdays--compact")}>
      <div className="gdays__months" aria-hidden="true">{months.map((m) => (m.label ? <span key={m.t} style={{ left: pct(m.t) }}>{m.label}</span> : null))}</div>
      <div className="gdays__strip" role="img" aria-label="Hours per day with both Sun and Earth in view">
        {Array.from(days, (h, k) => <span key={k} style={{ opacity: 0.08 + 0.92 * (h / 24) }} title={`${fmtShort(tl.startMs + k * 24 * H)}: ${h} h`} />)}
        {missionWin ? <i className="gdays__mission" style={{ left: pct(missionWin[0]), width: `max(3px, calc(${pct(missionWin[1])} - ${pct(missionWin[0])}))` }} /> : null}
      </div>
      {!compact ? (
        <div className="gdays__legend">
          <span>0 h</span><span className="gdays__ramp" /><span>24 h</span>
          <div className="grow" />
          <span className="gdays__key"><i />Mission</span>
        </div>
      ) : null}
    </div>
  );
}

/** Pestaña activa: en la Luna entera solo existen Overview y Sky & Time. */
function siteTab(app) {
  return app.moon && (app.tab === "terrain" || app.tab === "lander") ? "overview" : app.tab;
}

/** Datos del terreno de una celda de la malla global (Luna entera). */
function GlobalGround({ app, pixel }) {
  const L = app.G.L;
  const num = (a) => (a ? a[pixel] : NaN);
  const groups = [
    { label: "Terrain", fields: [
      ["Elevation", num(L.elev), (v) => `${Math.round(v).toLocaleString("en-US")} m`],
      ["Mean slope", num(L.slope), (v) => `${v.toFixed(1)}°`],
      ["Roughness", num(L.rough), (v) => `${v.toFixed(2)} m`],
    ] },
    { label: "Surface temperature in the mission", fields: [
      ["Mean", num(L.temp), (v) => `${Math.round(v)} K`],
      ["Coldest", num(L.tmin), (v) => `${Math.round(v)} K`],
      ["Hottest", num(L.tmax), (v) => `${Math.round(v)} K`],
    ] },
    { label: "Shadow and water", fields: [
      ["Permanent shadow", num(L.psr), (v) => `${Math.round(v * 100)}%`],
      ["Water equivalent", num(L.water), (v) => `${v.toFixed(3)} wt%`],
    ] },
  ];
  return (
    <div className="ground-groups mt-12">
      {groups.map((group) => (
        <section className="ground-group" key={group.label}>
          <h3 className="lbl">{group.label}</h3>
          <dl className="ground-values">
            {group.fields.map(([label, value, format]) => (
              <div key={label}><dt>{label}</dt><dd>{Number.isFinite(value) ? format(value) : "No data"}</dd></div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

function Header({ app, place, idx, onAstronaut }) {
  // El Mare analiza un solo sitio: para cambiarlo se vuelve a Explore (sin flechas ‹ ›).
  const { setTab, mission, weights, openSettings, openWeights, go, inCmp, toggleCmp, rankInfo, result } = app;
  const tab = siteTab(app);
  const scored = Number.isFinite(place.score);
  return (
    <header className="pagehead pagehead--site">
      <div className="pagehead__title">
        <div className="eyebrow-13">Mare/ {String(idx + 1).padStart(2, "0")} · {place.short}</div>
        <h1 className="h-page">{place.name}</h1>
        <div className="coords">{place.coords}</div>
      </div>
      {/* La nota del sitio, siempre a la vista (mismo estilo que la tarjeta "Best" de Explore). */}
      <div className="best__score site-score" aria-label={scored ? `Score ${Math.round(place.score)} out of 100` : "Not scored"}>
        <span>{scored ? Math.round(place.score) : "–"}</span>
        <span className="muted-11">
          {scored ? `/100 · ${presetOf(weights) || "Custom"}` : place.excluded ? "Left out by your limits" : result ? "Not scored" : "Scoring…"}
        </span>
        {scored && rankInfo ? <span className="pill-sm">#{rankInfo.rank} of {rankInfo.total}</span> : null}
      </div>
      <div className="grow" />
      <div className="pagehead__chips">
        <ProfileChip weights={weights} onClick={openWeights} />
        <MissionChip mission={mission} onClick={openSettings} />
      </div>
      <div className="pagehead__row">
        <Tabs
          label="Site sections"
          value={tab}
          // Astronaut Mode ocupa toda la pantalla: se abre encima, sin cambiar de pestaña.
          onChange={(value) => (value === "astronaut" ? onAstronaut() : setTab(value))}
          options={[
            { value: "overview", label: "Overview" },
            { value: "sky", label: "Sky & Time" },
            ...(app.moon ? [{ value: "astronaut", label: "Astronaut Mode" }] : [{ value: "terrain", label: "Terrain" }, { value: "lander", label: "Lander's View" }, { value: "astronaut", label: "Astronaut Mode" }]),
          ]}
        />
        <div className="grow" />
        <Btn icon={inCmp(place) ? "check" : "plus"} aria-pressed={inCmp(place)} onClick={() => toggleCmp(place)}>Compare</Btn>
      </div>
    </header>
  );
}

/* --------------------------------------------------------------- Overview */

function Overview({ app, place }) {
  const { tl, lw, result, mission, data, rankInfo, validation, curWin } = app;
  const p = place.p;
  const D = lw?.D ?? mission.durationDays * 24;
  // La tarjeta muestra la MEJOR ventana del sitio (la misma que da su nota).
  const startMs = tl && curWin ? tl.startMs + curWin.start * H : null;
  const endMs = startMs != null ? startMs + D * H : null;
  const landRun = curWin ? [curWin.a, curWin.b] : null;

  const dark = useMemo(() => {
    if (!tl) return null;
    const nights = runs(tl.sun, 0), outs = runs(tl.earth, 0);
    const long = (rr) => rr.reduce((m, [a, b]) => Math.max(m, b - a), 0);
    return {
      night: long(nights), outage: long(outs),
      nights2: nights.filter(([a, b]) => b - a > 48).length,
      outs5: outs.filter(([a, b]) => b - a > 120).length,
    };
  }, [tl]);

  const horMax = tl ? Math.max(...tl.ctx.hor) : NaN;

  // Pros y contras: los factores con datos, de mayor a menor.
  const scored = FACTORS.filter((f) => Number.isFinite(place.factors?.[f.key])).sort((a, b) => place.factors[b.key] - place.factors[a.key]);
  const pros = scored.slice(0, 3).filter((f) => place.factors[f.key] >= 50);
  const cons = scored.slice(-3).reverse().filter((f) => place.factors[f.key] < 60);
  const proText = { sun: "Long daylight", earth: "Earth often in view", slope: "Gentle slope", rough: "Smooth ground", temp: "Milder temperatures", ice: "Close to stable ice",
    ...(app.moon ? { temp: "Workable temperatures", ice: "Water signal" } : {}) };
  const conText = { sun: "Little sunlight", earth: "Earth low or hidden", slope: "Steep ground", rough: "Rough ground", temp: "Very cold", ice: "Far from stable ice",
    ...(app.moon ? { temp: "Extreme temperatures", ice: "No water signal" } : {}) };

  // Escala de la mini-barra: cubre todo el tramo "Land between" y la misión, con margen;
  // las posiciones se recortan a 0–100 % para que nada se salga de la tarjeta.
  const track = startMs != null ? (() => {
    const landA = tl.startMs + landRun[0] * H, landB = tl.startMs + landRun[1] * H;
    const a = Math.min(landA, startMs) - 3 * 86400e3, b = Math.max(landB, endMs) + 3 * 86400e3;
    const pc = (ms) => `${(Math.max(0, Math.min(1, (ms - a) / (b - a))) * 100).toFixed(2)}%`;
    return { a, b, pc, landA, landB };
  })() : null;

  return (
    <div className="grid-rows">
      <div className="flexrow">
        <Card className="f2">
          <CardHead title="Best landing window"><Fidelity level={result ? "computed" : "processing"} /></CardHead>
          {startMs == null ? (
            <p className="muted-12">{result ? "No complete mission fits in this period." : "Scoring the mission…"}</p>
          ) : (
            <div className="stack-20">
              <div className="lw">
                <div className="lw__date"><span className="lbl">Start</span><b>{fmtShort(startMs)}</b></div>
                <span className="lw__arrow">→</span>
                <div className="lw__date"><span className="lbl">End</span><b>{fmtShort(endMs)}</b></div>
                <div className="grow" />
                <span className={cx("vtag", "vtag--sun", curWin.sun < 0.5 && "is-low")}><Icon name="sun" size={14} />Sun {Math.round(curWin.sun * 100)}%</span>
                <span className={cx("vtag", "vtag--earth", curWin.earth < 0.5 && "is-low")}><Icon name="earth" size={14} />Earth {Math.round(curWin.earth * 100)}%</span>
              </div>
              <div className="grid4">
                <Stat label="Start · UTC" value={fmtIso(startMs)} />
                <Stat label="End · UTC" value={fmtIso(endMs)} />
                <Stat label="Land between" value={landRun ? (() => {
                  const a = fmtShort(tl.startMs + landRun[0] * H), b = fmtShort(tl.startMs + (landRun[1] - 1) * H);
                  return a.split(" ")[0] === b.split(" ")[0] ? `${a} – ${b.split(" ")[1]}` : `${a} – ${b}`;
                })() : "–"} />
                <Stat label="Precision" value="± 1" unit="h" />
              </div>
              <div className="lwtrack">
                <div className="lwtrack__labels">
                  {[startMs, endMs].map((t) => <span key={t} style={{ left: track.pc(t) }}>{fmtShort(t)}</span>)}
                </div>
                <div className="lwtrack__bar" title="Shaded: landing any time in this span gives at least 95% of the best mission · Outlined: the best mission">
                  <span className="lwtrack__land" style={{ left: track.pc(track.landA), width: `calc(${track.pc(track.landB)} - ${track.pc(track.landA)})` }} />
                  <span className="lwtrack__mission" style={{ left: track.pc(startMs), width: `max(4px, calc(${track.pc(endMs)} - ${track.pc(startMs)}))` }} />
                </div>
              </div>
              <div className="row-16 wrap">
                <div className="row-8"><span className="lbl">Length</span><span className="num-15">{formatDuration(D)}</span></div>
              </div>
            </div>
          )}
        </Card>
        <Card className="f1">
          <CardHead title="Sky at landing">
            {startMs != null && <span className="muted-12">{fmtShort(startMs)} · {fmtHM(startMs)} UTC</span>}
          </CardHead>
          {tl && curWin ? (
            <div className="nowlist">
              {[["sun", "Sun", tl.sun, tl.sunAz, tl.sunEl], ["earth", "Earth", tl.earth, tl.earthAz, tl.earthEl]].map(([k, name, vis, az, el]) => (
                <div key={k} className="nowrow">
                  <span className="nowrow__icon" style={{ color: `var(--${k})` }}><Icon name={k} size={18} /></span>
                  <span className="nowrow__text"><b>{name}</b><span className="muted-12">az {az[curWin.start].toFixed(1)}° · el {el[curWin.start].toFixed(1)}°</span></span>
                  <UpTag up={!!vis[curWin.start]} />
                </div>
              ))}
            </div>
          ) : <p className="muted-12">{tl ? "No landing time in this period." : "Needs the horizons and ephemeris files."}</p>}
        </Card>
      </div>

      <div className="flexrow">
        <Card className="f2">
          <CardHead title="Properties"><Fidelity level="computed" /></CardHead>
          <PropGrid values={place.factors} labels={app.moon ? MOON_FACTOR_LABELS : null} />
        </Card>
        <Card className="f1 f1--320">
          <CardHead title="Dark & outages" />
          {dark ? (
            <>
              <div className="grid2 mt-12">
                <Stat icon="moon" label="Longest night" value={formatDuration(dark.night)} />
                <Stat icon="wifi-off" label="Longest outage" value={formatDuration(dark.outage)} />
              </div>
              <div className="grid2 mt-12">
                <Stat label="Nights > 2 d" value={dark.nights2} />
                <Stat label="Outages > 5 d" value={dark.outs5} />
              </div>
              <p className="muted-11 mt-12">Over the whole period · Sun: {mission.sunMode === "any" ? "any part" : mission.sunMode} · Earth: {mission.earthMode}</p>
            </>
          ) : <p className="muted-12">–</p>}
        </Card>
      </div>

      <div className="flexrow">
        <Card className="f2">
          <CardHead title="Good days"><span className="muted-12">Hours per day with Sun and, where it changes, with Earth and with both</span></CardHead>
          {tl ? <GoodDays tl={tl} missionWin={startMs != null ? [startMs, endMs] : null} kinds={GOOD_DAY_KINDS} /> : <p className="muted-12">–</p>}
        </Card>
        <Card className="f1">
          <CardHead title="Ground data"><span className="muted-12">{app.moon ? `${app.gdata.manifest.grid.stepDeg}° cell` : "1 km cell"}</span></CardHead>
          {app.moon ? <GlobalGround app={app} pixel={p} /> : <GroundReadout data={data} pixel={p} />}
          <div className="grid2 mt-12">
            <Stat label="Horizon max" value={Number.isFinite(horMax) ? horMax.toFixed(1) : "–"} unit="°" />
            <Stat label="Observer" value={mission.observerM} unit="m" />
          </div>
          {app.moon ? null : <Btn className="mt-16" icon="navigation" onClick={() => app.setTab("lander")}>Lander's View</Btn>}
        </Card>
      </div>

      <div className="flexrow">
        <Card className="f1 f1--320">
          <CardHead title="At a glance">{rankInfo ? <span className="pill-sm">#{rankInfo.rank} of {rankInfo.total}</span> : null}</CardHead>
          <div className="grid2 mt-12">
            <div className="stack-6">
              <span className="lbl">Pros</span>
              {pros.length ? pros.map((f) => <span key={f.key} className="glance glance--pro"><Icon name="check" size={14} />{proText[f.key]}</span>) : <span className="muted-12">–</span>}
            </div>
            <div className="stack-6">
              <span className="lbl">Cons</span>
              {cons.length ? cons.map((f) => <span key={f.key} className="glance glance--con"><Icon name="x" size={14} />{conText[f.key]}</span>) : <span className="muted-12">–</span>}
            </div>
          </div>
          {place.excluded ? <p className="note-12 mt-12"><Icon name="info" size={12} />Left out by your limits: {place.excluded}</p> : null}
          {place.note ? <p className="muted-12 mt-12">{place.note}</p> : null}
        </Card>
        <Card className="f1 f1--280">
          <CardHead title="Data" />
          <div className="datalist mt-12">
            <div><span className="lbl">SPICE</span><span>DE440 · MOON_ME</span></div>
            <div><span className="lbl">LOLA</span><span>{app.moon ? "LDEM_64 · LDRM_16 · LPSR 65N/65S" : `LDEM_${app.pole === "north" ? "75N" : "75S"}_240M · LDSM · LPSR`}</span></div>
            <div><span className="lbl">Horizons</span><span>{app.moon ? "72 bins · 500 m – 300 km · cell centre" : "72 bins · 300 m – 300 km"}</span></div>
            {app.moon ? <div><span className="lbl">Diviner</span><span>Global temperatures by local time</span></div> : null}
            <div><span className="lbl">Cross-check</span><span>{validation}</span></div>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Sky & Time */

function SkyTime({ app }) {
  const { tl, lw, timeMs, mission } = app;
  const now = tl ? hourIndex(tl, timeMs) : 0;
  const info = useMemo(() => {
    if (!tl) return null;
    const at = (k) => (k < 0 ? null : tl.startMs + k * H);
    const sunUp = !!tl.sun[now];
    const sunChange = nextChange(tl.sun, now);
    // Siguiente noche: el próximo tramo sin Sol (si ya es de noche, el actual).
    let nightStart = sunUp ? sunChange : now;
    let nightEnd = nightStart >= 0 ? nextChange(tl.sun, nightStart) : -1;
    const earthUp = !!tl.earth[now];
    const earthChange = nextChange(tl.earth, now);
    // La mejor ventana del sitio (la misma que la tarjeta del Overview).
    const win = lw && lw.best >= 0 ? lw.best : -1;
    // Eventos de las próximas semanas.
    const ev = [];
    for (let t = now + 1; t < tl.n && ev.length < 6; t++) {
      if (tl.sun[t] !== tl.sun[t - 1]) ev.push({ t, icon: tl.sun[t] ? "sunrise" : "sunset", name: tl.sun[t] ? "Sunrise" : "Sunset", color: "var(--sun)" });
      if (tl.earth[t] !== tl.earth[t - 1]) ev.push({ t, icon: "earth", name: tl.earth[t] ? "Earth rises" : "Earth sets", color: "var(--earth)" });
      if (t === win) ev.push({ t, icon: "calendar", name: "Best landing", color: "var(--both)" });
    }
    return { at, sunUp, sunChange, nightStart, nightEnd, earthUp, earthChange, win, ev };
  }, [tl, lw, now]);

  if (!tl || !info) return <Card><p className="muted-12">Sky and time need the horizons and ephemeris files.</p></Card>;

  // Próximas 2 semanas.
  const a = now, b = Math.min(tl.n, now + 14 * 24);
  const pc = (t) => `${(((t - a) / (b - a)) * 100).toFixed(2)}%`;
  const lane = (arr, v = 1) => runs(arr, v, a, b);
  // Carril "Mission": la misión de la mejor ventana, recortada a estas 2 semanas.
  const winRuns = lw && lw.best >= 0 ? [[Math.max(a, lw.best), Math.min(b, lw.best + lw.D)]].filter(([x, y]) => y > x) : [];
  const dayTicks = [];
  for (let t = a; t <= b; t += 48) dayTicks.push(t);

  return (
    <div className="grid-rows">
      <div className="flexrow">
        <Card className="f1 f1--220">
          <span className="lbl"><Icon name="sun" size={12} style={{ color: "var(--sun)" }} />Sunlight</span>
          <div className="big-28">{info.sunUp ? "Now" : "Dark"}</div>
          <span className="muted-12">{info.sunChange > 0 ? `${formatDuration(info.sunChange - now)} ${info.sunUp ? "left" : "to sunrise"}` : "No change in the period"}</span>
        </Card>
        <Card className="f1 f1--220">
          <span className="lbl"><Icon name="moon" size={12} />Next night</span>
          <div className="big-28">{info.nightStart >= 0 ? fmtShort(info.at(info.nightStart)) : "None"}</div>
          <span className="muted-12">{info.nightStart >= 0 ? `${fmtHM(info.at(info.nightStart))} · ${info.nightEnd > 0 ? formatDuration(info.nightEnd - info.nightStart) : "until the end"}` : "Sun stays up"}</span>
        </Card>
        <Card className="f1 f1--220">
          <span className="lbl"><Icon name="earth" size={12} style={{ color: "var(--earth)" }} />{info.earthUp ? "Earth sets" : "Earth back"}</span>
          <div className="big-28">{info.earthChange > 0 ? fmtShort(info.at(info.earthChange)) : info.earthUp ? "Stays up" : "Not in period"}</div>
          <span className="muted-12">{info.earthChange > 0 ? fmtHM(info.at(info.earthChange)) : "–"}</span>
        </Card>
        <Card className="f1 f1--220">
          <span className="lbl"><Icon name="calendar" size={12} />Best landing</span>
          <div className="big-28">{info.win >= 0 ? fmtShort(info.at(info.win)) : "None"}</div>
          <span className="muted-12">
            {info.win < 0 ? "No complete mission fits" : info.win > now ? `in ${formatDuration(info.win - now)} · ${mission.durationDays} d mission` : info.win + (lw?.D || 0) > now ? "Mission under way at this time" : "Already passed in this period"}
          </span>
        </Card>
      </div>

      <Card>
        <CardHead title="Next 2 weeks" size="sm" />
        <div className="lanes2w">
          {[["Sun", lane(tl.sun), "var(--sun)"], ["Night", lane(tl.sun, 0), "var(--line-strong)"], ["Earth", lane(tl.earth), "var(--earth)"], ["Mission", winRuns, "var(--both)"]].map(([name, rr, col]) => (
            <div key={name} className="lane">
              <div className="lane__name"><span>{name}</span></div>
              <div className="lane__track">
                {rr.length ? rr.map(([x, y]) => <span key={x} style={{ left: pc(x), width: `calc(${pc(y)} - ${pc(x)})`, background: col }} />) : <em className="lane__none">None</em>}
              </div>
            </div>
          ))}
          <div className="lane lane--axis">
            <div className="lane__name" />
            <div className="lane__track lane__track--axis">
              {dayTicks.map((t) => <span key={t} style={{ left: pc(t) }}>{fmtShort(tl.startMs + t * H)}</span>)}
            </div>
          </div>
        </div>
      </Card>

      <div className="flexrow">
        <Card className="f1">
          <CardHead title="Where to look" size="sm" />
          <div className="grid2 mt-12">
            {[["sun", "Sun", tl.sunAz, tl.sunEl], ["earth", "Earth", tl.earthAz, tl.earthEl]].map(([k, name, az, el]) => (
              <div key={k} className="look">
                <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
                  <circle cx="32" cy="32" r="28" fill="none" stroke="var(--line)" />
                  <text x="32" y="10" textAnchor="middle" fontSize="8" fill="var(--ink-tertiary)">N</text>
                  <line x1="32" y1="32" x2={32 + 24 * Math.sin((az[now] * Math.PI) / 180)} y2={32 - 24 * Math.cos((az[now] * Math.PI) / 180)} stroke={`var(--${k})`} strokeWidth="2" strokeLinecap="round" />
                </svg>
                <div className="stack-4">
                  <b className="num-15">{name}</b>
                  <span className="num-13">{compass(az[now])}</span>
                  <span className="muted-12">{Math.round(el[now] * 10) / 10}° up</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card className="f1">
          <CardHead title="Events" size="sm" />
          <div className="events">
            {info.ev.length ? info.ev.map((e) => (
              <div key={`${e.t}-${e.name}`} className="event">
                <Icon name={e.icon} size={16} style={{ color: e.color }} />
                <span className="event__name">{e.name}</span>
                <span className="num-13">{fmtShort(info.at(e.t))} · {fmtHM(info.at(e.t))}</span>
              </div>
            )) : <p className="muted-12">No changes in the rest of the period.</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Terrain */

const TERRAIN_LAYERS = ["photo", "sun", "earth", "elevation", "slope", "rough", "temp", "shadow"];

function GroundReadout({ data, pixel }) {
  const { grid } = data.manifest;
  const [x, y] = pixelXY(grid, Math.floor(pixel / grid.n), pixel % grid.n);
  // Las detecciones de M³ que tenemos son las del polo sur (plano de su proyección):
  // en el norte ese dato no se muestra.
  const withDetections = grid.pole !== "north";
  let nearestSquared = Infinity;
  if (withDetections) {
    for (const [iceX, iceY] of iceDetections.points) {
      nearestSquared = Math.min(nearestSquared, (x - iceX) ** 2 + (y - iceY) ** 2);
    }
  }
  return (
    <div className="ground-groups mt-12">
      {GROUND_GROUPS.map((group) => (
        <section className="ground-group" key={group.label}>
          <h3 className="lbl">{group.label}</h3>
          <dl className="ground-values">
            {group.fields.filter(({ key }) => withDetections || key !== "nearestIce").map(({ key, label, format }) => {
              const value = key === "nearestIce" ? Math.sqrt(nearestSquared) / 1000 : data.layers[key]?.[pixel];
              return (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>{Number.isFinite(value) ? format(value) : "No data"}</dd>
                </div>
              );
            })}
          </dl>
        </section>
      ))}
    </div>
  );
}

function Terrain({ app, place }) {
  const [hoveredPixel, setHoveredPixel] = useState(null);
  const { data, terrainLayer, setTerrainLayer, valuesFor, sitesForMap, spotsForMap, legendFor, showIceEvidence, setShowIceEvidence, go, pole, refLabels, mapLayers } = app;
  const key = terrainLayer;
  const layer = mapLayers[key];
  const values = valuesFor(key);
  const ends = legendFor(key, values);
  // El Mare analiza el punto elegido: el mapa se centra en él, solo muestra su
  // marcador y un clic no cambia de punto (eso se hace en Explore).
  const focusSites = place.type === "site" ? sitesForMap.filter((s) => s.key === place.key) : [];
  const focusSpots = place.type === "spot" ? spotsForMap.filter((s) => s.key === place.key) : [];
  return (
    <div className="explore">
      <section aria-label={`Terrain around ${place.name}`} className="mapsec" data-theme="dark">
        <MapView data={data} layer={layer} values={values} sites={focusSites} spots={focusSpots} selected={place}
          showIceEvidence={showIceEvidence} hoverPixel={hoveredPixel} onHover={setHoveredPixel} refLabels={refLabels}>
          <div className="overlay mapnote">
            <Icon name="map-pin" size={14} />
            <span>Terrain around {place.short}. Hover to read any cell.</span>
            <button type="button" className="linkbtn linkbtn--12" onClick={() => go("explore")}>Change site in Explore<Icon name="chevron-right" size={12} /></button>
          </div>
        </MapView>
        <MapControls activeLayer={key} onLayer={setTerrainLayer} layerKeys={TERRAIN_LAYERS} legendEnds={ends} layers={mapLayers} pole={pole} refLabels={refLabels}
          showIceEvidence={showIceEvidence} onIceEvidence={setShowIceEvidence}>
          <MapPointReadout data={data} layer={layer} values={values} hoveredPixel={hoveredPixel} selected={place}
            datesFor={app.datesFor} fixedDates={app.fixedDates}
            onEnter={() => setHoveredPixel(null)} />
        </MapControls>
      </section>
      <aside className="rank">
        <Card pad="md2">
          <CardHead title="Ground data" size="sm"><span className="muted-12">1 km cell</span></CardHead>
          <GroundReadout data={data} pixel={place.p} />
        </Card>
        <Card pad="md2">
          <CardHead title="Precision" size="sm" />
          <div className="datalist mt-12">
            <div><span className="lbl">Terrain</span><span>LOLA 240 m, 1 km grid</span></div>
            <div><span className="lbl">Temperature, ice</span><span>LRO Diviner model, ~0.5 km, may sit a few 100 m off LOLA</span></div>
            <div><span className="lbl">Horizons</span><span>5° bins, 300 m – 300 km</span></div>
            <div><span className="lbl">Near field</span><span>Rocks and craters under 1 km are not resolved</span></div>
          </div>
        </Card>
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ página */

export default function Site({ app }) {
  const [astronaut, setAstronaut] = useState(false);
  const { selected, Rail, TimeBarEl, siteList, moonMission, result, sitesForMap, spotsForMap, timeMs, setTimeMs, go } = app;
  const data = app.moon ? app.gdata : app.data;
  const tab = siteTab(app);
  const place = selected;
  if (!place || !data) {
    return (
      <div className="shell">
        {Rail}
        <main className="shell__main">
          <header className="pagehead"><h1 className="h-page">Mare/</h1></header>
          <Card className="emptycard">
            <Icon name="map-pin" size={20} />
            <h2 className="h-md">No site selected</h2>
            <p className="muted-12">{app.moon ? "Click a cell on the whole-Moon map, then Open site." : "Pick a site in the ranking or click anywhere on the map."}</p>
            <Btn variant="primary" iconRight="arrow-right" onClick={() => go("explore")}>Explore</Btn>
          </Card>
        </main>
      </div>
    );
  }
  const idx = Math.max(0, siteList.findIndex((p) => p.key === place.key));
  return (
    <div className="shell">
      {Rail}
      <main className="shell__main">
        <Header app={app} place={place} idx={idx} onAstronaut={() => setAstronaut(true)} />
        {tab === "overview" ? <Overview app={app} place={place} /> : null}
        {tab === "sky" ? <SkyTime app={app} /> : null}
        {tab === "terrain" ? <Terrain app={app} place={place} /> : null}
        {tab === "lander" && !astronaut ? (
          <section aria-label="Lander's view" className="mapsec mapsec--tall">
            <Suspense fallback={<div className="mapsec__center"><div className="state"><Icon name="loader" size={16} className="spin" /><span className="state__title">Loading the 3D view</span></div></div>}>
              <Moon3D key={app.pole} data={data} mission={moonMission} result={result} selected={place} timeMs={timeMs} onTimeChange={setTimeMs}
                sites={sitesForMap.filter((s) => s.key === place.key)} spots={spotsForMap.filter((s) => s.key === place.key)}
                toolbarActions={<IconBtn icon="astronaut-helmet" label="Astronaut Mode" variant="raised" size={36} iconSize={20} onClick={() => setAstronaut(true)} />} />
            </Suspense>
          </section>
        ) : null}
        {(tab === "sky" || tab === "lander") && !astronaut && TimeBarEl}
      </main>
      {astronaut ? <Suspense fallback={<div role="status" className="ovl ovl--center"><span className="state__title">Loading Astronaut Mode…</span></div>}><AstronautMode app={app} onClose={() => setAstronaut(false)} /></Suspense> : null}
    </div>
  );
}

