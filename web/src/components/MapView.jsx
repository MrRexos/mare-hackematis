import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { L, cssColor } from "../ds.js";
import { latLonToXY, xyToPixel } from "../engine/geometry.js";

// Visor del mapa del polo sur (siempre en tema oscuro, como pide el design system).
// Dibuja en un <canvas>: relieve sombreado + capa de datos coloreada.
// Los marcadores son componentes MapMarker del design system encima del canvas.

const MIN_ZOOM = 1;
const MAX_ZOOM = 10;

/** Rampa de color de cada capa: (valor) -> [r, g, b, a 0-255] o null. */
function makeRamp(layer, colors, extent) {
  const { both, sun, earth, ink, lineStrong } = colors;
  switch (layer.ramp) {
    case "score": {
      const [lo, hi] = extent;
      // La mitad baja casi transparente; el brillo se concentra en lo mejor.
      return (v) => {
        if (!Number.isFinite(v)) return null;
        const t = hi > lo ? (v - lo) / (hi - lo) : 1;
        const a = t < 0.5 ? 50 * t : 25 + 230 * ((t - 0.5) / 0.5) ** 1.7;
        return [...both, a];
      };
    }
    case "sun":
    case "earth": {
      // Escala de 0 al máximo de la capa (la leyenda muestra ese máximo).
      const color = layer.ramp === "sun" ? sun : earth;
      const hi = extent[1] > 0 ? extent[1] : 1;
      return (v) => {
        if (!Number.isFinite(v)) return null;
        const t = Math.max(0, Math.min(1, v / hi));
        return [...color, 235 * t ** 1.6];
      };
    }
    case "slope":
      return (v) => (Number.isFinite(v) ? [...ink, 230 * Math.min(1, v / 30)] : null);
    case "shadow":
      // valor codificado: <0 = sombra permanente (trama), 0..1 = cercanía
      return (v, i, j) => {
        if (!Number.isFinite(v)) return null;
        if (v < 0) return (i + j) % 3 === 0 ? [...lineStrong, 255] : [0, 0, 0, 120];
        return [...ink, 200 * v];
      };
    default:
      return () => null;
  }
}

export default function MapView({ data, layer, values, sites, spots, selected, onSelect, onHover, children }) {
  const grid = data.manifest.grid;
  const n = grid.n;
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState({ zoom: 1, cx: n / 2, cy: n / 2 });
  const drag = useRef(null);

  // Tamaño del visor.
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // Capa de datos -> imagen n×n.
  useEffect(() => {
    const el = wrapRef.current;
    const colors = {
      both: cssColor(el, "--both"), sun: cssColor(el, "--sun"), earth: cssColor(el, "--earth"),
      ink: cssColor(el, "--ink"), lineStrong: cssColor(el, "--line-strong"),
    };
    let lo = Infinity, hi = -Infinity;
    if (values) for (const v of values) if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const ramp = makeRamp(layer, colors, [lo, hi]);
    const c = overlayRef.current || (overlayRef.current = document.createElement("canvas"));
    c.width = n; c.height = n;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(n, n);
    if (values) {
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const p = i * n + j;
        const rgba = ramp(values[p], i, j);
        if (!rgba) continue;
        img.data.set([rgba[0], rgba[1], rgba[2], rgba[3]], p * 4);
      }
    }
    ctx.putImageData(img, 0, 0);
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, layer]);

  const scale = useMemo(() => (Math.min(size.w, size.h) / n) * view.zoom, [size, view.zoom, n]);
  const toScreen = useCallback((pi, pj) => [
    size.w / 2 + (pj + 0.5 - view.cx) * scale,
    size.h / 2 + (pi + 0.5 - view.cy) * scale,
  ], [size, view, scale]);
  const toPixel = useCallback((sx, sy) => [
    Math.floor((sy - size.h / 2) / scale + view.cy),
    Math.floor((sx - size.w / 2) / scale + view.cx),
  ], [size, view, scale]);

  const draw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv || !size.w) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(size.w * dpr);
    cv.height = Math.round(size.h * dpr);
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    const x0 = size.w / 2 - view.cx * scale;
    const y0 = size.h / 2 - view.cy * scale;
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = !values ? 0.9 : layer.ramp === "score" ? 0.3 : 0.5;
    if (data.hillshade) ctx.drawImage(data.hillshade, x0, y0, n * scale, n * scale);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = view.zoom < 3;
    if (overlayRef.current) ctx.drawImage(overlayRef.current, x0, y0, n * scale, n * scale);
  }, [size, view, scale, values, layer, data.hillshade, n]);

  useEffect(draw, [draw]);

  // --- Interacción: arrastrar, rueda, teclado -----------------------------
  const clampView = (v) => ({
    zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom)),
    cx: Math.min(n, Math.max(0, v.cx)),
    cy: Math.min(n, Math.max(0, v.cy)),
  });
  const zoomAt = (factor, sx = size.w / 2, sy = size.h / 2) => {
    setView((v) => {
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
      const s0 = (Math.min(size.w, size.h) / n) * v.zoom;
      const s1 = (Math.min(size.w, size.h) / n) * zoom;
      const gx = (sx - size.w / 2) / s0 + v.cx;
      const gy = (sy - size.h / 2) / s0 + v.cy;
      return clampView({ zoom, cx: gx - (sx - size.w / 2) / s1, cy: gy - (sy - size.h / 2) / s1 });
    });
  };
  const onWheel = (e) => {
    const r = wrapRef.current.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - r.left, e.clientY - r.top);
  };
  const onPointerDown = (e) => {
    if (e.target !== canvasRef.current) return;
    drag.current = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    const r = wrapRef.current.getBoundingClientRect();
    const [pi, pj] = toPixel(e.clientX - r.left, e.clientY - r.top);
    onHover?.(pi >= 0 && pj >= 0 && pi < n && pj < n ? pi * n + pj : null);
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    setView((v) => clampView({ ...v, cx: d.cx - dx / scale, cy: d.cy - dy / scale }));
  };
  const onPointerUp = () => { drag.current = null; };
  const onKeyDown = (e) => {
    const step = 20 / scale;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) { e.preventDefault(); setView((v) => clampView({ ...v, cx: v.cx + moves[e.key][0], cy: v.cy + moves[e.key][1] })); }
    if (e.key === "+" || e.key === "=") zoomAt(1.4);
    if (e.key === "-") zoomAt(1 / 1.4);
  };

  // Centrar en el punto seleccionado.
  useEffect(() => {
    if (!selected) return;
    setView((v) => clampView({ zoom: Math.max(v.zoom, 3), cx: selected.j + 0.5, cy: selected.i + 0.5 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.rank]);

  const markerPos = (i, j) => {
    const [sx, sy] = toScreen(i, j);
    return { position: "absolute", left: sx - 14, top: sy - 14, zIndex: 2 };
  };
  const inView = (i, j) => {
    const [sx, sy] = toScreen(i, j);
    return sx > -20 && sy > -20 && sx < size.w + 20 && sy < size.h + 20;
  };

  return (
    <div
      ref={wrapRef}
      className="viewer"
      data-theme="dark"
      tabIndex={0}
      role="application"
      aria-label="South pole map. Drag to pan, scroll or press + and − to zoom, arrow keys to move."
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => onHover?.(null)}
      onKeyDown={onKeyDown}
    >
      <canvas ref={canvasRef} className="viewer__canvas" />
      {sites.map((s) => {
        const [x, y] = latLonToXY(grid, s.lat, s.lon);
        const [i, j] = xyToPixel(grid, x, y);
        if (!inView(i, j)) return null;
        return <L.MapMarker key={s.id} label={s.name} shape="circle" category="Artemis III candidate region" showLabel={view.zoom >= 2.5} style={markerPos(i, j)} />;
      })}
      {spots.map((s) => (inView(s.i, s.j) ? (
        <L.MapMarker
          key={`spot-${s.rank}`}
          label={s.name}
          shape="square"
          rank={s.rank}
          category="Best spot for this mission"
          state={selected?.rank === s.rank ? "selected" : "default"}
          showLabel={s.rank <= 3}
          style={markerPos(s.i, s.j)}
          onClick={() => onSelect?.(s)}
        />
      ) : null))}
      <div className="viewer__zoom">
        <L.IconButton icon="plus" label="Zoom in" variant="overlay" size="sm" onClick={() => zoomAt(1.5)} />
        <L.IconButton icon="minus" label="Zoom out" variant="overlay" size="sm" onClick={() => zoomAt(1 / 1.5)} />
        <L.IconButton icon="locate-fixed" label="Reset view" variant="overlay" size="sm" onClick={() => setView({ zoom: 1, cx: n / 2, cy: n / 2 })} />
      </div>
      {children}
    </div>
  );
}
