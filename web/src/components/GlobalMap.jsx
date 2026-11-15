import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { L, cssColor } from "../ds.js";
import { makeRamp } from "./MapView.jsx";
import { IconBtn } from "../ui/kit.jsx";
import { LANDMARKS } from "../data/landmarks.js";

// Mapa de toda la Luna (equirectangular, malla global de 0,5°). Mismo aspecto que el visor
// del polo sur (MapView): relieve LOLA de fondo y la capa elegida encima, cada propiedad con
// su propia escala de color (engine/globalRamps.js); las celdas descartadas quedan sin color.
// Marcadores: cuadrado = celda calculada; círculo = sitio de referencia (alunizajes Apollo).
//   rueda: zoom en el cursor · arrastrar: mover · clic: elegir celda · 0: vista completa

const MAX_ZOOM = 12;

/**
 * Imagen de una capa (una celda = un píxel, transparente donde no hay dato o la celda está
 * descartada). La usan el mapa 2D y el globo 3D, así los colores son los mismos en los dos.
 * `el` es un elemento del visor, para leer los colores del design system.
 */
export function layerCanvas(el, layer, values, cols, rows) {
  const colors = {
    both: cssColor(el, "--both"), sun: cssColor(el, "--sun"), earth: cssColor(el, "--earth"),
    ink: cssColor(el, "--ink"), lineStrong: cssColor(el, "--line-strong"),
    relief: [179, 157, 219], temp: [242, 139, 84],
  };
  let lo = Infinity, hi = -Infinity;
  for (const v of values) if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const ramp = makeRamp(layer, colors, [lo, hi]);
  const c = document.createElement("canvas");
  c.width = cols; c.height = rows;
  const ctx = c.getContext("2d");
  const im = ctx.createImageData(cols, rows);
  for (let p = 0; p < values.length; p++) {
    const rgba = ramp(values[p], Math.floor(p / cols), p % cols);
    if (rgba) im.data.set([rgba[0], rgba[1], rgba[2], rgba[3]], p * 4);
  }
  ctx.putImageData(im, 0, 0);
  return c;
}

export default function GlobalMap({ grid, hillshade, layer, values, spots, sites = [], selectedP, onSelect, onHover, children }) {
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

  // Capa coloreada: una imagen del tamaño de la malla que luego se escala (como en MapView).
  const [dataCanvas, setDataCanvas] = useState(null);
  useEffect(() => {
    setDataCanvas(values && wrapRef.current ? layerCanvas(wrapRef.current, layer, values, cols, rows) : null);
  }, [values, layer, cols, rows]);

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
    ctx.clearRect(0, 0, size.w, size.h);
    const [x0, y0] = toScreen(0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = !dataCanvas ? 0.9 : layer?.ramp === "score" ? 0.3 : 0.5;
    if (hillshade) ctx.drawImage(hillshade, x0, y0, cols * scale, rows * scale);
    ctx.globalAlpha = 1;
    if (dataCanvas) {
      ctx.imageSmoothingEnabled = view.zoom < 3;
      ctx.drawImage(dataCanvas, x0, y0, cols * scale, rows * scale);
    }
    // Retícula cada 30°, discreta (el polo sur lleva barra de escala; aquí orientan las coordenadas).
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    ctx.fillStyle = "rgba(255,255,255,0.45)";
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
  }, [size, view, scale, hillshade, dataCanvas, layer, cols, rows, grid.stepDeg, toScreen]);

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
  /** Marcador en un punto exacto (latitud y longitud), no en el centro de su celda. */
  const pointStyle = (lat, lon) => {
    const [sx, sy] = toScreen((lon - grid.lon0) / grid.stepDeg, (grid.lat0 - lat) / grid.stepDeg);
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
      {sites.map((s) => (
        <L.MapMarker
          key={`ref-${s.site.id}`}
          label={Number.isFinite(s.score) ? `${s.name} · ${Math.round(s.score)}` : s.name}
          shape="circle"
          category={s.kindLabel}
          state={selectedP === s.p ? "selected" : "default"}
          showLabel={selectedP === s.p || view.zoom >= 3}
          style={pointStyle(...s.centre)}
          onClick={() => onSelect?.(s.p)}
        />
      ))}
      {spots.map((s, k) => (
        <L.MapMarker
          key={`g-${s.p}`}
          label={`Hotspot ${String(k + 1).padStart(2, "0")} · ${Math.round(s.score)}`}
          shape="square"
          rank={k + 1}
          category="Calculated candidate"
          state={selectedP === s.p ? "selected" : "default"}
          showLabel={k < 3 || view.zoom >= 3}
          style={markerStyle(s.p)}
          onClick={() => onSelect?.(s.p)}
        />
      ))}
      {LANDMARKS.map((l) => {
        const p = Math.floor((grid.lat0 - l.lat) / grid.stepDeg) * cols + Math.floor((((l.lon - grid.lon0) % 360 + 360) % 360) / grid.stepDeg);
        // Si el ranking Apollo ya marca esta celda, no se repite el marcador.
        if (sites.some((s) => s.p === p)) return null;
        return <L.MapMarker key={l.id} label={l.name.split(" · ")[0]} shape="circle" category="Apollo landing site" state={selectedP === p ? "selected" : "default"}
          showLabel style={markerStyle(p)} onClick={() => onSelect?.(p)} />;
      })}
      {selectedP != null && !spots.some((s) => s.p === selectedP) && !sites.some((s) => s.p === selectedP) ? (
        <L.MapMarker label="Your spot" shape="custom" state="selected" category="Your spot" style={markerStyle(selectedP)} />
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
