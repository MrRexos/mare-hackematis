// 01 Mission setup — When: periodo y duración de la misión.

import { useRef, useState } from "react";
import { Icon, cx } from "../ui/kit.jsx";
import { fmtDay } from "../ui/Shell.jsx";

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

export default function SetupWhen({ mission, setPeriod, setCustom, setFixed, setDuration, periods, problem, go, openSettings, openLearn }) {
  const [menu, setMenu] = useState(false);
  const [about, setAbout] = useState(false);
  const fixed = mission.period === "fixed";
  const searchSub = mission.period === "next12" ? `${fmtDay(periods.next12[0])} → ${fmtDay(periods.next12[1])}`
    : mission.period === "nofixed" ? `${new Date(periods.nofixed[0]).getUTCFullYear()} → ${new Date(periods.nofixed[1]).getUTCFullYear()}` : null;

  return (
    <div className="when">
      <div className="when__lines" aria-hidden="true">
        {[27, 42.65, 58.3, 73.95].map((x) => <span key={x} style={{ left: `${x}%` }} />)}
      </div>
      <a href="#" className="when__brand" onClick={(e) => e.preventDefault()}>Mare Hackematis</a>
      <div className="when__menu">
        <button type="button" className="ibtn ibtn--ghost" style={{ width: 32, height: 32 }} aria-label="Menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
          <Icon name="menu" size={16} />
        </button>
      </div>
      {menu ? (
        <nav aria-label="Menu" className="popmenu when__pop">
          <button type="button" onClick={() => go("explore")}><Icon name="orbit" size={16} />Explore</button>
          <button type="button" onClick={() => go("compare")}><Icon name="compare" size={16} />Compare</button>
          <button type="button" onClick={() => { setMenu(false); openSettings(); }}><Icon name="sliders" size={16} />Settings</button>
          <button type="button" onClick={openLearn}><Icon name="info" size={16} />How it works</button>
        </nav>
      ) : null}

      <h1 className="when__title">Plan<br />your<br />landing</h1>

      <div role="radiogroup" aria-label="When" className="when__cols">
        {/* 01 — Tengo fecha: todas las celdas se evalúan en esas mismas fechas. */}
        <div className="when__col">
          <span className="when__idx">01</span>
          <button type="button" role="radio" aria-checked={fixed} className={cx("when__opt", fixed && "is-on")} onClick={() => setPeriod("fixed")}>{"I have a\nlanding date"}</button>
          {fixed ? (
            <>
              <div className="when__dates">
                <label><span>Land</span><input type="date" aria-label="Landing date" value={toInput(mission.fromMs)} min={toInput(periods.range[0])} max={toInput(periods.range[1])} onChange={(e) => e.target.value && setFixed(fromInput(e.target.value))} /></label>
              </div>
              <span className="when__sub">Every site is scored for these dates · back {fmtDay(mission.toMs)}</span>
            </>
          ) : <span className="when__sub">Compare all sites on the same dates</span>}
          <button type="button" className={cx("when__act", fixed && "is-on")} onClick={() => setPeriod("fixed")}>{fixed ? "Selected" : "Select"}</button>
        </div>

        {/* 02 — Búscame la mejor: cada celda en sus mejores días del rango. */}
        <div className="when__col">
          <span className="when__idx">02</span>
          <button type="button" role="radio" aria-checked={!fixed} className={cx("when__opt", !fixed && "is-on")} onClick={() => !fixed || setPeriod("next12")}>{"Find the\nbest dates"}</button>
          {!fixed ? (
            <>
              <div className="chips" role="radiogroup" aria-label="Search range">
                {SEARCH_RANGES.map(([id, label]) => (
                  <button key={id} type="button" role="radio" aria-checked={mission.period === id} className={cx("chip", mission.period === id && "is-on")} onClick={() => setPeriod(id)}>{label}</button>
                ))}
              </div>
              {mission.period === "custom" ? (
                <div className="when__dates">
                  <label><span>From</span><input type="date" value={toInput(mission.fromMs)} min={toInput(periods.range[0])} max={toInput(periods.range[1])} onChange={(e) => e.target.value && setCustom(fromInput(e.target.value), mission.toMs)} /></label>
                  <label><span>To</span><input type="date" value={toInput(mission.toMs)} min={toInput(periods.range[0])} max={toInput(periods.range[1])} onChange={(e) => e.target.value && setCustom(mission.fromMs, fromInput(e.target.value))} /></label>
                </div>
              ) : <span className="when__sub">{searchSub}</span>}
              <span className="when__sub">Each site gets its own best days</span>
            </>
          ) : <span className="when__sub">Each site gets its own best days</span>}
          <button type="button" className={cx("when__act", !fixed && "is-on")} onClick={() => !fixed || setPeriod("next12")}>{!fixed ? "Selected" : "Select"}</button>
        </div>

        {/* 03 — Días en superficie (siempre visible). */}
        <div className="when__col">
          <span className="when__idx">03</span>
          <span className="when__opt is-on is-static">{`${lengthLong(mission.durationDays)}\non surface`}</span>
          <LengthSlider value={mission.durationDays} onChange={setDuration} />
        </div>
        {problem ? <p className="when__problem" role="status"><Icon name="alert" size={14} />{problem}</p> : null}
      </div>

      <nav aria-label="Shortcuts" className="when__side">
        <button type="button" onClick={() => go("explore")}>skip</button>
        <span title="All times in UTC">utc</span>
      </nav>

      <img src={`${import.meta.env.BASE_URL}img/moon.png`} alt="" className="when__moon" />

      <nav aria-label="Setup steps" className="steps">
        {[["01", "when", 16], ["02", "priorities", 8], ["03", "priorities", 3]].map(([n, to, h]) => (
          <button type="button" key={n} aria-label={`Step ${n}`} aria-current={n === "01" ? "step" : undefined} className={cx("steps__s", n === "01" && "is-on")} onClick={() => go(to)}>
            <span style={{ height: h }} />
            <b>{n}</b>
          </button>
        ))}
      </nav>

      {about ? (
        <div role="dialog" aria-label="About" className="about">
          <div className="about__head">
            <span>Hackemate</span>
            <button type="button" className="ibtn ibtn--ghost" style={{ width: 28, height: 28 }} aria-label="Close" onClick={() => setAbout(false)}><Icon name="x" size={16} /></button>
          </div>
          <p>Computer engineering students at FIB.</p>
          <ul>
            <li>Oier Hernanz</li><li>Victor Puy</li><li>Pol Salvador</li><li>Nil Font</li><li>Jan Tarriño</li><li>Joel Susi</li>
          </ul>
          <span className="about__foot">Mare Hackematis · NASA Space Apps 2026</span>
        </div>
      ) : null}
      <button type="button" className="when__about" onClick={() => setAbout(!about)}>About</button>

      <button type="button" className="nextbtn" aria-label="Next: priorities" onClick={() => go("priorities")}>
        Next
        <span><Icon name="arrow-right" size={18} /></span>
      </button>
    </div>
  );
}
