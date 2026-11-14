import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { L, cssColor } from "../ds.js";
import { IconBtn } from "../ui/kit.jsx";
import { latLonToXY, xyToPixel } from "../engine/geometry.js";

// Visor del mapa del polo sur (siempre en tema oscuro, como pide el design system).
// Dibuja en un <canvas>: relieve sombreado + capa de datos coloreada.
// Los marcadores son componentes MapMarker del design system encima del canvas.
//
// Navegación:
//   rueda / trackpad  zoom centrado en el cursor (la página no se desplaza)
//   arrastrar         mover el mapa
//   pellizcar         zoom en pantallas táctiles
//   doble clic        acercar (Shift + doble clic: alejar)
//   clic              seleccionar ese píxel de 1 km y ver su puntuación
//   teclado           flechas mueven, + / − zoom, 0 vuelve a la vista completa

const MIN_ZOOM = 1;
const MAX_ZOOM = 16;
const NICE_KM = [1, 2, 5, 10, 20, 50, 100, 200];

/** Rampa de color de cada capa: (valor) -> [r, g, b, a 0-255] o null. */
function makeRamp(layer, colors, extent) {
  const { both, sun, earth, ink, lineStrong, relief } = colors;
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
    case "relief":
      return (v) => (Number.isFinite(v) ? [...relief, 235 * Math.min(1, v / 600) ** 0.8] : null);
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

export default function MapView({ data, layer, values, sites, spots, selected, onSelect, onHover, onPick, children }) {
  const grid = data.manifest.grid;
  const n = grid.n;
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState({ zoom: 1, cx: n / 2, cy: n / 2 });
  // Copias en refs para los listeners nativos (rueda, gestos), que no se recrean.
  const sizeRef = useRef(size);
  const viewRef = useRef(view);
  sizeRef.current = size;
  viewRef.current = view;
  const pointers = useRef(new Map());
  const gesture = useRef(null);

  // Tamaño del visor.
  useLayoutEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const baseScale = (s) => Math.min(s.w, s.h) / n;
  const scale = useMemo(() => baseScale(size) * view.zoom, [size, view.zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  const clampView = useCallback((v) => ({
    zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom)),
    cx: Math.min(n, Math.max(0, v.cx)),
    cy: Math.min(n, Math.max(0, v.cy)),
  }), [n]);

  /** Zoom manteniendo fijo el punto de pantalla (sx, sy). */
  const zoomAt = useCallback((factor, sx, sy) => {
    const s = sizeRef.current;
    if (sx === undefined) { sx = s.w / 2; sy = s.h / 2; }
    setView((v) => {
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
      const s0 = baseScale(s) * v.zoom;
      const s1 = baseScale(s) * zoom;
      const gx = (sx - s.w / 2) / s0 + v.cx;
      const gy = (sy - s.h / 2) / s0 + v.cy;
      return clampView({ zoom, cx: gx - (sx - s.w / 2) / s1, cy: gy - (sy - s.h / 2) / s1 });
    });
  }, [clampView]); // eslint-disable-line react-hooks/exhaustive-deps

  const local = (e) => {
    const r = wrapRef.current.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const toPixel = useCallback((sx, sy) => {
    const s = sizeRef.current, v = viewRef.current, sc = baseScale(s) * v.zoom;
    return [Math.floor((sy - s.h / 2) / sc + v.cy), Math.floor((sx - s.w / 2) / sc + v.cx)];
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const toScreen = useCallback((pi, pj) => [
    size.w / 2 + (pj + 0.5 - view.cx) * scale,
    size.h / 2 + (pi + 0.5 - view.cy) * scale,
  ], [size, view, scale]);
  const pixelIndex = (pi, pj) => (pi >= 0 && pj >= 0 && pi < n && pj < n ? pi * n + pj : null);

  // Rueda: listener nativo NO pasivo para poder impedir el scroll de la página.
  useEffect(() => {
    const el = wrapRef.current;
    const onWheel = (e) => {
      e.preventDefault();
      const [sx, sy] = local(e);
      // Ratón (pasos grandes) y trackpad (pasos finos) dan un zoom suave y proporcional.
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(Math.exp(-dy * 0.0022), sx, sy);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // Capa de datos -> imagen n×n.
  useEffect(() => {
    const el = wrapRef.current;
    const colors = {
      both: cssColor(el, "--both"), sun: cssColor(el, "--sun"), earth: cssColor(el, "--earth"),
      ink: cssColor(el, "--ink"), lineStrong: cssColor(el, "--line-strong"),
      relief: [179, 157, 219],
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

  // --- Puntero: arrastrar, pellizcar, clic ----------------------------------
  const onPointerDown = (e) => {
    if (e.target !== canvasRef.current) return; // los marcadores gestionan su propio clic
    wrapRef.current.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    const v = viewRef.current;
    if (pointers.current.size === 1) {
      const [x, y] = local(e);
      gesture.current = { type: "pan", x, y, cx: v.cx, cy: v.cy, moved: false };
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { type: "pinch", d: Math.hypot(a[0] - b[0], a[1] - b[1]), moved: true };
    }
  };
  const onPointerMove = (e) => {
    const [sx, sy] = local(e);
    if (e.pointerType === "mouse") onHover?.(pixelIndex(...toPixel(sx, sy)));
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, [sx, sy]);
    const g = gesture.current;
    if (!g) return;
    if (g.type === "pan") {
      const dx = sx - g.x, dy = sy - g.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) g.moved = true;
      const sc = baseScale(sizeRef.current) * viewRef.current.zoom;
      setView((v) => clampView({ ...v, cx: g.cx - dx / sc, cy: g.cy - dy / sc }));
    } else if (g.type === "pinch" && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (g.d > 0) zoomAt(d / g.d, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      g.d = d;
    }
  };
  const onPointerUp = (e) => {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (g?.type === "pan" && !g.moved) {
      const p = pixelIndex(...toPixel(...local(e)));
      if (p != null) onPick?.(p);
    }
    if (pointers.current.size === 0) gesture.current = null;
    else if (pointers.current.size === 1) {
      // Tras un pellizco, seguir moviendo con el dedo que queda.
      const [pt] = [...pointers.current.values()];
      const v = viewRef.current;
      gesture.current = { type: "pan", x: pt[0], y: pt[1], cx: v.cx, cy: v.cy, moved: true };
    }
  };
  const onDoubleClick = (e) => {
    if (e.target !== canvasRef.current) return;
    const [sx, sy] = local(e);
    zoomAt(e.shiftKey ? 1 / 2 : 2, sx, sy);
  };
  const resetView = () => setView({ zoom: 1, cx: n / 2, cy: n / 2 });
  const onKeyDown = (e) => {
    const step = 40 / scale;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) { e.preventDefault(); setView((v) => clampView({ ...v, cx: v.cx + moves[e.key][0], cy: v.cy + moves[e.key][1] })); }
    else if (e.key === "+" || e.key === "=") zoomAt(1.5);
    else if (e.key === "-" || e.key === "_") zoomAt(1 / 1.5);
    else if (e.key === "0") resetView();
  };

  // Centrar en lo seleccionado (punto caliente, región o punto elegido).
  useEffect(() => {
    if (!selected) return;
    setView((v) => clampView({ zoom: Math.max(v.zoom, 3), cx: selected.j + 0.5, cy: selected.i + 0.5 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.key]);

  // Barra de escala: el largo "bonito" (1, 2, 5, 10… km) que ocupa ~80-160 px.
  const pxPerKm = scale / (grid.pxM / 1000);
  const barKm = NICE_KM.find((k) => k * pxPerKm >= 80) || NICE_KM[NICE_KM.length - 1];

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
      aria-label="South pole map. Drag to pan, scroll or pinch to zoom, double-click to zoom in, click a spot to score it. Arrow keys move, + and − zoom, 0 resets."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => onHover?.(null)}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
    >
      <canvas ref={canvasRef} className="viewer__canvas" />
      {sites.map((s) => {
        const [clat, clon] = s.centre || [s.lat, s.lon];
        const [x, y] = latLonToXY(grid, clat, clon);
        const [i, j] = xyToPixel(grid, x, y);
        if (!inView(i, j)) return null;
        const label = Number.isFinite(s.score) ? `${s.name} · ${Math.round(s.score)}` : s.name;
        return (
          <L.MapMarker
            key={s.id}
            label={label}
            shape="circle"
            category="Artemis III candidate region"
            state={selected?.key === `site-${s.id}` ? "selected" : "default"}
            showLabel={view.zoom >= 2}
            style={markerPos(i, j)}
            onClick={() => onSelect?.({ type: "site", id: s.id })}
          />
        );
      })}
      {spots.map((s) => (inView(s.i, s.j) ? (
        <L.MapMarker
          key={`spot-${s.rank}`}
          label={`${s.name} · ${Math.round(s.peakScore)}`}
          shape="square"
          rank={s.rank}
          category="Best spot for this mission"
          state={selected?.key === `spot-${s.rank}` ? "selected" : "default"}
          showLabel={s.rank <= 3 || view.zoom >= 3}
          style={markerPos(s.i, s.j)}
          onClick={() => onSelect?.({ type: "spot", rank: s.rank })}
        />
      ) : null))}
      {selected?.type === "pick" && inView(selected.i, selected.j) ? (
        <L.MapMarker label={selected.name} shape="custom" state="selected" category="Spot you picked" style={markerPos(selected.i, selected.j)} />
      ) : null}
      <div className="viewer__zoom">
        <IconBtn icon="plus" label="Zoom in" variant="overlay" onClick={() => zoomAt(1.5)} />
        <IconBtn icon="minus" label="Zoom out" variant="overlay" onClick={() => zoomAt(1 / 1.5)} />
        <IconBtn icon="locate" label="Show the whole map" variant="overlay" onClick={resetView} />
      </div>
      <div className="viewer__scale" aria-label={`Scale: ${barKm} km`}>
        <span className="viewer__scalebar" style={{ width: barKm * pxPerKm }} />
        <span className="caption">{barKm} km</span>
        <span className="caption lh-muted">· ×{view.zoom.toFixed(1)}</span>
      </div>
      {children}
    </div>
  );
}
