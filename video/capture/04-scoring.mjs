// The scoring run, as it happens.
//
// Presses Explore and takes a screenshot about five times a second until the
// ranking is on screen, noting when each one was taken. build-assets.mjs lays
// the frames on the film timeline, each held for its real share of the run, so
// the time-lapse is the real progress bar at a constant speed-up. The speed is
// chosen so that the scored map arrives 2.5 s into the clip.
//
// Run it on an idle machine: the screenshots already cost the computation a
// little, and the film quotes the time measured by 01-timing.mjs, not this one.
//
//   node capture/04-scoring.mjs

import fs from "node:fs";
import path from "node:path";
import { MASTERS, PLAN, chooseHow, chooseWhen, chooseWhere, ensureDir, mergeMeta, openApp, sleep, startServer, writeJson } from "./lib.mjs";

const ARRIVAL_SECONDS = 2.5;
const dir = ensureDir(path.join(MASTERS, "scoring"));
for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f));

const server = await startServer();
const { browser, page } = await openApp({ dsf: 1 });
try {
  await page.waitForLoadState("networkidle");
  await chooseWhere(page, PLAN);
  await chooseWhen(page, PLAN);
  await chooseHow(page, PLAN);
  await sleep(500);

  const frames = [];
  let arrivalMs = null;
  const t0 = Date.now();
  await page.getByRole("button", { name: "Explore" }).click();
  for (let i = 0; i < 2000; i++) {
    const t = Date.now() - t0;
    const done = await page.evaluate(() => {
      const text = document.body.innerText;
      return /Computed/.test(text) && /Hotspot 01/.test(text) && !/Scoring/.test(text);
    });
    const file = `${String(i).padStart(4, "0")}.png`;
    await page.screenshot({ path: path.join(dir, file), type: "png" });
    frames.push({ file, t });
    if (done && arrivalMs == null) arrivalMs = t;
    if (arrivalMs != null && t - arrivalMs > 1500) break;
    await sleep(120);
  }
  const speed = arrivalMs / 1000 / ARRIVAL_SECONDS;
  writeJson(path.join(dir, "frames.json"), { speed, arrivalMs, arrivalSeconds: ARRIVAL_SECONDS, tail: 2, frames });
  mergeMeta({ scoringClip: { realSeconds: Number((arrivalMs / 1000).toFixed(1)), speed: Number(speed.toFixed(2)), frames: frames.length, arrivalFilmFrame: Math.round(ARRIVAL_SECONDS * 30) } });
  console.log(`scoring run: ${(arrivalMs / 1000).toFixed(1)} s, ${frames.length} screenshots, shown at ${speed.toFixed(2)}x`);
} finally {
  await browser.close();
  await server.stop();
}
