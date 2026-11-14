import { useRef, useState } from "react";
import { Icon, IconBtn, cx } from "../ui/kit.jsx";
import { presetOf } from "../engine/score.js";
import MissionTiming, { lengthLong, timingLabel } from "../ui/MissionTiming.jsx";
import MissionOptions from "../ui/MissionOptions.jsx";
import MissionWeights from "../ui/MissionWeights.jsx";

const DESTINATIONS = [
  { value: "south", label: "South Pole" },
  { value: "north", label: "North Pole", disabled: true, note: "Not available yet" },
  { value: "moon", label: "Whole Moon", disabled: true, note: "Not available yet" },
];

function MissionChoice({ id, label, value, complete, expanded, locked = false, onToggle, toggleRef, children }) {
  const open = expanded && !locked;
  return (
    <section className={cx("home__choice", complete && "is-complete", open && "is-open", locked && "is-locked")} aria-labelledby={`mission-${id}`}>
      <h2 id={`mission-${id}`}>
        <button ref={toggleRef} type="button" className="home__choice-toggle" disabled={locked}
          aria-expanded={open} aria-controls={`controls-${id}`} onClick={onToggle}>
          <span className="home__choice-title">
            <span className="home__choice-status" aria-hidden="true">{complete && <Icon name="check" size={12} />}</span>
            {label}
          </span>
          <Icon className="home__choice-chevron" name={locked ? "lock" : "chevron-down"} size={15} />
          <span className="home__choice-value" key={value}>{value}</span>
          {complete && <span className="sr-only">Complete</span>}
        </button>
      </h2>
      <div id={`controls-${id}`} className="home__choice-body" inert={open ? undefined : ""}>
        <div className="home__choice-clip"><div className="home__choice-controls">{children}</div></div>
      </div>
    </section>
  );
}

export default function Home({ app }) {
  const {
    mission, weights, setWeights, destination, destinationReady, chooseDestination,
    timingReady, timingMissing, planReady, planStarted, resetPlan, go, problem, cmpPlaces, openSettings,
  } = app;
  const [menu, setMenu] = useState(false);
  const [about, setAbout] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const whereRef = useRef(null);
  const toggle = (id) => setExpanded((current) => current === id ? null : id);
  const completeCount = Number(destinationReady) + Number(timingReady) + Number(planReady);
  const when = [timingLabel(mission), mission.durationDays != null && lengthLong(mission.durationDays)].filter(Boolean).join(" · ");
  const profile = weights ? presetOf(weights) || "Custom weights" : "Choose a scoring profile";
  const status = !destinationReady
    ? "Choose a destination."
    : problem || timingMissing || (planReady ? "Ready to explore." : "Choose a scoring profile.");
  const clear = () => {
    resetPlan();
    setExpanded(null);
    whereRef.current?.focus();
  };

  return (
    <div className="setup">
      <div className="setup__grid" aria-hidden="true"><span /><span /><span /></div>
      <img src={`${import.meta.env.BASE_URL}img/moon.png`} alt="" className="setup__moon" />
      <header className="setup__top">
        <span className="setup__brand">Mare Hackematis</span>
        <div className="setup__menu">
          <IconBtn icon={menu ? "x" : "menu"} variant="ghost" label={menu ? "Close menu" : "Menu"}
            size={40} aria-controls={menu ? "home-menu" : undefined} aria-expanded={menu} onClick={() => setMenu(!menu)} />
          {menu && (
            <nav id="home-menu" aria-label="Menu" className="popmenu setup__pop">
              {planReady && cmpPlaces.length > 0 && <button type="button" onClick={() => go("compare")}><Icon name="compare" size={16} />Compare sites</button>}
              <button type="button" onClick={() => { setMenu(false); openSettings(); }}><Icon name="sliders" size={16} />Advanced settings</button>
              <button type="button" onClick={() => go("learn")}><Icon name="info" size={16} />How it works</button>
              <button type="button" onClick={() => { setMenu(false); setAbout(true); }}><Icon name="badge" size={16} />About the team</button>
            </nav>
          )}
        </div>
      </header>

      <main className="setup__main">
        <form className="home__planner" aria-label="Mission plan" noValidate
          onSubmit={(e) => { e.preventDefault(); if (planReady) go("explore"); }}>
          <div className="setup__content">
            <div className="setup__head">
              <h1 className="setup__title">Plan your landing</h1>
              <p className="setup__lead">Choose where and when to land, and what matters most to your mission.</p>
            </div>
            <div className="home__choices">
              <MissionChoice id="where" label="Where" value={DESTINATIONS.find((option) => option.value === destination)?.label || "Choose a destination"}
                toggleRef={whereRef} complete={destinationReady} expanded={expanded === "where"} onToggle={() => toggle("where")}>
                <MissionOptions label="Lunar destination" value={destination} onChange={chooseDestination} options={DESTINATIONS} />
              </MissionChoice>

              <MissionChoice id="when" label="When" value={destinationReady ? when || "Set dates and duration" : "Choose a destination first"}
                complete={timingReady} locked={!destinationReady} expanded={expanded === "when"} onToggle={() => toggle("when")}>
                <MissionTiming {...app} />
              </MissionChoice>

              <MissionChoice id="how" label="How" value={timingReady ? profile : "Set dates and duration first"}
                complete={planReady} locked={!timingReady} expanded={expanded === "how"} onToggle={() => toggle("how")}>
                <MissionWeights weights={weights} setWeights={setWeights} compact />
              </MissionChoice>
            </div>
          </div>
          <div className="home__actions">
            <div className="home__progress">
              <div className="home__progress-track" role="progressbar" aria-label="Plan completion"
                aria-valuemin={0} aria-valuemax={3} aria-valuenow={completeCount}>
                <span style={{ width: `${completeCount / 3 * 100}%` }} />
              </div>
              <p id="mission-status" className={cx("home__status", problem && "mission-error")} role="status">{status}</p>
            </div>
            <div className="home__buttons">
              <button type="button" className="home__reset" disabled={!planStarted} onClick={clear}>
                <Icon name="rotate-ccw" size={15} />Reset plan
              </button>
              <button type="submit" className="setup__next" disabled={!planReady} aria-describedby="mission-status">
                Explore the map <span><Icon name={planReady ? "arrow-right" : "lock"} size={18} /></span>
              </button>
            </div>
          </div>
        </form>
      </main>

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
