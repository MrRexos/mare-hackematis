// Marco común de los tres pasos de configuración (una pantalla por paso):
//   01 Destination · 02 When · 03 What matters
// Misma composición en los tres: título grande con una frase que explica la decisión,
// controles en el centro, "Mission brief" a la derecha, pasos abajo a la izquierda y Back.

import { Icon, Btn, cx } from "../ui/kit.jsx";
import { fmtDay } from "../ui/Shell.jsx";

export const SETUP_STEPS = [["01", "where", "Destination"], ["02", "when", "When"], ["03", "priorities", "What matters"]];

/** Zonas de expedición. De momento solo el polo sur tiene datos. */
export const REGIONS = [
  { id: "south", name: "South Pole", sub: "8 Artemis III regions · 1 km grid · hour by hour", ready: true, cap: "south" },
  { id: "moon", name: "Whole Moon", sub: "Monthly averages for any site on the Moon", ready: false, cap: "all" },
  { id: "north", name: "North Pole", sub: "The same detail as the south pole, in the north", ready: false, cap: "north" },
];

export const regionName = (id) => REGIONS.find((r) => r.id === id)?.name || "South Pole";

export function periodLabel(mission) {
  if (mission.period === "fixed") return `Land on ${fmtDay(mission.fromMs)}`;
  return { next12: "Best dates · next 12 months", nofixed: "Best dates · 2026–2030", custom: "Best dates · custom range" }[mission.period] || "–";
}

/** Indicador 01 · 02 · 03 (se puede pulsar para saltar a cualquier paso). */
export function SetupSteps({ current, go, className }) {
  const at = SETUP_STEPS.findIndex(([, id]) => id === current);
  return (
    <nav aria-label="Setup steps" className={cx("steps", className)}>
      {SETUP_STEPS.map(([n, id, name], k) => {
        const h = k === at ? 16 : Math.abs(k - at) === 1 ? 8 : 3;
        return (
          <button type="button" key={n} aria-label={`Step ${n}: ${name}`} title={name} aria-current={k === at ? "step" : undefined}
            className={cx("steps__s", k === at && "is-on")} onClick={() => go(id)}>
            <span style={{ height: h }} />
            <b>{n}</b>
          </button>
        );
      })}
    </nav>
  );
}

/** Resumen de la misión (igual en los tres pasos) con la acción principal del paso. */
export function MissionBrief({ mission, region, cta, onCta, openSettings }) {
  return (
    <section className="card card--lg prio__brief" aria-label="Mission brief">
      <div className="stack-20">
        <h2 className="h-lg">Mission brief</h2>
        <div className="brief">
          <div><span className="lbl">Destination</span><span className="num-15">{regionName(region)}</span></div>
          <div><span className="lbl">Period</span><span className="num-15">{periodLabel(mission)}</span></div>
          <div><span className="lbl">On the surface</span><span><span className="num-15">{mission.durationDays}</span> <span className="unit">days</span></span></div>
          <div><span className="lbl">Observer</span><span><span className="num-15">Lander</span> <span className="unit">{mission.observerM} m</span></span></div>
        </div>
        <Btn variant="primary" size="lg" iconRight="arrow-right" className="btn--block" onClick={onCta}>{cta}</Btn>
        {openSettings ? <button type="button" className="linkbtn" onClick={openSettings}><Icon name="sliders" size={14} />Rules</button> : null}
      </div>
    </section>
  );
}

export default function SetupShell({ step, eyebrow, title, lead, children, brief, go, back }) {
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
        <a href="#" className="when__brand prio__brand" title="Home" onClick={(e) => { e.preventDefault(); go("home"); }}>Mare Hackematis</a>
        <div className="grow" />
        <button type="button" className="linkbtn" onClick={() => go("explore")}>Skip<Icon name="arrow-right" size={14} /></button>
      </div>
      <div className="prio__body">
        <div className="prio__head">
          <div className="eyebrow-13">{eyebrow}</div>
          <h1 className="display-88">{title}</h1>
          {lead ? <p className="prio__lead">{lead}</p> : null}
        </div>
        <div className="prio__weights">{children}</div>
        {brief}
      </div>
      <SetupSteps current={step} go={go} className="prio__steps" />
      {back ? (
        <div className="prio__foot">
          <Btn variant="outline" size="lg" icon="arrow-left" onClick={() => go(back)}>Back</Btn>
        </div>
      ) : null}
    </div>
  );
}
