// Paso 02 — When: periodo y duración de la misión (y piezas que reutiliza el panel de misión).

import { useRef } from "react";
import { Icon, cx } from "../ui/kit.jsx";
import { fmtDay } from "../ui/Shell.jsx";
import SetupShell, { MissionBrief } from "./SetupShell.jsx";

export const LENGTH_STEPS = [1, 2, 3, 5, 7, 10, 14, 21, 30, 45, 60, 90, 180, 270, 365, 545, 730];

export function lengthLong(d) {
  if (d < 30) return `${d} ${d === 1 ? "day" : "days"}`;
  if (d < 365) { const m = Math.round(d / 30); return `${m} ${m === 1 ? "month" : "months"}`; }
  const y = Math.round((d / 365) * 2) / 2;
  return `${y} ${d < 545 ? "year" : "years"}`;
}

const toInput = (ms) => new Date(ms).toISOString().slice(0, 10);
const fromInput = (s) => Date.parse(`${s}T00:00:00Z`);

export function LengthSlider({ value, onChange }) {
  const li = Math.max(0, LENGTH_STEPS.indexOf(value));
  const n = LENGTH_STEPS.length - 1;
  const drag = useRef(false);
  const at = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    onChange(LENGTH_STEPS[Math.round(f * n)]);
  };
  return (
    <div className="lslider">
      <div
        role="slider"
        tabIndex={0}
        aria-label="Mission length"
        aria-valuemin={0}
        aria-valuemax={n}
        aria-valuenow={li}
        aria-valuetext={lengthLong(value)}
        className="lslider__track"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = true; at(e); }}
        onPointerMove={(e) => { if (drag.current) at(e); }}
        onPointerUp={() => { drag.current = false; }}
        onPointerCancel={() => { drag.current = false; }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); onChange(LENGTH_STEPS[Math.min(n, li + 1)]); }
          if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); onChange(LENGTH_STEPS[Math.max(0, li - 1)]); }
        }}
      >
        {LENGTH_STEPS.map((d, i) => (
          <span key={d} className={cx("lslider__tick", i < li && "is-past", i === li && "is-on")} />
        ))}
      </div>
      <div className="lslider__ends"><span>1 d</span><span>2 y</span></div>
    </div>
  );
}

/** Rangos de búsqueda del modo "Find the best dates". */
export const SEARCH_RANGES = [["next12", "Next 12 months"], ["nofixed", "2026 – 2030"], ["custom", "Custom range"]];

/** Paso 02 — When: todo lo temporal (un día concreto o buscar en un rango) y los días en superficie. */
export default function SetupWhen({ mission, region, setPeriod, setCustom, setFixed, setDuration, periods, problem, go }) {
  const fixed = mission.period === "fixed";
  const rangeText = mission.period === "next12" ? `${fmtDay(periods.next12[0])} → ${fmtDay(periods.next12[1])}`
    : mission.period === "nofixed" ? `${fmtDay(periods.nofixed[0])} → ${fmtDay(periods.nofixed[1])}` : null;

  return (
    <SetupShell
      step="when"
      eyebrow="02 — When/"
      title={<>When<br />do you<br />go?</>}
      lead="Choose one landing day to compare every site on the same dates, or let the planner find each site's best days."
      go={go}
      back="where"
      brief={<MissionBrief mission={mission} region={region} cta="Continue" onCta={() => go("priorities")} />}
    >
      <div className="row-base"><span className="lbl">Landing date</span></div>
      <div role="radiogroup" aria-label="Landing date" className="dest">
        <div className={cx("opt", fixed && "is-on")}>
          <button type="button" role="radio" aria-checked={fixed} className="opt__head" onClick={() => setPeriod("fixed")}>
            <span className="opt__dot" />
            <span className="dest__text">
              <span className="dest__name">One landing day</span>
              <span className="dest__sub">Every site is scored on the same dates</span>
            </span>
          </button>
          {fixed ? (
            <div className="opt__body">
              <div className="dates">
                <label><span className="lbl">Land</span><input type="date" aria-label="Landing day" value={toInput(mission.fromMs)} min={toInput(periods.range[0])} max={toInput(periods.range[1])} onChange={(e) => e.target.value && setFixed(fromInput(e.target.value))} /></label>
              </div>
              <span className="muted-12">Back on {fmtDay(mission.toMs)}</span>
            </div>
          ) : null}
        </div>

        <div className={cx("opt", !fixed && "is-on")}>
          <button type="button" role="radio" aria-checked={!fixed} className="opt__head" onClick={() => fixed && setPeriod("next12")}>
            <span className="opt__dot" />
            <span className="dest__text">
              <span className="dest__name">Find the best dates</span>
              <span className="dest__sub">Each site gets its own best days within a range</span>
            </span>
          </button>
          {!fixed ? (
            <div className="opt__body">
              <div className="chips" role="radiogroup" aria-label="Search range">
                {SEARCH_RANGES.map(([id, label]) => (
                  <button key={id} type="button" role="radio" aria-checked={mission.period === id} className={cx("chip", mission.period === id && "is-on")} onClick={() => setPeriod(id)}>{label}</button>
                ))}
              </div>
              {mission.period === "custom" ? (
                <div className="dates">
                  <label><span className="lbl">From</span><input type="date" aria-label="From" value={toInput(mission.fromMs)} min={toInput(periods.range[0])} max={toInput(periods.range[1])} onChange={(e) => e.target.value && setCustom(fromInput(e.target.value), mission.toMs)} /></label>
                  <label><span className="lbl">To</span><input type="date" aria-label="To" value={toInput(mission.toMs)} min={toInput(periods.range[0])} max={toInput(periods.range[1])} onChange={(e) => e.target.value && setCustom(mission.fromMs, fromInput(e.target.value))} /></label>
                </div>
              ) : <span className="muted-12">{rangeText}</span>}
            </div>
          ) : null}
        </div>
      </div>

      <div className="setup-sep" />
      <div className="row-base">
        <span className="lbl">Days on the surface</span>
        <div className="grow" />
        <span className="num-15">{lengthLong(mission.durationDays)}</span>
      </div>
      <LengthSlider value={mission.durationDays} onChange={setDuration} />
      <p className="muted-12 setup-note">How long the lander must work after touchdown, from 1 day to 2 years.</p>
      {problem ? <p className="note-12" role="status"><Icon name="alert" size={12} />{problem}</p> : null}
    </SetupShell>
  );
}
