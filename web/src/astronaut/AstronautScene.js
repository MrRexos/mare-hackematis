import * as THREE from "three";
import { CSM } from "three/examples/jsm/csm/CSM.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { celestialAt, findSunlitTime } from "./CelestialPosition.js";
import { initPhysics, LunarPhysics, FIXED_STEP } from "./LunarPhysics.js";
import { makeSurfaceMaterials, setupLunarMaterial } from "./SurfaceMaterials.js";
import { addRocks, rockPlacements } from "./ProceduralRocks.js";
import { loadAssetLibrary } from "./MegascansLibrary.js";
import { randomSeed } from "./coordinates.js";
import { addTerrainLOD } from "./TerrainLOD.js";
import { createSurfaceGeology } from "./SurfaceGeology.js";
import { applyLookDelta, createFirstPersonControls } from "./FirstPersonControls.js";

export const QUALITIES = {
  LOW: { dpr: 0.85, shadow: 1024, cascades: 3, ao: false, rocks: 70, terrain: 130 },
  MEDIUM: { dpr: 1, shadow: 1024, cascades: 3, ao: false, rocks: 130, terrain: 190 },
  HIGH: { dpr: 1.4, shadow: 2048, cascades: 3, ao: true, rocks: 210, terrain: 280 },
  ULTRA: { dpr: 1.75, shadow: 4096, cascades: 4, ao: true, rocks: 320, terrain: 400 },
};

// Photographic exposure is calibrated for a dark lunar albedo at grazing angles;
// these rendering units are not a calibrated radiometric measurement.
const SUN_LIGHT = 10;

function meshFrom(data, tile = 8, context = false) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  const values = context ? data.uv : new Float32Array(data.positions.length / 3 * 2);
  if (!context) for (let p = 0; p < data.positions.length / 3; p++) { values[p * 2] = data.positions[p * 3] / tile; values[p * 2 + 1] = -data.positions[p * 3 + 2] / tile; }
  geometry.setAttribute("uv", new THREE.BufferAttribute(values, 2));
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  return geometry;
}

function earthTexture() {
  const w = 512, h = 256, pixels = new Uint8Array(w * h * 4), random = randomSeed(7918);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const lat = (y / h - 0.5) * Math.PI, lon = x / w * Math.PI * 2;
    const land = Math.sin(lon * 3 + Math.sin(lat * 4) * 2) + Math.cos(lon * 5 - lat * 7) * 0.5;
    const cloud = Math.sin(lon * 19 + lat * 23 + Math.sin(lon * 7) * 3) > 0.89 || Math.abs(lat) > 1.3;
    const shade = 0.9 + random() * 0.1;
    const rgb = cloud ? [210, 221, 225] : land > 0.7 ? [91, 99, 62] : [20, 72, 123];
    pixels.set([...rgb.map((c) => c * shade), 255], (y * w + x) * 4);
  }
  const texture = new THREE.DataTexture(pixels, w, h, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace; texture.needsUpdate = true;
  texture.magFilter = THREE.LinearFilter;
  return texture;
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
  const materials = makeSurfaceMaterials();
  let library, physics, csm, composer, gtao, renderPass, outputPass, raf = 0, disposed = false;
  const cleanups = [], geoms = new Set(), extraMaterials = new Set(), targets = [];
  const dispose = () => {
    if (disposed) return; disposed = true;
    cancelAnimationFrame(raf);
    for (const fn of cleanups) fn();
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    physics?.dispose(); csm?.remove(); csm?.dispose();
    for (const light of csm?.lights || []) light.shadow.dispose();
    gtao?.dispose(); outputPass?.dispose(); composer?.dispose();
    geoms.forEach((g) => g.dispose());
    materials.geometries.forEach((g) => { if (!geoms.has(g)) g.dispose(); });
    materials.materials.forEach((m) => m.dispose()); extraMaterials.forEach((m) => m.dispose());
    materials.textures.forEach((t) => t.dispose()); targets.forEach((t) => t.dispose());
    renderer.dispose(); canvas.remove();
  };
  try {
    const geology = createSurfaceGeology(bundle.terrain.lat, bundle.terrain.lon);
    library = await loadAssetLibrary(renderer, materials, signal, geology);
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    onStage("Generating environment");
    const terrainGeometry = meshFrom(bundle.terrain, library.surfaceTileM); geoms.add(terrainGeometry);
    const terrainLOD = addTerrainLOD(scene, bundle.terrain, terrainGeometry, materials.terrain, geoms);
    const contextGeometry = meshFrom(bundle.context, 8, true); geoms.add(contextGeometry);
    const contextMesh = new THREE.Mesh(contextGeometry, materials.terrain);
    contextMesh.receiveShadow = true; contextMesh.castShadow = true; scene.add(contextMesh);
    const rocks = rockPlacements(bundle.terrain, 1.4, geology, library.variants.length || 4);
    const rockField = addRocks(scene, rocks, materials.rock, library.variants);
    cleanups.push(() => rockField.dispose());
    for (const batch of rockField.batches) for (const mesh of batch.meshes) geoms.add(mesh.geometry);
    physics = new LunarPhysics(bundle.terrain, rocks);
    const sunMaterial = new THREE.MeshBasicMaterial({ color: 0xfff6e7, toneMapped: false }); extraMaterials.add(sunMaterial);
    const sunGeometry = new THREE.SphereGeometry(1, 32, 24); geoms.add(sunGeometry);
    const sun = new THREE.Mesh(sunGeometry, sunMaterial); sun.frustumCulled = false; scene.add(sun);
    const earthMap = earthTexture(); materials.textures.add(earthMap);
    const earthMaterial = new THREE.MeshBasicMaterial({ map: earthMap, color: 0xffffff, toneMapped: false }); extraMaterials.add(earthMaterial);
    const earthGeometry = new THREE.SphereGeometry(1, 48, 32); geoms.add(earthGeometry);
    const earth = new THREE.Mesh(earthGeometry, earthMaterial); earth.frustumCulled = false; scene.add(earth);
    const phaseSun = { value: new THREE.Vector3() };
    earthMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.lunarSunDirection = phaseSun;
      shader.vertexShader = `varying vec3 vEarthNormal;\n${shader.vertexShader}`.replace("#include <begin_vertex>", "#include <begin_vertex>\nvEarthNormal = normalize(mat3(modelMatrix) * normal);");
      shader.fragmentShader = `uniform vec3 lunarSunDirection; varying vec3 vEarthNormal;\n${shader.fragmentShader}`.replace("#include <opaque_fragment>", "outgoingLight *= 0.008 + 0.992 * max(0.0, dot(normalize(vEarthNormal), lunarSunDirection));\n#include <opaque_fragment>");
    };
    const sunClip = new THREE.Plane(), earthClip = new THREE.Plane();
    sunMaterial.clippingPlanes = [sunClip]; earthMaterial.clippingPlanes = [earthClip];
    const helmet = new THREE.SpotLight(0xf5f4ef, 90, 55, Math.PI * 0.32, 0.88, 1.5);
    helmet.castShadow = true; helmet.shadow.mapSize.set(1024, 1024); helmet.shadow.bias = -0.0002; helmet.shadow.normalBias = 0.015;
    helmet.shadow.autoUpdate = false;
    scene.add(helmet, helmet.target); cleanups.push(() => helmet.shadow.dispose());
    // Restrained ground bounce for photographic readability, not an atmosphere.
    const bounce = new THREE.HemisphereLight(0x62605b, 0xbeb7aa, 0.25);
    scene.add(bounce);
    onStage("Calculating celestial positions");
    let settings = { ...initial }, quality = QUALITIES[settings.quality], yaw = 0, pitch = -0.08, active = false, locked = false;
    let error = "", fatal = false, reading = null, targetSky = null, lastSky = -Infinity, lastHud = -Infinity;
    let last = performance.now(), accumulator = 0, averageMs = 16, samples = 0, adapted = false;
    let shadowTime = -Infinity, shadowClock = NaN, shadowsDirty = true;
    const shadowEye = new THREE.Vector3(Infinity, Infinity, Infinity);
    const shadowRotation = new THREE.Quaternion(), shadowSun = new THREE.Vector3();
    const startedAt = performance.now();
    const keys = new Set(), touchKeys = new Set();
    const skyDirections = { sun: new THREE.Vector3(), earth: new THREE.Vector3() };
    const heading = () => ((-yaw * 180 / Math.PI) % 360 + 360) % 360;
    const notify = (extra = {}) => onUpdate({ active, locked, error, yaw, heading: heading(), eye: physics.eye(), reading, quality: settings.quality, adapted, fps: Math.round(1000 / averageMs), assetLabel: library.label, warnings: library.warnings, ...extra });
    renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
      fatal = true; active = false;
      error = `The graphics driver could not compile the lunar surface shader. ${gl.getShaderInfoLog(fragment) || gl.getProgramInfoLog(program) || "Try a lower graphics quality."}`;
      notify({ fatal: true });
    };

    const setupQuality = () => {
      quality = QUALITIES[settings.quality];
      terrainLOD.setDistance(quality.terrain);
      for (const light of csm?.lights || []) light.shadow.dispose();
      csm?.remove(); csm?.dispose();
      csm = new CSM({ camera, parent: scene, cascades: quality.cascades, maxFar: 1200, mode: "practical", shadowMapSize: quality.shadow,
        lightDirection: new THREE.Vector3(0, -0.1, -1).normalize(), lightIntensity: SUN_LIGHT, shadowBias: -0.00002, lightNear: 0.1, lightFar: 34000, lightMargin: 17000 });
      csm.fade = true; csm.updateFrustums();
      csm.lights.forEach((light) => { light.shadow.normalBias = 0.025; light.shadow.radius = 1.5; light.shadow.autoUpdate = false; });
      materials.materials.forEach((material) => setupLunarMaterial(material, csm));
      gtao?.dispose(); outputPass?.dispose(); composer?.dispose();
      composer = null; gtao = null;
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, quality.dpr));
      if (quality.ao) {
        composer = new EffectComposer(renderer);
        renderPass = new RenderPass(scene, camera); composer.addPass(renderPass);
        gtao = new GTAOPass(scene, camera, wrap.clientWidth, wrap.clientHeight, undefined, { radius: 0.55, thickness: 0.35, samples: 8 });
        gtao.blendIntensity = 0.32; composer.addPass(gtao);
        outputPass = new OutputPass(); composer.addPass(outputPass);
      }
      shadowsDirty = true; adapted = false; samples = 0;
      renderer.shadowMap.needsUpdate = true;
    };
    setupQuality();
    const resize = () => {
      const width = Math.max(1, wrap.clientWidth), height = Math.max(1, wrap.clientHeight);
      renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
      composer?.setPixelRatio(renderer.getPixelRatio()); composer?.setSize(width, height);
      // AO's intermediate depth/normal buffers do not need full display resolution.
      const aoScale = settings.quality === "ULTRA" ? 0.75 : 0.6;
      gtao?.setSize(Math.max(1, Math.round(width * renderer.getPixelRatio() * aoScale)), Math.max(1, Math.round(height * renderer.getPixelRatio() * aoScale)));
      csm.updateFrustums(); shadowsDirty = true;
    };
    const observer = new ResizeObserver(resize); observer.observe(wrap); cleanups.push(() => observer.disconnect()); resize();
    const listen = (target, name, fn, options) => { target.addEventListener(name, fn, options); cleanups.push(() => target.removeEventListener(name, fn, options)); };
    const clearInput = () => { keys.clear(); touchKeys.clear(); accumulator = 0; last = performance.now(); };
    const controls = createFirstPersonControls(canvas, {
      onLook(dx, dy) { ({ yaw, pitch } = applyLookDelta(yaw, pitch, dx, dy, settings.sensitivity)); },
      onChange(state) { active = state.active; locked = state.locked; error = state.error; notify(); },
      onPause() { notify({ showSettings: true }); }, onClear: clearInput,
    });
    cleanups.push(() => controls.dispose());
    listen(document, "keydown", (event) => {
      if (!active || event.target.closest?.("input, select, textarea")) return;
      if (["KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft", "ShiftRight", "Space", "KeyR", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) {
        event.preventDefault();
        if (event.code === "KeyR") physics.reset();
        else if (!event.repeat || event.code !== "Space") keys.add(event.code);
      }
    });
    listen(document, "keyup", (event) => keys.delete(event.code));
    listen(canvas, "contextmenu", (event) => event.preventDefault());
    listen(canvas, "webglcontextlost", (event) => { event.preventDefault(); active = false; error = "Graphics context lost. Exit and reopen Astronaut Mode."; notify(); cancelAnimationFrame(raf); });
    let sunTarget = new THREE.Vector3(), direction = new THREE.Vector3(), clipNormal = new THREE.Vector3();
    const updateSky = (eye) => {
      reading = celestialAt(data, skyData, bundle.terrain, eye, settings.timeMs);
      if (!targetSky) {
        skyDirections.sun.fromArray(reading.sun.world); skyDirections.earth.fromArray(reading.earth.world);
        // Present the nearby fragment field; the selected astronomical time
        // and solar direction remain untouched.
        yaw = -Math.atan2(geology.patches[0].x, -geology.patches[0].z);
      }
      targetSky = reading;
    };
    updateSky(physics.eye());
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
      placeBody(sun, "sun", eye, dt); placeBody(earth, "earth", eye, dt); phaseSun.value.copy(skyDirections.sun);
      sunTarget.copy(skyDirections.sun).negate(); csm.lightDirection.copy(sunTarget);
      csm.lights.forEach((light) => { light.intensity = SUN_LIGHT * targetSky.sun.visibleFraction; });
      bounce.intensity = 0.005 + 0.25 * targetSky.sun.visibleFraction;
      helmet.visible = settings.headlamp; helmet.position.copy(camera.position);
      helmet.intensity = 90 * (1 - 0.70 * targetSky.sun.visibleFraction);
      camera.getWorldDirection(direction); helmet.target.position.copy(camera.position).addScaledVector(direction, 20);
      if (rockField.update(eye, quality.rocks, settings.density)) shadowsDirty = true;
      // GPU fallback changes rendering resolution, never geometry scale or physics.
      if (!adapted && samples > 120 && now - startedAt > 4000 && averageMs > 28) {
        renderer.setPixelRatio(Math.max(0.65, Math.min(devicePixelRatio || 1, quality.dpr) * 0.72));
        if (gtao) gtao.enabled = false;
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
        if (helmet.visible) helmet.shadow.needsUpdate = true;
        renderer.shadowMap.needsUpdate = true; shadowsDirty = false;
        shadowTime = now; shadowClock = settings.timeMs; shadowEye.copy(camera.position); shadowRotation.copy(camera.quaternion); shadowSun.copy(skyDirections.sun);
      }
      if (composer) composer.render(dt); else renderer.render(scene, camera);
      if (now - lastHud > 160) { notify({ eye }); lastHud = now; }
    };
    // Finish material compilation while the loading screen is still present.
    rockField.update(physics.eye(), quality.rocks, settings.density);
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
      configure(next) {
        const previous = settings; settings = { ...settings, ...next };
        if (previous.headlamp !== settings.headlamp || previous.density !== settings.density) shadowsDirty = true;
        if (next.exposure != null) renderer.toneMappingExposure = settings.exposure;
        if (next.fov != null && previous.fov !== settings.fov) { camera.fov = settings.fov; camera.updateProjectionMatrix(); csm.updateFrustums(); shadowsDirty = true; }
        if (next.quality && previous.quality !== next.quality) { setupQuality(); resize(); }
      },
    };
  } catch (error) { dispose(); throw error; }
}
