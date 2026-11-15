import { useEffect, useRef, useState } from "react";
import { L } from "../ds.js";
import { DEFAULT_LIMITS, FACTORS, PRESETS, ROUGH_MAX_M, TEMP_COLD_K, TEMP_MILD_K } from "../engine/score.js";
import { TEMP_BAND, WATER_FULL_WT_PCT } from "../engine/globalScore.js";

// "Data & methods": la parte larga de How it works. Explica, en lenguaje llano, de dónde
// salen los datos, qué hace el pipeline, qué calcula la web y cómo se ha comprobado.
// Los umbrales y pesos se importan del motor (score.js, globalScore.js) y las cifras de
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
  lcrossSite: "https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_artifact_impacts.html",
  hapke: "https://ntrs.nasa.gov/citations/19870013999",
};

const SECTIONS = [
  ["dm-sources", "Where the data comes from"],
  ["dm-prep", "How the data is prepared"],
  ["dm-sky", "Sunlight and Earth view"],
  ["dm-mission", "Mission dates"],
  ["dm-score", "The score"],
  ["dm-moon", "Whole Moon and Astronaut Mode"],
  ["dm-checks", "How we checked it"],
  ["dm-limits", "Measured, modelled or generated"],
  ["dm-refs", "References"],
];

function A({ href, children }) {
  return <a className="lh-link" href={href} target="_blank" rel="noreferrer">{children}</a>;
}

/** Bloque plegable: una pregunta o un producto. */
function Item({ title, children, open }) {
  return (
    <details className="dm-item" open={open}>
      <summary className="heading">{title}</summary>
      <div className="dm-item__body body-sm lh-sec">{children}</div>
    </details>
  );
}

/** Ficha corta de un producto: pares etiqueta / texto. */
function Facts({ rows }) {
  return (
    <dl className="dm-facts">
      {rows.map(([k, v]) => (
        <div key={k} className="dm-facts__row"><dt className="label lh-muted">{k}</dt><dd>{v}</dd></div>
      ))}
    </dl>
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

const Eq = ({ children }) => <pre className="dm-eq">{children}</pre>;

const fix = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "–");
const arcmin = (x) => (!Number.isFinite(x) ? "–" : x < 0.001 ? "< 0.001" : x.toFixed(4));

/** Lee los validation.json de los dos polos y el manifest global (son pequeños). */
function usePublishedChecks() {
  const [state, setState] = useState({ south: null, north: null, global: null });
  useEffect(() => {
    let alive = true;
    const get = (f) => fetch(BASE + f).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    Promise.all([get("validation.json"), get("north/validation.json"), get("global/manifest.json")])
      .then(([south, north, global]) => alive && setState({ south, north, global }));
    return () => { alive = false; };
  }, []);
  return state;
}

export default function DataMethods({ data }) {
  const root = useRef(null);
  const checks = usePublishedChecks();
  const ephem = data?.manifest?.ephem;
  const thermal = checks.global?.thermal;
  const label = Object.fromEntries(FACTORS.map((f) => [f.key, f.label]));

  const setAll = (open) => root.current?.querySelectorAll("details.dm-item").forEach((d) => { d.open = open; });
  const goTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  const valRow = (name, v, note) => [
    name,
    v?.horizons ? `${arcmin(v.horizons.maxArcmin.sun)}′` : "not run",
    v?.horizons ? `${arcmin(v.horizons.maxArcmin.earth)}′` : "not run",
    v?.avgvisib ? `${fix(v.avgvisib.meanAbsDiffPct)} pts (90 % within ${fix(v.avgvisib.p90AbsDiffPct)})` : "–",
    v?.avgearth ? `${fix(v.avgearth.meanAbsDiffPct)} pts (90 % within ${fix(v.avgearth.p90AbsDiffPct)})` : "–",
    note,
  ];

  return (
    <section className="dm" ref={root} aria-labelledby="dm-title">
      <header className="dm__head">
        <p className="eyebrow lh-muted">Part II</p>
        <h2 id="dm-title" className="title-lg">Data &amp; methods</h2>
        <p className="body lh-sec dm__intro">
          The full detail, for anyone who wants to check the work: which NASA data goes in, what we do to it, what the
          browser calculates and how we tested it. The numbers come from the code and the data files of this site. When
          we have not checked something, we say so. Open any line to read more.
        </p>
        <nav className="dm__index" aria-label="Data and methods sections">
          {SECTIONS.map(([id, name], k) => (
            <button key={id} type="button" className="dm__chip body-sm" onClick={() => goTo(id)}>
              <span className="lh-muted">{String(k + 9).padStart(2, "0")}</span> {name}
            </button>
          ))}
        </nav>
        <div className="dm__tools">
          <L.Button variant="ghost" size="sm" onClick={() => setAll(true)}>Expand all</L.Button>
          <L.Button variant="ghost" size="sm" onClick={() => setAll(false)}>Collapse all</L.Button>
        </div>
      </header>

      <div className="dm__stack">
        {/* ------------------------------------------------------------ 09 */}
        <L.Panel id="dm-sources" eyebrow="09 · Data" title="Where the data comes from">
          <p className="body-sm lh-sec">
            Everything is official NASA data, downloaded once from the{" "}
            <A href="https://pds-geosciences.wustl.edu/">PDS Geosciences Node</A> (the NASA archive for planetary
            surface data) and from <A href={LINKS.naif}>NAIF</A> (the NASA/JPL archive for spacecraft and planet
            positions). The download script checks that each file has the expected size before using it.
          </p>
          <Item title="Terrain at the poles: LOLA height, slope and roughness">
            <p>LOLA is the laser altimeter on NASA's Lunar Reconnaissance Orbiter (LRO). It measured the height of the ground along its orbits, and the LOLA team turned those measurements into maps.</p>
            <Facts rows={[
              ["Products", "LDEM_75S_240M and LDEM_75N_240M (height), LDSM (slope), LDRM (roughness). S = south, N = north."],
              ["Coverage", "75° to 90° of latitude at each pole, one value every 240 m."],
              ["Map type", "Polar stereographic: a flat map centred on the pole, on a sphere of radius 1,737.4 km."],
              ["Archive", <A key="a" href={LINKS.lolaPolar}>PDS · LOLA polar maps</A>],
              ["What we use it for", "Height of each 1 km cell, the terrain horizon, slope and roughness."],
            ]} />
          </Item>
          <Item title="Shadow and long-term light at the poles: LOLA LPSR and AVGVISIB">
            <p>The LOLA team also calculated, from the same terrain, which places never see the Sun and how often each place sees the Sun and the Earth over 18.6 years (Mazarico et al. 2011).</p>
            <Facts rows={[
              ["Products", "LPSR (permanently shadowed regions) and AVGVISIB (average visibility of the Sun, and of the Earth)."],
              ["Coverage", "75° to 90° at each pole, one value every 120 m."],
              ["Archive", <A key="a" href={LINKS.lolaLight}>PDS · LOLA illumination</A>],
              ["What we use it for", "LPSR: which cells are in permanent shadow, and how far each cell is from the nearest one. AVGVISIB: the map shown before you run a mission, and an independent answer to compare ours with."],
            ]} />
          </Item>
          <Item title="Terrain of the whole Moon: LOLA global maps">
            <Facts rows={[
              ["LDEM_64", "Height of the whole Moon, 64 values per degree (about 470 m at the equator). Used for the whole-Moon horizons, the 3D globe and Astronaut Mode outside the poles."],
              ["LDRM_16", "Roughness of the whole Moon, 16 values per degree (about 1.9 km)."],
              ["LPSR_65N / 65S", "Permanent shadow from 65° to 90° at both poles, 240 m."],
              ["Slope", "Calculated by our team from the LOLA global height mosaic at 118 m (USGS), over a distance of about 1 km. "],
              ["Archive", <span key="a"><A href={LINKS.lolaGlobal}>PDS · LOLA global maps</A> · <A href={LINKS.lola118}>USGS 118 m mosaic (large file)</A></span>],
            ]} />
          </Item>
          <Item title="Temperature and ice at the poles: Diviner Polar Resource Product">
            <p>Diviner is the LRO instrument that measures the heat the ground gives off. This product (Paige et al. 2010) uses those measurements with a thermal model to describe the whole year at each place.</p>
            <Facts rows={[
              ["Product", "LRO Diviner Polar Resource Product, version 2.0. One table per pole."],
              ["Coverage", "80° to 90°, in small triangles about 0.5 km across."],
              ["Values used", "Average temperature over the year, 2 cm below the surface. Highest surface temperature of the year. Depth at which water ice would stay frozen for billions of years."],
              ["Archive", <A key="a" href={LINKS.prp}>PDS · Diviner PRP</A>],
            ]} />
            <p>We found a problem in the north table as it is published: its longitudes are mirrored (real longitude = 180° − listed longitude). We noticed because the heights in the table did not match the LOLA terrain; after the correction they match almost perfectly. The pipeline repeats this check every time it runs and stops if the match is lost.</p>
          </Item>
          <Item title="Temperature of the whole Moon: Diviner Global Cumulative Products">
            <p>Here the temperature is measured, not modelled: the average of everything Diviner saw from 2009 to 2015 (Williams et al. 2017).</p>
            <Facts rows={[
              ["Product", "LRO Diviner Global Cumulative Products, version 1.0."],
              ["Detail", "Cells of 0.5°, sorted by local time (the hour of the lunar day at that place)."],
              ["Archive", <A key="a" href={LINKS.gcp}>PDS · Diviner GCP</A>],
              ["Gaps", thermal ? `${fix(thermal.measuredQuarterHourBinsPct)} % of the original cells-and-hours were observed. We fill the missing hours from the shape of the day at the same latitude; ${fix(thermal.gapsFilledPct)} % of the values used by the site are filled in this way.` : "Missing hours are filled from the shape of the day at the same latitude."],
            ]} />
          </Item>
          <Item title="Hydrogen of the whole Moon: Lunar Prospector">
            <p>The Lunar Prospector spacecraft counted neutrons coming from the ground. Fewer neutrons mean more hydrogen, which near the poles can be water ice.</p>
            <Facts rows={[
              ["Product", "Lunar Prospector GRS/NS special products, cells of 0.5°."],
              ["Real detail", "Each measurement sees a patch 60 to 150 km wide, so small icy craters are blurred."],
              ["Archive", <A key="a" href={LINKS.prospector}>PDS · Lunar Prospector</A>],
              ["What we use it for", "The water factor of the whole-Moon map (see 13)."],
            ]} />
          </Item>
          <Item title="Positions of the Sun and the Earth: SPICE and DE440">
            <p>SPICE is the NASA/JPL toolkit for positions and orientations in space. DE440 is a JPL ephemeris: the table of where the planets and the Moon are (Park et al. 2021).</p>
            <Facts rows={[
              ["Files", "de440s.bsp (positions), moon_pa_de440_200625.bpc and moon_de440_250416.tf (orientation of the Moon), naif0012.tls (leap seconds), pck00011.tpc."],
              ["Frame", "MOON_ME, the same Moon-fixed frame as the LOLA maps."],
              ["Correction", "LT+S: we use where the Sun and the Earth appear to be, after light travel time and aberration, like a real observer would see them."],
              ["Our file", ephem ? `One position of the Sun and one of the Earth every hour, from ${ephem.startUtc.slice(0, 10)}: ${ephem.count.toLocaleString("en-US")} hours, to the end of 2030.` : "One position of the Sun and one of the Earth every hour, 2026 to 2030."],
              ["Archive", <span key="a"><A href={LINKS.naif}>NAIF generic kernels</A> · <A href={LINKS.de440}>JPL DE440</A></span>],
            ]} />
          </Item>
          <Item title="Reference places, imagery and ice observations">
            <ul className="sources">
              <li><b>Artemis III regions:</b> NASA announced nine candidate regions of about 15 × 15 km on 28 October 2024. We show approximate centres for eight of them; we have no reliable centre for Slater Plain.</li>
              <li><b>North Pole craters:</b> names and centres from the IAU nomenclature. We kept only the craters that are clearly visible in the LOLA terrain where the list puts them. They are landmarks, not proposed landing sites.</li>
              <li><b>Apollo:</b> the six crewed landings, with lunar module positions measured on LRO images (NASA NSSDCA).</li>
              <li><b>Ice seen from orbit (South Pole):</b> <A href={LINKS.m3}>M³ ice detections</A> (Li et al. 2018), <A href={LINKS.lemelin}>shadowed regions with detections</A> (Lemelin et al. 2021) and the <A href={LINKS.lcrossSite}>LCROSS impact</A> in Cabeus (<A href={LINKS.lcross}>Colaprete et al. 2010</A>). Shown on the map, not scored.</li>
              <li><b>Images:</b> LROC WAC global mosaic on the 3D globe; NASA Blue Marble for the Earth in Astronaut Mode.</li>
              <li><b>Detailed terrain for Astronaut Mode:</b> LOLA 5 m maps of a few South Pole sites (<A href={LINKS.pgda78}>PGDA 78</A>, <A href={LINKS.pgda90}>PGDA 90</A>).</li>
            </ul>
          </Item>
        </L.Panel>

        {/* ------------------------------------------------------------ 10 */}
        <L.Panel id="dm-prep" eyebrow="10 · Data" title="How the data is prepared">
          <p className="body-sm lh-sec">
            A Python program (<code>pipeline/moonsite/</code>) runs once on a computer. It cuts the NASA maps to the area
            we need, puts them on our grids and writes small files. The website downloads those files and does the rest
            in your browser. There is no server.
          </p>
          <Item title="The three grids">
            <Table head={["Map", "Cell", "Size", "Area"]} rows={[
              ["South Pole", "1 km × 1 km", "400 × 400 cells", "400 km square around the pole, down to about 83.5°"],
              ["North Pole", "1 km × 1 km", "400 × 400 cells", "the same around the north pole"],
              ["Whole Moon", "0.5° × 0.5°", "720 × 360 cells", "everything; a cell is about 15 km wide at the equator and narrower towards the poles"],
            ]} />
          </Item>
          <Item title="From 240 m to 1 km: how one cell gets its value">
            <p>Each 1 km polar cell contains several values of the finer NASA maps. We summarise them like this:</p>
            <ul className="sources">
              <li><b>Height:</b> the value at the centre of the cell, interpolated.</li>
              <li><b>Slope and roughness:</b> the median of the 16 values of 240 m inside the cell. The median ignores a single extreme value.</li>
              <li><b>Permanent shadow:</b> the share of the cell in shadow (64 values of 120 m), and the distance from the cell centre to the nearest shadow.</li>
              <li><b>Temperature:</b> the average of the Diviner triangles inside the cell.</li>
              <li><b>Ice:</b> the distance to the nearest place where Diviner says ice would stay frozen within 0.5 m of the surface.</li>
            </ul>
            <p>A whole-Moon cell takes the median roughness, the average slope and the share of permanent shadow of everything inside its 0.5°.</p>
          </Item>
          <Item title="Terrain horizons: the slow part, done once">
            <p>The horizon of a place is how high the terrain rises around it in each direction. It does not change, so we calculate it once.</p>
            <p>From each cell, 2 m above the ground (the height of a lander's panels or antenna), we look in 72 directions, one every 5°. Along each direction we step over the terrain and keep the highest angle we find. We use the true shape of the Moon, so its curvature hides distant terrain as it should.</p>
            <Table head={["", "Polar maps", "Whole Moon"]} rows={[
              ["Terrain used", "LOLA 240 m", "LOLA LDEM_64 (about 470 m)"],
              ["Distance searched", "300 m to 300 km", "500 m to 300 km"],
              ["Points per cell", "1, at the centre", "1, or 4 above 60° of latitude"],
            ]} />
            <p>Above 60° the Sun stays low and small relief decides whether a place is lit, so a whole-Moon cell there has four horizons spread inside it and the result is their average.</p>
          </Item>
          <Item title="What the browser downloads">
            <ul className="sources">
              <li>For each pole: the fixed layers above, the horizons (72 numbers per cell) and a description file (<code>manifest.json</code>) with units and sources.</li>
              <li>For the whole Moon: horizons, heights, slope, roughness, shadow, water and a temperature curve for each cell.</li>
              <li>One file with the Sun and Earth positions every hour, shared by all maps.</li>
              <li><code>validation.json</code>: the results of the checks in section 15.</li>
            </ul>
          </Item>
        </L.Panel>

        {/* ------------------------------------------------------------ 11 */}
        <L.Panel id="dm-sky" eyebrow="11 · Calculation" title="Sunlight and Earth view">
          <p className="body-sm lh-sec">
            For each cell and each hour, the browser asks two questions: is the Sun above the terrain? Is the Earth above
            the terrain? It compares where the Sun and the Earth are in that cell's sky with the height of its horizon in
            that direction.
          </p>
          <Item title="Where the Sun and the Earth are in the sky">
            <p>From the hourly positions (section 09) we get the direction of the Sun and of the Earth as seen from the cell: their height above the flat horizon (elevation) and their compass direction (azimuth, measured clockwise from north).</p>
            <p>For the Earth we use the exact position of the cell, because from different parts of the Moon the Earth appears in slightly different places. The Sun is so far away that one direction works for the whole map.</p>
          </Item>
          <Item title="Is the Sun visible?">
            <p>The Sun is a disc about 0.5° wide, so it can be half hidden behind a ridge. You choose the rule in Mission settings:</p>
            <ul className="sources">
              <li><b>Any part of the disk</b> (default): counts as sunlight as soon as the top edge clears the horizon. This is the rule LOLA uses in its own maps.</li>
              <li><b>Disk centre:</b> the centre must be above the horizon.</li>
              <li><b>Whole disk:</b> the whole Sun must be above the horizon.</li>
            </ul>
            <p>Between two of the 72 directions, the horizon height is interpolated. The terrain under the disc is treated as a straight line.</p>
          </Item>
          <Item title="Is the Earth visible?">
            <p>By default the centre of the Earth must be above the horizon. You can choose “any part of the disk” instead; seen from the Moon, the Earth is almost 2° wide. This is a line of sight only: it does not check antennas or ground stations on Earth.</p>
          </Item>
          <Item title="From hours to mission numbers">
            <ul className="sources">
              <li><b>Sun visibility:</b> the share of the hours of your stay with the Sun visible.</li>
              <li><b>Earth visibility:</b> the same for the Earth.</li>
              <li><b>Longest night:</b> the longest run of hours in a row with less than 5 % of the Sun's disc visible.</li>
            </ul>
          </Item>
        </L.Panel>

        {/* ------------------------------------------------------------ 12 */}
        <L.Panel id="dm-mission" eyebrow="12 · Calculation" title="Mission dates">
          <Item title="What you choose">
            <ul className="sources">
              <li><b>Time on the surface:</b> from 1 day to 2 years.</li>
              <li><b>Landing date:</b> a fixed date, or a range to search (the next 12 months, or your own dates). The whole-Moon map uses a fixed date only.</li>
              <li><b>Dates available:</b> {ephem ? `from ${ephem.startUtc.slice(0, 10)} to the end of 2030` : "2026 to 2030"}, the period of our Sun and Earth file.</li>
            </ul>
          </Item>
          <Item title="How the best landing date is found">
            <p>When you search a range, the app tries every possible landing hour. For each one it works out the Sun and Earth visibility of the stay that would start then, and keeps the landing hour with the best mix of the two, according to your Sun and Earth weights.</p>
            <p>Each cell keeps its own best date, so two places on the map can have different best dates. For long searches the app checks every few hours instead of every hour, so that it stays fast (about 2,600 checks per cell at most).</p>
            <p>The work is split between several threads of your computer and takes a few seconds. Changing the Sun or Earth weight starts it again; the other weights and the limits apply at once.</p>
          </Item>
          <Item title="Landing windows and good days (place sheet)">
            <p>For a single place the app redoes the calculation hour by hour for the whole period. A <b>landing window</b> is a stretch of landing hours that gives at least 95 % of the best possible result. <b>Good days</b> count the hours of each day with both the Sun and the Earth in view.</p>
          </Item>
        </L.Panel>

        {/* ------------------------------------------------------------ 13 */}
        <L.Panel id="dm-score" eyebrow="13 · Calculation" title="The score">
          <p className="body-sm lh-sec">Each factor becomes a number from 0 (bad) to 1 (good). The score is their weighted average, from 0 to 100:</p>
          <Eq>{"score = 100 × (sum of weight × factor) ÷ (sum of weights)"}</Eq>
          <Item title="How each factor goes from 0 to 1" open>
            <Table head={["Factor", "Polar maps", "Whole Moon"]} rows={[
              [label.sun, "share of the stay with the Sun visible", "the same"],
              [label.earth, "share of the stay with the Earth visible", "the same"],
              [label.slope, "1 on flat ground, 0 at your maximum slope", "the same, with the average slope of the cell"],
              [label.rough, `1 when perfectly smooth, 0 at ${ROUGH_MAX_M} m of roughness`, "the same"],
              ["Temperature", `0 at ${TEMP_COLD_K} K or colder, 1 at ${TEMP_MILD_K} K or warmer. Uses the average temperature of the year, 2 cm below the surface.`, `Each hour of the stay is scored from the surface temperature at that hour: 0 at ${TEMP_BAND.coldK} K, 1 from ${TEMP_BAND.mildK} K to ${TEMP_BAND.hotOkK} K, 0 again at ${TEMP_BAND.hotMaxK} K. The factor is the average of those hours, so both a freezing night and a very hot noon count against a place.`],
              ["Ice / water", `1 next to ground where ice would stay frozen within 0.5 m, 0 at your “ice reach” distance (default ${DEFAULT_LIMITS.iceReachKm} km).`, `0 with no hydrogen signal, 1 at ${WATER_FULL_WT_PCT} % water by weight or more. Only shows a signal above 70° of latitude.`],
            ]} />
            <p>Kelvin (K) is the temperature scale scientists use: 0 K is absolute zero, 273 K is 0 °C. {TEMP_COLD_K} K is −223 °C; {TEMP_MILD_K} K is −23 °C.</p>
            <p>The whole-Moon water value comes from hydrogen: we subtract the hydrogen that is everywhere on the Moon (brought by the solar wind, not water) and convert the rest to water. Because each measurement covers 60 to 150 km, a crater full of ice looks diluted, so {WATER_FULL_WT_PCT} % is already a strong signal.</p>
          </Item>
          <Item title="Weights and profiles">
            <p>The weights always add up to 100. A profile is a ready-made set of weights; you can move any weight by hand and the others adjust.</p>
            <Table head={["Profile", ...FACTORS.map((f) => f.label)]} rows={Object.entries(PRESETS).map(([name, w]) => [name, ...FACTORS.map((f) => w[f.key])])} />
          </Item>
          <Item title="Limits that remove a place from the map">
            <ul className="sources">
              <li>Slope above your maximum (default {DEFAULT_LIMITS.maxSlopeDeg}°, adjustable from 2° to 30°).</li>
              <li>More than half of the cell in permanent shadow (on by default).</li>
              <li>A night longer than the battery lasts (off by default).</li>
              <li>Earth in view for less than a minimum share of the stay (off by default).</li>
              <li>No terrain data. A cell missing any data that the score uses gets no score.</li>
            </ul>
          </Item>
          <Item title="Hotspots and reference places">
            <p><b>Polar maps:</b> we take the best 3 % of the cells, join the ones that touch, and rank each group by its best cell. Up to 10 are listed.</p>
            <p><b>Whole Moon:</b> the 10 best cells, each at least 5° (about 150 km) away from the others, so that the list is not ten neighbours.</p>
            <p>Artemis III regions and Apollo sites are scored like any other place, with the cell that contains them. On the whole Moon that cell describes about 15 km of ground, not the exact spot.</p>
          </Item>
        </L.Panel>

        {/* ------------------------------------------------------------ 14 */}
        <L.Panel id="dm-moon" eyebrow="14 · Calculation" title="Whole Moon and Astronaut Mode">
          <Item title="Whole Moon: what changes">
            <ul className="sources">
              <li>The same calculation of Sun and Earth as at the poles, on 0.5° cells.</li>
              <li><b>Temperature by the hour:</b> the temperature of a place depends mostly on where the Sun is in its sky. For each hour of the stay, the app works out the local time of the cell (12:00 = Sun at its highest) and reads the Diviner curve of that cell at that time.</li>
              <li>Water from Lunar Prospector instead of the Diviner ice model.</li>
              <li>The scores are lower than at the poles because one cell averages 15 km of ground: a good ridge is mixed with the craters around it.</li>
            </ul>
          </Item>
          <Item title="Astronaut Mode: the ground">
            <p>You walk one square kilometre at real scale, with no vertical exaggeration and with the curvature of the Moon.</p>
            <Table head={["Where", "Real terrain", "Source"]} rows={[
              ["Two South Pole demo sites", "one value every 5 m", "LOLA site maps (PGDA)"],
              ["Rest of both poles", "every 240 m", "LOLA LDEM_75S / 75N"],
              ["Rest of the Moon", "about every 1.9 km", "LOLA LDEM_64, averaged"],
            ]} />
            <p>Small craters, rocks and gravel are added by the computer. Crater sizes follow the measured lunar statistics (Trask 1966), and rocks are placed mostly around young craters. They look right but they are <b>not real positions</b>. The same place always produces the same ground.</p>
            <p>Outside the poles the real terrain is so coarse that almost everything you see within the kilometre is generated.</p>
          </Item>
          <Item title="Astronaut Mode: the sky and the physics">
            <ul className="sources">
              <li>The Sun and the Earth are placed with the same hourly positions as the maps, at their real size. The Earth is not enlarged.</li>
              <li>Whether the Sun is hidden uses the terrain horizon plus the relief around you.</li>
              <li>The clouds on the Earth are invented and do not show the weather of any date.</li>
              <li>Gravity is 1.62 m/s², one sixth of the Earth's. The eye is about 1.7 m above the ground.</li>
              <li>The ground reflects light like lunar soil, using a model fitted to the whole Moon (<A href={LINKS.hapke}>Helfenstein &amp; Veverka 1987</A>). It is a picture, not a light measurement.</li>
            </ul>
          </Item>
        </L.Panel>

        {/* ------------------------------------------------------------ 15 */}
        <L.Panel id="dm-checks" eyebrow="15 · Validation" title="How we checked it"
          actions={<L.FidelityBadge level={checks.south?.horizons ? "validated" : "computed"}>{checks.south?.horizons ? "Checked" : "Loading"}</L.FidelityBadge>}>
          <p className="body-sm lh-sec">Two independent comparisons, read live from the published result files:</p>
          <Table head={["Map", "Sun position vs JPL", "Earth position vs JPL", "Sunlight vs LOLA", "Earth view vs LOLA", "Note"]} rows={[
            valRow("South Pole", checks.south, "3 test places"),
            valRow("North Pole", checks.north, "JPL check not run yet"),
          ]} />
          <p className="caption lh-muted">′ = arcminute, 1/60 of a degree. “pts” = percentage points of time.</p>
          <Item title="1 · Positions: our numbers against JPL Horizons">
            <p><A href={LINKS.horizons}>JPL Horizons</A> is NASA's public service for the positions of objects in the sky. We asked it for the Sun and the Earth as seen from three South Pole places{checks.south?.horizons ? `, every ${checks.south.horizons.window[2]} from ${checks.south.horizons.window[0].slice(0, 10)} to ${checks.south.horizons.window[1].slice(0, 10)}` : ""}, and compared with our own calculation. The largest difference is far below what the map can show.</p>
            <p>This checks the positions and the geometry. It does not check the terrain.</p>
          </Item>
          <Item title="2 · Sunlight: our horizons against LOLA's own maps">
            <p>We picked 2,000 random cells and calculated how often each sees the Sun from 2026 to 2030, with LOLA's rule (any part of the disc). Then we compared with LOLA's 18.6-year map. The same for the Earth.</p>
            <p>The table shows the average difference and the value that 90 % of the cells stay within. Part of the difference is expected: our period is shorter, our terrain is coarser (1 km against 120 m) and our observer stands 2 m above the ground. Our values come out slightly higher on average.</p>
          </Item>
          <Item title="3 · Whole Moon">
            <p>The whole-Moon sunlight was compared with the 1 km calculation for one day. With one horizon per cell the average error is 1 to 2 points below 60° of latitude. Above 60° it was 3.6 to 7.4 points; with four horizons per cell it went down to 1.5 to 4.2.</p>
          </Item>
          <Item title="4 · Checks that stop the pipeline">
            <ul className="sources">
              <li>Every download must have the expected size.</li>
              <li>The Diviner tables must line up with the LOLA terrain (see the north table problem in section 09).</li>
              <li>The global terrain must not be rotated or mirrored: the floor of Shackleton crater (89.67°S 129.78°E) must be more than 2 km below the reference level, and Mons Mouton (85.43°S 31.83°E) more than 5 km above it.</li>
              <li>Data shared between team members is checked for size, value range, a fingerprint of the file (SHA-256) and known points: for example, the Earth must be in view more than 95 % of the time at 0°N 0°E and less than 5 % at 0°N 180°E.</li>
            </ul>
          </Item>
        </L.Panel>

        {/* ------------------------------------------------------------ 16 */}
        <L.Panel id="dm-limits" eyebrow="16 · Validation" title="Measured, modelled or generated">
          <p className="body-sm lh-sec">Not every number has the same weight. This is what each one is.</p>
          <Table head={["Quantity", "What it is", "Real detail", "Keep in mind"]} rows={[
            ["Height, slope, roughness", "Measured by LOLA", "240 m at the poles, ~470 m to ~1.9 km on the whole Moon", "A 1 km cell summarises many values; a steep spot can hide inside a gentle cell"],
            ["Permanent shadow, long-term light", "Calculated by the LOLA team from the terrain", "120 m to 240 m", "18.6-year averages"],
            ["Sunlight and Earth view of your mission", "Calculated by us", "1 km or 0.5°, directions every 5°, terrain from 300 m away", "Sunlight is not electricity; Earth in view is not a radio link"],
            ["Temperature, poles", "Thermal model built on Diviner data", "~0.5 km", "A yearly average, the same for any date"],
            ["Temperature, whole Moon", "Measured by Diviner", "0.5°", thermal ? `${fix(thermal.gapsFilledPct)} % of the values filled in` : "Some hours filled in"],
            ["Ice, poles", "Model: where ice could survive", "~0.5 km", "Not ice that has been detected"],
            ["Water, whole Moon", "Hydrogen measured, converted to water", "60 to 150 km", "Assumes extra hydrogen near the poles is water"],
            ["Artemis III and Apollo places", "Approximate centres / lunar module positions", "–", "Shown for reference, not optimised"],
            ["Small craters, rocks in Astronaut Mode", "Generated", "–", "Plausible, not measured"],
          ]} />
          <Item title="Main limits">
            <ul className="sources">
              <li>This is a tool to compare regions, not to certify a landing site. A real site needs metre-scale images and terrain.</li>
              <li>Terrain closer than 300 m is not in the horizons; boulders and small craters are not in the data.</li>
              <li>Our Sun and Earth file covers 2026 to 2030; LOLA's light maps cover 18.6 years.</li>
              <li>There is no model of solar panels, batteries, radiation or communications hardware.</li>
              <li>The Diviner polar table sits on terrain from the Japanese Kaguya mission, which can be a few hundred metres off the LOLA terrain.</li>
            </ul>
          </Item>
        </L.Panel>

        {/* ------------------------------------------------------------ 17 */}
        <L.Panel id="dm-refs" eyebrow="17" title="References">
          <ul className="body-sm sources dm-refs">
            <li>Smith, D. E. et al. (2010). LOLA gridded data records, NASA PDS Geosciences Node. <A href={LINKS.lolaPolar}>Archive</A></li>
            <li>Mazarico, E. et al. (2011). Icarus 211. <A href={LINKS.lolaLight}>LPSR and AVGVISIB maps</A></li>
            <li>Paige, D. A. et al. (2010). Science 330. <A href={LINKS.prp}>Diviner Polar Resource Product</A></li>
            <li>Williams, J.-P. et al. (2017). Icarus 283, 300–325. <A href={LINKS.gcp}>Diviner Global Cumulative Products</A></li>
            <li>Feldman, W. C. et al. (2001). JGR 106, 23231 · Lawrence, D. J. et al. (2006). JGR 111. <A href={LINKS.prospector}>Lunar Prospector products</A></li>
            <li>Park, R. S. et al. (2021). DE440 ephemeris. AJ 161:105. <A href={LINKS.naif}>NAIF kernels</A></li>
            <li>Li, S. et al. (2018). M³ ice detections. PNAS. <A href={LINKS.m3}>doi:10.1073/pnas.1802345115</A></li>
            <li>Lemelin, M. et al. (2021). Shadowed regions with M³ ice detections (data set). <A href={LINKS.lemelin}>doi:10.5281/zenodo.4646092</A></li>
            <li>Colaprete, A. et al. (2010). LCROSS impact results. Science. <A href={LINKS.lcross}>doi:10.1126/science.1186986</A></li>
            <li>Helfenstein, P. &amp; Veverka, J. (1987). Lunar photometry. <A href={LINKS.hapke}>NASA technical report</A></li>
            <li>Trask, N. J. (1966). Crater size statistics used in Astronaut Mode.</li>
            <li>NASA (2024-10-28). Artemis III candidate landing regions · NASA NSSDCA, Apollo landing site coordinates · IAU Gazetteer of Planetary Nomenclature.</li>
            <li>NASA PGDA: <A href={LINKS.pgda78}>LOLA 5 m site maps (78)</A> · <A href={LINKS.pgda90}>South Pole 10 m map (90)</A>.</li>
          </ul>
        </L.Panel>
      </div>
    </section>
  );
}
