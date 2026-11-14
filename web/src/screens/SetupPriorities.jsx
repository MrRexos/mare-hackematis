// Paso 03 — What matters: pesos (%) de cada factor.

import { useRef } from "react";
import { Icon, cx } from "../ui/kit.jsx";
import { FACTORS, PRESETS, presetOf, rebalance } from "../engine/score.js";
import SetupShell, { MissionBrief } from "./SetupShell.jsx";

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

export default function SetupPriorities({ weights, setWeights, mission, region, openSettings }) {
  const total = FACTORS.reduce((s, f) => s + (weights[f.key] || 0), 0);
  const match = presetOf(weights);

  return (
    <SetupShell
      eyebrow="03 — What matters/"
      title={<>What<br />matters<br />most?</>}
      lead="Each factor scores a site from 0 to 100. Its final score is the weighted average, so the weights always add up to 100%."
      brief={<MissionBrief mission={mission} region={region} openSettings={openSettings} />}
    >
          <div className="stack-10">
            <div className="row-base">
              <span className="lbl">Weights</span>
              <div className="grow" />
              <span className="num-15">{total}%</span>
            </div>
            <div role="img" aria-label="Weights" className="wstack">
              {FACTORS.map((f) => (weights[f.key] > 0 ? <div key={f.key} title={`${f.label} ${weights[f.key]}%`} style={{ flex: `${weights[f.key]} 1 0`, background: f.color }} /> : null))}
            </div>
            <div className="chips">
              {Object.keys(PRESETS).map((p) => (
                <button key={p} type="button" className={cx("chip", p === match && "is-on")} aria-pressed={p === match} onClick={() => setWeights({ ...PRESETS[p] })}>{p}</button>
              ))}
            </div>
          </div>
          <div className="wrows">
            {FACTORS.map((f) => (
              <WeightRow key={f.key} f={f} value={weights[f.key] || 0} onChange={(v) => setWeights(rebalance(weights, f.key, v))} />
            ))}
          </div>
    </SetupShell>
  );
}
