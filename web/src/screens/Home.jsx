import { useEffect, useRef, useState } from "react";
import { Icon, IconBtn, cx } from "../ui/kit.jsx";
import { presetOf } from "../engine/score.js";
import MissionTiming, { lengthLong, timingLabel } from "../ui/MissionTiming.jsx";
import MissionOptions from "../ui/MissionOptions.jsx";
import MissionWeights from "../ui/MissionWeights.jsx";

/**
 * El polo norte se activa cuando existen sus datos (web/public/data/north) y la Luna entera
 * cuando existen los globales (web/public/data/global).
 */
const destinations = (ready) => DESTINATIONS.map((d) => (ready[d.value] ? { value: d.value, label: d.label } : d));

const DESTINATIONS = [
  { value: "south", label: "South Pole" },
  { value: "north", label: "North Pole", disabled: true, note: "Not available yet" },
  { value: "moon", label: "Whole Moon", disabled: true, note: "Not available yet" },
];
const STEPS = [
  { id: "where", label: "Where", title: <>Where<br />will you<br />land?</> },
  { id: "when", label: "When", title: <>When<br />will you<br />go?</> },
  { id: "how", label: "How", title: <>What<br />matters<br />most?</> },
];

export default function Home({ app }) {
  const {
    mission, weights, setWeights, destination, destinationReady, chooseDestination,
    timingReady, timingMissing, planReady, planStarted, resetPlan, go, problem, cmpPlaces, openSettings,
  } = app;
  const [menu, setMenu] = useState(false);
  const [about, setAbout] = useState(false);
  const [step, setStep] = useState(null);
  const titleRef = useRef(null);
  const overview = step === null;
  const complete = [destinationReady, timingReady, planReady];
  const available = [true, destinationReady, timingReady];
  const firstIncomplete = complete.findIndex((ready) => !ready);
  const current = step ?? (firstIncomplete < 0 ? 2 : firstIncomplete);
  const when = [timingLabel(mission), mission.durationDays != null && lengthLong(mission.durationDays)].filter(Boolean).join(" · ");
  const values = [
    DESTINATIONS.find((option) => option.value === destination)?.label || "Choose a destination",
    when || "Set dates and duration",
    weights ? presetOf(weights) || "Custom weights" : "Set mission priorities",
  ];
  const status = step === 1 ? problem || timingMissing : step === 2 && !planReady ? "Choose a scoring profile." : null;

  useEffect(() => {
    window.scrollTo(0, 0);
    if (step !== null) titleRef.current?.focus({ preventScroll: true });
  }, [step]);

  const next = () => {
    if (overview) {
      if (planReady) go("explore");
      else setStep(firstIncomplete);
    } else if (complete[step]) {
      if (step === 2) go("explore");
      else setStep(step + 1);
    }
  };
  const clear = () => {
    resetPlan();
    setStep(null);
    setMenu(false);
  };

  return (
    <div className={cx("setup", !overview && "setup--step")}>
      <div className="setup__grid" aria-hidden="true"><span /><span /><span /><span /></div>
      <img src={`${import.meta.env.BASE_URL}img/moon-landing.png`} alt="" width="2047" height="629" className="setup__moon" />
      <header className="setup__top">
        <button type="button" className="setup__brand" aria-label="Mare Hackematis, home" onClick={() => setStep(null)}>Mare Hackematis</button>
        <div className="setup__menu">
          <IconBtn icon={menu ? "x" : "menu"} variant="ghost" label={menu ? "Close menu" : "Menu"}
            size={32} iconSize={14} aria-controls={menu ? "home-menu" : undefined} aria-expanded={menu} onClick={() => setMenu(!menu)} />
          {menu && (
            <nav id="home-menu" aria-label="Menu" className="popmenu setup__pop">
              {planReady && cmpPlaces.length > 0 && <button type="button" onClick={() => go("compare")}><Icon name="compare" size={16} />Compare sites</button>}
              <button type="button" onClick={() => { setMenu(false); openSettings(); }}><Icon name="sliders" size={16} />Advanced settings</button>
              <button type="button" onClick={() => go("learn")}><Icon name="info" size={16} />How it works</button>
              <button type="button" onClick={() => { setMenu(false); setAbout(true); }}><Icon name="badge" size={16} />About the team</button>
              {planStarted && <button type="button" onClick={clear}><Icon name="rotate-ccw" size={16} />Reset plan</button>}
            </nav>
          )}
        </div>
      </header>

      <main className="setup__main">
        <form className="home__planner" aria-label="Mission plan" noValidate onSubmit={(e) => { e.preventDefault(); next(); }}>
          <div className="setup__content" key={step ?? "home"}>
            <div className="setup__head">
              <h1 ref={titleRef} tabIndex={-1} className="setup__title">{overview ? <>Plan<br />your<br />landing</> : STEPS[step].title}</h1>
            </div>

            {overview ? (
              <nav className="home__choices" aria-label="Mission setup">
                {STEPS.map(({ id, label }, index) => (
                  <section key={id} className={cx("home__choice", !available[index] && "is-locked")} aria-labelledby={`mission-${id}`}>
                    <span className="home__choice-index" aria-hidden="true">0{index + 1}</span>
                    <h2 id={`mission-${id}`}><button type="button" disabled={!available[index]} onClick={() => setStep(index)}>{label}</button></h2>
                    <p className="home__choice-value">{values[index]}</p>
                    <button type="button" className="home__choice-action" aria-label={`${complete[index] ? "Change" : "Select"} ${label.toLowerCase()}`}
                      disabled={!available[index]} onClick={() => setStep(index)}>{complete[index] ? "Change" : "Select"}</button>
                  </section>
                ))}
              </nav>
            ) : (
              <section className="setup__editor" aria-label={`${STEPS[step].label} settings`}>
                <div className="setup__editor-head"><span>0{step + 1}</span><h2>{STEPS[step].label}</h2></div>
                {step === 0 && <MissionOptions label="Lunar destination" value={destination} onChange={chooseDestination} options={destinations({ north: app.northReady, moon: app.globalReady })} />}
                {step === 1 && <MissionTiming {...app} fixedOnly={destination === "moon"} />}
                {step === 2 && <MissionWeights weights={weights} setWeights={setWeights} compact />}
                <p id="mission-status" className={cx("home__status", step === 1 && problem && "mission-error")} role="status">{status}</p>
              </section>
            )}
          </div>

          <nav className="home__steps" aria-label="Setup steps">
            {STEPS.map(({ id, label }, index) => (
              <button type="button" key={id} className={cx("home__step", current === index && "is-current")}
                aria-label={`Step 0${index + 1}: ${label}`} aria-current={current === index ? "step" : undefined}
                disabled={!available[index]} onClick={() => setStep(index)}>
                <span aria-hidden="true" /><b>0{index + 1}</b>
              </button>
            ))}
          </nav>

          <footer className="setup__bottom">
            <button type="button" className="setup__about-link" onClick={() => setAbout(!about)} aria-expanded={about}>About</button>
            <div className="setup__nav">
              {!overview && <button type="button" className="setup__back" onClick={() => setStep(step === 0 ? null : step - 1)}>Back</button>}
              <button type="submit" className="setup__next" disabled={!overview && !complete[step]}
                aria-describedby={!overview && status ? "mission-status" : undefined}>
                {(overview && planReady) || step === 2 ? "Explore" : "Next"}<span><Icon name="arrow-right" size={18} /></span>
              </button>
            </div>
          </footer>
        </form>
      </main>

      <span className="setup__utc" title="All mission dates use Coordinated Universal Time">utc</span>

      {about && (
        <div role="dialog" aria-label="About the team" className="about setup__about">
          <div className="about__head">
            <span>Hackemate</span>
            <IconBtn icon="x" label="Close" size={28} variant="ghost" onClick={() => setAbout(false)} />
          </div>
          <p>Computer engineering students at FIB.</p>
          <ul>
            <li>Oier Hernanz</li>
            <li>Victor Puy</li>
            <li>Pol Salvador</li>
            <li>Nil Font</li>
            <li>Jan Tarriño</li>
            <li>Joel Susi</li>
          </ul>
          <span className="about__foot">Mare Hackematis · NASA Space Apps 2026</span>
        </div>
      )}
    </div>
  );
}
