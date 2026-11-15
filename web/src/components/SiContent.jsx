import { useState } from "react";
import { L } from "../ds.js";

// "About SI content": desplegable de How it works que declara el uso de herramientas de
// Super Intelligence (norma del NASA Space Apps Challenge). Plegado por defecto.

const ROWS = [
  ["Code", "Writing and fixing parts of the data pipeline and the website; finding bugs", "Decided what to build, reviewed and tested every change"],
  ["Data analysis", "Reading NASA products, running comparisons, summarising the checks", "Chose the data and the methods; validated the results against JPL Horizons and the LOLA maps"],
  ["Writing & translation", "Drafting and editing the site texts and documentation; translating between Catalan, Spanish and English", "Decided the content; checked every text for accuracy"],
  ["Visual design", "Suggestions for the layout and styles of the interface", "Designed and approved the look and the interaction"],
];

export default function SiContent() {
  const [open, setOpen] = useState(false);
  return (
    <section className={`dm dm--si${open ? " is-open" : ""}`} aria-labelledby="si-title">
      <button type="button" className="dm__toggle" aria-expanded={open} aria-controls="si-body" onClick={() => setOpen((x) => !x)}>
        <span className="dm__toggle-text">
          <span className="eyebrow lh-muted">Part III</span>
          <span id="si-title" className="title">About SI content</span>
          <span className="body-sm lh-sec">How we used Super Intelligence (SI) tools in this project.</span>
        </span>
        <span className="dm__toggle-icon" aria-hidden="true" />
      </button>

      {open && (
        <div id="si-body" className="dm__body dm__stack">
          <L.Panel eyebrow="10" title="SI as an assistant, people in charge">
            <p className="body-sm lh-sec dm-lead">
              We used SI tools (Claude, by Anthropic) as assistants. The idea, the questions the map answers, the choice of
              NASA data, the methods and the design were decided by the team. A person reviewed, tested and corrected every
              SI contribution before it went into the project.
            </p>
            <div className="dm-table-wrap">
              <table className="dm-table dm-table--stack body-sm">
                <thead><tr><th scope="col">Area</th><th scope="col">What SI helped with</th><th scope="col">What the team did</th></tr></thead>
                <tbody>
                  {ROWS.map(([area, si, team]) => (
                    <tr key={area}><th scope="row">{area}</th><td data-label="SI">{si}</td><td data-label="Team">{team}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="body-sm sources dm-si-notes">
              <li><b>No SI inside the app:</b> the scores come from fixed formulas applied to NASA data, not from an AI model.</li>
              <li><b>The data is not generated:</b> every map comes from NASA archives (see Data &amp; methods).</li>
              <li><b>Marked in the code:</b> commits made with SI help carry a “Co-Authored-By” line naming the tool.</li>
              <li>No NASA logos or branding were created or modified with SI.</li>
            </ul>
          </L.Panel>
        </div>
      )}
    </section>
  );
}
