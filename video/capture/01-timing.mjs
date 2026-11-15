// Measures how long the app takes to score the film's mission, from pressing
// Explore to the ranking on screen. Nothing is captured during the measurement,
// so screenshots do not slow the computation down. The film quotes the median.
//
//   node capture/01-timing.mjs [runs]

import os from "node:os";
import { PLAN, mergeMeta, openApp, planMission, startServer } from "./lib.mjs";

const runs = Number(process.argv[2] || 3);
const server = await startServer();
const times = [];
try {
  for (let i = 0; i < runs; i++) {
    const { browser, page } = await openApp({ dsf: 1 });
    // Wait for the terrain horizons (11.5 MB) so that only the scoring is timed.
    await page.waitForLoadState("networkidle");
    const explore = async () => {
      await planMission(page, PLAN);
    };
    const t0 = Date.now();
    await explore();
    const tClick = Date.now();
    await page.waitForFunction(() => {
      const text = document.body.innerText;
      return /Computed/.test(text) && /Hotspot 01/.test(text) && !/Scoring/.test(text);
    }, null, { polling: 50, timeout: 300000 });
    const seconds = (Date.now() - tClick) / 1000;
    times.push(seconds);
    console.log(`run ${i + 1}: ${seconds.toFixed(2)} s to score (planner clicks took ${((tClick - t0) / 1000).toFixed(1)} s)`);
    await browser.close();
  }
} finally {
  await server.stop();
}
const sorted = [...times].sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)];
const cpu = os.cpus();
const meta = mergeMeta({
  scoring: {
    seconds: Number(median.toFixed(1)),
    runs: times.map((t) => Number(t.toFixed(2))),
    cores: cpu.length,
    cpu: cpu[0]?.model || "unknown",
    browser: "Chromium (Playwright, headless), software WebGL, no GPU",
    workers: Math.max(1, Math.min(8, cpu.length - 1)),
    note: "Time from pressing Explore to the ranking on screen, median of the runs.",
  },
});
console.log(JSON.stringify(meta.scoring, null, 2));
