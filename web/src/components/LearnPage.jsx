import { L } from "../ds.js";

// How it works/: cómo funciona, de dónde salen los datos y qué no dice la herramienta.

export default function LearnPage({ data }) {
  const v = data.validation || {};
  const hz = v.horizons?.maxArcmin;
  const avg = v.avgvisib;
  const arcmin = (x) => (x < 0.001 ? "< 0.001" : x.toFixed(4));
  return (
    <div className="learn lh-gridlines">
      <header className="learn__head">
        <p className="eyebrow lh-muted">Mare Hackematis</p>
        <h1 className="display-xl lh-slash learn__title">How it works</h1>
      </header>
      <div className="learn__cols">
        <L.Panel eyebrow="01" title="What the map answers">
          <p className="body-lg">
            For a landing date and a time on the surface, where on the Moon do you get the most sunlight and Earth
            contact, on ground gentle enough to land on, at workable temperatures and near water?
          </p>
          <p className="body lh-sec">
            There are two maps. <b>South Pole</b> covers 83.5° to 90°S in 1 km cells and can also search a whole window
            for the best landing dates. <b>Whole Moon</b> covers everything in 0.5° cells, about 15 km at the equator,
            for fixed dates. Each has a 2D map and a 3D view.
          </p>
        </L.Panel>
        <L.Panel eyebrow="02" title="How the score works">
          <ol className="body steps">
            <li>Every cell has a terrain horizon in 72 directions, ray-traced over NASA LOLA elevation out to 300 km. Above 60° latitude the whole-Moon map uses four horizons per cell, because there the Sun grazes the ground.</li>
            <li>For each hour of the mission the app checks the Sun disk and the Earth against that horizon. It runs in your browser, in a few seconds.</li>
            <li>Score = 100 · Σ weight × factor / Σ weight, with six factors: Sun, Earth, slope, roughness, temperature and water. You choose the weights with a profile or by hand.</li>
            <li>Limits remove cells from the map: maximum slope, permanent shadow, a night longer than the battery lasts, or too little Earth contact.</li>
            <li>Hotspots are the best places left. At the South Pole they are connected groups of the top 3% of cells; on the whole Moon, the best cells at least 5° apart.</li>
          </ol>
        </L.Panel>
        <L.Panel eyebrow="03" title="Why the two maps score differently">
          <ul className="body-sm sources">
            <li><b>Cell size:</b> the South Pole picks the best single kilometre, such as a sunlit ridge. A whole-Moon cell averages that ridge with the craters around it, so its best scores come out lower.</li>
            <li><b>Temperature:</b> at the South Pole it is the annual mean just below the surface, a fixed value. On the whole Moon it is the surface temperature hour by hour during the mission, and both cold nights and hot noons count against a cell.</li>
            <li><b>Water:</b> at the South Pole it is the distance to ground where ice could stay stable. On the whole Moon it is hydrogen measured from orbit, which only shows a signal above 70° latitude.</li>
          </ul>
          <p className="body-sm lh-sec">A 70 at the South Pole and a 60 on the whole Moon are not the same place measured twice.</p>
        </L.Panel>
        <L.Panel eyebrow="04" title="Mare and Astronaut Mode">
          <p className="body-sm lh-sec">
            <b>Mare</b> is the sheet of one place: its score factor by factor, the sky hour by hour, the days with Sun and
            Earth, and the ground data. <b>Compare</b> puts up to four places side by side.
          </p>
          <p className="body-sm lh-sec">
            At the South Pole, <b>Astronaut Mode</b> lets you walk one square kilometre around the place at real scale,
            with the Sun and the Earth where they would be at that hour. The hills come from the NASA elevation model.
            Craters smaller than the model can show, rocks and gravel are generated with lunar statistics: plausible, not
            measured.
          </p>
        </L.Panel>
        <L.Panel eyebrow="05" title="Data sources">
          <ul className="body-sm sources">
            <li><b>Terrain, slope, roughness, permanent shadow:</b> NASA LOLA, PDS Geosciences Node. Polar products at 120 to 240 m for the South Pole; LDEM_64, LDRM_16 and LPSR for the whole Moon.</li>
            <li><b>Sun and Earth:</b> NASA/JPL NAIF SPICE, DE440 ephemeris, MOON_ME frame, light time and aberration.</li>
            <li><b>Temperature:</b> LRO Diviner. South Pole: Polar Resource Product v2.0 (Paige et al. 2010), a thermal model. Whole Moon: Global Cumulative Products (Williams et al. 2017), measured by local time.</li>
            <li><b>Water:</b> Diviner ice stability depth at the South Pole; Lunar Prospector hydrogen on the whole Moon.</li>
            <li><b>Ice observations:</b> Lemelin et al. (2021) for shadowed regions with M³ detections; LCROSS impact from NASA and Colaprete et al. (2010).</li>
            <li><b>Imagery:</b> LROC WAC global mosaic (NASA/GSFC/ASU) on the 3D globe; NASA Blue Marble for the Earth in Astronaut Mode.</li>
            <li><b>Artemis III regions:</b> NASA (2024-10-28), approximate centres.</li>
            <li><b>Apollo landing sites:</b> NASA NSSDCA, lunar module positions measured on LROC images. References on the whole-Moon map.</li>
          </ul>
        </L.Panel>
        <L.Panel eyebrow="06" title="Can I trust these numbers?" actions={<L.FidelityBadge level={hz ? "validated" : "computed"}>{hz ? "Checked" : "Computed"}</L.FidelityBadge>}>
          <div className="readout-grid">
            <L.Readout label="Sun vs Horizons" value={hz ? arcmin(hz.sun) : "–"} unit="′ max" />
            <L.Readout label="Earth vs Horizons" value={hz ? arcmin(hz.earth) : "–"} unit="′ max" />
            <L.Readout label="Sunlight vs LOLA" value={avg ? avg.meanAbsDiffPct.toFixed(1) : "–"} unit="pts mean" approx />
            <L.Readout label="Earth view vs LOLA" value={v.avgearth ? v.avgearth.meanAbsDiffPct.toFixed(1) : "–"} unit="pts mean" approx />
          </div>
          <p className="body-sm lh-sec">
            {avg ? avg.note : "Run the validation step of the pipeline to fill these numbers."}
          </p>
          <p className="body-sm lh-sec">
            These checks are for the South Pole. The whole-Moon sunlight was compared with a 1 km reference: for a single
            day it is off by between 1 and 4.5 points depending on the latitude, most near the poles.
          </p>
        </L.Panel>
        <L.Panel eyebrow="07" title="Limitations">
          <ul className="body-sm sources">
            <li>Cells of 1 km or 15 km and 5° horizon bins: good to compare regions, not to certify a landing site.</li>
            <li>A whole-Moon cell has one value for 15 km of ground; a good spot inside a poor cell does not show.</li>
            <li>Terrain closer than 300 m is not resolved; boulders and small craters are not in the data.</li>
            <li>Sunlight is not the same as electrical power. Earth in view does not guarantee a working link.</li>
            <li>The South Pole water factor is distance to ground where a thermal model says ice would be stable within 0.5 m: where ice can survive, not measured ice. The whole-Moon hydrogen has a footprint of 60 to 150 km.</li>
            <li>Diviner temperatures come from a ~0.5 km mesh built on Kaguya altimetry; it may sit a few hundred metres off the LOLA grid.</li>
            <li>Relief shading is a visual aid, not sunlight.</li>
          </ul>
        </L.Panel>
        <L.Panel eyebrow="08" title="Why no radiation or impact layer">
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
