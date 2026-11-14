import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { L } from "../ds.js";
import { IconBtn } from "../ui/kit.jsx";
import { cellLatLon, fmtLatLon } from "../engine/globalScore.js";

// Mapa de toda la Luna (equirectangular, malla W4 1440 × 720). Relieve LOLA de fondo y
// la capa elegida encima con la rampa viridis (legible con daltonismo). Las celdas
// descartadas o sin datos se dibujan con trama, para no depender solo del color.
//   rueda: zoom en el cursor · arrastrar: mover · clic: elegir celda · 0: vista completa

const MAX_ZOOM = 12;

const VIRIDIS = (() => {
  const c = [[0.2777, 0.0054, 0.334], [0.105, 1.4046, 1.3845], [-0.3308, 0.2148, 0.095], [-4.6342, -5.7991, -19.3324],
    [6.2283, 14.1799, 56.6906], [4.7764, -13.7451, -65.353], [-5.4355, 4.6459, 26.3124]];
  const lut = new Uint8Array(256 * 3);
  for (let n = 0; n < 256; n++) {
    const t = n / 255;
    for (let ch = 0; ch < 3; ch++) {
      let v = 0;
      for (let k = 6; k >= 0; k--) v = v * t + c[k][ch];
      lut[n * 3 + ch] = Math.round(Math.max(0, Math.min(1, v)) * 255);
    }
  }
  return lut;
})();
export const viridisCss = () => `linear-gradient(90deg, ${[0, 64, 128, 192, 255].map((n) => `rgb(${VIRIDIS[n * 3]},${VIRIDIS[n * 3 + 1]},${VIRIDIS[n * 3 + 2]})`).join(",")})`;

export default function GlobalMap({ grid, hillshade, values, extent, invert, spots, selectedP, onSelect, onHover, opacity = 0.8, children }) {
  const { cols, rows } = grid;
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState({ zoom: 1, cx: cols / 2, cy: rows / 2 });
  const viewRef = useRef(view);
  const sizeRef = useRef(size);
  viewRef.current = view;
  sizeRef.current = size;
  const drag = useRef(null);

  useLayoutEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const base = (s) => Math.min(s.w / cols, s.h / rows);
  const scale = base(size) * view.zoom;

  // Capa coloreada (una imagen de 1440 × 720 que luego se escala).
  const dataCanvas = useMemo(() => {
    if (!values) return null;
    const c = document.createElement("canvas");
    c.width = cols; c.height = rows;
    const ctx = c.getContext("2d");
    const im = ctx.createImageData(cols, rows);
    const [lo, hi] = extent;
    for (let p = 0; p < values.length; p++) {
      const v = values[p], o = p * 4;
      if (!Number.isFinite(v)) {
        const i = Math.floor(p / cols), j = p % cols;
        const g = (i + j) % 6 < 2 ? 120 : 45;
        im.data[o] = im.data[o + 1] = im.data[o + 2] = g; im.data[o + 3] = 150;
        continue;
      }
      let t = hi > lo ? (v - lo) / (hi - lo) : 1;
      t = Math.max(0, Math.min(1, invert ? 1 - t : t));
      const n = Math.round(t * 255) * 3;
      im.data[o] = VIRIDIS[n]; im.data[o + 1] = VIRIDIS[n + 1]; im.data[o + 2] = VIRIDIS[n + 2]; im.data[o + 3] = 255;
    }
    ctx.putImageData(im, 0, 0);
    return c;
  }, [values, extent, invert, cols, rows]);

  const toScreen = useCallback((x, y) => [size.w / 2 + (x - view.cx) * scale, size.h / 2 + (y - view.cy) * scale], [size, view, scale]);
  const toGrid = (sx, sy) => {
    const s = sizeRef.current, v = viewRef.current, sc = base(s) * v.zoom;
    return [(sx - s.w / 2) / sc + v.cx, (sy - s.h / 2) / sc + v.cy];
  };

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !size.w) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(size.w * dpr); cv.height = Math.round(size.h * dpr);
    cv.style.width = `${size.w}px`; cv.style.height = `${size.h}px`;
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#050505";
    ctx.fillRect(0, 0, size.w, size.h);
    const [x0, y0] = toScreen(0, 0);
    ctx.imageSmoothingEnabled = true;
    if (hillshade) ctx.drawImage(hillshade, x0, y0, cols * scale, rows * scale);
    if (dataCanvas) {
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = hillshade ? opacity : 1;
      ctx.drawImage(dataCanvas, x0, y0, cols * scale, rows * scale);
      ctx.globalAlpha = 1;
    }
    // Retícula cada 30°
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 1;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "11px system-ui, sans-serif";
    for (let lon = -150; lon <= 150; lon += 30) {
      const [x] = toScreen((lon + 180) / grid.stepDeg, 0);
      ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + rows * scale); ctx.stroke();
      ctx.fillText(`${lon}°`, x + 3, Math.min(size.h, y0 + rows * scale) - 6);
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      const [, y] = toScreen(0, (90 - lat) / grid.stepDeg);
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + cols * scale, y); ctx.stroke();
      ctx.fillText(`${lat}°`, Math.max(0, x0) + 4, y - 4);
    }
  }, [size, view, scale, hillshade, dataCanvas, opacity, cols, rows, grid.stepDeg, toScreen]);

  const clamp = (v) => ({ zoom: Math.min(MAX_ZOOM, Math.max(1, v.zoom)), cx: Math.min(cols, Math.max(0, v.cx)), cy: Math.min(rows, Math.max(0, v.cy)) });
  const zoomAt = (f, sx, sy) => {
    const s = sizeRef.current;
    if (sx === undefined) { sx = s.w / 2; sy = s.h / 2; }
    setView((v) => {
      const zoom = Math.min(MAX_ZOOM, Math.max(1, v.zoom * f));
      const s0 = base(s) * v.zoom, s1 = base(s) * zoom;
      const gx = (sx - s.w / 2) / s0 + v.cx, gy = (sy - s.h / 2) / s0 + v.cy;
      return clamp({ zoom, cx: gx - (sx - s.w / 2) / s1, cy: gy - (sy - s.h / 2) / s1 });
    });
  };

  useEffect(() => {
    const el = wrapRef.current;
    const onWheel = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cellAt = (e) => {
    const r = wrapRef.current.getBoundingClientRect();
    const [gx, gy] = toGrid(e.clientX - r.left, e.clientY - r.top);
    const i = Math.floor(gy), j = Math.floor(gx);
    return i < 0 || j < 0 || i >= rows || j >= cols ? null : i * cols + j;
  };

  const onPointerDown = (e) => {
    if (e.target.closest("button, .overlay")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, v: viewRef.current, moved: false };
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (d) {
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
      const sc = base(sizeRef.current) * d.v.zoom;
      setView(clamp({ zoom: d.v.zoom, cx: d.v.cx - dx / sc, cy: d.v.cy - dy / sc }));
    }
    onHover?.(cellAt(e), e);
  };
  const onPointerUp = (e) => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) {
      const p = cellAt(e);
      if (p != null) onSelect?.(p);
    }
  };
  const onKeyDown = (e) => {
    if (e.key === "+" || e.key === "=") zoomAt(1.5);
    else if (e.key === "-") zoomAt(1 / 1.5);
    else if (e.key === "0") setView({ zoom: 1, cx: cols / 2, cy: rows / 2 });
  };

  const markerStyle = (p) => {
    const i = Math.floor(p / cols), j = p % cols;
    const [sx, sy] = toScreen(j + 0.5, i + 0.5);
    return { position: "absolute", left: sx - 14, top: sy - 14, zIndex: 2 };
  };

  return (
    <div
      ref={wrapRef}
      className="viewer"
      data-theme="dark"
      tabIndex={0}
      role="application"
      aria-label="Whole Moon map. Drag to pan, scroll to zoom, click a cell to see its score. + and − zoom, 0 resets."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { drag.current = null; }}
      onPointerLeave={() => onHover?.(null)}
      onKeyDown={onKeyDown}
    >
      <canvas ref={canvasRef} className="viewer__canvas" />
      {spots.map((s, k) => (
        <L.MapMarker
          key={`g-${s.p}`}
          label={`${fmtLatLon(s.lat, s.lon)} · ${Math.round(s.score)}`}
          shape="square"
          rank={k + 1}
          category="Best cell on the whole Moon"
          state={selectedP === s.p ? "selected" : "default"}
          showLabel={k < 3 || view.zoom >= 3}
          style={markerStyle(s.p)}
          onClick={() => onSelect?.(s.p)}
        />
      ))}
      {selectedP != null && !spots.some((s) => s.p === selectedP) ? (
        <L.MapMarker label={fmtLatLon(...cellLatLon(grid, selectedP))} shape="custom" state="selected" category="Cell you picked" style={markerStyle(selectedP)} />
      ) : null}
      <div className="viewer__zoom">
        <IconBtn icon="plus" label="Zoom in" variant="overlay" onClick={() => zoomAt(1.5)} />
        <IconBtn icon="minus" label="Zoom out" variant="overlay" onClick={() => zoomAt(1 / 1.5)} />
        <IconBtn icon="locate" label="Show the whole Moon" variant="overlay" onClick={() => setView({ zoom: 1, cx: cols / 2, cy: rows / 2 })} />
      </div>
      {children}
    </div>
  );
}
