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
            Earth visibility on gentle ground near terrain where water ice could persist?
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
            <li>It samples landing times across the window at a step that depends on its length and keeps the best one per pixel.</li>
            <li>Score = 100 · Σ weight × factor / Σ weight. Factors include Sun and Earth visibility, slope, roughness, mean ground temperature and modelled ice proximity. Limits for slope, permanent shadow and night can exclude cells.</li>
            <li>Hotspots are connected groups of the top 3% of pixels, ranked by their best pixel.</li>
          </ol>
        </L.Panel>
        <L.Panel eyebrow="03" title="Data sources">
          <ul className="body-sm sources">
            <li><b>Terrain, slope, roughness:</b> LOLA LDEM_75S_240M, LDSM_75S_240M and LDRM_75S_240M, NASA PDS Geosciences Node.</li>
            <li><b>Permanent shadow, long-term Sun and Earth:</b> LOLA LPSR and AVGVISIB 120 m (Mazarico et al. 2011), NASA PDS.</li>
            <li><b>Temperature and ice stability:</b> LRO Diviner Polar Resource Product v2.0 (Paige et al. 2010), NASA PDS. A peer-reviewed thermal model fit to the first mapping year.</li>
            <li><b>Ice observations:</b> Lemelin et al. (2021) mapped permanently shadowed regions associated with M³ detections. The LCROSS marker uses NASA’s Centaur impact coordinates and the water detection reported by Colaprete et al. (2010).</li>
            <li><b>Sun and Earth:</b> NASA/JPL NAIF SPICE, DE440 ephemeris, MOON_ME frame, light time and aberration.</li>
            <li><b>Artemis III regions:</b> NASA (2024-10-28), approximate centres.</li>
            <li><b>Apollo landing sites (Whole Moon):</b> NASA NSSDCA, lunar module positions measured on LROC images.</li>
            <li><b>Checks:</b> JPL Horizons API and LOLA AVGVISIB (Sun and Earth).</li>
          </ul>
        </L.Panel>
        <L.Panel eyebrow="04" title="Can I trust these numbers?" actions={<L.FidelityBadge level={hz ? "validated" : "computed"}>{hz ? "Checked" : "Computed"}</L.FidelityBadge>}>
          <div className="readout-grid">
            <L.Readout label="Sun vs Horizons" value={hz ? arcmin(hz.sun) : "–"} unit="′ max" />
            <L.Readout label="Earth vs Horizons" value={hz ? arcmin(hz.earth) : "–"} unit="′ max" />
            <L.Readout label="Sunlight vs LOLA" value={avg ? avg.meanAbsDiffPct.toFixed(1) : "–"} unit="pts mean" approx />
            <L.Readout label="Earth view vs LOLA" value={v.avgearth ? v.avgearth.meanAbsDiffPct.toFixed(1) : "–"} unit="pts mean" approx />
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
            <li>The ice factor is distance to ground where a thermal model says ice would be stable within 0.5 m. It is where ice can survive, not measured ice.</li>
            <li>Diviner temperatures come from a ~0.5 km mesh built on Kaguya altimetry; it may sit a few hundred metres off the LOLA grid.</li>
            <li>Relief shading is a visual aid, not sunlight.</li>
          </ul>
        </L.Panel>
        <L.Panel eyebrow="06" title="Why no radiation or impact layer">
          <p className="body-sm lh-sec">
            NASA publishes no surface map of radiation dose or meteoroid impact risk per site at the south pole. With no
            atmosphere or magnetic field, the dose is almost the same everywhere; the terrain only blocks a small part of
            the sky. Hydrogen maps (LRO LEND) and UV frost maps (LRO LAMP) exist, but their reading as ice is indirect,
            so they are not scored.
          </p>
        </L.Panel>
      </div>
    </div>
  );
}
