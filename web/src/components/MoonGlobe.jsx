import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { L, cssColor } from "../ds.js";
import { IconBtn } from "../ui/kit.jsx";

// Globo 3D de la Luna entera. Es solo la Luna: fotografía real (mosaico LROC WAC) y relieve
// real de LOLA, sin capas de datos. Encima van los marcadores de las mejores celdas y de la
// celda elegida.
//   arrastrar: girar · rueda / pellizco: zoom · clic: elegir la celda de ese punto
//
// Calidad sin sacrificar velocidad:
// - Se pinta solo cuando algo cambia (giro, zoom, textura nueva), no 60 veces por segundo.
// - Primero la foto de 4k (unos 2 MB); la de 8k se carga después y solo si la GPU la admite.
// - El relieve fino es un mapa de normales (no cuesta geometría); el grande (cuencas y
//   cordilleras en el limbo) desplaza una esfera de 384 × 192 caras.
//
// Marco de la escena: esfera de radio 1; +Y = polo norte; longitud 0° (cara visible) hacia +X.

const SEGMENTS = [384, 192];
const RELIEF = 6;                 // exageración del desplazamiento (el real no se vería a esta escala)
const MOON_R_KM = 1737.4;
const MIN_DIST = 1.22, MAX_DIST = 7, START_DIST = 4.3; // en radios lunares; a 4,3 el globo cabe entero
const BASE = `${import.meta.env.BASE_URL}data/`;

/** Punto de la esfera unidad para una latitud y longitud (grados). */
function onSphere(lat, lon, r = 1, out = new THREE.Vector3()) {
  const phi = ((lon + 180) * Math.PI) / 180, theta = ((90 - lat) * Math.PI) / 180;
  return out.set(-Math.cos(phi) * Math.sin(theta) * r, Math.cos(theta) * r, Math.sin(phi) * Math.sin(theta) * r);
}

/** Latitud y longitud (grados) de un punto de la esfera. */
function toLatLon(v) {
  const r = v.length();
  const lat = 90 - (Math.acos(Math.max(-1, Math.min(1, v.y / r))) * 180) / Math.PI;
  let lon = (Math.atan2(v.z, -v.x) * 180) / Math.PI - 180;
  if (lon < -180) lon += 360;
  return [lat, lon];
}

export default function MoonGlobe({ globe, grid, places, selected, onSelect, children }) {
  const wrapRef = useRef(null);
  const three = useRef(null);
  const [labels, setLabels] = useState([]);
  const [state, setState] = useState("loading"); // loading | ready | error
  const live = useRef({ places, selected });
  live.current = { places, selected };

  // --- Escena (una vez) -------------------------------------------------------
  useEffect(() => {
    const wrap = wrapRef.current;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    } catch {
      setState("error");
      return undefined;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const bg = cssColor(wrap, "--canvas");
    renderer.setClearColor(new THREE.Color(`rgb(${bg.join(",")})`), 1);
    renderer.domElement.className = "viewer__canvas";
    wrap.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 40);
    camera.position.set(START_DIST, 0.55, 0.9).setLength(START_DIST);
    scene.add(camera);
    // La luz viaja con la cámara, algo ladeada: el relieve siempre se lee y no hay cara a oscuras.
    const sun = new THREE.DirectionalLight(0xffffff, 2.6);
    sun.position.set(-1.6, 1.1, 1.4);
    camera.add(sun);
    scene.add(new THREE.AmbientLight(0xffffff, 0.22));

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.minDistance = MIN_DIST;
    controls.maxDistance = MAX_DIST;
    controls.zoomSpeed = 0.7;

    const range = globe.height ? (globe.height.maxM - globe.height.minM) / 1000 / MOON_R_KM : 0;
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    material.displacementScale = range * RELIEF;
    material.displacementBias = globe.height ? (globe.height.minM / 1000 / MOON_R_KM) * RELIEF : 0;
    const moon = new THREE.Mesh(new THREE.SphereGeometry(1, SEGMENTS[0], SEGMENTS[1]), material);
    scene.add(moon);

    // Anillo sobre la celda elegida (se orienta tangente a la esfera).
    const ringC = cssColor(wrap, "--ink");
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.02, 0.026, 48),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(`rgb(${ringC.join(",")})`), side: THREE.DoubleSide, depthTest: false, transparent: true }));
    ring.renderOrder = 2;
    ring.visible = false;
    scene.add(ring);

    let dirty = true, alive = true, raf = 0, fly = null;
    const invalidate = () => { dirty = true; };
    const loader = new THREE.TextureLoader();
    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const load = (file, colour) => new Promise((resolve, reject) => loader.load(BASE + file, (t) => {
      if (colour) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = aniso;
      resolve(t);
    }, undefined, reject));

    load(globe.albedo.file, true).then((t) => {
      if (!alive) return t.dispose();
      material.map = t; material.needsUpdate = true; setState("ready"); invalidate();
      // La foto de 8k, solo si la GPU y la memoria del equipo lo permiten, y sin bloquear nada.
      const big = globe.albedo.fileHi && renderer.capabilities.maxTextureSize >= 8192 && (navigator.deviceMemory ?? 8) >= 4;
      if (big) load(globe.albedo.fileHi, true).then((hi) => {
        if (!alive) return hi.dispose();
        material.map.dispose(); material.map = hi; material.needsUpdate = true; invalidate();
      }).catch(() => {});
      return undefined;
    }).catch(() => alive && setState("error"));
    if (globe.normal) load(globe.normal.file, false).then((t) => {
      if (!alive) return t.dispose();
      material.normalMap = t; material.normalScale.set(1, 1); material.needsUpdate = true; invalidate();
      return undefined;
    }).catch(() => {});
    if (globe.height) load(globe.height.file, false).then((t) => {
      if (!alive) return t.dispose();
      material.displacementMap = t; material.needsUpdate = true; invalidate();
      return undefined;
    }).catch(() => {});

    // Marcadores HTML: se proyectan a pantalla y se ocultan en la cara de atrás.
    const v = new THREE.Vector3(), c = new THREE.Vector3();
    const project = () => {
      const { places: list, selected: sel } = live.current;
      const w = wrap.clientWidth, h = wrap.clientHeight;
      const items = [...list];
      if (sel && !list.some((p) => p.key === sel.key)) items.push(sel);
      c.copy(camera.position);
      const out = [];
      for (const p of items) {
        onSphere(p.lat, p.lon, 1.012, v);
        if (v.dot(c) < 1.03) continue;                // detrás del horizonte del globo
        v.project(camera);
        out.push({ place: p, x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h });
      }
      setLabels(out);
      if (sel) {
        onSphere(sel.lat, sel.lon, 1.02, ring.position);
        ring.lookAt(0, 0, 0);
        // Tamaño constante en pantalla: de cerca el anillo encoge con la distancia.
        ring.scale.setScalar(Math.max(0.1, Math.min(1.4, (camera.position.length() - 1) / 2.4)));
        ring.visible = true;
      } else ring.visible = false;
    };

    const resize = () => {
      const w = wrap.clientWidth, h = wrap.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      invalidate();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      if (fly) {                                        // giro suave hacia la celda elegida
        const k = Math.min(1, (now - fly.t0) / 650);
        const e = 1 - (1 - k) ** 3;
        camera.position.copy(fly.from).lerp(fly.to, e).setLength(fly.from.length() + (fly.to.length() - fly.from.length()) * e);
        if (k >= 1) fly = null;
        dirty = true;
      }
      // Cuanto más cerca, más fino el giro.
      controls.rotateSpeed = Math.max(0.12, Math.min(0.9, (camera.position.length() - 1) * 0.42));
      if (controls.update()) dirty = true;
      if (!dirty) return;
      dirty = false;
      renderer.render(scene, camera);
      project();
    };
    raf = requestAnimationFrame(loop);

    // Clic (sin arrastre) = elegir la celda de ese punto.
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), unit = new THREE.Sphere(new THREE.Vector3(), 1), hit = new THREE.Vector3();
    let down = null;
    const onDown = (e) => { down = [e.clientX, e.clientY]; fly = null; };
    const onUp = (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) { down = null; return; }
      down = null;
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      if (!ray.ray.intersectSphere(unit, hit)) return;
      const [lat, lon] = toLatLon(hit);
      const i = Math.min(grid.rows - 1, Math.max(0, Math.floor((grid.lat0 - lat) / grid.stepDeg)));
      const j = Math.min(grid.cols - 1, Math.max(0, Math.floor((lon - grid.lon0) / grid.stepDeg)));
      three.current?.onSelect?.(i * grid.cols + j);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    three.current = {
      invalidate,
      onSelect: null,
      zoom: (f) => { camera.position.setLength(Math.min(MAX_DIST, Math.max(MIN_DIST, camera.position.length() * f))); invalidate(); },
      home: () => { fly = { t0: performance.now(), from: camera.position.clone(), to: new THREE.Vector3(START_DIST, 0.55, 0.9).setLength(START_DIST) }; },
      flyTo: (lat, lon) => {
        const d = Math.min(camera.position.length(), 2.6);
        fly = { t0: performance.now(), from: camera.position.clone(), to: onSphere(lat, lon, d) };
      },
    };

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      controls.dispose();
      for (const t of [material.map, material.normalMap, material.displacementMap]) t?.dispose();
      material.dispose();
      moon.geometry.dispose();
      ring.geometry.dispose();
      ring.material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      three.current = null;
    };
  }, [globe, grid]);

  // El clic usa siempre el onSelect actual; los marcadores, las listas actuales.
  useEffect(() => { if (three.current) three.current.onSelect = onSelect; });
  useEffect(() => { three.current?.invalidate(); }, [places, selected?.key]);
  // Al elegir un lugar (en el ranking o en el globo), el globo gira hasta ponerlo delante.
  useEffect(() => { if (selected) three.current?.flyTo(selected.lat, selected.lon); }, [selected?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={wrapRef} className="viewer viewer--3d" data-theme="dark" role="application"
      aria-label="3D globe of the Moon. Drag to rotate, scroll to zoom, click a point to pick its cell.">
      {labels.map(({ place, x, y }, k) => (
        <L.MapMarker
          key={place.key}
          label={`${place.coords}${Number.isFinite(place.score) ? ` · ${Math.round(place.score)}` : ""}`}
          shape={place.shape === "square" ? "square" : "custom"}
          rank={place.rank || undefined}
          category={place.kindLabel}
          state={selected?.key === place.key ? "selected" : "default"}
          showLabel={selected?.key === place.key || (place.rank && place.rank <= 3)}
          style={{ position: "absolute", left: x - 14, top: y - 14, zIndex: selected?.key === place.key ? 3 : 2 }}
          onClick={() => onSelect?.(place.p)}
        />
      ))}
      <div className="viewer__zoom">
        <IconBtn icon="plus" label="Zoom in" variant="overlay" onClick={() => three.current?.zoom(1 / 1.3)} />
        <IconBtn icon="minus" label="Zoom out" variant="overlay" onClick={() => three.current?.zoom(1.3)} />
        <IconBtn icon="locate" label="Show the near side" variant="overlay" onClick={() => three.current?.home()} />
      </div>
      {state === "loading" ? <div className="mapsec__center"><div className="state"><span className="state__title">Loading the Moon</span></div></div> : null}
      {state === "error" ? <div className="mapsec__center"><div className="state"><span className="state__title">3D view unavailable</span><span className="state__text">The globe textures could not be loaded, or WebGL is off. The 2D map has the same places.</span></div></div> : null}
      {children}
    </div>
  );
}
