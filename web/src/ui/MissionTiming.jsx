import { useId } from "react";
import { Icon, cx } from "./kit.jsx";
import { fmtDay } from "./Shell.jsx";
import MissionOptions from "./MissionOptions.jsx";
import { DAY_MS } from "../engine/missionTiming.js";

const LENGTH_STEPS = [1, 2, 3, 5, 7, 10, 14, 21, 30, 45, 60, 90, 180, 270, 365, 545, 730];
const SEARCH_RANGES = [
  { value: "next12", label: "Next 12 months" },
  { value: "custom", label: "Custom range" },
];

export const timingLabel = (mission) => {
  if (mission.period === "fixed" && mission.fromMs != null) return fmtDay(mission.fromMs);
  return SEARCH_RANGES.find(({ value }) => value === mission.period)?.label;
};

export function lengthLong(d) {
  if (d < 30) return `${d} ${d === 1 ? "day" : "days"}`;
  if (d < 365) { const m = Math.round(d / 30); return `${m} ${m === 1 ? "month" : "months"}`; }
  const y = Math.round((d / 365) * 2) / 2;
  return `${y} ${d < 545 ? "year" : "years"}`;
}

const toInput = (ms) => ms == null ? "" : new Date(ms).toISOString().slice(0, 10);
const fromInput = (s) => s ? Date.parse(`${s}T00:00:00Z`) : null;

function LengthSlider({ value, onChange }) {
  const selected = LENGTH_STEPS.indexOf(value);
  const last = LENGTH_STEPS.length - 1;
  const choose = (index) => onChange(LENGTH_STEPS[Math.max(0, Math.min(last, index))]);
  const atPointer = (e) => {
    const { left, width } = e.currentTarget.getBoundingClientRect();
    choose(Math.floor((e.clientX - left) / width * LENGTH_STEPS.length));
  };
  const onKeyDown = (e) => {
    const positions = { ArrowLeft: selected - 1, ArrowDown: selected - 1, ArrowRight: selected + 1, ArrowUp: selected + 1, Home: 0, End: last };
    if (!Object.hasOwn(positions, e.key)) return;
    e.preventDefault();
    choose(positions[e.key]);
  };

  return (
    <div className="lslider">
      <div className="row-base">
        <span className="lbl">Time on the surface</span>
        <span className={value == null ? "muted-12" : "num-13"}>{value == null ? "Choose duration" : lengthLong(value)}</span>
      </div>
      <div
        className="lslider__track"
        role="slider"
        tabIndex={0}
        aria-label="Time on the surface"
        aria-valuemin={0}
        aria-valuemax={LENGTH_STEPS[last]}
        aria-valuenow={value ?? 0}
        aria-valuetext={value == null ? "Duration not set" : lengthLong(value)}
        onPointerDown={(e) => {
          if (e.button !== 0 || !e.isPrimary) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          atPointer(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) atPointer(e);
        }}
        onKeyDown={onKeyDown}
      >
        {LENGTH_STEPS.map((days, index) => (
          <span key={days} className={cx("lslider__tick", index < selected && "is-past", index === selected && "is-on")} />
        ))}
      </div>
      <div className="lslider__ends" aria-hidden="true"><span>1 d</span><span>2 y</span></div>
    </div>
  );
}

/** fixedOnly: la Luna entera solo admite fecha fija de aterrizaje (buscar fechas es de los polos). */
export default function MissionTiming({ mission, setPeriod, updateMission, periods, problem, fixedOnly = false }) {
  const statusId = useId();
  const fixed = mission.period === "fixed";
  const searching = ["search", "custom", "next12"].includes(mission.period);
  const min = toInput(periods.range[0]);
  const max = toInput(periods.range[1]);

  return (
    <div className="mission-timing">
      <div role="group" aria-label="Landing date mode" className="tabs tabs--block">
        <button type="button" className={cx("tabs__tab", searching && "is-on")} aria-pressed={searching} disabled={fixedOnly}
          title={fixedOnly ? "Whole Moon uses a fixed landing date; best-date search is for the South Pole and North Pole only" : undefined}
          onClick={() => !searching && setPeriod("search")}>Find best dates</button>
        <button type="button" className={cx("tabs__tab", fixed && "is-on")} aria-pressed={fixed} onClick={() => !fixed && setPeriod("fixed")}>Fixed date</button>
      </div>
      {fixed && (
        <div className="mission-timing__fields">
          <label className="mission-field">
            <span className="lbl">Landing date (UTC)</span>
            <input type="date" value={toInput(mission.fromMs)} min={min} max={toInput(periods.range[1] - (mission.durationDays ?? 1) * DAY_MS)}
              onChange={(e) => updateMission({ fromMs: fromInput(e.target.value) })} aria-describedby={problem ? statusId : undefined} />
          </label>
          {mission.toMs != null && <p className="muted-12">Mission ends {fmtDay(mission.toMs)}.</p>}
        </div>
      )}
      {searching && (
        <div className="mission-timing__fields">
          <MissionOptions label="Search range" hideLabel value={mission.period} onChange={setPeriod} options={SEARCH_RANGES} />
          {mission.period === "custom" ? (
            <div className="mission-timing__dates">
              <label className="mission-field">
                <span className="lbl">From (UTC)</span>
                <input type="date" value={toInput(mission.fromMs)} min={min} max={max}
                  onChange={(e) => updateMission({ fromMs: fromInput(e.target.value) })} aria-describedby={problem ? statusId : undefined} />
              </label>
              <label className="mission-field">
                <span className="lbl">To (UTC)</span>
                <input type="date" value={toInput(mission.toMs)} min={min} max={max}
                  onChange={(e) => updateMission({ toMs: fromInput(e.target.value) })} aria-describedby={problem ? statusId : undefined} />
              </label>
            </div>
          ) : mission.period === "next12" && <p className="muted-12">{fmtDay(mission.fromMs)} → {fmtDay(mission.toMs)} (UTC)</p>}
        </div>
      )}
      <LengthSlider value={mission.durationDays} onChange={(durationDays) => updateMission({ durationDays })} />
      {problem && <p id={statusId} className="note-12 mission-error" role="status"><Icon name="alert" size={14} />{problem}</p>}
    </div>
  );
}
