import { useEffect, useState } from "react";
import { L } from "../ds.js";
import { DEFAULT_LIMITS, ROUGH_MAX_M, TEMP_COLD_K, TEMP_MILD_K } from "../engine/score.js";
import { TEMP_BAND, WATER_FULL_WT_PCT } from "../engine/globalScore.js";

// "Data & methods": desplegable de How it works, en forma de esquema. Para cada mapa
// (polos / Luna entera): dato, fuente, qué representa y detalle. Después, el cálculo en
// cinco pasos, la escala de cada factor, las comprobaciones y los límites.
// Umbrales importados del motor (score.js, globalScore.js); validación leída de los
// validation.json publicados.

const BASE = `${import.meta.env.BASE_URL}data/`;
const PDS_LOLA = "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx";
const LINK = {
  lolaPolar: `${PDS_LOLA}/data/lola_gdr/polar/img/`,
  lolaLight: `${PDS_LOLA}/extras/illumination/img/`,
  lolaGlobal: `${PDS_LOLA}/data/lola_gdr/cylindrical/img/`,
  lola118: "https://planetarymaps.usgs.gov/mosaic/Lunar_LRO_LOLA_Global_LDEM_118m_Mar2014.tif",
  prp: "https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/data_derived_prp/",
  gcp: "https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/data_derived_gcp/",
  prospector: "https://pds-geosciences.wustl.edu/missions/lunarp/reduced_special.html",
  naif: "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/",
  horizons: "https://ssd.jpl.nasa.gov/horizons/",
};

const A = ({ href, children }) => <a className="lh-link" href={href} target="_blank" rel="noreferrer">{children}</a>;

// Tipo de dato: medido, modelo de un equipo de la NASA o calculado por nosotros.
const KIND = { m: "Measured", mod: "NASA model", calc: "Our calculation", ref: "Reference" };

// [dato, fuente (enlace), qué representa, detalle, tipo]
const SUN_EARTH = ["Sun & Earth", <A key="s" href={LINK.naif}>JPL SPICE · DE440</A>, "Where they are, every hour, 2026–2030", "1 h", "mod"];
const DATA = {
  poles: [
    ["Height", <A key="s" href={LINK.lolaPolar}>LOLA LDEM</A>, "Shape of the ground; gives the horizons", "240 m", "m"],
    ["Slope", <A key="s" href={LINK.lolaPolar}>LOLA LDSM</A>, "How steep the ground is", "240 m", "m"],
    ["Roughness", <A key="s" href={LINK.lolaPolar}>LOLA LDRM</A>, "How bumpy the ground is", "240 m", "m"],
    ["Permanent shadow", <A key="s" href={LINK.lolaLight}>LOLA LPSR</A>, "Ground that never sees the Sun", "120 m", "mod"],
    ["Temperature", <A key="s" href={LINK.prp}>Diviner PRP</A>, "Yearly average, 2 cm underground", "~0.5 km", "mod"],
    ["Ice", <A key="s" href={LINK.prp}>Diviner PRP</A>, "Where ice could stay frozen within 0.5 m", "~0.5 km", "mod"],
    SUN_EARTH,
    ["Places", "NASA · IAU", "Artemis III regions (south), named craters (north)", "approx.", "ref"],
  ],
  moon: [
    ["Height", <A key="s" href={LINK.lolaGlobal}>LOLA LDEM_64</A>, "Shape of the ground; gives the horizons", "~470 m", "m"],
    ["Slope", <A key="s" href={LINK.lola118}>LOLA 118 m mosaic</A>, "Average steepness of the cell", "~1 km", "calc"],
    ["Roughness", <A key="s" href={LINK.lolaGlobal}>LOLA LDRM_16</A>, "How bumpy the ground is", "~1.9 km", "m"],
    ["Permanent shadow", <A key="s" href={LINK.lolaLight}>LOLA LPSR</A>, "Ground that never sees the Sun (above 65°)", "240 m", "mod"],
    ["Temperature", <A key="s" href={LINK.gcp}>Diviner GCP</A>, "Surface temperature at each hour of the lunar day", "0.5°", "m"],
    ["Water", <A key="s" href={LINK.prospector}>Lunar Prospector</A>, "Hydrogen turned into water; signal only above 70°", "60–150 km", "m"],
    SUN_EARTH,
    ["Places", "NASA NSSDCA", "Apollo missions: Apollo 11, 12, 14, 15, 16 and 17 landing sites (Apollo 11 also has its flag in Astronaut Mode)", "LM position", "ref"],
  ],
};

const GRID = {
  poles: "Grid: 1 km cells, 400 km square around each pole.",
  moon: "Grid: 0.5° cells, about 15 km wide at the equator.",
};

const STEPS = [
  ["Horizon", "From each cell, how high the terrain rises in 72 directions, up to 300 km. Done once."],
  ["Sun & Earth", "Each hour of your stay: is the Sun above that horizon? Is the Earth?"],
  ["Factors", "Six numbers from 0 (bad) to 1 (good)."],
  ["Score", "Weighted average of the factors, from 0 to 100. You choose the weights."],
  ["Filter", "Too steep, permanent shadow or other limits remove the cell. The best ones are the hotspots."],
];

const fix = (x) => (Number.isFinite(x) ? x.toFixed(1) : "–");
const arcmin = (x) => (!Number.isFinite(x) ? "–" : x < 0.001 ? "< 0.001′" : `${x.toFixed(4)}′`);

function useChecks(enabled) {
  const [v, setV] = useState({});
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const get = (f) => fetch(BASE + f).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    Promise.all([get("validation.json"), get("north/validation.json")]).then(([south, north]) => alive && setV({ south, north }));
    return () => { alive = false; };
  }, [enabled]);
  return v;
}

function Table({ head, rows, className = "" }) {
  return (
    <div className="dm-table-wrap">
      <table className={`dm-table body-sm ${className}`}>
        <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => (j === 0 ? <th key={j} scope="row" data-label={head[j]}>{c}</th> : <td key={j} data-label={head[j]}>{c}</td>))}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DataMethods() {
  const [open, setOpen] = useState(false);
  const [map, setMap] = useState("poles");
  const checks = useChecks(open);

  const dataRows = DATA[map].map(([name, src, what, detail, kind]) => [
    name, src, what, detail, <span key="k" className={`dm-kind dm-kind--${kind}`}>{KIND[kind]}</span>,
  ]);
  const checkRow = (name, v) => [
    name,
    v?.horizons ? `${arcmin(v.horizons.maxArcmin.sun)} · ${arcmin(v.horizons.maxArcmin.earth)}` : "not run yet",
    v?.avgvisib ? `${fix(v.avgvisib.meanAbsDiffPct)} pts` : "–",
    v?.avgearth ? `${fix(v.avgearth.meanAbsDiffPct)} pts` : "–",
  ];

  return (
    <section className={`dm${open ? " is-open" : ""}`} aria-labelledby="dm-title">
      <button type="button" className="dm__toggle" aria-expanded={open} aria-controls="dm-body" onClick={() => setOpen((x) => !x)}>
        <span className="dm__toggle-text">
          <span className="eyebrow lh-muted">Part II</span>
          <span id="dm-title" className="title">Data &amp; methods</span>
          <span className="body-sm lh-sec">Every data source, how the score is built and how we checked it.</span>
        </span>
        <span className="dm__toggle-icon" aria-hidden="true" />
      </button>

      {open && (
        <div id="dm-body" className="dm__body dm__stack">
          <L.Panel eyebrow="09" title="The data"
            actions={<L.SegmentedControl label="Map" size="sm" value={map} onChange={setMap}
              options={[{ value: "poles", label: "South & North Pole" }, { value: "moon", label: "Whole Moon" }]} />}>
            <Table className="dm-table--stack" head={["Data", "Source", "What it shows", "Detail", "Type"]} rows={dataRows} />
            <p className="caption lh-muted dm-note">{GRID[map]} All sources are official NASA data; the links open the archive.</p>
          </L.Panel>

          <L.Panel eyebrow="10" title="From data to score">
            <ol className="dm-steps">
              {STEPS.map(([t, d], k) => (
                <li key={t}><span className="readout-sm lh-muted">{k + 1}</span><b className="body-sm">{t}</b><span className="body-sm lh-sec">{d}</span></li>
              ))}
            </ol>
            <Table head={["Factor", "Scores 0", "Scores 1"]} rows={[
              ["Sun · Earth", "never in view", "always in view"],
              ["Slope", `at your maximum (default ${DEFAULT_LIMITS.maxSlopeDeg}°)`, "flat"],
              ["Roughness", `${ROUGH_MAX_M} m or more`, "smooth"],
              ["Temperature · poles", `${TEMP_COLD_K} K (−223 °C)`, `${TEMP_MILD_K} K (−23 °C) or warmer`],
              ["Temperature · whole Moon", `below ${TEMP_BAND.coldK} K or above ${TEMP_BAND.hotMaxK} K`, `${TEMP_BAND.mildK}–${TEMP_BAND.hotOkK} K, hour by hour`],
              ["Ice · poles", `${DEFAULT_LIMITS.iceReachKm} km or farther`, "next to ice"],
              ["Water · whole Moon", "no signal", `${WATER_FULL_WT_PCT} % water or more`],
            ]} />
          </L.Panel>

          <L.Panel eyebrow="11" title="How we checked it">
            <Table head={["Map", "Positions vs JPL (Sun · Earth)", "Sunlight vs LOLA", "Earth view vs LOLA"]} rows={[
              checkRow("South Pole", checks.south),
              checkRow("North Pole", checks.north),
            ]} />
            <p className="caption lh-muted dm-note">
              Positions: our Sun and Earth directions against NASA's <A href={LINK.horizons}>JPL Horizons</A> (′ = 1/60 of a degree).
              Sunlight and Earth view: 2,000 random cells against LOLA's own 18.6-year maps (average difference, in % of the time).
            </p>
          </L.Panel>

          <L.Panel eyebrow="12" title="Limits">
            <ul className="body-sm sources">
              <li>Compares regions; does not certify a landing site.</li>
              <li>Boulders, small craters and terrain closer than 300 m are not in the data.</li>
              <li>Sunlight is not electricity; Earth in view is not a radio link.</li>
              <li>Polar ice is where ice could survive, not ice that was detected.</li>
              <li>Astronaut Mode: hills are real, small craters and rocks are generated.</li>
            </ul>
          </L.Panel>
        </div>
      )}
    </section>
  );
}
