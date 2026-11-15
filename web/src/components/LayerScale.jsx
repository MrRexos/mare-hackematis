import { paletteOf, rampCss } from "../engine/globalRamps.js";
import { cx } from "../ui/kit.jsx";

const VALUE = /^(-?\d+(?:\.\d+)?)\s*(.*?)(\+?)$/;

/** Marcas intermedias entre los dos extremos de la leyenda. Las unidades largas solo van en los extremos. */
export function scaleTicks(ends, count = 5) {
  const lo = VALUE.exec(String(ends[0]).trim()), hi = VALUE.exec(String(ends[1]).trim());
  if (!lo || !hi) return ends.map(String);
  const a = Number(lo[1]), b = Number(hi[1]), unit = hi[2] || lo[2], gap = unit && !/^[%°]/.test(unit) ? " " : "";
  const decimalsOf = (text) => (text.split(".")[1] || "").length;
  // Más decimales mientras el paso no sea exacto y el redondeo se coma más del 1 % del rango.
  let decimals = Math.max(decimalsOf(lo[1]), decimalsOf(hi[1]));
  const step = (b - a) / (count - 1), exact = (d) => Math.abs(step * 10 ** d - Math.round(step * 10 ** d)) < 1e-6;
  for (let k = 0; k < 2 && !exact(decimals) && Math.abs(b - a) < 50 * 10 ** -decimals; k++) decimals++;
  return Array.from({ length: count }, (_, k) => (k === 0 ? String(ends[0]) : k === count - 1 ? String(ends[1]) : `${(a + step * k).toFixed(decimals)}${unit.length > 2 ? "" : gap + unit}`));
}

/** Escala de valores de la capa activa, siempre visible sobre el mapa. */
export default function LayerScale({ layer, ends, note }) {
  const palette = paletteOf(layer), ticks = scaleTicks(ends);
  return (
    <div className="overlay map-scale" role="img" aria-label={`${layer.label}: scale from ${ticks[0]} to ${ticks[ticks.length - 1]}`}>
      <span className="map-scale__name">{layer.label}</span>
      <div className={cx("ramp", !palette && `ramp--${layer.ramp}`)} style={palette ? { background: rampCss(palette) } : undefined} />
      <div className="map-scale__ticks" data-count={ticks.length}>{ticks.map((tick, k) => <span key={k}>{tick}</span>)}</div>
      {note ? <span className="map-scale__note">{note}</span> : null}
    </div>
  );
}
