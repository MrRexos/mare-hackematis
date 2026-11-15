// Escalas de color de las capas de la Luna entera (mapa 2D y globo 3D).
// Cada propiedad tiene su propia gama, para que no se confundan entre sí:
//
//   score      lila → rojo → verde → azul (azul = la mejor puntuación)
//   sun        naranja → amarillo → blanco (más claro = más Sol)
//   earth      azul del design system, de transparente a opaco (sin cambios)
//   elevation  verde azulado (cuencas) → verde → arena → marrón → blanco (cumbres)
//   slope      verde (llano) → amarillo → rojo (demasiada pendiente): lectura de seguridad
//   rough      crema → rosa → magenta → morado oscuro
//   temp       lila → azul (frío) → amarillo → naranja → rojo (caliente)
//   water      de transparente (sin agua) a azul claro y azul intenso
//
// Una escala es una lista de paradas [posición 0-1, [r, g, b]]. `alpha` es la opacidad de las
// celdas con dato (de 0 a 255); con `fade`, la opacidad además crece con el valor, de modo que
// donde no hay nada (agua = 0) se sigue viendo la Luna.

const hex = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
const stops = (...list) => list.map(([t, h]) => [t, hex(h)]);

export const GLOBAL_RAMPS = {
  score: { alpha: 215, stops: stops([0, "#7b2cbf"], [0.34, "#e03131"], [0.67, "#37b24d"], [1, "#1c7ed6"]) },
  sun: { alpha: 215, stops: stops([0, "#b3440b"], [0.35, "#f08c00"], [0.7, "#ffd43b"], [1, "#fffbe6"]) },
  elevation: { alpha: 215, stops: stops([0, "#0b525b"], [0.3, "#2d9d78"], [0.55, "#e9c46a"], [0.8, "#9c6644"], [1, "#f8f9fa"]) },
  slope: { alpha: 215, stops: stops([0, "#2f9e44"], [0.33, "#ffd43b"], [0.66, "#f76707"], [1, "#c92a2a"]) },
  rough: { alpha: 215, stops: stops([0, "#fff0f6"], [0.35, "#f783ac"], [0.7, "#c2255c"], [1, "#5f0f40"]) },
  temp: { alpha: 215, stops: stops([0, "#7048e8"], [0.25, "#339af0"], [0.5, "#ffd43b"], [0.75, "#fd7e14"], [1, "#e03131"]) },
  water: { alpha: 235, fade: true, stops: stops([0, "#a5d8ff"], [0.5, "#339af0"], [1, "#1864ab"]) },
};

/** Color [r, g, b] de una escala en la posición t (0-1). */
export function rampColor(ramp, t) {
  const s = ramp.stops;
  const x = Math.max(0, Math.min(1, t));
  let k = 1;
  while (k < s.length - 1 && x > s[k][0]) k += 1;
  const [t0, a] = s[k - 1], [t1, b] = s[k];
  const w = t1 > t0 ? (x - t0) / (t1 - t0) : 0;
  return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w];
}

/** Degradado CSS de la escala, para la leyenda. */
export function rampCss(ramp) {
  const a = (t) => (ramp.fade ? (0.15 + 0.85 * t).toFixed(2) : 1);
  return `linear-gradient(90deg, ${ramp.stops.map(([t, c]) => `rgba(${c.join(",")},${a(t)}) ${Math.round(t * 100)}%`).join(", ")})`;
}

/**
 * Función valor → [r, g, b, a] de una capa. `range` = [mínimo, máximo] que cubre la escala.
 * Sin dato (NaN) → null (celda sin color). Con `fade`, valor ≤ mínimo → null.
 */
export function rampFunction(ramp, [lo, hi]) {
  const span = hi > lo ? hi - lo : 1;
  return (v) => {
    if (!Number.isFinite(v)) return null;
    const t = Math.max(0, Math.min(1, (v - lo) / span));
    if (ramp.fade && t <= 0) return null;
    const c = rampColor(ramp, t);
    return [c[0], c[1], c[2], ramp.fade ? ramp.alpha * (0.25 + 0.75 * t ** 0.7) : ramp.alpha];
  };
}
