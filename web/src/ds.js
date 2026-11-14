// Acceso a los componentes del design system "Lunar Horizon" (window.LunarHorizon).
// Se resuelven al renderizar, cuando bundle.js ya está cargado: <L.Panel>, <L.Button>…
export const L = new Proxy({}, { get: (_, key) => window.LunarHorizon?.[key] });

/** Lee un color del tema (variable CSS) como [r, g, b]. */
export function cssColor(el, name) {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  if (v.startsWith("#")) {
    const hex = v.length === 4 ? v.replace(/#(.)(.)(.)/, "#$1$1$2$2$3$3") : v;
    return [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
  }
  const m = v.match(/[\d.]+/g);
  return m ? m.slice(0, 3).map(Number) : [255, 255, 255];
}
