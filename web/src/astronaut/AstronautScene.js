import * as THREE from "three";
import { CSM } from "three/examples/jsm/csm/CSM.js";
import { celestialAt, findSunlitTime } from "./CelestialPosition.js";
import { createEarthVisual, createSunVisual } from "./CelestialVisuals.js";
import { initPhysics, LunarPhysics, FIXED_STEP } from "./LunarPhysics.js";
import { lunarReflectance, makeSurfaceMaterials, setupLunarMaterial } from "./SurfaceMaterials.js";
import { addGravel, addRocks, rockPlacements } from "./ProceduralRocks.js";
import { loadAssetLibrary } from "./MegascansLibrary.js";
import { lunarToLocal, seedAt } from "./coordinates.js";
import { LANDMARKS, createFlag } from "./Landmarks.js";
import { groundAt } from "./SurfaceRelief.js";
import { addTerrainLOD } from "./TerrainLOD.js";
import { createSurfaceGeology } from "./SurfaceGeology.js";
import { applyLookDelta, createFirstPersonControls } from "./FirstPersonControls.js";

// detail: how far each level of terrain reaches, in node widths; depth: finest
// level (6 is half-metre cells, 5 is one metre); gravel: range in metres.
export const QUALITIES = {
  LOW: { dpr: 0.85, shadow: 1024, cascades: 3, rocks: 70, detail: 0.3, depth: 5, gravel: 18 },
  MEDIUM: { dpr: 1, shadow: 1024, cascades: 3, rocks: 130, detail: 0.4, depth: 6, gravel: 28 },
  HIGH: { dpr: 1.4, shadow: 2048, cascades: 3, rocks: 210, detail: 0.55, depth: 6, gravel: 38 },
  ULTRA: { dpr: 1.75, shadow: 4096, cascades: 4, rocks: 320, detail: 0.85, depth: 6, gravel: 48 },
};

// Rendering units, not a radiometric calibration: chosen so sunlit regolith
// lands where a correctly exposed photograph puts it.
const SUN_LIGHT = 16;
// Sunlit ground is the only fill light on the Moon. It reaches the underside
// and the shaded flanks of things; level ground in shadow gets almost nothing.
const BOUNCE = 0.085;
// Earthlight is ten thousand times weaker than sunlight: invisible by day, the
// only natural light once the Sun is below the local horizon.
const EARTHSHINE_DAY = 0.0006, EARTHSHINE_NIGHT = 0.05;
const ZOOM = 4;
// The exposure was set for the grazing Sun of the poles. With the Sun high the ground returns
// several times more light, so the exposure comes down with it, as a camera's would.
const groundLevel = (elevationDeg) => lunarReflectance(Math.sin(Math.max(1, elevationDeg) * Math.PI / 180), 0.3, 0);
const POLAR_LEVEL = groundLevel(2.5);
const autoExposure = (elevationDeg) => Math.max(0.3, Math.min(1.15, (POLAR_LEVEL / groundLevel(elevationDeg)) ** 0.75));

function meshFrom(data) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geometry.setAttribute("uv", new THREE.BufferAttribute(data.uv, 2));
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  return geometry;
}

export async function createAstronautScene(wrap, bundle, data, skyData, initial, onUpdate, onStage, signal) {
  onStage("Preparing surface materials");
  await initPhysics();
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = initial.exposure ?? 1.2; renderer.setClearColor(0x000000, 1);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.localClippingEnabled = true;
  renderer.domElement.className = "astronaut__canvas";
  renderer.domElement.setAttribute("aria-label", "Lunar surface. WASD to walk, mouse to look, Space to jump, R to reset, Escape to change the time or settings.");
  renderer.domElement.tabIndex = 0;
  wrap.prepend(renderer.domElement);
  const canvas = renderer.domElement, scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(initial.fov, 1, 0.08, 45000);
  camera.rotation.order = "YXZ";
  const materials = makeSurfaceMaterials(seedAt(bundle.terrain.lat, bundle.terrain.lon));
  let library, physics, csm, raf = 0, disposed = false;
  const cleanups = [], geoms = new Set(), extraMaterials = new Set(), targets = [];
  const dispose = () => {
    if (disposed) return; disposed = true;
    cancelAnimationFrame(raf);
    for (const fn of cleanups) fn();
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    physics?.dispose(); csm?.remove(); csm?.dispose();
    for (const light of csm?.lights || []) light.shadow.dispose();
    geoms.forEach((g) => g.dispose());
    materials.geometries.forEach((g) => { if (!geoms.has(g)) g.dispose(); });
    materials.materials.forEach((m) => m.dispose()); extraMaterials.forEach((m) => m.dispose());
    materials.textures.forEach((t) => t.dispose()); targets.forEach((t) => t.dispose());
    renderer.dispose(); canvas.remove();
  };
  try {
    const geology = createSurfaceGeology(bundle.terrain.lat, bundle.terrain.lon, { craters: bundle.terrain.surface.craters });
    library = await loadAssetLibrary(renderer, materials, signal, geology);
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    onStage("Generating environment");
    const terrainLOD = addTerrainLOD(scene, bundle.terrain.surface, materials.terrain, { tile: library.surfaceTileM });
    cleanups.push(() => terrainLOD.dispose());
    const contextGeometry = meshFrom(bundle.context); geoms.add(contextGeometry);
    const contextMesh = new THREE.Mesh(contextGeometry, materials.terrain);
    contextMesh.receiveShadow = true; contextMesh.castShadow = true; scene.add(contextMesh);
    const rocks = rockPlacements(bundle.terrain, 1.4, geology, library.variants.length || 4);
    const rockField = addRocks(scene, rocks, materials.rock, library.variants);
    cleanups.push(() => rockField.dispose());
    for (const batch of rockField.batches) for (const mesh of batch.meshes) geoms.add(mesh.geometry);
    materials.rock.userData.lunarRockGain = { value: THREE.MathUtils.clamp(materials.regolithAlbedo / 0.097, 0.3, 4) };
    const gravel = addGravel(scene, bundle.terrain, geology, materials.rock);
    cleanups.push(() => gravel.dispose());
    physics = new LunarPhysics(bundle.terrain, rocks);
    const sunVisual = createSunVisual(), { sun, glare } = sunVisual;
    const sunMaterial = sun.material, glareMaterial = glare.material;
    cleanups.push(() => sunVisual.dispose()); scene.add(sun, glare);
    // NASA Blue Marble with a synthetic cloud layer; turned and lit for the chosen instant.
    const earthMap = await new THREE.TextureLoader().loadAsync(new URL(`${import.meta.env.BASE_URL}assets/astronaut/sky/earth_2k.jpg`, document.baseURI).href);
    if (signal.aborted) { earthMap.dispose(); throw new DOMException("Cancelled", "AbortError"); }
    const earthVisual = createEarthVisual(earthMap), { earth, phaseSun } = earthVisual;
    const earthMaterial = earth.material;
    cleanups.push(() => earthVisual.dispose()); scene.add(earth);
    const sunClip = new THREE.Plane(), earthClip = new THREE.Plane();
    sunMaterial.clippingPlanes = [sunClip]; earthMaterial.clippingPlanes = [earthClip];
    // A lamp at the eye throws its shadows straight behind what it lights, where
    // the wearer cannot see them: it needs no shadow map.
    const helmet = new THREE.SpotLight(0xf5f4ef, 90, 55, Math.PI * 0.32, 0.88, 1.5);
    scene.add(helmet, helmet.target);
    // The sky is black: the only fill is sunlight thrown back by the ground itself.
    const bounce = new THREE.HemisphereLight(0x15130f, 0xb9b2a4, 0);
    scene.add(bounce);
    const earthshine = new THREE.DirectionalLight(0xb9cdf2, 0);
    scene.add(earthshine, earthshine.target);
    onStage("Calculating celestial positions");
    let settings = { ...initial }, quality = QUALITIES[settings.quality], yaw = 0, pitch = -0.08, active = false, locked = false;
    let zoomHeld = false, zoom = 0, saving = 1, exposure = 1;
    const plain = new Set();   // materials lit as ordinary matte surfaces (the flag), not as regolith
    let error = "", fatal = false, reading = null, targetSky = null, lastSky = -Infinity, lastHud = -Infinity;
    let last = performance.now(), accumulator = 0, averageMs = 16, samples = 0, adapted = false;
    let shadowTime = -Infinity, shadowClock = NaN, shadowsDirty = true;
    const shadowEye = new THREE.Vector3(Infinity, Infinity, Infinity);
    const shadowRotation = new THREE.Quaternion(), shadowSun = new THREE.Vector3();
    const startedAt = performance.now();
    const keys = new Set(), touchKeys = new Set();
    const skyDirections = { sun: new THREE.Vector3(), earth: new THREE.Vector3() };
    const earthAxes = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], earthBasis = new THREE.Matrix4();
    const heading = () => ((-yaw * 180 / Math.PI) % 360 + 360) % 360;
    const notify = (extra = {}) => onUpdate({ active, locked, error, yaw, heading: heading(), eye: physics.eye(), reading, quality: settings.quality, adapted, fps: Math.round(1000 / averageMs), assetLabel: library.label, warnings: library.warnings, ...extra });
    renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
      fatal = true; active = false;
      error = `The graphics driver could not compile the lunar surface shader. ${gl.getShaderInfoLog(fragment) || gl.getProgramInfoLog(program) || "Try a lower graphics quality."}`;
      notify({ fatal: true });
    };

    const setupQuality = () => {
      quality = QUALITIES[settings.quality];
      for (const light of csm?.lights || []) light.shadow.dispose();
      csm?.remove(); csm?.dispose();
      csm = new CSM({ camera, parent: scene, cascades: quality.cascades, maxFar: 1200, mode: "practical", shadowMapSize: quality.shadow,
        lightDirection: new THREE.Vector3(0, -0.1, -1).normalize(), lightIntensity: SUN_LIGHT, shadowBias: -0.00002, lightNear: 0.1, lightFar: 34000, lightMargin: 17000 });
      csm.fade = true; csm.updateFrustums();
      csm.lights.forEach((light) => { light.shadow.normalBias = 0.025; light.shadow.radius = 1.5; light.shadow.autoUpdate = false; });
      materials.materials.forEach((material) => setupLunarMaterial(material, csm));
      plain.forEach((material) => { csm.setupMaterial(material); material.needsUpdate = true; });
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, quality.dpr));
      shadowsDirty = true; adapted = false; saving = 1; samples = 0;
      renderer.shadowMap.needsUpdate = true;
    };
    setupQuality();
    const resize = () => {
      const width = Math.max(1, wrap.clientWidth), height = Math.max(1, wrap.clientHeight);
      renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
      csm.updateFrustums(); shadowsDirty = true;
    };
    const observer = new ResizeObserver(resize); observer.observe(wrap); cleanups.push(() => observer.disconnect()); resize();
    const listen = (target, name, fn, options) => { target.addEventListener(name, fn, options); cleanups.push(() => target.removeEventListener(name, fn, options)); };
    const clearInput = () => { keys.clear(); touchKeys.clear(); zoomHeld = false; accumulator = 0; last = performance.now(); };
    const controls = createFirstPersonControls(canvas, {
      onLook(dx, dy) { ({ yaw, pitch } = applyLookDelta(yaw, pitch, dx, dy, settings.sensitivity * camera.fov / settings.fov)); },
      onChange(state) { active = state.active; locked = state.locked; error = state.error; notify(); },
      onPause() { notify({ showSettings: true }); }, onClear: clearInput,
    });
    cleanups.push(() => controls.dispose());
    listen(document, "keydown", (event) => {
      if (!active || event.target.closest?.("input, select, textarea")) return;
      if (event.code === "KeyZ") { event.preventDefault(); zoomHeld = true; return; }
      if (["KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft", "ShiftRight", "Space", "KeyR", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) {
        event.preventDefault();
        if (event.code === "KeyR") physics.reset();
        else if (!event.repeat || event.code !== "Space") keys.add(event.code);
      }
    });
    listen(document, "keyup", (event) => { keys.delete(event.code); if (event.code === "KeyZ") zoomHeld = false; });
    // Hold the right button or Z for a long lens, to look at the Earth or a far ridge.
    listen(document, "mousedown", (event) => { if (active && event.button === 2) zoomHeld = true; });
    listen(document, "mouseup", (event) => { if (event.button === 2) zoomHeld = false; });
    listen(canvas, "contextmenu", (event) => event.preventDefault());
    listen(canvas, "webglcontextlost", (event) => { event.preventDefault(); active = false; error = "Graphics context lost. Exit and reopen Astronaut Mode."; notify(); cancelAnimationFrame(raf); });
    let sunTarget = new THREE.Vector3(), direction = new THREE.Vector3(), clipNormal = new THREE.Vector3();
    const updateSky = (eye) => {
      reading = celestialAt(data, skyData, bundle.terrain, eye, settings.timeMs);
      if (!targetSky) {
        skyDirections.sun.fromArray(reading.sun.world); skyDirections.earth.fromArray(reading.earth.world);
        // Start with the Sun behind one shoulder, where relief and shadows read
        // best; in darkness, face the nearest young crater. The chosen time and
        // the solar direction are never altered.
        if (reading.sun.visibleFraction > 0.2) yaw = -(reading.sun.az + 118) * Math.PI / 180;
        else if (geology.landmark) yaw = -Math.atan2(geology.landmark.x, -geology.landmark.z);
      }
      targetSky = reading;
    };
    updateSky(physics.eye());
    exposure = autoExposure(reading.sun.el); renderer.toneMappingExposure = settings.exposure * exposure;
    // Landmarks inside the walkable kilometre. One at the arrival point itself is set a few
    // steps ahead, turned to face the walker.
    for (const landmark of LANDMARKS) {
      if (!landmark.flag) continue;
      let [x, z] = lunarToLocal(bundle.terrain.frame, landmark.lat, landmark.lon);
      if (!(Math.abs(x) < 480 && Math.abs(z) < 480)) continue;
      if (Math.hypot(x, z) < 5) { x -= Math.sin(yaw) * 7; z -= Math.cos(yaw) * 7; }
      const flag = createFlag(landmark.flag);
      flag.group.position.set(x, groundAt(bundle.terrain, x, z), z); flag.group.rotation.y = yaw;
      flag.geometries.forEach((g) => geoms.add(g)); flag.textures.forEach((t) => materials.textures.add(t));
      flag.materials.forEach((m) => { extraMaterials.add(m); plain.add(m); csm.setupMaterial(m); });
      scene.add(flag.group);
    }
    const placeBody = (mesh, key, eye, dt) => {
      const body = targetSky[key], distance = 22000;
      direction.fromArray(body.world); skyDirections[key].lerp(direction, 1 - Math.exp(-dt * 10)).normalize();
      const dir = skyDirections[key];
      mesh.position.set(eye.x + dir.x * distance, eye.y + dir.y * distance, eye.z + dir.z * distance);
      mesh.scale.setScalar(distance * Math.tan(body.angularRadius));
      mesh.visible = body.visibleFraction > 0;
      const horizontal = Math.hypot(dir.x, dir.z) || 1, angle = body.horizon * Math.PI / 180;
      clipNormal.set(-dir.x / horizontal * Math.sin(angle), Math.cos(angle), -dir.z / horizontal * Math.sin(angle));
      const plane = key === "sun" ? sunClip : earthClip;
      plane.normal.copy(clipNormal); plane.constant = -(clipNormal.x * eye.x + clipNormal.y * eye.y + clipNormal.z * eye.z);
    };
    const tick = (now) => {
      if (disposed || fatal) return;
      raf = requestAnimationFrame(tick);
      if (document.hidden) { last = now; return; }
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now;
      averageMs += (dt * 1000 - averageMs) * 0.025; samples++;
      if (active && !document.hidden) {
        accumulator = Math.min(accumulator + dt, FIXED_STEP * 6);
        while (accumulator >= FIXED_STEP) {
          const held = (key) => keys.has(key) || touchKeys.has(key);
          physics.step({ forward: Number(held("KeyW") || held("ArrowUp")) - Number(held("KeyS") || held("ArrowDown")),
            right: Number(held("KeyD") || held("ArrowRight")) - Number(held("KeyA") || held("ArrowLeft")),
            fast: held("ShiftLeft") || held("ShiftRight"), jump: held("Space") }, yaw);
          keys.delete("Space"); touchKeys.delete("Space"); accumulator -= FIXED_STEP;
        }
      }
      const eye = physics.eye(active ? accumulator / FIXED_STEP : 1);
      camera.position.set(eye.x, eye.y, eye.z); camera.rotation.set(pitch, yaw, 0); camera.updateMatrixWorld();
      if (now - lastSky > 150 || targetSky.timeMs !== settings.timeMs) { updateSky(eye); lastSky = now; }
      if (Math.abs(zoom - Number(zoomHeld)) > 0.002) {
        zoom += (Number(zoomHeld) - zoom) * (1 - Math.exp(-dt * 10));
        camera.fov = settings.fov / (1 + (ZOOM - 1) * zoom); camera.updateProjectionMatrix(); csm.updateFrustums(); shadowsDirty = true;
      }
      placeBody(sun, "sun", eye, dt); placeBody(earth, "earth", eye, dt);
      const daylight = targetSky.sun.visibleFraction, earthBody = targetSky.earth;
      exposure += (autoExposure(targetSky.sun.el) - exposure) * (1 - Math.exp(-dt * 3));
      renderer.toneMappingExposure = settings.exposure * exposure;
      // Turn the globe so the right continents face the Moon, and light its day side.
      earthAxes[0].fromArray(earthBody.greenwich); earthAxes[1].fromArray(earthBody.north); earthAxes[2].crossVectors(earthAxes[0], earthAxes[1]);
      earth.quaternion.setFromRotationMatrix(earthBasis.makeBasis(earthAxes[0], earthAxes[1], earthAxes[2]));
      phaseSun.value.fromArray(earthBody.toSun);
      glare.position.copy(sun.position); glare.scale.setScalar(22000 * 2 * Math.tan(24 * Math.PI / 180));
      glareMaterial.opacity = daylight; glare.visible = daylight > 0;
      sunTarget.copy(skyDirections.sun).negate(); csm.lightDirection.copy(sunTarget);
      csm.lights.forEach((light) => { light.intensity = SUN_LIGHT * daylight; });
      bounce.intensity = SUN_LIGHT * (0.0012 + BOUNCE * daylight);
      earthshine.position.copy(camera.position).addScaledVector(skyDirections.earth, 1000); earthshine.target.position.copy(camera.position);
      earthshine.intensity = SUN_LIGHT * earthBody.litFraction * Math.min(1, earthBody.visibleFraction * 2) * (EARTHSHINE_NIGHT + (EARTHSHINE_DAY - EARTHSHINE_NIGHT) * daylight);
      helmet.visible = settings.headlamp; helmet.position.copy(camera.position);
      // A helmet lamp cannot compete with sunlit ground; it matters in shadow.
      // Lunar soil sends a lamp held at the eye straight back, so a little goes far.
      helmet.intensity = 16 * (1 - daylight) ** 2 + 2.5 * daylight;
      camera.getWorldDirection(direction); helmet.target.position.copy(camera.position).addScaledVector(direction, 20);
      if (terrainLOD.update(eye, quality.detail * saving, quality.depth)) shadowsDirty = true;
      if (rockField.update(eye, quality.rocks, settings.density)) shadowsDirty = true;
      if (gravel.update(eye, quality.gravel * saving, settings.density)) shadowsDirty = true;
      // GPU fallback changes rendering resolution, never geometry scale or physics.
      if (!adapted && samples > 120 && now - startedAt > 4000 && averageMs > 28) {
        renderer.setPixelRatio(Math.max(0.65, Math.min(devicePixelRatio || 1, quality.dpr) * 0.72));
        saving = 0.7;
        for (const light of csm.lights) if (light.shadow.mapSize.width > 1024) {
          light.shadow.map?.dispose(); light.shadow.map = null; light.shadow.mapSize.set(1024, 1024);
        }
        shadowsDirty = true;
        resize(); adapted = true;
      }
      // Holding mouse capture does not mean the camera moved. Reuse all maps
      // when stationary; update moving shadows without slowing camera/physics.
      const cameraMoved = shadowEye.distanceToSquared(camera.position) > 0.0001 || 1 - Math.abs(shadowRotation.dot(camera.quaternion)) > 0.000001;
      const sunMoved = shadowSun.distanceToSquared(skyDirections.sun) > 1e-10;
      if ((shadowsDirty || cameraMoved || sunMoved || shadowClock !== settings.timeMs) && now - shadowTime > 32) {
        csm.update();
        for (const light of csm.lights) light.shadow.needsUpdate = true;
        renderer.shadowMap.needsUpdate = true; shadowsDirty = false;
        shadowTime = now; shadowClock = settings.timeMs; shadowEye.copy(camera.position); shadowRotation.copy(camera.quaternion); shadowSun.copy(skyDirections.sun);
      }
      renderer.render(scene, camera);
      if (now - lastHud > 160) { notify({ eye }); lastHud = now; }
    };
    // Finish material compilation while the loading screen is still present.
    terrainLOD.update(physics.eye(), quality.detail, quality.depth);
    rockField.update(physics.eye(), quality.rocks, settings.density);
    gravel.update(physics.eye(), quality.gravel, settings.density);
    onStage("Preparing lunar shaders");
    await renderer.compileAsync(scene, camera);
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    last = performance.now(); tick(last);
    if (fatal) throw new Error(error);
    notify();
    return {
      dispose, start: controls.start, pause: controls.pause,
      reset() { physics.reset(); notify(); },
      findSunlight(from, to, searchSignal) { return findSunlitTime(data, skyData, bundle.terrain, physics.eye(), settings.timeMs, from, to, searchSignal); },
      command(code, pressed) { if (pressed) { controls.activateTouch(); touchKeys.add(code); } else touchKeys.delete(code); },
      // Development-only camera rig for automated screenshots; stripped from builds.
      debug: import.meta.env.DEV ? {
        look(nextYaw, nextPitch) { yaw = nextYaw; pitch = nextPitch; },
        teleport(x, z) { physics.teleport(x, z); shadowsDirty = true; },
        freeze() { adapted = true; },
        zoom(on) { zoomHeld = !!on; },
        info: () => ({ render: { ...renderer.info.render }, memory: { ...renderer.info.memory }, programs: renderer.info.programs?.length, eye: physics.eye(), yaw, pitch, reading, averageMs,
          terrain: terrainLOD.stats(), gravel: gravel.count(), landmark: geology.landmark, gains: [...materials.materials].map((m) => m.userData.lunarRockGain?.value).filter(Boolean), albedo: materials.regolithAlbedo, rocks: rocks.length, boulders: rocks.filter((r) => r.radius >= 0.3).length, fields: geology.fields.length }),
      } : undefined,
      configure(next) {
        const previous = settings; settings = { ...settings, ...next };
        if (previous.headlamp !== settings.headlamp || previous.density !== settings.density) shadowsDirty = true;
        if (next.exposure != null) renderer.toneMappingExposure = settings.exposure * exposure;
        if (next.fov != null && previous.fov !== settings.fov) { camera.fov = settings.fov / (1 + (ZOOM - 1) * zoom); camera.updateProjectionMatrix(); csm.updateFrustums(); shadowsDirty = true; }
        if (next.quality && previous.quality !== next.quality) { setupQuality(); resize(); }
      },
    };
  } catch (error) { dispose(); throw error; }
}
