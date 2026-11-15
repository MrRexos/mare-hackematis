import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, IconBtn, Btn } from "../ui/kit.jsx";
import { formatLatLon, formatUtc } from "../engine/geometry.js";
import { loadAstronautEphemeris, loadTerrain } from "./TerrainLoader.js";
import { createAstronautScene, QUALITIES } from "./AstronautScene.js";
import { surfaceAt } from "./coordinates.js";
import { landmarkInCell } from "./Landmarks.js";
import "./astronaut.css";

const dateInput = (ms) => new Date(ms).toISOString().slice(0, 16);
const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

function minimapImage(terrain) {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d"), image = ctx.createImageData(128, 128);
  let lo = Infinity, hi = -Infinity;
  for (const height of terrain.heights) { lo = Math.min(lo, height); hi = Math.max(hi, height); }
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const h = surfaceAt(terrain, (x / 127 - 0.5) * 1000, (y / 127 - 0.5) * 1000);
    const value = 45 + (h - lo) / Math.max(1, hi - lo) * 125;
    image.data.set([value, value, value, 255], (y * 128 + x) * 4);
  }
  ctx.putImageData(image, 0, 0); return canvas.toDataURL();
}

function TouchButton({ code, label, icon, engine }) {
  return <button type="button" className="astronaut-touch__button" aria-label={label}
    onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); engine.current?.command(code, true); }}
    onPointerUp={() => engine.current?.command(code, false)} onPointerCancel={() => engine.current?.command(code, false)} onLostPointerCapture={() => engine.current?.command(code, false)}>
    <Icon name={icon} size={22} />
  </button>;
}

export default function AstronautMode({ app, onClose }) {
  // The far horizon comes from the map of the active region: south pole or whole Moon.
  const { selected, timeMs, setTimeMs, mission } = app, data = app.moon ? app.gdata : app.data;
  // A whole-Moon cell is some 15 km wide: if it holds a landmark, the walk starts there.
  const [center, setCenter] = useState(() => {
    const landmark = app.moon ? landmarkInCell(selected.lat, selected.lon, app.gdata.manifest.grid.stepDeg) : null;
    return landmark ? { lat: landmark.lat, lon: landmark.lon, name: landmark.name } : { lat: selected.lat, lon: selected.lon, name: selected.name };
  });
  const [bundle, setBundle] = useState(null), [stage, setStage] = useState("Loading lunar terrain"), [error, setError] = useState(null);
  const [retry, setRetry] = useState(0), [ready, setReady] = useState(false), [hud, setHud] = useState({});
  const [panel, setPanel] = useState(null), [minimap, setMinimap] = useState(true), [playing, setPlaying] = useState(false);
  const [searching, setSearching] = useState(false), [searchNote, setSearchNote] = useState("");
  const [settings, setSettings] = useState({ quality: navigator.hardwareConcurrency <= 4 ? "MEDIUM" : "HIGH", fov: 64, sensitivity: 1.7, headlamp: true, density: 1, exposure: 1.2 });
  const wrap = useRef(null), dialog = useRef(null), engine = useRef(null), options = useRef(settings), clock = useRef(timeMs);
  const sunlightSearch = useRef(null);
  options.current = settings; clock.current = timeMs;
  const image = useMemo(() => bundle ? minimapImage(bundle.terrain) : null, [bundle]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    const trap = (event) => {
      if (event.key !== "Tab" || document.pointerLockElement) return;
      const items = Array.from(dialog.current.querySelectorAll('button:not(:disabled), input, select, a[href], [tabindex="0"]')).filter((el) => el.offsetParent !== null);
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", trap);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", trap); requestAnimationFrame(() => document.querySelector('button[aria-label="Astronaut Mode"]')?.focus()); };
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    setReady(false); setError(null); setBundle(null); setStage("Loading lunar terrain"); setSearching(false); setSearchNote("");
    let scene;
    (async () => {
      try {
        const [loaded, sky] = await Promise.all([loadTerrain(center.lat, center.lon, setStage, abort.signal), loadAstronautEphemeris()]);
        if (abort.signal.aborted) return;
        setBundle(loaded);
        scene = await createAstronautScene(wrap.current, loaded, data, sky, { ...options.current, timeMs: clock.current }, (status) => {
          if (abort.signal.aborted) return;
          setHud(status);
          if (status.showSettings) { setPanel("time"); setPlaying(false); }
          if (status.fatal) { setError(status.error); setReady(false); }
        }, setStage, abort.signal);
        if (abort.signal.aborted) { scene.dispose(); return; }
        engine.current = scene; setReady(true);
        if (import.meta.env.DEV) window.__astronaut = scene;
      } catch (failure) { if (!abort.signal.aborted) setError(failure.message); }
    })();
    return () => { abort.abort(); sunlightSearch.current?.abort(); scene?.dispose(); engine.current = null; };
  }, [center, data, retry]);

  useEffect(() => { engine.current?.configure({ ...settings, timeMs }); }, [settings, timeMs, ready]);
  useEffect(() => {
    if (panel && ready) dialog.current?.querySelector(".astronaut__panel button")?.focus({ preventScroll: true });
  }, [panel, ready]);
  useEffect(() => {
    if (!playing) return undefined;
    const interval = setInterval(() => {
      const next = clock.current + 0.1 * 6 * 3600000;
      if (next >= mission.toMs) setPlaying(false);
      setTimeMs(Math.min(next, mission.toMs));
    }, 100);
    return () => clearInterval(interval);
  }, [playing, mission.toMs, setTimeMs]);

  const togglePanel = (next) => { engine.current?.pause(); setPanel((value) => value === next ? null : next); };
  const resume = () => { setPanel(null); engine.current?.start(); };
  const close = () => { setPlaying(false); engine.current?.pause(); onClose(); };
  const setOption = (key, value) => setSettings((s) => ({ ...s, [key]: value }));
  // The packaged 5 m demo is a south pole site: from the north pole map it is not offered,
  // because the distant horizons loaded here belong to the north.
  const hasDemo = data.pole !== "north";
  const useDemo = () => { engine.current?.pause(); setPlaying(false); setPanel(null); setCenter({ lat: -89.45, lon: 222.5, name: "Connecting ridge · NASA 5 m demo" }); };
  const reading = hud.reading, eye = hud.eye || { x: 0, z: 0 }, heading = hud.heading || 0;
  const position = reading ? formatLatLon(reading.lat, reading.lon, 5) : formatLatLon(center.lat, center.lon, 5);
  const changeTime = (value) => { if (Number.isFinite(value)) setTimeMs(Math.max(mission.fromMs, Math.min(mission.toMs, value))); };
  const findSunlight = async () => {
    engine.current?.pause(); setPlaying(false); setSearchNote(""); setSearching(true);
    sunlightSearch.current?.abort();
    const abort = new AbortController(); sunlightSearch.current = abort;
    try {
      const found = await engine.current?.findSunlight(mission.fromMs, mission.toMs, abort.signal);
      if (abort.signal.aborted) return;
      if (found != null) { setTimeMs(found); setPanel(null); }
      else setSearchNote("No fully sunlit hour was found at your position within this mission period. Try another place or use the helmet light.");
    } catch (failure) { if (!abort.signal.aborted) setSearchNote(failure.message); }
    finally { if (!abort.signal.aborted) setSearching(false); }
  };

  return <div ref={dialog} role="dialog" aria-modal="true" aria-label="Astronaut Mode" tabIndex={-1} className="astronaut" data-theme="dark" data-active={!!hud.active} data-locked={!!hud.locked}>
    <div ref={wrap} className="astronaut__world" />
    <header className="astronaut__header">
      <div className="astronaut__identity"><div><h1>Astronaut Mode</h1><span>{center.name}</span></div></div>
      <div className="astronaut__compass" aria-label={`Heading ${Math.round(heading)} degrees ${directions[Math.round(heading / 45) % 8]}`}><span>N</span><i />{String(Math.round(heading) % 360).padStart(3, "0")}°<b>{directions[Math.round(heading / 45) % 8]}</b></div>
      <div className="astronaut__actions">
        {ready ? <IconBtn icon="flashlight" label={settings.headlamp ? "Helmet light on" : "Helmet light off"} variant="overlay" className="astronaut__lamp-toggle" aria-pressed={settings.headlamp} onClick={() => setOption("headlamp", !settings.headlamp)} /> : null}
        <IconBtn icon="calendar" label="Date and time" variant="overlay" aria-expanded={panel === "time"} onClick={() => togglePanel("time")} />
        <IconBtn icon="sliders" label="Astronaut settings" variant="overlay" aria-expanded={panel === "settings"} onClick={() => togglePanel("settings")} />
        <button type="button" className="astronaut__exit" onClick={close}><Icon name="x" size={16} />Exit</button>
      </div>
    </header>

    {!ready ? <div className="astronaut__loading" role={error ? "alert" : "status"}>
      {error ? <>
        <h2>Terrain unavailable</h2>
        <p>{error}</p>
        <div className="row-8 wrap"><Btn onClick={() => setRetry((n) => n + 1)} icon="refresh">Retry</Btn>{hasDemo && <Btn onClick={useDemo}>Explore NASA 5 m demo</Btn>}</div>
      </> : <>
        <span className="astronaut__loading-line" />
        <span className="astronaut__loading-stage">{stage}</span>
      </>}
    </div> : <>
      <div className="astronaut__reticle" aria-hidden="true"><i /><i /></div>
      <div className="astronaut__location" aria-live="off"><span className="astronaut__eyebrow">Lunar coordinates</span><strong>{position}</strong><span>{reading?.altitude.toFixed(1)} m above reference sphere</span></div>
      <div className="astronaut__readings">
        <div className="astronaut__timestamp"><Icon name="calendar" size={13} />{formatUtc(timeMs)}</div>
        {["sun", "earth"].map((key) => {
          const body = reading?.[key];
          return <div key={key} className={`astronaut__body ${body?.visible ? "is-visible" : ""}`}>
            <Icon name={key} size={18} /><div><b>{key === "sun" ? "Sun" : "Earth"}</b><span>{body ? `${body.el.toFixed(2)}° elevation · ${body.az.toFixed(1)}° az` : "Calculating"}</span></div>
            <span className="astronaut__visibility">{key === "earth" ? body?.visible ? "Direct view" : "No direct view" : body?.visible ? "In view" : "Hidden"}</span>
          </div>;
        })}
      </div>
      <footer className="astronaut__footer">
        <button type="button" className="astronaut__source" onClick={() => togglePanel("data")}><span className="astronaut__source-dot" /><b>Scientific terrain</b><span>{bundle.metadata.resolutionM} m samples · 1:1 scale</span><Icon name="info" size={13} /></button>
        <span className="astronaut__detail">Craters under {bundle.metadata.relief?.maxD ?? 20} m and rocks: generated, not measured</span>
        <span className="astronaut__performance">{hud.adapted ? "Adaptive · " : ""}{settings.quality} · {hud.fps || "–"} fps</span>
      </footer>

      {minimap && image ? <div className="astronaut__minimap" aria-label="Minimap of the one kilometer exploration boundary">
        <span className="astronaut__eyebrow">N ↑</span><svg viewBox="0 0 128 128" role="img" aria-label="Your position and heading within the scientific terrain">
          <image href={image} width="128" height="128" /><rect x="1" y="1" width="126" height="126" fill="none" stroke="rgba(255,255,255,.5)" strokeDasharray="3 3" />
          <g transform={`translate(${(eye.x / 1000 + 0.5) * 128} ${(eye.z / 1000 + 0.5) * 128}) rotate(${heading})`}><path d="M0 -7 4 4 0 2 -4 4Z" fill="#fff" stroke="#111" /></g>
        </svg><span>1,000 × 1,000 m</span>
      </div> : null}

      {!hud.active && !panel ? <div className="astronaut__entry">
        <span className="astronaut__eyebrow">One small step</span><h2>Walk the Moon.</h2><p>Real lunar terrain. Your place, your time.</p>
        <Btn variant="primary" icon="astronaut-helmet" onClick={() => engine.current?.start()}>Start exploring</Btn>
        <div className="astronaut__keyguide"><span><kbd>W A S D</kbd> Walk</span><span>Mouse Look</span><span><kbd>Space</kbd> Jump</span><span><kbd>Shift</kbd> Faster</span><span><kbd>Z</kbd> Zoom</span><span><kbd>R</kbd> Reset</span><span><kbd>Esc</kbd> Time & settings</span></div>
      </div> : null}
      {hud.error ? <div className="astronaut__notice" role="status">{hud.error}</div> : null}

      <div className="astronaut-touch" aria-label="Touch movement controls">
        <div className="astronaut-touch__pad"><TouchButton code="KeyW" label="Walk forward" icon="chevron-up" engine={engine} /><div><TouchButton code="KeyA" label="Walk left" icon="chevron-left" engine={engine} /><TouchButton code="KeyS" label="Walk backward" icon="chevron-down" engine={engine} /><TouchButton code="KeyD" label="Walk right" icon="chevron-right" engine={engine} /></div></div>
        <TouchButton code="Space" label="Jump" icon="chevron-up" engine={engine} />
      </div>
    </>}

    {panel && ready ? <aside className="astronaut__panel" aria-label={panel === "time" ? "Date and time controls" : panel === "data" ? "Scientific provenance" : "Graphics and controls"}>
      <div className="row-8"><h2>{panel === "time" ? "Lunar time" : panel === "data" ? "Terrain & provenance" : "Graphics & controls"}</h2><div className="grow" /><IconBtn icon="x" label="Close panel" size={32} variant="ghost" onClick={() => setPanel(null)} /></div>
      <nav className="astronaut__panel-nav" aria-label="Exploration pause menu">
        <button type="button" aria-pressed={panel === "time"} onClick={() => setPanel("time")}><Icon name="calendar" size={14} />Date & time</button>
        <button type="button" aria-pressed={panel === "settings"} onClick={() => setPanel("settings")}><Icon name="sliders" size={14} />Settings</button>
        <button type="button" aria-pressed={panel === "data"} onClick={() => setPanel("data")}><Icon name="info" size={14} />Sources</button>
      </nav>
      <Btn variant="primary" icon="play" onClick={resume}>Resume exploring</Btn>
      {panel === "time" ? <>
        <label>Selected instant · UTC<input aria-label="Astronaut date and time UTC" type="datetime-local" step="60" value={dateInput(timeMs)} min={dateInput(mission.fromMs)} max={dateInput(mission.toMs)} onChange={(event) => changeTime(Date.parse(`${event.target.value}Z`))} /></label>
        <input type="range" aria-label="Astronaut timeline" min={mission.fromMs} max={mission.toMs} step={3600000} value={timeMs} onChange={(event) => changeTime(Number(event.target.value))} />
        <div className="row-8"><Btn size="sm" onClick={() => changeTime(timeMs - 3600000)}>−1 h</Btn><Btn size="sm" icon={playing ? "pause" : "play"} onClick={() => setPlaying((v) => !v)}>{playing ? "Pause" : "Time lapse"}</Btn><Btn size="sm" onClick={() => changeTime(timeMs + 3600000)}>+1 h</Btn></div>
        <Btn size="sm" icon="sun" disabled={searching} onClick={findSunlight}>{searching ? "Searching for sunlight…" : "Find sunlight"}</Btn>
        <p>NASA/JPL SPICE · interpolated hourly vectors.<br />Time lapse advances UTC at 6 hours per second.</p>
      </> : panel === "settings" ? <>
        <label>Quality<select aria-label="Graphics quality" value={settings.quality} onChange={(e) => setOption("quality", e.target.value)}>{Object.keys(QUALITIES).map((q) => <option key={q}>{q}</option>)}</select></label>
        <label>Field of view <b>{settings.fov}°</b><input aria-label="Field of view" type="range" min="50" max="100" value={settings.fov} onChange={(e) => setOption("fov", Number(e.target.value))} /></label>
        <label>Mouse sensitivity<input aria-label="Mouse sensitivity" type="range" min="0.4" max="4" step="0.1" value={settings.sensitivity} onChange={(e) => setOption("sensitivity", Number(e.target.value))} /></label>
        <label>Fine gravel density<input aria-label="Gravel density" type="range" min="0.4" max="1.4" step="0.1" value={settings.density} onChange={(e) => setOption("density", Number(e.target.value))} /></label>
        <label>Exposure <b>{settings.exposure.toFixed(1)}</b><input aria-label="Exposure" type="range" min="0.7" max="2" step="0.1" value={settings.exposure} onChange={(e) => setOption("exposure", Number(e.target.value))} /></label>
        <label className="astronaut__checkbox"><input type="checkbox" checked={minimap} onChange={(e) => setMinimap(e.target.checked)} />Show minimap</label>
        <Btn size="sm" icon="locate" onClick={() => engine.current?.reset()}>Reset position</Btn>{hasDemo && <Btn size="sm" onClick={useDemo}>Explore NASA 5 m demo</Btn>}
        <p>WASD walk · Shift faster · Space jump · R reset.<br />Hold Z or the right mouse button for a 4× long lens.<br />Esc pauses to change the time or settings.<br />Drag to look on touchscreens. Gravity: 1.62 m/s².</p>
      </> : <>
        <span className="astronaut__eyebrow">Scientific terrain</span><b>{bundle.metadata.name}</b><p>{bundle.metadata.provider} · {bundle.metadata.resolutionM} m sample spacing. Horizontal and vertical scale 1:1. Lunar reference sphere: 1,737,400 m.</p>
        <p>{bundle.metadata.interpolation || bundle.metadata.uncertainty}</p><p>DEM sample spacing is not a statement of measurement accuracy.</p>
        <span className="astronaut__eyebrow">Relief below the DEM</span><p>The DEM cannot show craters under about {bundle.metadata.relief?.maxD ?? 20} m. Those are generated: {bundle.metadata.relief?.craters?.toLocaleString("en-US") ?? "thousands of"} craters from {bundle.metadata.relief?.minD ?? 2} m up, with lunar size statistics and mostly worn, soft shapes, plus gentle hummocks. They are plausible, not measured, and they fade out at the edge of the kilometre so the surface meets the DEM exactly.</p>
        <a href={bundle.metadata.productUrl} target="_blank" rel="noreferrer">View original NASA product <Icon name="external-link" size={12} /></a>
        <span className="astronaut__eyebrow">Surface appearance</span><p>{hud.assetLabel}. Rocks lie where they would on the Moon: thrown out around the young craters and in loose groups of fragments. Their positions, like the gravel and surface materials, are a representation guided by Apollo photographs, not measured data.</p>
        <span className="astronaut__eyebrow">Visibility & light</span><p>SPICE vectors rotated into MOON_ME_DE421. Topocentric Earth and Sun. Distant horizons: 1 km grid, 5° azimuth bins, approximately 2 m observer; local terrain is sampled from the loaded DEM. Rendered shadows approximate visibility across the region.</p>
        <p>The ground reflects light as lunar soil does (Hapke model with published whole-Moon values), not as a matte surface: brighter with the Sun behind you, darker against it. The sky is black and the only fill light is sunlight thrown back by the ground. The Earth is NASA Blue Marble imagery at its true size, turned and lit for the selected instant; its clouds are synthetic.</p>
        <p>The helmet light is an artificial light. Earth communication status is geometric line of sight.</p>
        {bundle.warnings.length || hud.warnings?.length ? <p>Some higher resolution data or optional assets were unavailable; the loaded source is identified above.</p> : null}
      </>}
      {searchNote ? <p role="status">{searchNote}</p> : null}
    </aside> : null}
    {searchNote && !panel ? <div className="astronaut__notice" role="status">{searchNote}</div> : null}
  </div>;
}
