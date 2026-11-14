// Portada (home): la pantalla de la Luna. Resume los tres pasos de la configuración
// (01 Destination · 02 When · 03 What matters) con lo elegido en cada uno, y "Start"
// empieza el recorrido paso a paso. La marca de arriba a la izquierda siempre vuelve aquí.

import { useState } from "react";
import { Icon, cx } from "../ui/kit.jsx";
import { presetOf } from "../engine/score.js";
import { periodLabel, regionName } from "./SetupShell.jsx";
import { lengthLong } from "./SetupWhen.jsx";

export default function Home({ region, mission, weights, go, openSettings, openLearn }) {
  const [menu, setMenu] = useState(false);
  const [about, setAbout] = useState(false);

  const steps = [
    ["01", "where", "Destination", regionName(region)],
    ["02", "when", "When", `${periodLabel(mission)} · ${lengthLong(mission.durationDays)}`],
    ["03", "priorities", "What matters", presetOf(weights) || "Custom weights"],
  ];

  return (
    <div className="when">
      <div className="when__lines" aria-hidden="true">
        {[27, 42.65, 58.3, 73.95].map((x) => <span key={x} style={{ left: `${x}%` }} />)}
      </div>
      <a href="#" className="when__brand" title="Home" onClick={(e) => e.preventDefault()}>Mare Hackematis</a>
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

      {/* Los tres pasos, con lo elegido en cada uno. Pulsar uno lleva a ese paso. */}
      <nav aria-label="Mission setup" className="when__cols">
        {steps.map(([n, id, name, value]) => (
          <div key={n} className="when__col">
            <span className="when__idx">{n}</span>
            <button type="button" className="when__opt is-on" onClick={() => go(id)}>{name}</button>
            <span className="when__sub">{value}</span>
            <button type="button" className="when__act" onClick={() => go(id)}>Change</button>
          </div>
        ))}
      </nav>

      <nav aria-label="Shortcuts" className="when__side">
        <button type="button" onClick={() => go("explore")}>skip</button>
        <span title="All times in UTC">utc</span>
      </nav>

      <img src={`${import.meta.env.BASE_URL}img/moon.png`} alt="" className="when__moon" />

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
      <button type="button" className={cx("when__about")} onClick={() => setAbout(!about)}>About</button>

      <button type="button" className="nextbtn" aria-label="Start: step 01, destination" onClick={() => go("where")}>
        Start
        <span><Icon name="arrow-right" size={18} /></span>
      </button>
    </div>
  );
}
