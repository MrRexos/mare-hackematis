// Puntos calientes: zonas conectadas de píxeles con las mejores puntuaciones.
//
// 1. Umbral = percentil `topShare` de las puntuaciones válidas (por defecto el 3 % mejor).
// 2. Se agrupan los píxeles por encima del umbral (vecindad de 8).
// 3. Cada zona se resume en su píxel de mayor puntuación y se ordena por él.

import { pixelXY, xyToLatLon } from "./geometry.js";

export function findHotspots(score, grid, { topShare = 0.03, max = 10, minPixels = 2 } = {}) {
  const n = grid.n;
  const valid = [];
  for (let p = 0; p < score.length; p++) if (Number.isFinite(score[p])) valid.push(score[p]);
  if (valid.length === 0) return { threshold: NaN, spots: [] };
  valid.sort((a, b) => a - b);
  const threshold = valid[Math.min(valid.length - 1, Math.floor(valid.length * (1 - topShare)))];

  const label = new Int32Array(score.length).fill(-1);
  const spots = [];
  const stack = [];
  for (let p = 0; p < score.length; p++) {
    if (label[p] !== -1 || !(score[p] >= threshold)) continue;
    const id = spots.length;
    let size = 0, sum = 0, bestP = p;
    label[p] = id;
    stack.push(p);
    while (stack.length) {
      const q = stack.pop();
      size += 1;
      sum += score[q];
      if (score[q] > score[bestP]) bestP = q;
      const qi = (q / n) | 0, qj = q % n;
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          if (!di && !dj) continue;
          const i = qi + di, j = qj + dj;
          if (i < 0 || j < 0 || i >= n || j >= n) continue;
          const r = i * n + j;
          if (label[r] === -1 && score[r] >= threshold) { label[r] = id; stack.push(r); }
        }
      }
    }
    spots.push({ id, size, mean: sum / size, peak: bestP, peakScore: score[bestP] });
  }

  const kept = spots
    .filter((s) => s.size >= minPixels)
    .sort((a, b) => b.peakScore - a.peakScore)
    .slice(0, max)
    .map((s, k) => {
      const i = (s.peak / n) | 0, j = s.peak % n;
      const [x, y] = pixelXY(grid, i, j);
      const [lat, lon] = xyToLatLon(grid, x, y);
      return { ...s, rank: k + 1, i, j, x, y, lat, lon, areaKm2: (s.size * grid.pxM * grid.pxM) / 1e6 };
    });
  return { threshold, spots: kept };
}

/** Sitio de referencia más cercano (km) para dar contexto al nombre. */
export function nearestSite(spot, sites, grid, toXY) {
  let best = null;
  for (const s of sites) {
    const [x, y] = toXY(grid, s.lat, s.lon);
    const d = Math.hypot(x - spot.x, y - spot.y) / 1000;
    if (!best || d < best.km) best = { site: s, km: d };
  }
  return best;
}
