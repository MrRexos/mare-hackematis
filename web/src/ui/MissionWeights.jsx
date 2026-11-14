import { useRef } from "react";
import { Icon, cx } from "./kit.jsx";
import { FACTORS, PRESETS, presetOf, rebalance } from "../engine/score.js";
import MissionOptions from "./MissionOptions.jsx";

const PROFILES = Object.keys(PRESETS).map((name) => ({ value: name, label: name }));

function WeightRow({ f, value, onChange }) {
  const drag = useRef(false);
  const at = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    onChange(((e.clientX - r.left) / r.width) * 100);
  };
  const off = !!f.noData;
  return (
    <div className={cx("wrow", off && "is-off")} title={off ? f.hint : undefined}>
      <span className="wrow__icon"><Icon name={f.icon} size={16} style={{ color: off ? undefined : f.color }} /></span>
      <span className="wrow__name">
        {f.label}
        {off ? <span className="wrow__nodata">No data yet</span> : null}
      </span>
      <div
        role="slider"
        tabIndex={off ? -1 : 0}
        aria-label={`${f.label} weight`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-disabled={off || undefined}
        className="wslider"
        onPointerDown={(e) => { if (off) return; e.currentTarget.setPointerCapture(e.pointerId); drag.current = true; at(e); }}
        onPointerMove={(e) => { if (drag.current) at(e); }}
        onPointerUp={() => { drag.current = false; }}
        onPointerCancel={() => { drag.current = false; }}
        onKeyDown={(e) => {
          if (off) return;
          if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); onChange(value + 1); }
          if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); onChange(value - 1); }
        }}
      >
        <div className="wslider__rail" />
        <div className="wslider__fill" style={{ width: `${value}%`, background: f.color }} />
        {!off ? <div className="wslider__thumb" style={{ left: `calc(${value}% - 10px)` }} /> : null}
      </div>
      <span className={cx("wrow__val", !value && "is-zero")}>{value}%</span>
    </div>
  );
}

export default function MissionWeights({ weights, setWeights, compact = false }) {
  const profiles = <MissionOptions label="Scoring profile" value={weights ? presetOf(weights) : null} options={PROFILES}
    onChange={(profile) => setWeights({ ...PRESETS[profile] })} />;
  if (!weights) return <div className="mission-weights">{profiles}</div>;

  const total = FACTORS.reduce((s, f) => s + (weights[f.key] || 0), 0);
  const match = presetOf(weights);
  const details = (
    <div className="wrows">
      <p className="muted-12">The site score is a weighted average. The weights add up to {total}%.</p>
      {FACTORS.map((f) => (
        <WeightRow key={f.key} f={f} value={weights[f.key] || 0} onChange={(v) => setWeights((w) => rebalance(w, f.key, v))} />
      ))}
    </div>
  );

  return (
    <div className="mission-weights">
      {profiles}
      {!match && !compact && <p className="muted-12">Custom weights active</p>}
      <div
        role="img"
        aria-label={FACTORS.map((f) => `${f.label}: ${weights[f.key] || 0}%`).join(", ")}
        className="wstack"
      >
        {FACTORS.map((f) => weights[f.key] > 0 && (
          <div key={f.key} title={`${f.label} ${weights[f.key]}%`} style={{ flex: `${weights[f.key]} 1 0`, background: f.color }} />
        ))}
      </div>
      {compact ? (
        <details className="mission-details">
          <summary>Adjust weights</summary>
          {details}
        </details>
      ) : details}
    </div>
  );
}
