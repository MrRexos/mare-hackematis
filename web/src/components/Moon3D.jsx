import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { L, cssColor } from "../ds.js";
import { DEG, formatUtc, latLonToXY, localFrame, pixelXY, xyToPixel, xyToUnit } from "../engine/geometry.js";

// Vista 3D del polo activo (sur o norte, según data.manifest.grid.pole).
// - Relieve: elevación LOLA de la malla de 1 km, sobre la esfera lunar real
//   (la curvatura baja ~11 km en el borde, más que el propio relieve).
// - Sol y Tierra: en su dirección real (SPICE) para el instante de la TimeBar.
// - Luz: cada punto está iluminado solo si el Sol está por encima de SU horizonte
//   real (los mismos horizontes que el mapa), con la fracción de disco visible.
//   Las sombras no salen de un truco gráfico: salen del relieve.
//
// Marco de la escena (km): X = MOON_ME.y (90°E a la derecha), Y = arriba en el polo.
// Polo sur: Z = −MOON_ME.x (la longitud 0° hacia el fondo, como "arriba" en el mapa).
// Polo norte: Z = +MOON_ME.x (la longitud 0° hacia la cámara, como "abajo" en su mapa).
// Las dos son rotaciones puras (sin espejo), así que el relieve no sale invertido.

const SUN_RADIUS_KM = 695700;
const EARTH_RADIUS_KM = 6378.1366;
const SKY_DIST_KM = 900;  // distancia a la que se dibujan el Sol y la Tierra
const SUN_ENLARGE = 6;
const EARTH_ENLARGE = 3;
const SCENE = {
  south: (x, y, z, R) => [y, -z - R, -x],
  north: (x, y, z, R) => [y, z - R, x],
};

function srgbToLinear(c) {
  return (c / 255) ** 2.2;
}

export default function Moon3D({ data, mission, result, sites, spots, selected, selectionKey = selected?.key, viewSwitch, toolbarActions, timeMs: extTime, onTimeChange, onSelect }) {
  const { manifest, layers, horizon, ephem } = data;
  const grid = manifest.grid;
  const n = grid.n;
  const north = grid.pole === "north";
  const toScene = north ? SCENE.north : SCENE.south;
  const R = grid.radiusM / 1000;
  const hz = manifest.horizon;
  const em = manifest.ephem;

  const wrapRef = useRef(null);
  const three = useRef(null);
  const cameraFocus = useRef(null);
  const [mode, setMode] = useState("sun");
  const [exag, setExag] = useState(3);
  const [aid, setAid] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [labels, setLabels] = useState([]);

  // Rango de tiempo: la misión calculada, o la ventana elegida.
  const span = useMemo(() => {
    const start = result ? result.startMs : mission.windowStartMs;
    const end = result
      ? result.startMs + (result.landingHours + result.durationH) * 3600e3
      : mission.windowEndMs + mission.durationDays * 86400e3;
    const ephemEnd = em.startUnixMs + (em.count - 2) * em.stepSeconds * 1000;
    return [Math.max(start, em.startUnixMs), Math.min(end, ephemEnd)];
  }, [result, mission, em]);
  const bestMs = selected?.metrics && result ? result.startMs + selected.metrics.best * result.stepMs : null;
  // Con timeMs/onTimeChange la vista sigue el reloj compartido de la app (TimeBar externa).
  const external = extTime != null && !!onTimeChange;
  const [ownTime, setOwnTime] = useState(() => bestMs ?? span[0]);
  const timeMs = external ? extTime : ownTime;
  const setTimeMs = external ? onTimeChange : setOwnTime;
  useEffect(() => { if (!external && bestMs != null) setOwnTime(bestMs); }, [bestMs, external]);
  useEffect(() => { if (!external) setOwnTime((t) => Math.min(span[1], Math.max(span[0], t))); }, [span, external]);

  // Punto de referencia para las lecturas: lo seleccionado o el polo.
  const refPixel = selected ? selected.p : (n / 2) * n + n / 2;

  // --- Datos por vértice (una vez) ------------------------------------------
  const pre = useMemo(() => {
    const N = n * n;
    const frame = new Float32Array(N * 9); // up, east, north (MOON_ME)
    const unit = new Float32Array(N * 3);
    const h = new Float32Array(N);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const p = i * n + j;
      const [x, y] = pixelXY(grid, i, j);
      const u = xyToUnit(grid.radiusM, x, y, grid.pole);
      const [up, east, north] = localFrame(u);
      frame.set(up, p * 9); frame.set(east, p * 9 + 3); frame.set(north, p * 9 + 6);
      unit.set(u, p * 3);
      const e = layers.elevation[p];
      h[p] = Number.isFinite(e) ? e : 0;
    }
    return { frame, unit, h };
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Escena (una vez) -------------------------------------------------------
  useEffect(() => {
    const wrap = wrapRef.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const bg = cssColor(wrap, "--canvas");
    renderer.setClearColor(new THREE.Color(`rgb(${bg.join(",")})`), 1);
    wrap.prepend(renderer.domElement);
    renderer.domElement.className = "viewer__canvas";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 6000);
    camera.position.set(0, 230, 330);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 8;
    controls.maxDistance = 1400;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.screenSpacePanning = false;

    // Malla del terreno.
    const geom = new THREE.BufferGeometry();
    const pos = new Float32Array(n * n * 3);
    const col = new Float32Array(n * n * 3);
    geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geom.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const idx = new Uint32Array((n - 1) * (n - 1) * 6);
    let k = 0;
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < n - 1; j++) {
      const a = i * n + j, b = a + 1, c = a + n, d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b;
      idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
    geom.setIndex(new THREE.BufferAttribute(idx, 1));
    const terrain = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    scene.add(terrain);

    // Sol y Tierra (agrandados, ver aviso en pantalla).
    const sunC = cssColor(wrap, "--sun"), earthC = cssColor(wrap, "--earth");
    const sunR = SKY_DIST_KM * Math.tan((0.267 * Math.PI) / 180) * SUN_ENLARGE;
    const earthR = SKY_DIST_KM * Math.tan((0.95 * Math.PI) / 180) * EARTH_ENLARGE;
    const mkBody = (r, c) => {
      const g = new THREE.Group();
      const solid = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(`rgb(${c.join(",")})`) }));
      const ring = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(`rgb(${c.join(",")})`), wireframe: true }));
      g.add(solid, ring);
      scene.add(g);
      return { g, solid, ring };
    };
    const sun = mkBody(sunR, sunC);
    const earth = mkBody(earthR, earthC);

    // Línea del horizonte "matemático" del polo (círculo a la altura del suelo), como referencia.
    const ringPts = [];
    for (let a = 0; a <= 128; a++) ringPts.push(new THREE.Vector3(Math.cos((a / 128) * 2 * Math.PI) * SKY_DIST_KM, 0, Math.sin((a / 128) * 2 * Math.PI) * SKY_DIST_KM));
    const lineC = cssColor(wrap, "--line-strong");
    const horizonRing = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ringPts), new THREE.LineDashedMaterial({ color: new THREE.Color(`rgb(${lineC.join(",")})`), dashSize: 12, gapSize: 10 }));
    horizonRing.computeLineDistances();
    scene.add(horizonRing);

    // Marcador vertical del punto de referencia.
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    scene.add(pin);

    const resize = () => {
      const w = wrap.clientWidth, hgt = wrap.clientHeight;
      renderer.setSize(w, hgt, false);
      camera.aspect = w / Math.max(1, hgt);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
      three.current?.onFrame?.();
    };
    loop();

    three.current = { renderer, scene, camera, controls, geom, pos, col, terrain, sun, earth, pin, onFrame: null };
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      geom.dispose();
      renderer.domElement.remove();
      three.current = null;
    };
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Posiciones (cambian con la exageración) + normales reales -------------
  const normals = useRef(null);
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    const { unit, h } = pre;
    const write = (ex) => {
      for (let p = 0; p < n * n; p++) {
        const r = R + (h[p] * ex) / 1000;
        const s = toScene(unit[p * 3] * r, unit[p * 3 + 1] * r, unit[p * 3 + 2] * r, R);
        t.pos[p * 3] = s[0]; t.pos[p * 3 + 1] = s[1]; t.pos[p * 3 + 2] = s[2];
      }
      t.geom.attributes.position.needsUpdate = true;
    };
    // Normales del relieve real (sin exagerar) para que la luz sea física.
    write(1);
    t.geom.computeVertexNormals();
    normals.current = t.geom.attributes.normal.array.slice();
    write(exag);
    t.geom.computeBoundingSphere();
  }, [pre, exag]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Sol, Tierra y colores para el instante actual ------------------------
  const sky = useMemo(() => {
    const f = (timeMs - em.startUnixMs) / (em.stepSeconds * 1000);
    const k0 = Math.max(0, Math.min(em.count - 2, Math.floor(f)));
    const w = Math.min(1, Math.max(0, f - k0));
    const v = (c) => ephem[k0 * 6 + c] * (1 - w) + ephem[(k0 + 1) * 6 + c] * w;
    const S = [v(0), v(1), v(2)];
    const E = [v(3), v(4), v(5)];
    const sd = Math.hypot(...S);
    return { sun: S.map((x) => x / sd), sunDist: sd, earth: E };
  }, [timeMs, ephem, em]);

  const horizonAt = (p, azDeg) => {
    const bins = hz.bins;
    const a = (((azDeg % 360) + 360) % 360) / (360 / bins);
    const k0 = Math.floor(a) % bins, k1 = (k0 + 1) % bins, w = a - Math.floor(a);
    const b = p * bins;
    return (horizon[b + k0] * (1 - w) + horizon[b + k1] * w) * hz.scaleDeg + hz.offsetDeg;
  };
  const azEl = (p, d) => {
    const fr = pre.frame;
    const o = p * 9;
    const len = Math.hypot(d[0], d[1], d[2]);
    const up = (d[0] * fr[o] + d[1] * fr[o + 1] + d[2] * fr[o + 2]) / len;
    const e = d[0] * fr[o + 3] + d[1] * fr[o + 4] + d[2] * fr[o + 5];
    const nn = d[0] * fr[o + 6] + d[1] * fr[o + 7] + d[2] * fr[o + 8];
    return [Math.atan2(e, nn) * DEG, Math.asin(Math.max(-1, Math.min(1, up))) * DEG];
  };
  const earthVec = (p) => {
    const r = R + pre.h[p] / 1000 + hz.observerHeightM / 1000;
    return [sky.earth[0] - pre.unit[p * 3] * r, sky.earth[1] - pre.unit[p * 3 + 1] * r, sky.earth[2] - pre.unit[p * 3 + 2] * r];
  };

  useEffect(() => {
    const t = three.current;
    if (!t || !normals.current) return;
    const wrap = wrapRef.current;
    const base = cssColor(wrap, "--ink").map(srgbToLinear);
    const ec = cssColor(wrap, "--earth").map(srgbToLinear);
    const nrm = normals.current;
    const S = sky.sun;
    const S3 = toScene(S[0], S[1], S[2], 0);
    const sunRad = Math.asin(SUN_RADIUS_KM / sky.sunDist) * DEG;
    const aidL = new THREE.Vector3(-0.5, 0.75, -0.45).normalize();
    for (let p = 0; p < n * n; p++) {
      const nx = nrm[p * 3], ny = nrm[p * 3 + 1], nz = nrm[p * 3 + 2];
      // Fracción del disco solar sobre el horizonte real de este punto.
      const [saz, sel] = azEl(p, S);
      let frac = 0;
      if (sel > -3) {
        const q = (sel - horizonAt(p, saz)) / sunRad;
        frac = q >= 1 ? 1 : q <= -1 ? 0 : 1 - (Math.acos(q) - q * Math.sqrt(1 - q * q)) / Math.PI;
      }
      const lambert = Math.max(0, nx * S3[0] + ny * S3[1] + nz * S3[2]);
      let b = 1 - Math.exp(-2.2 * frac * lambert);                   // exposición para pantalla
      if (aid) b += 0.07 * Math.max(0, nx * aidL.x + ny * aidL.y + nz * aidL.z); // ayuda visual
      let r = base[0] * b, g = base[1] * b, bl = base[2] * b;
      if (mode === "earth") {
        const [eaz, eel] = azEl(p, earthVec(p));
        r *= 0.55; g *= 0.55; bl *= 0.55;
        if (eel > horizonAt(p, eaz)) { r = r * 0.45 + ec[0] * 0.55; g = g * 0.45 + ec[1] * 0.55; bl = bl * 0.45 + ec[2] * 0.55; }
      }
      t.col[p * 3] = r; t.col[p * 3 + 1] = g; t.col[p * 3 + 2] = bl;
    }
    t.geom.attributes.color.needsUpdate = true;

    // Sol y Tierra en el cielo; sólidos si se ven desde el punto de referencia.
    const place = (body, dir, visible) => {
      const d = toScene(dir[0], dir[1], dir[2], 0);
      const l = Math.hypot(...d);
      body.g.position.set((d[0] / l) * SKY_DIST_KM, (d[1] / l) * SKY_DIST_KM, (d[2] / l) * SKY_DIST_KM);
      body.solid.visible = visible;
      body.ring.visible = !visible;
    };
    const [saz, sel] = azEl(refPixel, S);
    const [eaz, eel] = azEl(refPixel, earthVec(refPixel));
    place(t.sun, S, sel + sunRad > horizonAt(refPixel, saz));
    place(t.earth, earthVec(refPixel), eel > horizonAt(refPixel, eaz));
  }, [sky, mode, aid, exag, pre]); // eslint-disable-line react-hooks/exhaustive-deps

  // Coloca la cámara detrás del punto de referencia, mirando hacia un astro
  // (el Sol y la Tierra van casi a ras de horizonte en el polo).
  const face = (dirMoonMe) => {
    const t = three.current;
    if (!t) return;
    const d = toScene(dirMoonMe[0], dirMoonMe[1], dirMoonMe[2], 0);
    const hl = Math.hypot(d[0], d[2]) || 1;
    const dist = selected ? 90 : 260;
    const tg = t.controls.target;
    t.camera.position.set(tg.x - (d[0] / hl) * dist, tg.y + dist * 0.16, tg.z - (d[2] / hl) * dist);
  };

  // Pin del punto de referencia y objetivo de la cámara.
  const resolvedKey = selected?.key;
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    const p = refPixel;
    const r = R + (pre.h[p] * exag) / 1000;
    const s = toScene(pre.unit[p * 3] * r, pre.unit[p * 3 + 1] * r, pre.unit[p * 3 + 2] * r, R);
    t.pin.position.set(s[0], s[1] + 6, s[2]);
    t.pin.visible = !!selected;
    if (selectionKey && !resolvedKey) return;
    if (cameraFocus.current?.key === selectionKey && cameraFocus.current?.exag === exag) return;
    cameraFocus.current = { key: selectionKey, exag };
    t.controls.target.set(selected ? s[0] : 0, selected ? s[1] : 0, selected ? s[2] : 0);
    face(sky.sun);
  }, [selectionKey, resolvedKey, refPixel, exag]); // eslint-disable-line react-hooks/exhaustive-deps

  // Etiquetas HTML (Sol, Tierra, regiones, puntos calientes) proyectadas cada fotograma.
  const labelSrc = useMemo(() => {
    const out = [];
    for (const s of sites) {
      const [clat, clon] = s.centre || [s.lat, s.lon];
      const [x, y] = latLonToXY(grid, clat, clon);
      const [fi, fj] = xyToPixel(grid, x, y);
      out.push({ key: s.key, ref: s.ref, text: Number.isFinite(s.score) ? `${s.name} · ${Math.round(s.score)}` : s.name, p: Math.round(fi) * n + Math.round(fj), kind: "site" });
    }
    for (const s of spots.slice(0, 5)) out.push({ key: s.key, ref: s.ref, text: `${String(s.rank).padStart(2, "0")} ${s.name} · ${Math.round(s.score)}`, p: s.peak, kind: "spot" });
    return out;
  }, [sites, spots, grid, n]);

  useEffect(() => {
    const t = three.current;
    if (!t) return;
    let last = 0;
    t.onFrame = () => {
      const now = performance.now();
      if (now - last < 50) return; // ~20 fps para las etiquetas
      last = now;
      const w = wrapRef.current?.clientWidth || 0, hgt = wrapRef.current?.clientHeight || 0;
      const v = new THREE.Vector3();
      const proj = (x, y, z) => {
        v.set(x, y, z).project(t.camera);
        return v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 ? [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * hgt] : null;
      };
      const out = [];
      for (const l of labelSrc) {
        const r = R + (pre.h[l.p] * exag) / 1000;
        const s = toScene(pre.unit[l.p * 3] * r, pre.unit[l.p * 3 + 1] * r, pre.unit[l.p * 3 + 2] * r, R);
        const xy = proj(s[0], s[1] + 3, s[2]);
        if (xy) out.push({ ...l, xy });
      }
      const sp = t.sun.g.position, ep = t.earth.g.position;
      const sxy = proj(sp.x, sp.y, sp.z), exy = proj(ep.x, ep.y, ep.z);
      if (sxy) out.push({ key: "sun", text: "Sun", xy: sxy, kind: "sun" });
      if (exy) out.push({ key: "earth", text: "Earth", xy: exy, kind: "earth" });
      setLabels(out);
    };
  }, [labelSrc, exag, pre]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lecturas en el punto de referencia.
  const reading = useMemo(() => {
    const S = sky.sun;
    const sunRad = Math.asin(SUN_RADIUS_KM / sky.sunDist) * DEG;
    const [saz, sel] = azEl(refPixel, S);
    const [eaz, eel] = azEl(refPixel, earthVec(refPixel));
    const sh = horizonAt(refPixel, saz), eh = horizonAt(refPixel, eaz);
    return { saz, sel, sh, sunUp: sel + sunRad > sh, eaz, eel, eh, earthUp: eel > eh };
  }, [sky, refPixel]); // eslint-disable-line react-hooks/exhaustive-deps

  const where = selected ? selected.name : north ? "North pole" : "South pole";

  return (
    <div ref={wrapRef} className="viewer viewer--3d" data-theme="dark" aria-label={`3D view of the lunar ${north ? "north" : "south"} pole with the Sun and Earth. Drag to rotate, scroll to zoom, right-drag to pan.`}>
      {labels.map((l) => {
        const cls = `label3d label3d--${l.kind} ${selected?.key === l.key ? "is-selected" : ""}`;
        const style = { transform: `translate(${l.xy[0]}px, ${l.xy[1]}px)` };
        // Regiones y puntos calientes se pueden pulsar (como los marcadores del mapa 2D).
        if (onSelect && l.ref) {
          return (
            <button key={l.key} type="button" className={`${cls} label3d--btn`} style={style} aria-pressed={selected?.key === l.key}
              aria-label={`Select ${l.text}`} onClick={() => onSelect(l.ref)}>
              {l.text}
            </button>
          );
        }
        return (
          <span key={l.key} className={cls} style={style}>
            {l.kind === "sun" || l.kind === "earth" ? <L.Icon name={l.kind} size={14} className={`lh-k-${l.kind}`} /> : null}
            {l.text}
          </span>
        );
      })}
      <L.Panel tone="overlay" padding="compact" className="hud hud--layers">
        <div className="hud__row">
          {viewSwitch}
          <L.SegmentedControl
            label="Surface colour"
            size="sm"
            value={mode}
            onChange={setMode}
            options={[{ value: "sun", label: "Sunlight now", icon: "sun" }, { value: "earth", label: "Earth view now", icon: "earth" }]}
          />
          <L.SegmentedControl
            label="Relief exaggeration"
            size="sm"
            value={String(exag)}
            onChange={(v) => setExag(Number(v))}
            options={[{ value: "1", label: "×1" }, { value: "3", label: "×3" }, { value: "6", label: "×6" }]}
          />
          {toolbarActions}
        </div>
      </L.Panel>
      <L.Panel tone="overlay" padding="compact" className="hud hud--readings">
        <div className="readout-sm">{where}</div>
        <div className="caption lh-muted">{formatUtc(timeMs)}</div>
        <div className="hover-grid hover-grid--2">
          <L.Readout size="sm" label="Sun elevation" kind="sun" value={reading.sel.toFixed(2)} unit="°" hint={`skyline ${reading.sh.toFixed(1)}°`} />
          <L.Readout size="sm" label="Earth elevation" kind="earth" value={reading.eel.toFixed(2)} unit="°" hint={`skyline ${reading.eh.toFixed(1)}°`} />
        </div>
        <div className="tag-row">
          <L.VisibilityTag kind="sun" state={reading.sunUp ? "visible" : "blocked"}>{reading.sunUp ? "Sun in view" : "Sun hidden"}</L.VisibilityTag>
          <L.VisibilityTag kind="earth" state={reading.earthUp ? "visible" : "blocked"}>{reading.earthUp ? "Earth in view" : "Earth hidden"}</L.VisibilityTag>
        </div>
        <div className="tag-row">
          <L.Button size="sm" icon="sun" onClick={() => face(sky.sun)}>Face the Sun</L.Button>
          <L.Button size="sm" icon="earth" onClick={() => face(earthVec(refPixel))}>Face Earth</L.Button>
        </div>
        <L.Switch label="Relief shading" description="Relief shading is a visual aid, not sunlight." checked={aid} onChange={setAid} />
        <L.FidelityBadge level="approximate" detail={`Not to scale: Sun ×${SUN_ENLARGE}, Earth ×${EARTH_ENLARGE}, relief ×${exag}. Light uses 1 km terrain horizons.`}>Not to scale</L.FidelityBadge>
      </L.Panel>
      {external ? null : <div className="hud hud--timebar">
        <L.TimeBar
          start={span[0]}
          end={span[1]}
          value={timeMs}
          onChange={(d) => setTimeMs(d.getTime())}
          playing={playing}
          onPlayingChange={setPlaying}
          playStepMs={2 * 3600e3}
          playIntervalMs={90}
          tone="overlay"
        />
      </div>}
    </div>
  );
}
