// Geometría compartida por la web y el worker. Mismas convenciones que el
// pipeline (pipeline/moonsite/geo.py y visibility.py):
// - Plano estereográfico polar sur de LOLA: x = rho·sin(lon), y = rho·cos(lon).
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

export function latLonToXY(grid, latDeg, lonDeg) {
  const rho = 2 * grid.radiusM * Math.tan(Math.PI / 4 + (latDeg * RAD) / 2);
  return [rho * Math.sin(lonDeg * RAD), rho * Math.cos(lonDeg * RAD)];
}

export function xyToLatLon(grid, x, y) {
  const rho = Math.hypot(x, y);
  const lat = -(Math.PI / 2 - 2 * Math.atan(rho / (2 * grid.radiusM)));
  return [lat * DEG, Math.atan2(x, y) * DEG];
}

/** Vector unitario (MOON_ME) del punto (x, y) del plano. */
export function xyToUnit(R, x, y) {
  const xs = x / (2 * R);
  const ys = y / (2 * R);
  const t2 = xs * xs + ys * ys;
  const k = 1 / (1 + t2);
  return [2 * ys * k, 2 * xs * k, -(1 - t2) * k];
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
