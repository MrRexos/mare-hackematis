import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { L, cssColor } from "../ds.js";
import { IconBtn } from "../ui/kit.jsx";
import { formatLatLon, latLonToXY, xyToPixel } from "../engine/geometry.js";
import { ROUGH_MAX_M } from "../engine/score.js";
import iceDetections from "../data/iceDetections.json";

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
  const { both, sun, earth, ink, lineStrong, relief, temp } = colors;
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
    case "rough":
      // LOLA LDRM en metros; tope visual en ROUGH_MAX_M (el mismo que la puntuación).
      return (v) => (Number.isFinite(v) ? [...relief, 235 * Math.min(1, v / ROUGH_MAX_M) ** 0.8] : null);
    case "elevation":
    case "temp": {
      const [lo, hi] = extent;
      const color = layer.ramp === "elevation" ? ink : temp;
      return (v) => {
        if (!Number.isFinite(v)) return null;
        const t = hi > lo ? (v - lo) / (hi - lo) : 1;
        return [...color, 30 + 215 * t ** 1.2];
      };
    }
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

export default function MapView({ data, layer, values, sites, spots, selected, selectionKey = selected?.key, onSelect, onPick, showIceEvidence, hoverPixel, onHover, children }) {
  const grid = data.manifest.grid;
  const n = grid.n;
  const [iceRegions, setIceRegions] = useState(null);
  const [iceRegionError, setIceRegionError] = useState(false);
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState({ zoom: 1, cx: n / 2, cy: n / 2 });
  const centeredKey = useRef(null);
  const [impactOpen, setImpactOpen] = useState(false);
  const impactButton = useRef(null);
  useEffect(() => {
    if (!showIceEvidence || iceRegions) return undefined;
    let cancelled = false;
    setIceRegionError(false);
    import("../data/iceEvidence.json")
      .then(({ default: data }) => { if (!cancelled) setIceRegions(data.regions); })
      .catch(() => { if (!cancelled) setIceRegionError(true); });
    return () => { cancelled = true; };
  }, [showIceEvidence, iceRegions]);
  const evidencePath = useMemo(() => {
    if (!iceRegions) return null;
    const path = new Path2D();
    for (const region of iceRegions) {
      for (const ring of region) {
        ring.forEach(([x, y], i) => {
          const j = (x + grid.halfM) / grid.pxM;
          const row = (grid.halfM - y) / grid.pxM;
          if (i === 0) path.moveTo(j, row);
          else path.lineTo(j, row);
        });
        path.closePath();
      }
    }
    return path;
  }, [grid, iceRegions]);
  const detections = useMemo(() => iceDetections.points
    .map(([x, y]) => xyToPixel(grid, x, y))
    .filter(([i, j]) => i >= -0.5 && j >= -0.5 && i < n - 0.5 && j < n - 0.5), [grid, n]);
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
      if (e.target.closest(".overlay, .viewer__zoom")) return;
      e.preventDefault();
      onHover(null);
      const [sx, sy] = local(e);
      // Ratón (pasos grandes) y trackpad (pasos finos) dan un zoom suave y proporcional.
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(Math.exp(-dy * 0.0022), sx, sy);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt, onHover]);

  // Capa de datos -> imagen n×n.
  useEffect(() => {
    const el = wrapRef.current;
    const colors = {
      both: cssColor(el, "--both"), sun: cssColor(el, "--sun"), earth: cssColor(el, "--earth"),
      ink: cssColor(el, "--ink"), lineStrong: cssColor(el, "--line-strong"),
      relief: [179, 157, 219],
      temp: [242, 139, 84],
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
    if (showIceEvidence && scale > 0) {
      const color = cssColor(wrapRef.current, "--earth").join(", ");
      if (evidencePath) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, y0, n * scale, n * scale);
        ctx.clip();
        ctx.translate(x0, y0);
        ctx.scale(scale, scale);
        ctx.fillStyle = `rgba(${color}, 0.25)`;
        ctx.strokeStyle = `rgb(${color})`;
        ctx.lineWidth = 1.4 / scale;
        ctx.fill(evidencePath, "evenodd");
        ctx.stroke(evidencePath);
        ctx.restore();
      }
      ctx.beginPath();
      for (const [i, j] of detections) {
        const x = x0 + (j + 0.5) * scale;
        const y = y0 + (i + 0.5) * scale;
        if (x < 0 || y < 0 || x > size.w || y > size.h) continue;
        ctx.moveTo(x + 1.9, y);
        ctx.arc(x, y, 1.9, 0, 2 * Math.PI);
      }
      ctx.fillStyle = `rgb(${color})`;
      ctx.fill();
      ctx.strokeStyle = "rgba(0, 0, 0, 0.65)";
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
  }, [size, view, scale, values, layer, data.hillshade, n, evidencePath, detections, showIceEvidence]);

  useEffect(draw, [draw]);

  // --- Puntero: arrastrar, pellizcar, clic ----------------------------------
  const onPointerDown = (e) => {
    if (e.target !== canvasRef.current) return; // los marcadores gestionan su propio clic
    onHover(null);
    setImpactOpen(false);
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
    if (e.pointerType === "mouse") {
      const hover = e.target === canvasRef.current && !gesture.current;
      onHover(hover ? pixelIndex(...toPixel(sx, sy)) : null);
    }
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
    if (!pointers.current.has(e.pointerId)) return;
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (e.type === "pointerup" && g?.type === "pan" && !g.moved) {
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
    if (e.target !== wrapRef.current) return;
    const step = 40 / scale;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) { e.preventDefault(); setView((v) => clampView({ ...v, cx: v.cx + moves[e.key][0], cy: v.cy + moves[e.key][1] })); }
    else if (e.key === "+" || e.key === "=") zoomAt(1.5);
    else if (e.key === "-" || e.key === "_") zoomAt(1 / 1.5);
    else if (e.key === "0") resetView();
    else if (e.key === "Enter" && size.w) {
      const pixel = pixelIndex(...toPixel(size.w / 2, size.h / 2));
      if (pixel != null) onPick?.(pixel);
    }
  };

  // Centrar en lo seleccionado (punto caliente, región o punto elegido).
  const resolvedKey = selected?.key;
  useEffect(() => {
    if (!selectionKey) centeredKey.current = null;
    if (!resolvedKey || centeredKey.current === resolvedKey) return;
    centeredKey.current = resolvedKey;
    setView((v) => {
      const zoom = Math.max(v.zoom, 3);
      const viewport = sizeRef.current;
      const sc = baseScale(viewport) * zoom;
      const verticalOffset = viewport.w < 560 && sc > 0 ? 0.12 * viewport.h / sc : 0;
      return clampView({ zoom, cx: selected.j + 0.5, cy: selected.i + 0.5 - verticalOffset });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, resolvedKey]);

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
  const impact = iceDetections.impact;
  const [impactI, impactJ] = xyToPixel(grid, ...latLonToXY(grid, impact.lat, impact.lon));
  const hover = hoverPixel == null ? null : toScreen(Math.floor(hoverPixel / n), hoverPixel % n);

  useEffect(() => {
    if (!showIceEvidence) setImpactOpen(false);
  }, [showIceEvidence]);

  return (
    <div
      ref={wrapRef}
      className="viewer"
      data-theme="dark"
      tabIndex={0}
      role="application"
      aria-label="South pole map. Drag or use arrow keys to pan. Scroll, pinch or use plus and minus to zoom. Select a point for ground data. Enter selects the centre and 0 resets the map."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => onHover(null)}
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
            category="Artemis III reference region"
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
          category="Candidate calculated for this mission"
          state={selected?.key === `spot-${s.rank}` ? "selected" : "default"}
          showLabel={s.rank <= 3 || view.zoom >= 3}
          style={markerPos(s.i, s.j)}
          onClick={() => onSelect?.({ type: "spot", rank: s.rank })}
        />
      ) : null))}
      {selected?.type === "pick" && inView(selected.i, selected.j) ? (
        <L.MapMarker label={selected.name} shape="custom" state="selected" category="Spot you picked" style={markerPos(selected.i, selected.j)} />
      ) : null}
      {showIceEvidence && inView(impactI, impactJ) && (
        <button type="button" ref={impactButton} className="ice-impact" style={markerPos(impactI, impactJ)}
          aria-label={impact.name} title={impact.name} aria-expanded={impactOpen}
          onClick={() => setImpactOpen((open) => !open)}
        ><span className="ice-impact-key" /></button>
      )}
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
      {showIceEvidence && iceRegionError && <p className="overlay mapnote" role="status">Ice-region outlines could not be loaded.</p>}
      {showIceEvidence && impactOpen && (
        <section className="overlay impact-card" aria-label="LCROSS observation">
          <div className="row-8">
            <strong className="grow">{impact.name}</strong>
            <IconBtn icon="x" label="Close LCROSS details" variant="ghost" size={28} onClick={() => {
              setImpactOpen(false);
              impactButton.current?.focus({ preventScroll: true });
            }} />
          </div>
          <div className="coords">{formatLatLon(impact.lat, impact.lon, 4)}</div>
          <p>LCROSS detected water in material excavated here in 2009.</p>
          <a href={impact.studyUrl} target="_blank" rel="noreferrer">Read the LCROSS study</a>
        </section>
      )}
      {hover && <span className="map-cursor" style={{ left: hover[0], top: hover[1], width: Math.max(4, scale), height: Math.max(4, scale) }} />}
    </div>
  );
}
