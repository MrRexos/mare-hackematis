// 01 Mission setup — What matters: pesos (%) de cada factor y la región.

import { useRef } from "react";
import { Icon, Btn, Choice, cx } from "../ui/kit.jsx";
import { FACTORS, PRESETS, presetOf, rebalance } from "../engine/score.js";

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

export default function SetupPriorities({ weights, setWeights, mission, sitesCount, go, openSettings }) {
  const total = FACTORS.reduce((s, f) => s + (weights[f.key] || 0), 0);
  const match = presetOf(weights);
  const periodName = { nofixed: "No fixed date", custom: "Custom window" }[mission.period];

  return (
    <div className="prio">
      <div className="prio__lines" aria-hidden="true">
        {[25, 50, 75].map((x) => (
          <span key={x} style={{ left: `${x}%` }}>
            <i className="cross" style={{ top: 150 }} />
            <i className="cross" style={{ top: 840 }} />
          </span>
        ))}
      </div>
      <div className="prio__top">
        <div className="grow" />
        <button type="button" className="linkbtn" onClick={() => go("explore")}>Skip<Icon name="arrow-right" size={14} /></button>
      </div>
      <div className="prio__body">
        <div className="prio__head">
          <div className="eyebrow-13">02 — What matters/</div>
          <h1 className="display-88">What<br />matters<br />most?</h1>
        </div>

        <div className="prio__weights">
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
        </div>

        <section className="card card--lg prio__brief">
          <div className="stack-20">
            <h2 className="h-lg">Mission brief</h2>
            <div className="brief">
              <div><span className="lbl">Period</span><span className="num-15">{periodName}</span></div>
              <div><span className="lbl">On the surface</span><span><span className="num-15">{mission.durationDays}</span> <span className="unit">days</span></span></div>
              <div><span className="lbl">Observer</span><span><span className="num-15">Lander</span> <span className="unit">{mission.observerM} m</span></span></div>
              <div><span className="lbl">DSN rule</span><span className="num-15">Off</span></div>
            </div>
            <div className="hr" />
            <div className="stack-10">
              <div className="eyebrow-13">03 — Where/</div>
              <div className="row-10">
                <Choice on icon="crosshair" title="South Pole" sub={`${sitesCount} regions · 1 km grid`} onClick={() => {}} />
                <Choice disabled icon="globe" title="Whole Moon" sub="No data yet" />
              </div>
            </div>
            <Btn variant="primary" size="lg" iconRight="arrow-right" className="btn--block" onClick={() => go("explore")}>Find sites</Btn>
            <button type="button" className="linkbtn" onClick={openSettings}><Icon name="sliders" size={14} />Rules</button>
          </div>
        </section>
      </div>
      <div className="prio__foot">
        <Btn variant="outline" size="lg" icon="arrow-left" onClick={() => go("when")}>Back</Btn>
      </div>
    </div>
  );
}
