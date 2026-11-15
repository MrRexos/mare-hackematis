// Stills of every screen the film uses, at 3840 × 2160 (device scale factor 2),
// so the film can zoom into a card and the text stays sharp.
//
// It walks the app the way a planner would: Where, When, How, Explore, the best
// site in Mare, then Compare. It also writes down what the app says (best site,
// its window, the sky readouts) and where each card sits on the page, so that
// captions and zooms in the film come from the capture and not from memory.
//
//   node capture/02-stills.mjs

import {
  PLAN, chooseHow, chooseWhen, chooseWhere, mergeMeta, openApp, settle, startServer, still, waitComputed,
} from "./lib.mjs";

const server = await startServer();
const { browser, page, errors } = await openApp({ dsf: 2 });
const rects = {};
const rect = async (key, selector, nth = 0) => {
  const box = await page.locator(selector).nth(nth).boundingBox();
  if (box) rects[key] = { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) };
  return box;
};
const text = (selector, nth = 0) => page.locator(selector).nth(nth).innerText().then((s) => s.replace(/\s+/g, " ").trim());

try {
  // --- Planner -------------------------------------------------------------
  await settle(page, 1200);
  await still(page, "home-empty");

  await chooseWhere(page, PLAN);
  await settle(page);
  await rect("plannerEditor", ".setup__editor");
  await rect("plannerTitle", ".setup__title");
  await still(page, "plan-where");

  await chooseWhen(page, PLAN);
  await settle(page);
  await rect("plannerEditorWhen", ".setup__editor");
  await still(page, "plan-when");

  await chooseHow(page, PLAN);
  await settle(page);
  await rect("plannerEditorHow", ".setup__editor");
  await still(page, "plan-how");

  await page.getByRole("button", { name: "Mare Hackematis, home" }).click();
  await settle(page);
  await rect("plannerChoices", ".home__choices");
  await still(page, "plan-ready");
  const planValues = await page.locator(".home__choice-value").allInnerTexts();

  // --- Explore -------------------------------------------------------------
  await page.getByRole("button", { name: "Explore" }).click();
  await waitComputed(page);
  await settle(page, 1500);
  await rect("map", ".mapsec");
  await rect("rank", ".rank");
  await rect("best", ".rank__best");
  await rect("rankList", ".rank__list");
  await rect("missionChip", ".mchip");
  await rect("readout", ".map-readout");
  await still(page, "explore-score");
  const best = {
    name: await text(".best__name"),
    coords: await text(".rank__best .coords"),
    score: Number((await text(".best__score")).split(" ")[0]),
    window: await text(".rank__best .num-13"),
  };
  const candidates = await page.locator(".rrow").evaluateAll((rows) => rows.map((r) => ({
    name: r.querySelector(".rrow__name")?.textContent.trim(),
    score: Number(r.querySelector(".rrow__score")?.textContent.trim()),
  })));

  // Other layers of the same map (extended cut).
  for (const [name, label] of [["sun", "Sun visibility"], ["earth", "Earth visibility"], ["slope", "Terrain slope"]]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await settle(page, 900);
    await still(page, `explore-${name}`);
  }
  await page.getByRole("button", { name: "Mission score", exact: true }).click();
  await settle(page, 600);

  // --- Compare: the best calculated candidate and the three best Artemis III regions.
  await page.locator(".rank__best").getByRole("button", { name: "Compare" }).click();
  await page.getByRole("button", { name: /Artemis III references/ }).click();
  await settle(page, 700);
  const references = [
    { name: await text(".best__name"), score: Number((await text(".best__score")).split(" ")[0]), window: await text(".rank__best .num-13") },
    ...(await page.locator(".rrow").evaluateAll((rows) => rows.map((r) => ({
      name: r.querySelector(".rrow__name")?.textContent.trim(),
      score: Number(r.querySelector(".rrow__score")?.textContent.trim()),
    })))),
  ];
  await still(page, "explore-artemis");
  await page.locator(".rank__best").getByRole("button", { name: "Compare" }).click();
  for (const row of [0, 1]) await page.locator(".rrow").nth(row).locator("button.ibtn").click();
  await settle(page, 500);
  await rect("tray", ".cmptray, .tray, [class*=tray]");
  await still(page, "explore-tray");

  await page.getByRole("button", { name: "Open", exact: true }).click();
  await settle(page, 1500);
  const cards = page.locator(".shell__main .card");
  const cardCount = await cards.count();
  for (let i = 0; i < cardCount; i++) {
    const title = await cards.nth(i).locator("h2, h3").first().innerText().catch(() => "");
    const box = await cards.nth(i).boundingBox();
    if (!box) continue;
    const key = /Side by side/.test(title) ? "cmpTable" : /Good days by month/.test(title) ? "cmpMonths" : /^Why/.test(title) ? "cmpWhy" : null;
    if (key) rects[key] = { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) };
  }
  await still(page, "compare");
  const compare = {
    head: await text(".eyebrow-13"),
    sites: await page.locator(".shell__main table").first().locator("thead th").allInnerTexts().then((a) => a.map((s) => s.trim()).filter(Boolean)),
  };

  // --- Mare: the best calculated candidate ----------------------------------
  await page.getByRole("button", { name: "Explore" }).first().click();
  await settle(page, 600);
  await page.getByRole("button", { name: /Calculated candidates/ }).click();
  await settle(page, 400);
  await page.locator(".rank__best").getByRole("button", { name: "Open site" }).click();
  await settle(page, 1500);
  const siteCards = async () => {
    const out = {};
    const list = page.locator(".shell__main .card");
    for (let i = 0; i < (await list.count()); i++) {
      const title = (await list.nth(i).locator("h2, h3, .lbl").first().innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      const box = await list.nth(i).boundingBox();
      if (title && box) out[title] = { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) };
    }
    return out;
  };
  rects.overview = await siteCards();
  await still(page, "mare-overview");
  const overviewText = await page.locator(".shell__main").innerText();

  await page.getByRole("tab", { name: "Sky & Time" }).click();
  await settle(page, 1200);
  rects.sky = await siteCards();
  await still(page, "mare-sky");
  const skyText = await page.locator(".shell__main").innerText();

  await page.getByRole("tab", { name: "Lander's View" }).click();
  await page.waitForSelector("canvas");
  await settle(page, 6000);
  await still(page, "mare-lander");

  const line = (s, re) => (s.match(re) || [])[1]?.replace(/\s+/g, " ").trim() ?? null;
  mergeMeta({
    plan: { ...PLAN, shown: planValues },
    best,
    candidates,
    references,
    compare,
    site: {
      windowStart: line(overviewText, /START · UTC\s+([0-9: -]+)/),
      windowEnd: line(overviewText, /END · UTC\s+([0-9: -]+)/),
      sunAtLanding: line(overviewText, /Sun\s+(az [^\n]+)/),
      earthAtLanding: line(overviewText, /Earth\s+(az [^\n]+)/),
      crossCheck: line(overviewText, /CROSS-CHECK\s+([^\n]+)/),
      sunlightLeft: line(skyText, /SUNLIGHT\s+[^\n]+\s+([^\n]+)/),
      nextNight: line(skyText, /NEXT NIGHT\s+([^\n]+)/),
      earthSets: line(skyText, /EARTH SETS\s+([^\n]+\s+[^\n]+)/),
    },
    rects,
    viewport: { width: 1920, height: 1080, deviceScaleFactor: 2 },
  });
  console.log(JSON.stringify({ best, candidates: candidates.slice(0, 3), references: references.slice(0, 4), compare, planValues }, null, 1));
  if (errors.length) console.log("page errors:", errors);
} finally {
  await browser.close();
  await server.stop();
}
