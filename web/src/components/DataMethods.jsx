import { useEffect, useState } from "react";
import { L } from "../ds.js";
import { DEFAULT_LIMITS, FACTORS, PRESETS, ROUGH_MAX_M, TEMP_COLD_K, TEMP_MILD_K } from "../engine/score.js";
import { TEMP_BAND, WATER_FULL_WT_PCT } from "../engine/globalScore.js";

// "Data & methods": la parte detallada de How it works, plegada por defecto. Explica en
// lenguaje llano de dónde salen los datos, qué se calcula y cómo se ha comprobado.
// Umbrales y pesos se importan del motor (score.js, globalScore.js) y las cifras de
// validación se leen de los validation.json publicados, para que el texto no se desfase.

const BASE = `${import.meta.env.BASE_URL}data/`;

const PDS_LOLA = "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx";
const LINKS = {
  lolaPolar: `${PDS_LOLA}/data/lola_gdr/polar/img/`,
  lolaLight: `${PDS_LOLA}/extras/illumination/img/`,
  lolaGlobal: `${PDS_LOLA}/data/lola_gdr/cylindrical/img/`,
  lola118: "https://planetarymaps.usgs.gov/mosaic/Lunar_LRO_LOLA_Global_LDEM_118m_Mar2014.tif",
  prp: "https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/data_derived_prp/",
  gcp: "https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/data_derived_gcp/",
  prospector: "https://pds-geosciences.wustl.edu/missions/lunarp/reduced_special.html",
  naif: "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/",
  de440: "https://ssd.jpl.nasa.gov/planets/eph_export.html",
  horizons: "https://ssd.jpl.nasa.gov/horizons/",
  pgda78: "https://pgda.gsfc.nasa.gov/products/78",
  pgda90: "https://pgda.gsfc.nasa.gov/products/90",
  m3: "https://doi.org/10.1073/pnas.1802345115",
  lemelin: "https://doi.org/10.5281/zenodo.4646092",
  lcross: "https://doi.org/10.1126/science.1186986",
  hapke: "https://ntrs.nasa.gov/citations/19870013999",
};

const SECTIONS = [
  ["dm-sources", "Data"],
  ["dm-prep", "Preparation"],
  ["dm-sky", "Sun and Earth"],
  ["dm-score", "Score"],
  ["dm-moon", "Whole Moon & Astronaut"],
  ["dm-checks", "Checks"],
  ["dm-limits", "Limits"],
  ["dm-refs", "References"],
];

function A({ href, children }) {
  return <a className="lh-link" href={href} target="_blank" rel="noreferrer">{children}</a>;
}

/** Bloque plegable. */
function Item({ title, children }) {
  return (
    <details className="dm-item">
      <summary className="heading">{title}</summary>
      <div className="dm-item__body body-sm lh-sec">{children}</div>
    </details>
  );
}

function Table({ head, rows }) {
  return (
    <div className="dm-table-wrap">
      <table className="dm-table body-sm">
        <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

const fix = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "–");
const arcmin = (x) => (!Number.isFinite(x) ? "–" : x < 0.001 ? "< 0.001" : x.toFixed(4));

/** Lee los validation.json de los dos polos y el manifest global (son pequeños). */
function usePublishedChecks(enabled) {
  const [state, setState] = useState({ south: null, north: null, global: null });
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const get = (f) => fetch(BASE + f).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    Promise.all([get("validation.json"), get("north/validation.json"), get("global/manifest.json")])
      .then(([south, north, global]) => alive && setState({ south, north, global }));
    return () => { alive = false; };
  }, [enabled]);
  return state;
}

export default function DataMethods({ data }) {
  const [open, setOpen] = useState(false);
  const checks = usePublishedChecks(open);
  const ephem = data?.manifest?.ephem;
  const thermal = checks.global?.thermal;
  const label = Object.fromEntries(FACTORS.map((f) => [f.key, f.label]));
  const goTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  const valRow = (name, v) => [
    name,
    v?.horizons ? `${arcmin(v.horizons.maxArcmin.sun)}′ / ${arcmin(v.horizons.maxArcmin.earth)}′` : "not run yet",
    v?.avgvisib ? `${fix(v.avgvisib.meanAbsDiffPct)} pts` : "–",
    v?.avgearth ? `${fix(v.avgearth.meanAbsDiffPct)} pts` : "–",
  ];

  return (
    <section className={`dm${open ? " is-open" : ""}`} aria-labelledby="dm-title">
      <button type="button" className="dm__toggle" aria-expanded={open} aria-controls="dm-body" onClick={() => setOpen((v) => !v)}>
        <span className="dm__toggle-text">
          <span className="eyebrow lh-muted">Part II</span>
          <span id="dm-title" className="title">Data &amp; methods</span>
          <span className="body-sm lh-sec">Sources, calculations and checks, in detail.</span>
        </span>
        <span className="dm__toggle-icon" aria-hidden="true" />
      </button>

      {open && (
        <div id="dm-body" className="dm__body">
          <nav className="dm__index" aria-label="Data and methods sections">
            {SECTIONS.map(([id, name]) => (
              <button key={id} type="button" className="dm__chip body-sm" onClick={() => goTo(id)}>{name}</button>
            ))}
          </nav>

          <div className="dm__stack">
            {/* ---------------------------------------------------- Datos */}
            <L.Panel id="dm-sources" eyebrow="09" title="Where the data comes from">
              <p className="body-sm lh-sec">All official NASA data, from the <A href="https://pds-geosciences.wustl.edu/">PDS archive</A> and <A href={LINKS.naif}>NAIF</A>.</p>
              <Item title="Terrain: LOLA">
                <p>LOLA is the laser altimeter on NASA's Lunar Reconnaissance Orbiter (LRO). It gives height, slope and roughness.</p>
                <ul className="sources">
                  <li><b>Poles:</b> one value every 240 m, from 75° to 90°. <A href={LINKS.lolaPolar}>PDS</A></li>
                  <li><b>Permanent shadow and long-term light:</b> 120 m, calculated by the LOLA team over 18.6 years (Mazarico et al. 2011). <A href={LINKS.lolaLight}>PDS</A></li>
                  <li><b>Whole Moon:</b> height about every 470 m, roughness about every 1.9 km. <A href={LINKS.lolaGlobal}>PDS</A></li>
                  <li><b>Whole-Moon slope:</b> calculated by us from the LOLA 118 m mosaic, over about 1 km. <A href={LINKS.lola118}>USGS</A></li>
                </ul>
              </Item>
              <Item title="Temperature and ice: Diviner">
                <p>Diviner is the LRO instrument that measures the heat of the ground.</p>
                <ul className="sources">
                  <li><b>Poles:</b> Polar Resource Product v2.0 (Paige et al. 2010). A thermal model built on Diviner data, in cells of about 0.5 km: yearly average temperature and the depth where ice would stay frozen. <A href={LINKS.prp}>PDS</A></li>
                  <li><b>Whole Moon:</b> Global Cumulative Products (Williams et al. 2017). Measured temperature, 2009–2015, for every hour of the lunar day.{thermal ? ` About ${fix(thermal.gapsFilledPct, 0)} % of the values are gaps we filled in.` : ""} <A href={LINKS.gcp}>PDS</A></li>
                </ul>
                <p>The north polar table is published with mirrored longitudes. We correct it, and the pipeline checks it against the LOLA terrain every time it runs.</p>
              </Item>
              <Item title="Water: Lunar Prospector">
                <p>Hydrogen measured from orbit, used for the whole-Moon water factor. Each measurement covers 60 to 150 km, so small icy craters look diluted. <A href={LINKS.prospector}>PDS</A></p>
              </Item>
              <Item title="Sun and Earth positions: SPICE and DE440">
                <p>The JPL tools and tables of where the Sun, the Earth and the Moon are (Park et al. 2021). We save one position of each every hour{ephem ? `, ${ephem.count.toLocaleString("en-US")} hours from ${ephem.startUtc.slice(0, 4)} to the end of 2030` : ", 2026 to 2030"}, in the same Moon frame as LOLA, as a real observer would see them. <A href={LINKS.naif}>NAIF</A> · <A href={LINKS.de440}>DE440</A></p>
              </Item>
              <Item title="Places and other data">
                <ul className="sources">
                  <li><b>Artemis III:</b> NASA's candidate regions (28 Oct 2024), approximate centres.</li>
                  <li><b>North Pole craters:</b> IAU names, checked against the terrain. Landmarks, not landing sites.</li>
                  <li><b>Apollo:</b> the six landings, from NASA NSSDCA.</li>
                  <li><b>Ice seen from orbit</b> (South Pole, shown but not scored): <A href={LINKS.m3}>M³</A>, <A href={LINKS.lemelin}>Lemelin et al. 2021</A>, <A href={LINKS.lcross}>LCROSS</A>.</li>
                  <li><b>Detailed terrain</b> for Astronaut Mode: <A href={LINKS.pgda78}>LOLA 5 m maps</A>.</li>
                </ul>
              </Item>
            </L.Panel>

            {/* ---------------------------------------------------- Preparación */}
            <L.Panel id="dm-prep" eyebrow="10" title="How the data is prepared">
              <p className="body-sm lh-sec">A Python program prepares everything once. Then your browser does the rest; there is no server.</p>
              <Item title="The grids">
                <Table head={["Map", "Cell", "Area"]} rows={[
                  ["South / North Pole", "1 km", "400 km square around the pole"],
                  ["Whole Moon", "0.5° (about 15 km)", "everything"],
                ]} />
                <p>A 1 km cell summarises the finer NASA values inside it: the median for slope and roughness, the average for temperature, the share in permanent shadow, and the distance to shadow and to ice.</p>
              </Item>
              <Item title="Terrain horizons">
                <p>The horizon is how high the terrain rises around a place. From each cell, 2 m above the ground, we look in 72 directions (every 5°) up to 300 km away and keep the highest angle, including the curvature of the Moon.</p>
                <p>On the whole Moon, above 60° of latitude, each cell has four horizons instead of one, because there the low Sun depends on small relief.</p>
              </Item>
            </L.Panel>

            {/* ---------------------------------------------------- Sol y Tierra */}
            <L.Panel id="dm-sky" eyebrow="11" title="Sunlight, Earth view and dates">
              <Item title="Is the Sun or the Earth visible?">
                <p>For each cell and each hour, the app compares where the Sun and the Earth are in that sky with the horizon in that direction.</p>
                <ul className="sources">
                  <li><b>Sun:</b> by default it counts as soon as any part of the disc is above the terrain (LOLA's rule). You can ask for the centre or the whole disc.</li>
                  <li><b>Earth:</b> by default its centre must be above the terrain. This is line of sight only, not a radio link.</li>
                </ul>
                <p>Mission numbers: the share of hours with Sun, the share with Earth, and the longest night (hours in a row with less than 5 % of the Sun visible).</p>
              </Item>
              <Item title="Best landing dates">
                <p>The app tries every landing hour in your search range and keeps, for each cell, the one with the best mix of Sun and Earth. Each place can have a different best date. A <b>landing window</b> is a run of landing hours within 95 % of the best.</p>
                <p>Stays from 1 day to 2 years. The whole-Moon map uses a fixed date.</p>
              </Item>
            </L.Panel>

            {/* ---------------------------------------------------- Puntuación */}
            <L.Panel id="dm-score" eyebrow="12" title="The score">
              <pre className="dm-eq">{"score = 100 × (sum of weight × factor) ÷ (sum of weights)"}</pre>
              <Item title="Each factor, from 0 to 1">
                <Table head={["Factor", "Poles", "Whole Moon"]} rows={[
                  [`${label.sun} / ${label.earth}`, "share of the stay in view", "the same"],
                  [label.slope, `1 when flat, 0 at your maximum (default ${DEFAULT_LIMITS.maxSlopeDeg}°)`, "the same, average slope"],
                  [label.rough, `1 when smooth, 0 at ${ROUGH_MAX_M} m`, "the same"],
                  ["Temperature", `0 at ${TEMP_COLD_K} K, 1 at ${TEMP_MILD_K} K (yearly average)`, `hour by hour: 1 between ${TEMP_BAND.mildK} and ${TEMP_BAND.hotOkK} K, 0 below ${TEMP_BAND.coldK} K or above ${TEMP_BAND.hotMaxK} K`],
                  ["Ice / water", `1 next to ice, 0 at ${DEFAULT_LIMITS.iceReachKm} km`, `1 at ${WATER_FULL_WT_PCT} % water or more`],
                ]} />
                <p className="caption lh-muted">K = kelvin. {TEMP_COLD_K} K is −223 °C; {TEMP_MILD_K} K is −23 °C.</p>
              </Item>
              <Item title="Profiles">
                <Table head={["Profile", ...FACTORS.map((f) => f.label)]} rows={Object.entries(PRESETS).map(([name, w]) => [name, ...FACTORS.map((f) => w[f.key])])} />
              </Item>
              <Item title="Limits and hotspots">
                <p><b>Removed from the map:</b> too steep, mostly in permanent shadow, a night longer than the battery (optional), too little Earth contact (optional), or missing data.</p>
                <p><b>Hotspots:</b> at the poles, groups of the best 3 % of cells; on the whole Moon, the 10 best cells at least 5° apart.</p>
              </Item>
            </L.Panel>

            {/* ---------------------------------------------------- Luna entera y astronauta */}
            <L.Panel id="dm-moon" eyebrow="13" title="Whole Moon and Astronaut Mode">
              <Item title="Whole Moon">
                <p>The same calculation on 0.5° cells. The temperature changes with the hour: the app reads the Diviner temperature of each cell at its local time. One cell averages about 15 km of ground, so scores are lower than at the poles.</p>
              </Item>
              <Item title="Astronaut Mode">
                <p>One square kilometre at real scale. The hills are real: 5 m detail at two South Pole sites, 240 m at the poles, about 1.9 km elsewhere. Small craters, rocks and gravel are <b>generated</b>: plausible, not measured.</p>
                <p>The Sun and the Earth are at their real position and size. Gravity is 1.62 m/s². The light on the ground follows a lunar soil model (<A href={LINKS.hapke}>Helfenstein &amp; Veverka 1987</A>).</p>
              </Item>
            </L.Panel>

            {/* ---------------------------------------------------- Comprobaciones */}
            <L.Panel id="dm-checks" eyebrow="14" title="How we checked it">
              <Table head={["Map", "Positions vs JPL (Sun / Earth)", "Sunlight vs LOLA", "Earth view vs LOLA"]} rows={[
                valRow("South Pole", checks.south),
                valRow("North Pole", checks.north),
              ]} />
              <p className="caption lh-muted">′ = 1/60 of a degree. pts = average difference in percentage points of time.</p>
              <Item title="What these checks mean">
                <ul className="sources">
                  <li><b>Positions:</b> our Sun and Earth directions against NASA's <A href={LINKS.horizons}>JPL Horizons</A> at three South Pole places. Checks the geometry, not the terrain.</li>
                  <li><b>Sunlight and Earth view:</b> 2,000 random cells against LOLA's own 18.6-year maps. Some difference is expected: our period is shorter (2026–2030) and our terrain coarser (1 km against 120 m).</li>
                  <li><b>Whole Moon:</b> compared with the 1 km calculation; 1 to 2 points of difference below 60°, up to about 4 near the poles.</li>
                  <li><b>Automatic stops:</b> the pipeline stops if a download is incomplete, the Diviner table does not match the terrain, or the global terrain looks rotated.</li>
                </ul>
              </Item>
            </L.Panel>

            {/* ---------------------------------------------------- Límites */}
            <L.Panel id="dm-limits" eyebrow="15" title="What is measured and what is not">
              <Table head={["", "What it is"]} rows={[
                ["Terrain, whole-Moon temperature, hydrogen", "Measured"],
                ["Permanent shadow, polar temperature, ice", "Models from NASA teams"],
                ["Sunlight and Earth view of your mission", "Calculated by us"],
                ["Small craters and rocks in Astronaut Mode", "Generated"],
              ]} />
              <Item title="Main limits">
                <ul className="sources">
                  <li>It compares regions; it does not certify a landing site.</li>
                  <li>Terrain closer than 300 m, boulders and small craters are not in the data.</li>
                  <li>Sunlight is not electricity, and Earth in view is not a radio link.</li>
                  <li>Polar “ice” is where ice could survive, not ice that has been detected.</li>
                </ul>
              </Item>
            </L.Panel>

            {/* ---------------------------------------------------- Referencias */}
            <L.Panel id="dm-refs" eyebrow="16" title="References">
              <ul className="body-sm sources dm-refs">
                <li>Smith et al. (2010), LOLA data, NASA PDS. <A href={LINKS.lolaPolar}>Link</A></li>
                <li>Mazarico et al. (2011), Icarus 211. <A href={LINKS.lolaLight}>Link</A></li>
                <li>Paige et al. (2010), Science 330. <A href={LINKS.prp}>Link</A></li>
                <li>Williams et al. (2017), Icarus 283. <A href={LINKS.gcp}>Link</A></li>
                <li>Feldman et al. (2001), JGR 106 · Lawrence et al. (2006), JGR 111. <A href={LINKS.prospector}>Link</A></li>
                <li>Park et al. (2021), AJ 161:105 (DE440). <A href={LINKS.naif}>Link</A></li>
                <li>Li et al. (2018), PNAS · Lemelin et al. (2021) · Colaprete et al. (2010), Science. <A href={LINKS.m3}>Link</A></li>
                <li>NASA PGDA, LOLA 5 m and 10 m maps. <A href={LINKS.pgda78}>78</A> · <A href={LINKS.pgda90}>90</A></li>
              </ul>
            </L.Panel>
          </div>
        </div>
      )}
    </section>
  );
}
