import { useEffect, useRef } from "react";

// Icono de la Luna con la zona de destino resaltada (Home › Where):
//   south = casquete sur · north = casquete norte · moon = toda la Luna.
//
// Es una fotografía real: el mosaico global LROC WAC de la NASA (public/img/moon-map.png, el
// mismo del globo 3D, reducido por pipeline/moonsite/globe_textures.py). Aquí se proyecta
// sobre una esfera en un canvas pequeño, así la Luna gira de verdad sobre su eje. La zona
// del destino va a plena luz y el resto en penumbra; en los polos la vista se inclina para
// que el casquete se vea de frente. Decorativo: el nombre lo da la etiqueta de la opción.

const MAP_URL = `${import.meta.env.BASE_URL}img/moon-map.png`;
const RAD = Math.PI / 180;
const SIZE = 36;                 // lado del icono, px CSS
const CAP_DEG = 62;              // latitud donde empieza cada casquete polar
const TURN_S = [70, 26];         // segundos por vuelta: en reposo y con la opción elegida
const BREATH_S = 2.8;            // latido de la zona elegida

/**
 * Latitud del centro de la vista y peso 0-1 de la zona resaltada según la latitud. `detail` =
 * columnas de foto por píxel del icono: los polos se ven de frente y ampliados, piden el doble.
 */
const soft = (deg) => Math.max(0, Math.min(1, deg / 3 + 0.5)); // borde suave de 3°
const ZONES = {
  south: { tilt: -46, detail: 4, weight: (lat) => soft(-CAP_DEG - lat), edge: -CAP_DEG },
  north: { tilt: 46, detail: 4, weight: (lat) => soft(lat - CAP_DEG), edge: CAP_DEG },
  moon: { tilt: 0, detail: 2, weight: () => 1, edge: null },
};

const photos = new Map();
/** Fotografía en gris con el ancho pedido (alto = ancho / 2). Se descarga una sola vez. */
function loadPhoto(width) {
  if (!photos.has(width)) {
    photos.set(width, new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = width; c.height = width / 2;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const rgba = ctx.getImageData(0, 0, c.width, c.height).data;
        const w = c.width, h = c.height, gray = new Uint8Array(w * h), sum = new Float64Array(2 * w + 1);
        // Cerca de los polos cada fila de la foto cubre muy poco terreno: se promedia a lo largo
        // de la fila en proporción (1 / cos latitud) o, vista de frente, el polo sale a rayas.
        for (let j = 0; j < h; j++) {
          const lat = (90 - ((j + 0.5) / h) * 180) * RAD;
          const k = Math.min(w / 4, Math.round((1 / Math.max(0.02, Math.cos(lat)) - 1) / 2));
          for (let i = 0; i < 2 * w; i++) sum[i + 1] = sum[i] + rgba[(j * w + (i % w)) * 4];
          for (let i = 0; i < w; i++) gray[j * w + i] = (sum[i + w + k + 1] - sum[i + w - k]) / (2 * k + 1);
        }
        resolve({ w, h, gray });
      };
      img.onerror = reject;
      img.src = MAP_URL;
    }));
  }
  return photos.get(width);
}

/**
 * Lo que no cambia de un fotograma a otro, por píxel del disco: fila de la foto, columna con
 * el giro a cero, sombreado del limbo, peso de la zona, línea del borde y transparencia.
 */
function sphere(n, zone, photo) {
  const { tilt, weight, edge } = ZONES[zone] || ZONES.moon;
  const st = Math.sin(tilt * RAD), ct = Math.cos(tilt * RAD);
  const c = n / 2, R = n / 2 - 1;
  const row = new Float32Array(n * n), col = new Float32Array(n * n), shade = new Float32Array(n * n);
  const zoneW = new Float32Array(n * n), line = new Float32Array(n * n), alpha = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5 - c) / R, y = -(j + 0.5 - c) / R, r2 = x * x + y * y;
      const a = Math.max(0, Math.min(1, (1 - Math.sqrt(r2)) * R + 0.5)); // borde del disco sin dientes
      if (!a) continue;
      const p = j * n + i, z = Math.sqrt(Math.max(0, 1 - r2));
      const lat = Math.asin(Math.max(-1, Math.min(1, y * ct + z * st))) / RAD;
      const lon = Math.atan2(x, z * ct - y * st) / RAD;
      row[p] = Math.min(photo.h - 1.001, Math.max(0, ((90 - lat) / 180) * photo.h - 0.5));
      col[p] = ((lon + 180) / 360) * photo.w;
      shade[p] = 0.58 + 0.42 * Math.sqrt(z);
      zoneW[p] = weight(lat);
      line[p] = edge == null ? 0 : Math.max(0, 1 - Math.abs(lat - edge) / 2.2);
      alpha[p] = Math.round(a * 255);
    }
  }
  return { n, row, col, shade, zoneW, line, alpha };
}

/** Pinta un fotograma. `turn` = vueltas dadas (0-1), `on` = cuánto está elegida (0-1), `breath` = −1…1. */
function paint(ctx, image, s, photo, turn, on, breath) {
  const { n, row, col, shade, zoneW, line, alpha } = s;
  const { w, gray } = photo, out = image.data;
  const shift = (1 - (turn % 1)) * w;               // la superficie avanza hacia el este (a la derecha)
  const dim = 0.62;                                 // fuera de la zona
  const lit = 1 + (0.36 + 0.1 * breath) * on;       // dentro de la zona
  const ring = 30 + 60 * on;
  for (let p = 0; p < n * n; p++) {
    if (!alpha[p]) { out[p * 4 + 3] = 0; continue; }
    const u = (col[p] + shift) % w, u0 = Math.floor(u), fu = u - u0, u1 = (u0 + 1) % w;
    const v0 = Math.floor(row[p]), fv = row[p] - v0, a = v0 * w, b = a + w;
    const g = (gray[a + u0] * (1 - fu) + gray[a + u1] * fu) * (1 - fv) + (gray[b + u0] * (1 - fu) + gray[b + u1] * fu) * fv;
    const value = Math.min(255, g * shade[p] * (dim + (lit - dim) * zoneW[p]) + ring * line[p]);
    out[p * 4] = out[p * 4 + 1] = out[p * 4 + 2] = value;
    out[p * 4 + 3] = alpha[p];
  }
  ctx.putImageData(image, 0, 0);
}

export default function MoonZone({ zone, checked = false, disabled = false }) {
  const canvasRef = useRef(null);
  const live = useRef({ checked });
  live.current.checked = checked;

  useEffect(() => {
    const canvas = canvasRef.current;
    const n = Math.round(SIZE * Math.min(3, window.devicePixelRatio || 1));
    canvas.width = canvas.height = n;
    const ctx = canvas.getContext("2d");
    const image = ctx.createImageData(n, n);
    const still = disabled || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, alive = true;

    loadPhoto(n * (ZONES[zone] || ZONES.moon).detail).then((photo) => {
      if (!alive) return;
      const s = sphere(n, zone, photo);
      canvas.dataset.ready = "";
      if (still) {                                    // sin movimiento: cara visible, estado actual
        const draw = () => paint(ctx, image, s, photo, 0, live.current.checked ? 1 : 0, 0);
        draw();
        live.current.redraw = draw;
        return;
      }
      let last = performance.now(), turn = 0, on = live.current.checked ? 1 : 0, beat = 0;
      const frame = (now) => {
        raf = requestAnimationFrame(frame);
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        on += ((live.current.checked ? 1 : 0) - on) * Math.min(1, dt * 7);   // entra y sale suave
        turn += dt / (TURN_S[0] + (TURN_S[1] - TURN_S[0]) * on);
        beat += dt;
        paint(ctx, image, s, photo, turn, on, Math.sin((beat / BREATH_S) * 2 * Math.PI));
      };
      raf = requestAnimationFrame(frame);
    }).catch(() => {});                               // sin foto queda el disco liso del CSS

    return () => { alive = false; cancelAnimationFrame(raf); live.current.redraw = null; };
  }, [zone, disabled]);

  // Sin animación, el icono se repinta solo cuando cambia la elección.
  useEffect(() => { live.current.redraw?.(); }, [checked]);

  return (
    <span className={`moonzone moonzone--${zone}`} aria-hidden="true">
      <canvas ref={canvasRef} style={{ width: SIZE, height: SIZE }} />
      <span className="moonzone__ping" />
    </span>
  );
}
