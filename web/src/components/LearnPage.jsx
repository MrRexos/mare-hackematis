import { L } from "../ds.js";
import DataMethods from "./DataMethods.jsx";
import SiContent from "./SiContent.jsx";

// How it works/: resumen corto (qué responde, cómo puntúa, qué fiabilidad tiene y sus
// límites). El detalle (fuentes, escalas y comprobaciones) está en DataMethods, plegado.

export default function LearnPage({ data }) {
  // Las cifras de comprobación son las del polo cuyos datos están cargados (el del plan en curso).
  const north = data.pole === "north";
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
          <p className="body-lg">Where on the Moon do you get the most sunlight and Earth contact, on safe ground, at workable temperatures and near water?</p>
          <ul className="body-sm sources">
            <li><b>South Pole · North Pole:</b> 1 km cells, from 83.5° to the pole. Can search for the best landing dates.</li>
            <li><b>Whole Moon:</b> 0.5° cells (about 15 km), for a fixed date.</li>
          </ul>
        </L.Panel>
        <L.Panel eyebrow="02" title="How the score works">
          <ol className="body-sm steps">
            <li><b>Horizon:</b> how high the terrain rises around each cell, in 72 directions.</li>
            <li><b>Sun & Earth:</b> each hour of the stay, are they above that horizon?</li>
            <li><b>Six factors</b> from 0 to 1: Sun, Earth, slope, roughness, temperature, water.</li>
            <li><b>Score</b> = weighted average, 0 to 100. You choose the weights.</li>
            <li><b>Limits</b> remove cells; the best ones left are the <b>hotspots</b>.</li>
          </ol>
        </L.Panel>
        <L.Panel eyebrow="03" title="Poles and whole Moon score differently">
          <ul className="body-sm sources">
            <li><b>Cell size:</b> 1 km finds the best ridge; 15 km averages it with the craters around it.</li>
            <li><b>Temperature:</b> yearly average at the poles; hour by hour on the whole Moon.</li>
            <li><b>Water:</b> distance to possible ice at the poles; hydrogen from orbit on the whole Moon.</li>
          </ul>
        </L.Panel>
        <L.Panel eyebrow="04" title="Mare and Astronaut Mode">
          <ul className="body-sm sources">
            <li><b>Mare:</b> the sheet of one place: score, sky hour by hour, best days. <b>Compare</b> sets up to four side by side.</li>
            <li><b>Astronaut Mode:</b> walk one kilometre at real scale, with the Sun and the Earth in place. Hills are real NASA terrain; small craters and rocks are generated.</li>
          </ul>
        </L.Panel>
        <L.Panel eyebrow="05" title="Can I trust these numbers?">
          <div className="readout-grid">
            <L.Readout label="Sun vs Horizons" value={hz ? arcmin(hz.sun) : "–"} unit="′ max" />
            <L.Readout label="Earth vs Horizons" value={hz ? arcmin(hz.earth) : "–"} unit="′ max" />
            <L.Readout label="Sunlight vs LOLA" value={avg ? avg.meanAbsDiffPct.toFixed(1) : "–"} unit="pts mean" approx />
            <L.Readout label="Earth view vs LOLA" value={v.avgearth ? v.avgearth.meanAbsDiffPct.toFixed(1) : "–"} unit="pts mean" approx />
          </div>
          <p className="body-sm lh-sec">
            {north ? "North Pole" : "South Pole"} compared with NASA's JPL Horizons and with LOLA's own light maps
            {north ? " (the JPL check has not been run for the north yet)" : ""}. Details in Data & methods.
          </p>
        </L.Panel>
        <L.Panel eyebrow="06" title="Limits">
          <ul className="body-sm sources">
            <li>Compares regions; does not certify a landing site.</li>
            <li>Boulders, small craters and terrain closer than 300 m are not in the data.</li>
            <li>Sunlight is not electricity; Earth in view is not a radio link.</li>
            <li>Polar ice is where ice could survive, not ice that was detected.</li>
            <li>No radiation or impact layer: NASA publishes no such map per site.</li>
          </ul>
        </L.Panel>
      </div>
      {/* Parte II: datos y métodos en detalle (fuentes, escalas y comprobaciones), plegada. */}
      <DataMethods />
      {/* Parte III: declaración del uso de herramientas SI (norma del Space Apps Challenge). */}
      <SiContent />
    </div>
  );
}
