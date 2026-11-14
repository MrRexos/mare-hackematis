// 03 Site: ficha de un lugar con pestañas Overview, Sky & Time, Terrain y Lander's View.

import { Suspense, lazy, useMemo, useState } from "react";
import MapView from "../components/MapView.jsx";
import { Icon, Btn, Card, CardHead, Tabs, Fidelity, Shape, IconBtn, cx } from "../ui/kit.jsx";
import { MissionChip, ProfileChip, fmtShort, fmtHM, fmtIso } from "../ui/Shell.jsx";
import { FACTORS } from "../engine/score.js";
import { compass, goodHoursPerDay, hourIndex, nextChange, runs } from "../engine/timeline.js";
import { formatDuration } from "../engine/geometry.js";
import { Legend } from "./Explore.jsx";

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

/** Rejilla de propiedades: nombre, valor y barra (Overview y Compare). */
export function PropGrid({ values }) {
  return (
    <div className="props">
      {FACTORS.map((f) => {
        const v = values?.[f.key];
        const ok = Number.isFinite(v);
        return (
          <div key={f.key} className={cx("props__item", !ok && "is-off")} title={ok ? f.hint : `${f.label}: no data yet`}>
            <div className="row-8">
              <Icon name={f.icon} size={14} style={{ color: ok ? f.color : undefined }} />
              <span className="props__name">{f.label}</span>
              <span className="props__v">{ok ? Math.round(v) : "–"}</span>
            </div>
            <div className="bar">{ok ? <div className="bar__fill" style={{ width: `${v}%`, background: f.color }} /> : null}</div>
          </div>
        );
      })}
    </div>
  );
}

/** Tira de "días buenos": horas al día con Sol y Tierra a la vez. */
export function GoodDays({ tl, missionWin, compact }) {
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

function Header({ app, place, idx, total }) {
  const { tab, setTab, mission, weights, openSettings, go, inCmp, toggleCmp, stepSite } = app;
  return (
    <header className="pagehead pagehead--site">
      <div className="pagehead__title">
        <div className="eyebrow-13">Mare/ {place.type === "pick" ? place.short : `${String(idx + 1).padStart(2, "0")} · ${place.short}`}</div>
        <h1 className="h-page">{place.name}</h1>
        <div className="coords">{place.coords}</div>
      </div>
      <div className="grow" />
      <div className="pagehead__chips">
        <ProfileChip weights={weights} onClick={() => go("priorities")} />
        <MissionChip mission={mission} onClick={openSettings} />
      </div>
      <div className="pagehead__row">
        <Tabs
          label="Site sections"
          value={tab}
          onChange={setTab}
          options={[
            { value: "overview", label: "Overview" },
            { value: "sky", label: "Sky & Time" },
            { value: "terrain", label: "Terrain" },
            { value: "lander", label: "Lander's View" },
          ]}
        />
        <div className="grow" />
        {place.type !== "pick" ? <div className="pager">
          <IconBtn icon="chevron-left" label="Previous site" variant="raised" size={40} onClick={() => stepSite(-1)} disabled={total < 2} />
          <span className="num-13">{String(idx + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}</span>
          <IconBtn icon="chevron-right" label="Next site" variant="raised" size={40} onClick={() => stepSite(1)} disabled={total < 2} />
        </div> : null}
        <Btn icon={inCmp(place) ? "check" : "plus"} aria-pressed={inCmp(place)} onClick={() => toggleCmp(place)}>Compare</Btn>
      </div>
    </header>
  );
}

/* --------------------------------------------------------------- Overview */

function Overview({ app, place }) {
  const { tl, lw, result, mission, timeMs, setTimeMs, data, useDates, rankInfo, validation } = app;
  const layers = data.layers;
  const p = place.p;
  const D = lw?.D ?? mission.durationDays * 24;
  const startMs = tl && lw && lw.best >= 0 ? tl.startMs + lw.best * H : null;
  const endMs = startMs != null ? startMs + D * H : null;
  const landRun = tl && lw ? lw.windows.find(([a, b]) => lw.best >= a && lw.best < b) : null;
  const nextWin = () => {
    if (!tl || !lw) return;
    const w = lw.windows.find(([a]) => tl.startMs + a * H > timeMs + H) || lw.windows[0];
    if (w) setTimeMs(tl.startMs + w[0] * H);
  };

  const now = tl ? hourIndex(tl, timeMs) : 0;
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

  const slope = layers.slope?.[p];
  const elev = layers.elevation?.[p];
  const horMax = tl ? Math.max(...tl.ctx.hor) : NaN;

  // Pros y contras: los factores con datos, de mayor a menor.
  const scored = FACTORS.filter((f) => Number.isFinite(place.factors?.[f.key])).sort((a, b) => place.factors[b.key] - place.factors[a.key]);
  const pros = scored.slice(0, 3).filter((f) => place.factors[f.key] >= 50);
  const cons = scored.slice(-3).reverse().filter((f) => place.factors[f.key] < 60);
  const proText = { sun: "Long daylight", earth: "Earth often in view", slope: "Gentle slope", relief: "Smooth ground", ice: "Close to cold traps" };
  const conText = { sun: "Little sunlight", earth: "Earth low or hidden", slope: "Steep ground", relief: "Rough ground", ice: "Far from cold traps" };

  const track = startMs != null ? (() => {
    const a = startMs - 9 * 86400e3, b = endMs + 9 * 86400e3;
    const pc = (ms) => `${(((ms - a) / (b - a)) * 100).toFixed(2)}%`;
    return { a, b, pc };
  })() : null;

  return (
    <div className="grid-rows">
      <div className="flexrow">
        <Card className="f2">
          <CardHead title="Landing window"><Fidelity level={result ? "computed" : "processing"} /></CardHead>
          {startMs == null ? (
            <p className="muted-12">{result ? "No complete mission fits in this period." : "Scoring the mission…"}</p>
          ) : (
            <div className="stack-20">
              <div className="lw">
                <div className="lw__date"><span className="lbl">Start</span><b>{fmtShort(startMs)}</b></div>
                <span className="lw__arrow">→</span>
                <div className="lw__date"><span className="lbl">End</span><b>{fmtShort(endMs)}</b></div>
                <div className="grow" />
                <span className={cx("vtag", "vtag--sun", lw.sun < 0.5 && "is-low")}><Icon name="sun" size={14} />Sun {Math.round(lw.sun * 100)}%</span>
                <span className={cx("vtag", "vtag--earth", lw.earth < 0.5 && "is-low")}><Icon name="earth" size={14} />Earth {Math.round(lw.earth * 100)}%</span>
              </div>
              <div className="grid4">
                <Stat label="Start · UTC" value={fmtIso(startMs)} />
                <Stat label="End · UTC" value={fmtIso(endMs)} />
                <Stat label="Land between" value={landRun ? `${fmtShort(tl.startMs + landRun[0] * H)} – ${fmtShort(tl.startMs + (landRun[1] - 1) * H).replace(/^\w+ /, "")}` : "–"} />
                <Stat label="Precision" value="± 1" unit="h" />
              </div>
              <div className="lwtrack">
                <div className="lwtrack__labels">
                  {[track.a, startMs, endMs, track.b].map((t) => <span key={t} style={{ left: track.pc(t) }}>{fmtShort(t)}</span>)}
                </div>
                <div className="lwtrack__bar">
                  {landRun ? <span className="lwtrack__land" style={{ left: track.pc(tl.startMs + landRun[0] * H), width: `calc(${track.pc(tl.startMs + landRun[1] * H)} - ${track.pc(tl.startMs + landRun[0] * H)})` }} /> : null}
                  <span className="lwtrack__mission" style={{ left: track.pc(startMs), width: `calc(${track.pc(endMs)} - ${track.pc(startMs)})` }} />
                </div>
              </div>
              <div className="row-16 wrap">
                <div className="row-8"><span className="lbl">Length</span><span className="num-15">{formatDuration(D)}</span></div>
                <div className="grow" />
                <Btn icon="skip-forward" onClick={nextWin}>Next window</Btn>
                <Btn variant="primary" icon="check" onClick={() => useDates(startMs, endMs)}>Use these dates</Btn>
              </div>
            </div>
          )}
        </Card>
        <Card className="f1">
          <CardHead title="Now"><span className="muted-12">{fmtShort(timeMs)} · {fmtHM(timeMs)}</span></CardHead>
          {tl ? (
            <div className="nowlist">
              {[["sun", "Sun", tl.sun, tl.sunAz, tl.sunEl], ["earth", "Earth", tl.earth, tl.earthAz, tl.earthEl]].map(([k, name, vis, az, el]) => (
                <div key={k} className="nowrow">
                  <span className="nowrow__icon" style={{ color: `var(--${k})` }}><Icon name={k} size={18} /></span>
                  <span className="nowrow__text"><b>{name}</b><span className="muted-12">az {az[now].toFixed(1)}° · el {el[now].toFixed(1)}°</span></span>
                  <UpTag up={!!vis[now]} />
                </div>
              ))}
            </div>
          ) : <p className="muted-12">Needs the horizons and ephemeris files.</p>}
        </Card>
      </div>

      <div className="flexrow">
        <Card className="f2">
          <CardHead title="Properties"><Fidelity level="computed" /></CardHead>
          <PropGrid values={place.factors} />
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
          <CardHead title="Good days"><span className="muted-12">Hours per day with Sun and Earth</span></CardHead>
          {tl ? <GoodDays tl={tl} missionWin={startMs != null ? [startMs, endMs] : null} /> : <p className="muted-12">–</p>}
        </Card>
        <Card className="f1">
          <CardHead title="Terrain"><span className="pill-sm">LOLA 240 m</span></CardHead>
          <div className="grid2 mt-12">
            <Stat label="Slope" value={Number.isFinite(slope) ? slope.toFixed(1) : "–"} unit="°" />
            <Stat label="Elevation" value={Number.isFinite(elev) ? `${elev >= 0 ? "+" : ""}${(elev / 1000).toFixed(1)}` : "–"} unit="km" />
            <Stat label="Horizon max" value={Number.isFinite(horMax) ? horMax.toFixed(1) : "–"} unit="°" />
            <Stat label="Observer" value={mission.observerM} unit="m" />
          </div>
          <Btn className="mt-16" icon="navigation" onClick={() => app.setTab("lander")}>Lander's View</Btn>
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
            <div><span className="lbl">LOLA</span><span>LDEM_75S_240M · LDSM · LPSR</span></div>
            <div><span className="lbl">Horizons</span><span>72 bins · 300 m – 300 km</span></div>
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
    const win = lw ? lw.windows.find(([a]) => a > now) : null;
    // Eventos de las próximas semanas.
    const ev = [];
    for (let t = now + 1; t < tl.n && ev.length < 6; t++) {
      if (tl.sun[t] !== tl.sun[t - 1]) ev.push({ t, icon: tl.sun[t] ? "sunrise" : "sunset", name: tl.sun[t] ? "Sunrise" : "Sunset", color: "var(--sun)" });
      if (tl.earth[t] !== tl.earth[t - 1]) ev.push({ t, icon: "earth", name: tl.earth[t] ? "Earth rises" : "Earth sets", color: "var(--earth)" });
      if (lw && lw.windows.some(([a]) => a === t)) ev.push({ t, icon: "calendar", name: "Window opens", color: "var(--both)" });
    }
    return { at, sunUp, sunChange, nightStart, nightEnd, earthUp, earthChange, win, ev };
  }, [tl, lw, now]);

  if (!tl || !info) return <Card><p className="muted-12">Sky and time need the horizons and ephemeris files.</p></Card>;

  // Próximas 2 semanas.
  const a = now, b = Math.min(tl.n, now + 14 * 24);
  const pc = (t) => `${(((t - a) / (b - a)) * 100).toFixed(2)}%`;
  const lane = (arr, v = 1) => runs(arr, v, a, b);
  const winRuns = lw ? lw.windows.map(([x, y]) => [Math.max(a, x), Math.min(b, y)]).filter(([x, y]) => y > x) : [];
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
          <span className="lbl"><Icon name="calendar" size={12} />Next window</span>
          <div className="big-28">{info.win ? fmtShort(info.at(info.win[0])) : "None"}</div>
          <span className="muted-12">{info.win ? `${mission.durationDays} d mission` : "No better start later in the period"}</span>
        </Card>
      </div>

      <Card>
        <CardHead title="Next 2 weeks" size="sm" />
        <div className="lanes2w">
          {[["Sun", lane(tl.sun), "var(--sun)"], ["Night", lane(tl.sun, 0), "var(--line-strong)"], ["Earth", lane(tl.earth), "var(--earth)"], ["Window", winRuns, "var(--both)"]].map(([name, rr, col]) => (
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

const TERRAIN_LAYERS = [
  { value: "sun", label: "Sunlight" },
  { value: "earth", label: "Earth view" },
  { value: "ice", label: "Water ice" },
  { value: "slope", label: "Slope" },
  { value: "temp", label: "Temperature", disabled: true, title: "No temperature data yet" },
  { value: "relief", label: "Terrain" },
];

function Terrain({ app, place }) {
  const { data, terrainLayer, setTerrainLayer, LAYERS, valuesFor, sitesForMap, spotsForMap, setSelRef, legendFor, result } = app;
  const key = terrainLayer;
  const mapKey = key === "ice" ? "shadow" : key;
  const layer = LAYERS[mapKey];
  const values = valuesFor(mapKey);
  const ends = legendFor(mapKey, values);
  const p = place.p;
  const l = data.layers;
  const rows = [
    ["sun", "Sunlight", result ? `${Math.round(result.sun[p] * 100)}%` : `${Math.round((l.avgSun?.[p] || 0) * 100)}%`, result ? "of the mission" : "18.6-year average"],
    ["earth", "Earth view", result ? `${Math.round(result.earth[p] * 100)}%` : "–", "of the mission"],
    ["ice", "Water ice", Number.isFinite(l.psrDistKm?.[p]) ? `${l.psrDistKm[p].toFixed(1)} km` : "–", "to permanent shadow"],
    ["slope", "Slope", Number.isFinite(l.slope?.[p]) ? `${l.slope[p].toFixed(1)}°` : "–", "median, 240 m baseline"],
    ["temp", "Temperature", "–", "no data yet"],
    ["relief", "Terrain", Number.isFinite(l.relief?.[p]) ? `${Math.round(l.relief[p])} m` : "–", "height range, 3 × 3 km"],
  ];
  const cur = rows.find((r) => r[0] === key);
  return (
    <div className="explore">
      <section aria-label="Terrain map" className="mapsec">
        <MapView data={data} layer={layer} values={values} sites={sitesForMap} spots={spotsForMap} selected={place} onSelect={setSelRef} onPick={(px) => setSelRef({ type: "pick", p: px })}>
          <div className="overlay layerbar layerbar--tabs" role="tablist" aria-label="Layer">
            {TERRAIN_LAYERS.map((o) => (
              <button key={o.value} type="button" role="tab" aria-selected={key === o.value} disabled={o.disabled || (o.value === "earth" && !result)} title={o.title} className={cx("layerbar__b", key === o.value && "is-on")} onClick={() => setTerrainLayer(o.value)}>{o.label}</button>
            ))}
          </div>
          <Legend layer={layer} legendEnds={ends} />
        </MapView>
      </section>
      <aside className="rank">
        <Card pad="md2">
          <CardHead title={cur[1]} size="sm"><Fidelity level="computed" /></CardHead>
          <div className="big-40 mt-12">{cur[2]}</div>
          <span className="muted-12">{cur[3]} at {place.short}</span>
        </Card>
        <Card pad="md2">
          <CardHead title="Layers" size="sm" />
          <div className="layerlist">
            {rows.map(([k, name, v, sub]) => (
              <button key={k} type="button" className={cx("layerlist__row", key === k && "is-on")} disabled={k === "temp"} onClick={() => setTerrainLayer(k)}>
                <span className="grow">{name}<span className="muted-11"> · {sub}</span></span>
                <span className="num-13">{v}</span>
              </button>
            ))}
          </div>
        </Card>
        <Card pad="md2">
          <CardHead title="Precision" size="sm" />
          <div className="datalist mt-12">
            <div><span className="lbl">Terrain</span><span>LOLA 240 m, 1 km grid</span></div>
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
  const { selected, Rail, TimeBarEl, siteList, data, moonMission, result, sitesForMap, spotsForMap, timeMs, setTimeMs, setSelRef, tab, go } = app;
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
            <p className="muted-12">Pick a site in the ranking or click anywhere on the map.</p>
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
        <Header app={app} place={place} idx={idx} total={siteList.length || 1} />
        {tab === "overview" ? <Overview app={app} place={place} /> : null}
        {tab === "sky" ? <SkyTime app={app} /> : null}
        {tab === "terrain" ? <Terrain app={app} place={place} /> : null}
        {tab === "lander" && !astronaut ? (
          <section aria-label="Lander's view" className="mapsec mapsec--tall">
            <Suspense fallback={<div className="mapsec__center"><div className="state"><Icon name="loader" size={16} className="spin" /><span className="state__title">Loading the 3D view</span></div></div>}>
              <Moon3D
                data={data} mission={moonMission} result={result} sites={sitesForMap} spots={spotsForMap} selected={place}
                timeMs={timeMs} onTimeChange={setTimeMs} onPick={(p) => setSelRef({ type: "pick", p })}
                toolbarActions={<IconBtn icon="astronaut-helmet" label="Astronaut Mode" variant="raised" size={36} iconSize={20} onClick={() => setAstronaut(true)} />}
              />
            </Suspense>
          </section>
        ) : null}
        {!astronaut ? TimeBarEl : null}
      </main>
      {astronaut ? <Suspense fallback={<div role="status" className="ovl ovl--center"><span className="state__title">Loading Astronaut Mode…</span></div>}><AstronautMode app={app} onClose={() => setAstronaut(false)} /></Suspense> : null}
    </div>
  );
}

