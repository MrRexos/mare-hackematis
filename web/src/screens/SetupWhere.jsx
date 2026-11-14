// 01 Mission setup — Destination: dónde es la expedición (polo sur, Luna entera, polo norte).
// De momento solo el polo sur tiene datos; las otras zonas se muestran como "Coming soon".

import { Icon, cx } from "../ui/kit.jsx";
import { SetupFrame } from "./SetupWhen.jsx";

export const REGIONS = [
  { id: "south", idx: "01", title: "South\nPole", sub: "8 Artemis III regions · 1 km grid · hour by hour", ready: true },
  { id: "moon", idx: "02", title: "Whole\nMoon", sub: "Monthly averages for every site on the Moon", ready: false },
  { id: "north", idx: "03", title: "North\nPole", sub: "Same detail as the south pole, for the north", ready: false },
];

export default function SetupWhere({ region, setRegion, go, openSettings, openLearn }) {
  return (
    <SetupFrame step="where" title={<>Choose<br />your<br />destination</>} go={go} openSettings={openSettings} openLearn={openLearn}
      onNext={() => go("when")} nextLabel="dates">
      <div role="radiogroup" aria-label="Destination" className="when__cols">
        {REGIONS.map((r) => {
          const on = region === r.id;
          return (
            <div key={r.id} className={cx("when__col", !r.ready && "is-soon")}>
              <span className="when__idx">{r.idx}</span>
              <button type="button" role="radio" aria-checked={on} aria-disabled={!r.ready || undefined} disabled={!r.ready}
                className={cx("when__opt", on && "is-on")} onClick={() => setRegion(r.id)}>{r.title}</button>
              <span className="when__sub">{r.sub}</span>
              {r.ready ? (
                <button type="button" className={cx("when__act", on && "is-on")} onClick={() => setRegion(r.id)}>{on ? "Selected" : "Select"}</button>
              ) : (
                <span className="when__soon"><Icon name="clock" size={12} />Coming soon</span>
              )}
            </div>
          );
        })}
      </div>
    </SetupFrame>
  );
}
