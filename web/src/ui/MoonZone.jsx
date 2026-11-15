import { useId } from "react";

// Icono pequeño de la Luna con la zona de destino resaltada (Home › Where):
//   south = casquete sur · north = casquete norte · moon = todo el disco.
// La animación va en styles.css (.moonzone): los cráteres giran despacio, la zona elegida
// late y, al elegirla, sale un anillo. Decorativo: el nombre lo da la etiqueta de la opción.

/** Borde de cada casquete: una línea de latitud vista algo de lado, por eso va curvada. */
const ZONES = {
  south: "M0 21.5 Q16 26 32 21.5 V32 H0 Z",
  north: "M0 10.5 Q16 6 32 10.5 V0 H0 Z",
  moon: "M0 0 H32 V32 H0 Z",
};

/** Cráteres [x, y, radio] en una franja de 32 de ancho; se repite una vez para girar sin salto. */
const CRATERS = [[5, 9, 2.1], [13, 17, 2.9], [21.5, 10.5, 1.6], [26, 21, 2.3], [9, 24.5, 1.5], [17.5, 5.5, 1.2], [29.5, 14, 1.1], [2.5, 17.5, 1.3]];

export default function MoonZone({ zone }) {
  const id = `moonzone-${useId().replace(/:/g, "")}`;
  return (
    <svg className={`moonzone moonzone--${zone}`} viewBox="0 0 32 32" width="30" height="30" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={id}><circle cx="16" cy="16" r="13" /></clipPath>
      </defs>
      <circle className="moonzone__ping" cx="16" cy="16" r="13" />
      <circle className="moonzone__disc" cx="16" cy="16" r="13" />
      <g clipPath={`url(#${id})`}>
        <path className="moonzone__zone" d={ZONES[zone] || ZONES.moon} />
        <g className="moonzone__craters">
          {[0, 32].map((dx) => CRATERS.map(([x, y, r]) => <circle key={`${dx}-${x}`} cx={x + dx} cy={y} r={r} />))}
        </g>
      </g>
      <circle className="moonzone__rim" cx="16" cy="16" r="13" />
    </svg>
  );
}
