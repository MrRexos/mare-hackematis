// Past the south pole: the same plan on the North Pole map and on the whole
// Moon (3D globe). Stills at 3840 × 2160.
//
//   node capture/05-reach-stills.mjs

import { PLAN, mergeMeta, openApp, planMission, settle, sleep, startServer, still, waitComputed } from "./lib.mjs";

const server = await startServer();
const { browser, page, errors } = await openApp({ dsf: 2 });
const text = (selector) => page.locator(selector).first().innerText().then((s) => s.replace(/\s+/g, " ").trim());
const bestCard = async () => ({
  name: await text(".best__name"),
  coords: await text(".rank__best .coords"),
  score: Number((await text(".best__score")).split(" ")[0]),
  window: await text(".rank__best .num-13").catch(() => null),
});
try {
  await planMission(page, PLAN);
  await waitComputed(page);
  await settle(page, 800);

  // North Pole: its data loads the first time, then the same engine scores it.
  await page.getByRole("tab", { name: "North Pole" }).click();
  await sleep(1500);
  await waitComputed(page, 400);
  await settle(page, 1500);
  await still(page, "north-score");
  const north = { best: await bestCard(), chip: await text(".mchip") };
  const northRefs = await page.locator(".rank__list .chip").allInnerTexts();

  // Whole Moon: fixed dates, 0.5 degree cells; then the 3D globe.
  await page.getByRole("tab", { name: "Whole Moon" }).click();
  await sleep(1500);
  await waitComputed(page, 400);
  await settle(page, 1500);
  await still(page, "moon-score");
  const moon = { best: await bestCard(), chip: await text(".mchip") };
  const moonRefs = await page.locator(".rank__list .chip").allInnerTexts();

  await page.getByRole("tab", { name: "3D" }).click();
  await page.waitForSelector("canvas.viewer__canvas", { timeout: 120000 });
  // The globe draws the 4k photograph first and the 8k one when it arrives.
  await sleep(25000);
  await still(page, "moon-globe");

  mergeMeta({ reach: { north: { ...north, rankings: northRefs.map((s) => s.replace(/\s+/g, " ").trim()) }, moon: { ...moon, rankings: moonRefs.map((s) => s.replace(/\s+/g, " ").trim()) } } });
  console.log(JSON.stringify({ north, moon }, null, 1));
  if (errors.length) console.log("page errors:", errors);
} finally {
  await browser.close();
  await server.stop();
}
