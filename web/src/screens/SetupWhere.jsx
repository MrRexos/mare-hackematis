// Paso 01 — Destination: dónde es la expedición (polo sur, Luna entera, polo norte).
// El polo sur tiene datos hora a hora. La Luna entera se activa cuando existen las mallas
// globales ya calculadas (web/public/data/global); el polo norte sigue como "Coming soon".

import { Icon, cx } from "../ui/kit.jsx";
import SetupShell, { MissionBrief, REGIONS } from "./SetupShell.jsx";

export { REGIONS };

/** Miniatura de la Luna con la zona resaltada (casquete sur, toda o casquete norte). */
function MoonThumb({ cap }) {
  return (
    <span className={cx("dest__moon", `dest__moon--${cap}`)} aria-hidden="true"
      style={{ backgroundImage: `url(${import.meta.env.BASE_URL}img/moon.png)` }} />
  );
}

export default function SetupWhere({ region, setRegion, mission, go, globalManifest }) {
  const moonLayers = globalManifest ? Object.keys(globalManifest.layers).length : 0;
  const regions = REGIONS.map((r) => (r.id === "moon" && moonLayers
    ? { ...r, ready: true, sub: `${moonLayers} precomputed layers · 0.25° grid · any site on the Moon` }
    : r));
  return (
    <SetupShell
      step="where"
      eyebrow="01 — Destination/"
      title={<>Where<br />do you<br />land?</>}
      lead={moonLayers
        ? "Pick the region to plan. The south pole has hour-by-hour data; the whole Moon uses precomputed global layers."
        : "Pick the region to plan. The south pole has hour-by-hour data today; the rest of the Moon is on the way."}
      go={go}
      back="home"
      brief={<MissionBrief mission={mission} region={region} cta="Continue" onCta={() => go("when")} />}
    >
      <div className="row-base">
        <span className="lbl">Region</span>
      </div>
      <div role="radiogroup" aria-label="Destination" className="dest">
        {regions.map((r) => {
          const on = region === r.id;
          return (
            <button key={r.id} type="button" role="radio" aria-checked={on} disabled={!r.ready}
              className={cx("dest__card", on && "is-on")} onClick={() => setRegion(r.id)}>
              <MoonThumb cap={r.cap} />
              <span className="dest__text">
                <span className="dest__name">{r.name}</span>
                <span className="dest__sub">{r.sub}</span>
              </span>
              {r.ready ? (
                <span className={cx("dest__state", on && "is-on")}>{on ? <><Icon name="check" size={14} />Selected</> : "Select"}</span>
              ) : (
                <span className="dest__state dest__state--soon"><Icon name="clock" size={14} />Coming soon</span>
              )}
            </button>
          );
        })}
      </div>
    </SetupShell>
  );
}
