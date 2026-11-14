// Marco persistente de la portada y los tres pasos de configuración.
//
// Se monta UNA vez para las cuatro pantallas (home, where, when, priorities), así la
// retícula, la marca, el menú, la Luna y la barra inferior no saltan al cambiar de paso.
// Solo cambia el contenido central, que entra con una transición según la dirección.
//
// Retícula editorial del design system: cuatro columnas con hairlines y cruces "+".
// Movimiento: solo cuando lo inicia el usuario, curva cubic-bezier(.2,.8,.2,1),
// y sin animaciones con prefers-reduced-motion.

import { useState } from "react";
import { Icon, cx } from "../ui/kit.jsx";
import { SetupSteps } from "./SetupShell.jsx";

export default function SetupLayout({ screen, dir, go, back, next, openSettings, openLearn, children }) {
  const [menu, setMenu] = useState(false);
  const [about, setAbout] = useState(false);
  const isHome = screen === "home";

  return (
    <div className={cx("setup", isHome ? "setup--home" : "setup--step")}>
      <div className="setup__grid" aria-hidden="true">
        {[25, 50, 75].map((x) => (
          <span key={x} style={{ left: `${x}%` }}>
            <i className="cross setup__cross--top" />
            <i className="cross setup__cross--bottom" />
          </span>
        ))}
      </div>

      <img src={`${import.meta.env.BASE_URL}img/moon.png`} alt="" className="setup__moon" />

      <header className="setup__top">
        <a href="#" className="setup__brand" aria-current={isHome ? "page" : undefined} title="Home"
          onClick={(e) => { e.preventDefault(); go("home"); }}>Mare Hackematis</a>
        <div className="setup__menu">
          <button type="button" className="ibtn ibtn--ghost" style={{ width: 36, height: 36 }} aria-label="Menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <Icon name={menu ? "x" : "menu"} size={16} />
          </button>
          {menu ? (
            <nav aria-label="Menu" className="popmenu setup__pop">
              <button type="button" onClick={() => go("explore")}><Icon name="orbit" size={16} />Explore the map</button>
              <button type="button" onClick={() => go("compare")}><Icon name="compare" size={16} />Compare</button>
              <button type="button" onClick={() => { setMenu(false); openSettings(); }}><Icon name="sliders" size={16} />Mission settings</button>
              <button type="button" onClick={openLearn}><Icon name="info" size={16} />How it works</button>
              <button type="button" onClick={() => { setMenu(false); setAbout(true); }}><Icon name="badge" size={16} />About the team</button>
            </nav>
          ) : null}
        </div>
      </header>

      <nav aria-label="Shortcuts" className="setup__side">
        <button type="button" onClick={() => go("explore")}>skip to map</button>
        <span title="All times in UTC">utc</span>
      </nav>

      {/* El contenido cambia con cada pantalla; la clave fuerza la animación de entrada. */}
      <main key={screen} className={cx("setup__content", dir !== 0 && "is-anim", dir < 0 && "is-back")}>{children}</main>

      <footer className="setup__bottom">
        <SetupSteps current={screen} go={go} className="setup__steps" />
        <div className="setup__nav">
          {back ? (
            <button type="button" className="setup__back" onClick={() => go(back)}>
              <Icon name="arrow-left" size={14} />Back
            </button>
          ) : null}
          <button type="button" className="setup__next" onClick={next.onClick} disabled={next.disabled} aria-label={next.aria || next.label}>
            {next.label}
            <span><Icon name="arrow-right" size={18} /></span>
          </button>
        </div>
      </footer>

      {about ? (
        <div role="dialog" aria-label="About the team" className="about setup__about">
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
    </div>
  );
}
