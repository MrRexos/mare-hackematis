// Shared helpers for the capture scripts.
//
// Everything the film shows of the product is captured here from the real app,
// running on its own Vite dev server. Nothing under web/ is edited: the scripts
// only click, type and read, as a person would.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
export const { chromium } = require("playwright");

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..", "..");
export const WEB = path.join(ROOT, "web");
export const OUT = path.join(ROOT, "video", "public", "app");
export const MASTERS = path.join(ROOT, "video", "capture", "masters");
export const PORT = Number(process.env.CAPTURE_PORT || 5173);
export const URL_APP = `http://127.0.0.1:${PORT}/`;

// The plan used in the film. One place, so every script films the same mission.
export const PLAN = {
  destination: "South Pole",
  from: "2026-12-01",
  to: "2027-03-01",
  days: 14,
  profile: "Balanced",
};
// The browser clock is pinned so "today" is the same on every run.
export const TODAY = "2026-11-15T12:00:00Z";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function reachable() {
  try {
    const r = await fetch(URL_APP, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

/** Starts the app's dev server for the length of one capture run. */
export async function startServer() {
  if (await reachable()) return { stop: async () => {}, reused: true };
  const child = spawn("npm", ["run", "dev", "--", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"], {
    cwd: WEB,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  for (let i = 0; i < 120; i++) {
    if (await reachable()) {
      return {
        reused: false,
        stop: async () => { try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ } },
      };
    }
    if (child.exitCode != null) throw new Error(`Dev server exited:\n${log}`);
    await sleep(500);
  }
  throw new Error(`Dev server did not start:\n${log}`);
}

/**
 * Opens the app. `dsf` 2 gives 3840 × 2160 stills that stay sharp when the film
 * zooms in; moving shots use dsf 1 (1920 × 1080, pixel for pixel).
 */
export async function openApp({ width = 1920, height = 1080, dsf = 1, stepper = false } = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dsf, colorScheme: "dark" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.setFixedTime(new Date(TODAY));
  if (stepper) await page.addInitScript(fs.readFileSync(path.join(here, "stepper.js"), "utf8"));
  await page.goto(URL_APP);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await sleep(600);
  return { browser, context, page, errors };
}

const LENGTH_STEPS = [1, 2, 3, 5, 7, 10, 14, 21, 30, 45, 60, 90, 180, 270, 365, 545, 730];

/** Step 1 of the planner. */
export async function chooseWhere(page, plan = PLAN) {
  await page.getByRole("button", { name: "Select where" }).click();
  await page.getByRole("radio", { name: plan.destination }).click();
}
/** Step 2 of the planner: a search range and the time on the surface. */
export async function chooseWhen(page, plan = PLAN) {
  await page.getByRole("button", { name: "Next" }).click();
  if (plan.fixed) {
    await page.getByRole("button", { name: "Fixed date" }).click();
    await page.locator('input[type="date"]').fill(plan.fixed);
  } else {
    await page.getByRole("button", { name: "Find best dates" }).click();
    await page.getByRole("radio", { name: "Custom range" }).click();
    await page.getByLabel("From (UTC)").fill(plan.from);
    await page.getByLabel("To (UTC)").fill(plan.to);
  }
  const box = await page.locator(".lslider__track").boundingBox();
  const at = (LENGTH_STEPS.indexOf(plan.days) + 0.5) / LENGTH_STEPS.length;
  await page.mouse.click(box.x + box.width * at, box.y + box.height / 2);
}
/** Step 3 of the planner. */
export async function chooseHow(page, plan = PLAN) {
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("radio", { name: plan.profile }).click();
}
export async function planMission(page, plan = PLAN) {
  await chooseWhere(page, plan);
  await chooseWhen(page, plan);
  await chooseHow(page, plan);
  await page.getByRole("button", { name: "Explore" }).click();
}

/** Waits until the mission is scored and the ranking is on screen. */
export async function waitComputed(page, maxSeconds = 240) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxSeconds * 1000) {
    const done = await page.evaluate(() => {
      const text = document.body.innerText;
      return /Computed/.test(text) && /Hotspot 01/.test(text) && !/Scoring/.test(text);
    });
    if (done) return true;
    await sleep(200);
  }
  throw new Error("The mission did not finish computing in time");
}

/** Lets layout, images and CSS transitions settle before a still. */
export async function settle(page, ms = 700) {
  await page.evaluate(() => document.fonts.ready);
  await sleep(ms);
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** A PNG master of the viewport. */
export async function still(page, name) {
  ensureDir(MASTERS);
  const file = path.join(MASTERS, `${name}.png`);
  await page.screenshot({ path: file, type: "png", animations: "disabled", caret: "hide" });
  return file;
}

export function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}
export function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
/** Numbers read off the app while filming; the film's captions use these. */
export const META = path.join(ROOT, "video", "src", "captured.json");
export function mergeMeta(patch) {
  const next = { ...readJson(META), ...patch };
  writeJson(META, next);
  return next;
}
