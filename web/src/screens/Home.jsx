// Portada (home): la pantalla de la Luna, dentro del mismo marco que los pasos (SetupLayout).
// Resume los tres pasos de la configuración (01 Destination · 02 When · 03 What matters)
// con lo elegido en cada uno; pulsar uno lleva a ese paso y "Start" empieza por el 01.

import { presetOf } from "../engine/score.js";
import { periodLabel, regionName } from "./SetupShell.jsx";
import { lengthLong } from "./SetupWhen.jsx";

export default function Home({ region, mission, weights, go }) {
  const steps = [
    ["01", "where", "Destination", regionName(region)],
    ["02", "when", "When", `${periodLabel(mission)} · ${lengthLong(mission.durationDays)}`],
    ["03", "priorities", "What matters", presetOf(weights) || "Custom weights"],
  ];

  return (
    <>
      <div className="setup__head">
        <div className="eyebrow-13">Mission planner/</div>
        <h1 className="setup__title">Plan<br />your<br />landing</h1>
        <p className="setup__lead">Three choices, and every square kilometre of the south pole gets a score for your mission.</p>
      </div>

      {/* Los tres pasos, uno por columna de la retícula, con lo elegido en cada uno. */}
      <nav aria-label="Mission setup" className="setup__main home__cols">
        {steps.map(([n, id, name, value]) => (
          <div key={n} className="home__col">
            <span className="when__idx">{n}</span>
            <button type="button" className="when__opt is-on" onClick={() => go(id)}>{name}</button>
            <span className="when__sub">{value}</span>
            <button type="button" className="when__act" onClick={() => go(id)}>Change</button>
          </div>
        ))}
      </nav>
    </>
  );
}
