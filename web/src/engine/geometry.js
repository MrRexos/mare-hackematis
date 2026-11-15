// Geometría compartida por la web y el worker. Mismas convenciones que el
// pipeline (pipeline/moonsite/geo.py y visibility.py):
// - Plano estereográfico polar de LOLA, según grid.pole:
//     "south" (por defecto): x = rho·sin(lon), y =  rho·cos(lon), rho = 2R·tan(45° + lat/2)
//     "north":               x = rho·sin(lon), y = −rho·cos(lon), rho = 2R·tan(45° − lat/2)
//   La longitud 0° (cara visible) queda arriba en el sur y abajo en el norte; 90°E, a la derecha.
// - Malla: fila 0 arriba (+y). Centro del píxel (i, j):
//   x = -half + (j + 0.5)·px,  y = half - (i + 0.5)·px.
// - Marco local ENU; acimut horario desde el norte (norte = hacia el polo norte).

export const DEG = 180 / Math.PI;
export const RAD = Math.PI / 180;

export function pixelXY(grid, i, j) {
  return [-grid.halfM + (j + 0.5) * grid.pxM, grid.halfM - (i + 0.5) * grid.pxM];
}

export function xyToPixel(grid, x, y) {
  return [(grid.halfM - y) / grid.pxM - 0.5, (x + grid.halfM) / grid.pxM - 0.5];
}

/** +1 en el polo sur, −1 en el norte: signo de y respecto a cos(lon) y signo de z. */
const poleSign = (pole) => (pole === "north" ? -1 : 1);

export function latLonToXY(grid, latDeg, lonDeg) {
  const s = poleSign(grid.pole);
  const rho = 2 * grid.radiusM * Math.tan(Math.PI / 4 + (s * latDeg * RAD) / 2);
  return [rho * Math.sin(lonDeg * RAD), s * rho * Math.cos(lonDeg * RAD)];
}

export function xyToLatLon(grid, x, y) {
  const s = poleSign(grid.pole);
  const rho = Math.hypot(x, y);
  const lat = -s * (Math.PI / 2 - 2 * Math.atan(rho / (2 * grid.radiusM)));
  return [lat * DEG, Math.atan2(x, s * y) * DEG];
}

/** Vector unitario (MOON_ME) del punto (x, y) del plano del polo `pole` ("south" si no se indica). */
export function xyToUnit(R, x, y, pole) {
  const s = poleSign(pole);
  const xs = x / (2 * R);
  const ys = y / (2 * R);
  const t2 = xs * xs + ys * ys;
  const k = 1 / (1 + t2);
  return [2 * s * ys * k, 2 * xs * k, -s * (1 - t2) * k];
}

/**
 * Vector unitario (MOON_ME) del centro de la celda (i, j).
 * Malla polar (polo sur o norte, n × n) o malla global lat/lon (grid.type === "latlon":
 * fila 0 desde lat0 hacia el sur, columna 0 desde lon0 hacia el este).
 * En la malla global, (fi, fj) eligen un punto dentro de la celda (0,5 = centro).
 */
export function cellUnit(grid, i, j, fi = 0.5, fj = 0.5) {
  if (grid.type === "latlon") {
    const lat = (grid.lat0 - (i + fi) * grid.stepDeg) * RAD;
    const lon = (grid.lon0 + (j + fj) * grid.stepDeg) * RAD;
    const cl = Math.cos(lat);
    return [cl * Math.cos(lon), cl * Math.sin(lon), Math.sin(lat)];
  }
  const [x, y] = pixelXY(grid, i, j);
  return xyToUnit(grid.radiusM, x, y, grid.pole);
}

/** Marco local a partir del vector unitario: [up, east, north]. */
export function localFrame(u) {
  const cl = Math.hypot(u[0], u[1]) || 1e-12;
  const east = [-u[1] / cl, u[0] / cl, 0];
  const north = [(-u[2] * u[0]) / cl, (-u[2] * u[1]) / cl, cl];
  return [u, east, north];
}

/** "89.4°S 222.8°E": formato del design system (longitud 0–360 E). */
export function formatLatLon(latDeg, lonDeg, digits = 2) {
  const lat = `${Math.abs(latDeg).toFixed(digits)}°${latDeg < 0 ? "S" : "N"}`;
  const lon = `${(((lonDeg % 360) + 360) % 360).toFixed(digits)}°E`;
  return `${lat} ${lon}`;
}

/** Fecha UTC en ISO del design system: "2027-03-14 06:00 UTC". */
export function formatUtc(ms) {
  const d = new Date(ms);
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function formatDuration(hours) {
  if (!Number.isFinite(hours)) return "–";
  const d = Math.floor(hours / 24);
  const h = Math.round(hours - d * 24);
  if (d === 0) return `${h} h`;
  return h ? `${d} d ${h} h` : `${d} d`;
}
