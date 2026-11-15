// Astronaut Mode, frame by frame.
//
// The machine that renders the film has no GPU, so the mode cannot be recorded
// live: one frame takes several seconds. Instead the script takes over the
// browser's animation clock (stepper.js) and advances it 1/30 s per frame. The
// app runs its own physics and renderer on every step; nothing is retouched.
//
// What is driven from outside:
//   - walking, with the same command the on-screen touch buttons send;
//   - where the camera looks and the telephoto, with the camera rig the app
//     exposes in development builds for automated screenshots;
//
// The graphics quality is the one the app picks by itself on this machine
// (MEDIUM with four cores). Changing it in the settings panel raised a WebGL
// uniform error in three.js when this was written, so the script leaves it alone.
//
// The window is 1140 px tall and only the top 1080 rows are kept. The row that
// is left out is the footer, which shows a frames-per-second figure. Under a
// stepped clock that figure is an artefact of the capture, not a measurement,
// so it does not belong in the film.
//
//   node capture/03-astronaut.mjs            full capture (1920 × 1080 frames)
//   node capture/03-astronaut.mjs --preview  quick low-resolution check of the path

import fs from "node:fs";
import path from "node:path";
import { MASTERS, PLAN, ensureDir, mergeMeta, openApp, planMission, settle, sleep, startServer, waitComputed } from "./lib.mjs";

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : fallback;
};
const preview = process.argv.includes("--preview");
const quality = arg("quality", "MEDIUM");
const FPS = 30;
const FRAMES = Number(arg("frames", 120));
// The preview advances three frames of film time per rendered frame.
const stride = Number(arg("stride", preview ? 3 : 1));
const scale = preview ? 1 / 3 : 1;
const width = Math.round(1920 * scale), height = Math.round(1140 * scale), keep = Math.round(1080 * scale);
const outDir = ensureDir(path.join(MASTERS, preview ? "astronaut-preview" : "astronaut"));

const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const mix = (a, b, t) => a + (b - a) * t;
const rad = (deg) => (deg * Math.PI) / 180;

const server = await startServer();
const { browser, page, errors } = await openApp({ width, height, dsf: 1, stepper: true });
try {
  await planMission(page, PLAN);
  await waitComputed(page);
  await settle(page, 500);
  await page.locator(".rank__best").getByRole("button", { name: "Open site" }).click();
  await settle(page, 800);
  await page.getByRole("tab", { name: "Astronaut Mode" }).click();
  await page.waitForFunction(() => !!window.__astronaut, null, { timeout: 600000, polling: 250 });
  // From here on, frames only advance when the script says so.
  await page.evaluate(() => { window.__cap.enable(); window.__astronaut.debug.freeze(); });
  const step = (ms = 1000 / FPS) => page.evaluate((dt) => window.__cap.step(dt), ms);

  if (quality !== "MEDIUM") {
    await page.getByRole("button", { name: "Astronaut settings" }).click();
    await page.getByLabel("Graphics quality").selectOption(quality);
    await sleep(300);
    await page.getByRole("button", { name: "Close panel" }).click();
    await sleep(300);
  }
  for (let i = 0; i < 2; i++) { await step(); await sleep(100); }

  // At the landing hour the low Sun can sit behind a rise a few metres away.
  // The app has a button for that: Find sunlight moves the clock to an hour in
  // the mission period with the whole solar disc in view from where you stand.
  const sunNow = await page.evaluate(() => window.__astronaut.debug.info().reading.sun.visibleFraction);
  let usedFindSunlight = false;
  if (sunNow < 0.98) {
    await page.getByRole("button", { name: "Date and time" }).click();
    await page.getByRole("button", { name: "Find sunlight" }).click();
    await page.waitForFunction(() => !document.querySelector(".astronaut__panel"), null, { timeout: 180000, polling: 250 });
    usedFindSunlight = true;
  }
  // Let the Sun and the Earth settle at their place for the chosen hour. Steps of
  // 100 ms: fewer frames to draw while nothing is being filmed.
  for (let i = 0; i < 8; i++) await step(100);
  await sleep(300);

  const info = await page.evaluate(() => {
    const i = window.__astronaut.debug.info();
    return { eye: i.eye, yaw: i.yaw, sun: { az: i.reading.sun.az, el: i.reading.sun.el, visible: i.reading.sun.visibleFraction },
      earth: { az: i.reading.earth.az, el: i.reading.earth.el, visible: i.reading.earth.visibleFraction } };
  });
  console.log("sky at the site:", JSON.stringify(info));

  // The shot: walk with the Sun behind, turn until the Earth is ahead, then the telephoto.
  const earthAz = info.earth.az;
  const startAz = earthAz - 62;
  const WALK_END = 72, ZOOM_START = 78;
  const lookAt = (frame) => {
    const turn = ease(frame / 70);
    const tilt = ease((frame - ZOOM_START) / 26);
    return { yaw: -rad(mix(startAz, earthAz, turn)), pitch: mix(mix(-0.13, -0.035, turn), rad(info.earth.el) - 0.03, tilt) };
  };

  await page.evaluate(({ yaw, pitch }) => window.__astronaut.debug.look(yaw, pitch), lookAt(0));
  await page.evaluate(() => { window.__astronaut.command("KeyW", true); window.__astronaut.command("ShiftLeft", true); });
  // A second of walking before the first frame, so the shot starts in motion.
  for (let i = 0; i < 10; i++) await step(100);

  const started = Date.now();
  let rendered = 0;
  for (let frame = 0; frame < FRAMES; frame += stride) {
    if (frame >= WALK_END && frame < WALK_END + stride) await page.evaluate(() => { window.__astronaut.command("KeyW", false); window.__astronaut.command("ShiftLeft", false); });
    if (frame >= ZOOM_START && frame < ZOOM_START + stride) await page.evaluate(() => window.__astronaut.debug.zoom(true));
    await page.evaluate(({ yaw, pitch }) => window.__astronaut.debug.look(yaw, pitch), lookAt(frame));
    await step((1000 / FPS) * stride);
    await sleep(60); // lets the HUD repaint with the new readings
    const file = path.join(outDir, `${String(frame).padStart(4, "0")}.png`);
    await page.screenshot({ path: file, type: "png", clip: { x: 0, y: 0, width, height: keep }, timeout: 300000 });
    rendered += 1;
    const perFrame = (Date.now() - started) / 1000 / rendered;
    if (rendered % 10 === 1) console.log(`frame ${frame}/${FRAMES} · ${perFrame.toFixed(1)} s per frame`);
  }
  const hud = await page.locator(".astronaut__readings").innerText().catch(() => "");
  const footer = await page.locator(".astronaut__footer").innerText().catch(() => "");
  const place = await page.locator(".astronaut__identity").innerText().catch(() => "");
  if (!preview) {
    mergeMeta({ astronaut: {
      place: place.replace(/\s+/g, " ").trim(), quality, frames: FRAMES, fps: FPS,
      sun: info.sun, earth: info.earth,
      hud: hud.replace(/\s+/g, " ").trim(),
      terrain: footer.replace(/\s+/g, " ").trim().replace(/\s*·?\s*(Adaptive · )?[A-Z]+ · [0-9–]+ fps$/, ""),
      usedFindSunlight,
      secondsPerFrame: Number(((Date.now() - started) / 1000 / rendered).toFixed(1)),
    } });
  }
  console.log("hud:", hud.replace(/\s+/g, " "));
  console.log("footer:", footer.replace(/\s+/g, " "));
  if (errors.length) console.log("page errors:", errors);
  fs.writeFileSync(path.join(outDir, "done.txt"), new Date().toISOString());
} finally {
  await browser.close();
  await server.stop();
}
