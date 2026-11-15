# Credits and sources

Film: Mare Hackematis, submission cut, 30.0 s (900 frames at 30 fps, 1920 x 1080, H.264 video, AAC audio).
Team: Hackemate. Event: NASA Space Apps Challenge 2026, challenge "Lunar Landing Site Navigator".

This is a student project. NASA did not build, use or endorse it, and the film shows no NASA insignia or logo. NASA datasets are named because they are the sources of the data.

## Where each line on screen comes from

| On screen | Source in this repository |
|---|---|
| "The launch date just slipped. Where on the Moon do you land now?" | The situation described in the challenge statement, `data/PROJECT BASIS.txt` (Background, third paragraph: launch delays force planners to reconsider date and location). It is the framing of the film, not a claim about the app. |
| "Tell it where, when and what matters." | The three planner steps Where, When and How in `web/src/screens/Home.jsx`. |
| "Sun and Earth, checked against the real LOLA horizon." | `docs/ARCHITECTURE.md`, "Computing a mission", step 2. The horizon file is "Ray-marched over LOLA LDEM_75S_240M (PDS)": `web/public/data/manifest.json`, `horizon.source`. |
| "160,000 km2" | Grid of 400 x 400 pixels of 1 km: `web/public/data/manifest.json` (`grid.n` 400, `grid.pxM` 1000) and `docs/ARCHITECTURE.md`, "Grid". |
| "hour by hour" | True for the mission in the film. `web/src/engine/missionEngine.js` samples every `ceil((landing hours + mission hours) / 2600)` hours. The film plan is a 90 day range with 14 days on the surface: 1,824 + 336 = 2,160 hours, so the step is 1 hour. With a 12 month range the step becomes 4 hours, and the line would be false. |
| "Scored in 15 s, in the browser." and "Measured: 14.8 s on 4 CPU cores, no GPU." | Measured with `video/capture/01-timing.mjs`: time from pressing Explore to the ranking on screen, median of three runs (14.64, 15.23 and 14.82 s). Conditions and raw values are in `video/src/captured.json`, key `scoring`. "In the browser": `README.md`, "No server", and `docs/ARCHITECTURE.md`. |
| "Time-lapse of the real computation." | The scoring shot is the real run, captured by `video/capture/04-scoring.mjs` and played 6.8 times faster. That run took 17.1 s, more than the 14.8 s quoted, because taking a screenshot five times a second slows it down. Both figures are in `video/src/captured.json` (`scoringClip` and `scoring`). |
| "The best site, with its best landing window." | Best-site card of Explore (`web/src/screens/Explore.jsx`) and `docs/ARCHITECTURE.md`, "Computing a mission", step 3. |
| "Sunlight left. Next night. When the Earth sets." | The cards of the Sky & Time tab in `web/src/screens/Site.jsx`. |
| "Side by side with the Artemis III candidate regions." | Compare screen (`web/src/screens/Compare.jsx`). The regions and their note ("NASA announced nine ~15 x 15 km candidate regions on 2024-10-28. Points are approximate region centres, not landing sites") are in `web/public/data/manifest.json`, `sites`. The film compares the best calculated candidate with the three best-ranked regions. |
| "Then walk the site at 1:1 scale." | `docs/ASTRONAUT_MODE.md`, "Scientific data included": the mesh is 1,000 x 1,000 units, one unit per metre, with no vertical exaggeration. |
| "LOLA 240 m relief. Smaller craters and rocks are generated." | Same document, "Relief below the DEM resolution". At a site picked from the map the terrain is the 240 m LOLA DEM, and craters under 140 m and all rocks are generated, not measured. The app says so in its own footer. |
| "South Pole. North Pole. Whole Moon." | `README.md`, sections "North pole" and "Whole Moon view". |
| "0.002 arcminutes, at most" and "Sun and Earth, azimuth and elevation. 726 comparisons at 3 sites." | `web/public/data/validation.json`, `horizons`: largest difference 0.0016 arcmin for the Earth and 0.00004 arcmin for the Sun, in 6 series of 121 samples (Connecting ridge, Malapert Massif and Haworth, January 2027, every 6 hours). The comparison is JPL Horizons against the pipeline's formulas, which are the same ones the browser uses (`docs/ARCHITECTURE.md`, "Scientific conventions"). It is a south pole check; the north pole comparison has not been run (`README.md`, "North pole"). The app shows the same figure in Mare as "JPL Horizons, <= 0.002'". |
| "Data: NASA LOLA, NASA/JPL SPICE DE440, LRO Diviner" | `docs/ARCHITECTURE.md`, "Data (all official)". |
| End card | Team name in `web/src/screens/Home.jsx` (About). Challenge name in `README.md`. |

Numbers that appear inside the app captures (scores, dates, elevations) are whatever the app computed during capture. `video/src/captured.json` keeps a copy of the main ones.

## Product footage

Every image of the product is the app itself, running on its Vite dev server and driven with Playwright. Nothing under `web/` was changed. The scripts are in `video/capture/` and can be run again.

| Shot | Script | Notes |
|---|---|---|
| Planner, Explore, Mare, Compare | `02-stills.mjs` | Stills at 3840 x 2160 (device scale factor 2), so the film can zoom into a card. |
| Scoring | `04-scoring.mjs` | Screenshots of the real run with their timestamps, laid on the film timeline at a constant speed-up. |
| Astronaut Mode | `03-astronaut.mjs` | See below. |
| North Pole and whole Moon | `05-reach-stills.mjs` | Stills at 3840 x 2160. |

The mission in every shot is the same: South Pole, search range 2026-12-01 to 2027-03-01, 14 days on the surface, profile Balanced. The browser clock is pinned to 2026-11-15.

Astronaut Mode needs a note. The machine that made the film has no GPU, so the mode could not be recorded live. The script takes over the browser's animation clock and advances it 1/30 s per frame; the app runs its own physics and renderer on each step. Walking uses the command the on-screen touch buttons send. The camera direction and the telephoto use the camera rig the app exposes in development builds for automated screenshots. The clock was moved with the app's own "Find sunlight" button, because at the landing hour a rise a few metres away hides the Sun from where the walker stands. The capture window is 1140 px tall and the film keeps the top 1080 rows: the row left out is the footer, which shows a frames-per-second figure that means nothing under a stepped clock.

## Music

| | |
|---|---|
| Track | Mare Hackematis, film score (30 s) |
| Author | Hackemate. Written for this film. |
| Source | `video/audio/score.py` in this repository. It synthesises the track from sine partials, envelopes and a noise reverb. It uses no samples and no recordings. |
| Licence | Original work of the team, with no third-party material, so no outside licence applies. The team has not yet chosen a public licence for it. |

Measured on the rendered file: 30.000 s, 48 kHz stereo, integrated loudness -16.8 LUFS, true peak -3.0 dBFS, silent in the last 150 ms.

## Typeface

Geist and Geist Mono, the typefaces the app loads from Google Fonts (`web/index.html`). SIL Open Font License 1.1. The latin files are in `video/public/fonts/`.

## Third-party material visible in the footage

| Material | Where it shows | Provider and terms as the repository states them |
|---|---|---|
| Lunar relief, slope, roughness, permanent shadow, mean illumination | Maps, 3D views, Astronaut Mode terrain | NASA LOLA, PDS Geosciences Node (`docs/ARCHITECTURE.md`, "Data") |
| Sun and Earth positions | Every Sun and Earth readout | NASA/JPL NAIF SPICE, DE440 (`docs/ARCHITECTURE.md`) |
| Temperature and ice stability | Score factors | LRO Diviner Polar Resource Product (`docs/ARCHITECTURE.md`) |
| Artemis III regions | Ranking and Compare | NASA announcement of 2024-10-28, approximate centres (`web/public/data/manifest.json`) |
| Photograph on the 3D globe | Whole-Moon shot | LROC WAC global mosaic 100 m, NASA/GSFC/Arizona State University, USGS Astrogeology (`web/public/data/global/manifest.json`) |
| The Earth in Astronaut Mode | Astronaut Mode shot | NASA Blue Marble Next Generation, public domain, taken from the `three-globe` npm package; the clouds are synthetic (`docs/ASTRONAUT_MODE.md`) |
| Rocks and ground textures in Astronaut Mode | Astronaut Mode shot | Quixel Megascans from Fab, "Fab Standard License, downloaded through the owner's account" (`web/public/assets/astronaut/manifest.json`, `docs/ASTRONAUT_MODE.md`) |
| Moon photograph on the home page | Planner shots | `web/public/img/moon-landing.png`. The repository does not state its source. |

## Tools

Remotion 4 (remotion.dev) renders the film. Its free licence covers individuals and teams of up to three people; a larger team should check the Remotion licence terms. Playwright and Chromium capture the app. FFmpeg encodes the captures.

## To settle before publishing

1. The source of `web/public/img/moon-landing.png` is not written down anywhere in the repository. It is on screen for about four seconds. Whoever added it should confirm where it comes from.
2. The end card shows no web address, because nobody had confirmed which public address to print. To add one, set the `url` prop of `Submission` in `video/src/Root.tsx` and render again.
3. Remotion's free licence stops at three people and the About box of the app lists six.
4. The Fab Standard License of the Megascans assets was accepted through one team member's account. That person should confirm it covers showing the assets in a public video.
