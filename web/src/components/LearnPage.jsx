import { L } from "../ds.js";

// Learn/: cómo funciona, de dónde salen los datos y qué no dice la herramienta.

export default function LearnPage({ data }) {
  const v = data.validation || {};
  const hz = v.horizons?.maxArcmin;
  const avg = v.avgvisib;
  const arcmin = (x) => (x < 0.001 ? "< 0.001" : x.toFixed(4));
  return (
    <div className="learn lh-gridlines">
      <header className="learn__head">
        <p className="eyebrow lh-muted">04 — How it works</p>
        <h1 className="display-xl lh-slash learn__title">Learn</h1>
      </header>
      <div className="learn__cols">
        <L.Panel eyebrow="01" title="What the map answers">
          <p className="body-lg">
            For a landing window and a surface time, which 1 km spots near the lunar south pole give the most sunlight and
            Earth contact, on gentle ground, close to permanently shadowed regions where ice may be?
          </p>
          <p className="body lh-sec">
            At the pole the Sun stays within about 1.6° of the horizon and Earth within about 7°, so the surrounding terrain
            decides almost everything. Small changes in place or date change the answer.
          </p>
        </L.Panel>
        <L.Panel eyebrow="02" title="How the score works">
          <ol className="body steps">
            <li>Every 1 km pixel has a terrain horizon in 72 directions, ray-traced over NASA LOLA elevation.</li>
            <li>For each hour of the mission the app checks the Sun disk and Earth against that horizon.</li>
            <li>It tries every landing time in the window (every 3 h) and keeps the best one per pixel.</li>
            <li>Score = 100 · Σ weight × factor / Σ weight. Limits (slope, permanent shadow, night) remove pixels.</li>
            <li>Hotspots are connected groups of the top 3% of pixels, ranked by their best pixel.</li>
          </ol>
        </L.Panel>
        <L.Panel eyebrow="03" title="Data sources">
          <ul className="body-sm sources">
            <li><b>Terrain:</b> LOLA LDEM_75S_240M and LDSM_75S_240M, NASA PDS Geosciences Node.</li>
            <li><b>Permanent shadow and long-term light:</b> LOLA LPSR and AVGVISIB 120 m (Mazarico et al. 2011), NASA PDS.</li>
            <li><b>Sun and Earth:</b> NASA/JPL NAIF SPICE, DE440 ephemeris, MOON_ME frame, light time and aberration.</li>
            <li><b>Artemis III regions:</b> NASA (2024-10-28), approximate centres.</li>
            <li><b>Checks:</b> JPL Horizons API and LOLA AVGVISIB.</li>
          </ul>
        </L.Panel>
        <L.Panel eyebrow="04" title="Can I trust these numbers?" actions={<L.FidelityBadge level={hz ? "validated" : "computed"}>{hz ? "Checked" : "Computed"}</L.FidelityBadge>}>
          <div className="readout-grid">
            <L.Readout label="Sun vs Horizons" value={hz ? arcmin(hz.sun) : "–"} unit="′ max" />
            <L.Readout label="Earth vs Horizons" value={hz ? arcmin(hz.earth) : "–"} unit="′ max" />
            <L.Readout label="Sunlight vs LOLA" value={avg ? avg.meanAbsDiffPct.toFixed(1) : "–"} unit="pts mean" approx />
          </div>
          <p className="body-sm lh-sec">
            {avg ? avg.note : "Run the validation step of the pipeline to fill these numbers."}
          </p>
        </L.Panel>
        <L.Panel eyebrow="05" title="Limitations">
          <ul className="body-sm sources">
            <li>1 km pixels and 5° horizon bins: good to compare regions, not to certify a landing site.</li>
            <li>Terrain closer than 300 m is not resolved; boulders and small craters are not in the data.</li>
            <li>Sunlight is not the same as electrical power. Earth in view does not guarantee a working link.</li>
            <li>The ice factor is distance to permanent shadow, not measured ice.</li>
            <li>Relief shading is a visual aid, not sunlight.</li>
          </ul>
        </L.Panel>
      </div>
    </div>
  );
}
