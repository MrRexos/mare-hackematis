import { useEffect, useState } from "react";
import { L } from "../ds.js";

const DAY_MS = 86400000;
export const MAX_WINDOW_DAYS = 60;

export function toDateInput(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
export function fromDateInput(s) {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Comprueba la misión; devuelve un mensaje o null. */
export function missionProblem(m, range) {
  if (!(m.windowEndMs > m.windowStartMs)) return "The latest landing date must be after the earliest one.";
  if ((m.windowEndMs - m.windowStartMs) / DAY_MS > MAX_WINDOW_DAYS) return `Keep the landing window to ${MAX_WINDOW_DAYS} days or less.`;
  if (m.windowStartMs < range[0]) return `Ephemeris starts on ${toDateInput(range[0])}.`;
  if (m.windowEndMs + m.durationDays * DAY_MS > range[1]) return `The mission must end before ${toDateInput(range[1])}.`;
  return null;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Campo de fecha en ISO (YYYY-MM-DD, UTC). El design system no admite formatos locales. */
function DateField({ label, valueMs, onChange }) {
  const [text, setText] = useState(toDateInput(valueMs));
  useEffect(() => setText(toDateInput(valueMs)), [valueMs]);
  const valid = ISO_DAY.test(text) && !Number.isNaN(fromDateInput(text));
  const commit = (s) => {
    setText(s);
    if (ISO_DAY.test(s) && !Number.isNaN(fromDateInput(s))) onChange(fromDateInput(s));
  };
  return (
    <label className="field">
      <span className="label lh-muted">{label}</span>
      <span className={`field__wrap ${valid ? "" : "is-invalid"}`}>
        <input
          type="text"
          inputMode="numeric"
          className="field__input readout"
          value={text}
          placeholder="YYYY-MM-DD"
          aria-invalid={!valid}
          onChange={(e) => commit(e.target.value.trim())}
          onBlur={() => setText(toDateInput(valueMs))}
        />
        <span className="field__unit caption lh-muted">UTC</span>
      </span>
    </label>
  );
}

export default function MissionPanel({ mission, setMission, range, onRun, running, progress, problem, observerHeightM }) {
  const set = (patch) => setMission({ ...mission, ...patch });
  return (
    <L.Panel eyebrow="01 — Mission" title="Mission window">
      <div className="form-grid">
        <DateField label="EARLIEST LANDING" valueMs={mission.windowStartMs} onChange={(ms) => set({ windowStartMs: ms })} />
        <DateField label="LATEST LANDING" valueMs={mission.windowEndMs} onChange={(ms) => set({ windowEndMs: ms })} />
      </div>
      <div className="stack-4">
        <L.Slider
          label="Surface time"
          value={mission.durationDays}
          min={1}
          max={30}
          step={1}
          onChange={(v) => set({ durationDays: v })}
          format={(v) => `${v} d`}
          minLabel="1 d"
          maxLabel="30 d"
          description="Days the lander must work after touchdown. Dates and times are UTC."
        />
        <p className="body-sm lh-sec note">
          Panels and antenna {observerHeightM} m above the terrain. Each candidate landing time is checked every 3 h inside the window.
        </p>
        {problem ? <L.StatusBanner tone="error" title="Check the mission dates">{problem}</L.StatusBanner> : null}
        {running ? (
          <L.StatusBanner tone="loading" title="Computing Sun and Earth over the terrain" progress={progress}>
            {Math.round(progress * 100)}% of the 160,000 map pixels done
          </L.StatusBanner>
        ) : null}
        <L.Button variant="primary" icon="search" onClick={onRun} disabled={!!problem || running} loading={running}>
          Find the best landing spots
        </L.Button>
      </div>
    </L.Panel>
  );
}
