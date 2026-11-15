# NASA Space Apps 2026: Lunar Landing Site Navigator

Mission selector for the lunar south pole: you enter the **landing window** and the
mission **duration**, and the web app computes a **suitability heat map** from
official NASA data. The map combines solar exposure, Earth visibility,
relief and proximity to ice, and marks the **hotspots** where it is best to land.

Challenge: [Lunar Landing Site Navigator](https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/).

- **Data:** NASA LOLA (PDS) and NASA/JPL SPICE, validated against JPL Horizons.
- **Grid:** 1 km × 1 km, 83.5–90°S.
- **No server:** static web app; the computation runs in the browser.
- **Design:** shared design system "Lunar Horizon".

- **Full architecture:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- **Data contract** for extending to the whole Moon and splitting the work between teams:
  [docs/DATA_CONTRACT.md](docs/DATA_CONTRACT.md).
- **Validate a layer before delivering it:**

  ```bash
  python tools/validate_layer.py layers/<id>
  ```

## Start the web app (view only)

The generated data is already in `web/public/data/`. You need Node 18 or later.

```bash
cd web
npm install
npm run dev
```

Open http://localhost:5173.

## Astronaut Mode

In **Mare → Lander's View**, press the **Astronaut Mode** helmet to walk around a 1 km × 1 km region centred on the selected point. It includes real NASA terrain at 1:1 scale, lunar physics, Sun/Earth from SPICE, time controls, four surfaces and 20 Quixel rock variants. Craters smaller than the DEM resolution and the rocks are generated with lunar statistics: they are plausible, not measured data. The ground reflects light with a lunar photometric model (Hapke) and the Earth is shown at its real size, turned and lit for the chosen instant. The mode also opens from Mare on the Whole Moon map, on a 1.9 km elevation model, with a flag at the Apollo 11 site.

Controls: WASD, captured mouse, Shift, Space, R and Z (or right button) for a 4× telephoto lens. Escape pauses and opens the settings; Resume exploring captures the mouse again. The demo data and the regional fallback are included. See [running, sources, DEM preparation, assets, tests and scientific limits](docs/ASTRONAUT_MODE.md).

## Regenerate the data (pipeline)

You need Python 3.11 or later. The download takes about 330 MB in `.cache/`, outside git.

```bash
python -m venv .venv
.venv/Scripts/pip install -r pipeline/requirements.txt
cd pipeline
../.venv/Scripts/python -m moonsite.fetch
../.venv/Scripts/python -m moonsite.build all
```

`build all` runs, in order:
- static layers;
- ephemerides;
- horizons (a few minutes);
- sites;
- validation (needs network access for JPL Horizons).

## Global Earth layer (task T4)

`earth.visible_fraction.mean` on the G1K grid (10 916 × 5 458): fraction of the time in which
the centre of the Earth is above the LOLA horizon, with parallax. Data: LOLA
LDEM_64 (NASA PDS) and SPICE DE440 (NASA/JPL NAIF). It also generates `suitability.earth`
(0–100 = % of the time with the Earth visible; 0 below `EARTH_MIN_PCT`).

```bash
cd pipeline
../.venv/Scripts/python -m moonsite.fetch global              # SPICE + LDEM_64 (531 MB)
../.venv/Scripts/python -m moonsite.earth_global 2026-11-14   # the day passed to the program (no date: today UTC)
../.venv/Scripts/python -m moonsite.earth_global --mes 2026-11 2026-12
../.venv/Scripts/python -m moonsite.earth_global --estandar   # 60 months + 2026-2030 mean
python ../tools/validate_layer.py ../layers/earth.visible_fraction.mean
```

It does not need the T2 horizons: it traces the LOLA horizon only at the azimuths the
Earth passes through and only in the cells where libration leaves the answer in doubt.
Reference: one month on G1K, about 20 min with 2 cores (scales with the cores).

## Global light layer (task T3)

`sun.visible_fraction.mean` (fraction of the solar disk visible above the LOLA horizon),
`sun.longest_night_h.max` (longest continuous night, Sun visible < 0.05) and
`suitability.sun` (0–100) on the G1K grid, the same one used by all layers. Data: LOLA
LDEM_64 (NASA PDS) and SPICE DE440 (NASA/JPL NAIF).

```bash
cd pipeline
../.venv/Scripts/python -m moonsite.fetch global                 # if not already there
../.venv/Scripts/python -m moonsite.sun_global 2026-11-14         # the day passed to the program
../.venv/Scripts/python -m moonsite.sun_global --mes 2026-11
../.venv/Scripts/python -m moonsite.sun_global --estandar        # 60 months + 2026-2030 mean
cd ..
python tools/validate_layer.py layers/sun.visible_fraction.mean
```

Reference: one day on G1K with samples every 10 min, about 12 min with 2 cores.

## View a layer on the map of the Moon

```bash
python tools/view_layer.py layers/sun.visible_fraction.mean [--periodo 2026-11-14]
```

It generates `layers/<id>/viewer_<periodo>.html` (opens with a double click): global view and
both poles, LOLA relief in the background, reference points (Shackleton, Apollo 11, Tycho…) and,
on mouse hover, latitude, longitude, G1K row/column and value. It works for any layer.

## "Whole Moon" view

You choose **Whole Moon** as the destination on the home page, or with the **South Pole / Whole Moon** tab
in Explore (it switches region without redoing the plan). The web app computes **on the spot**, in the
browser, the light, the visible Earth and the longest night of each cell for the mission
dates: landing day + days on the surface (a few seconds for 14 days). It is the same
engine as the south pole, with a whole-Moon grid of 0.5° (720 × 360, ~15 km at the equator).
For now only with a **fixed landing date**; searching for the best dates is still
south pole only. The score uses the factors that have global data: light, Earth and slope.

**3D view.** As at the south pole, Explore has 2D and 3D. The 3D view is a globe of the Moon that you
rotate and zoom with the mouse: real photography (LROC WAC 100 m mosaic) with LOLA relief,
and on top the best cells and the selected one. By default only the photo is shown; the layer bar
lets you put any of the 2D map layers on top (the same image that colours it,
following the relief).
The textures are in `web/public/data/global/globe/` (14 MB) and are only downloaded when the 3D view is opened:
first the 4k photo (2.7 MB) and, if the machine can handle it, the 8k one. To regenerate them:
`python -m moonsite.globe_textures` (downloads the 6 GB mosaic to `.cache`).

**Colours.** Each property has its own scale, the same at the south pole and on the whole Moon
(2D map and 3D globe), so they are not confused: score from lilac to red, green and blue (blue =
best); Sun from orange to yellow and white; elevation from blue-green to sand, brown and white;
slope from green to yellow and red; roughness from cream to magenta and purple; temperature from lilac
and blue (cold) to yellow, orange and red (hot); water (and proximity to ice at the south pole) in
blue, transparent where there is none. The Earth keeps the blue of the design system. They are in
`web/src/engine/globalRamps.js`; the legends draw the same scale as the map.

**Mare and Compare** also work with the whole Moon: on the map, a cell has the
"Open site" and "Compare" buttons. The site page (Mare) shows Overview and Sky & Time with the
hour-by-hour series of that cell; Terrain and Lander's View belong to the 1 km polar map and only exist
at the south pole. Each region compares its own places.

Everything that does not depend on the date is already computed and ships in the repository
(`web/public/data/global/`), so nothing has to be run to use the view:

| File | Contents |
|---|---|
| `horizon.u8` | Terrain horizon of each cell at 72 azimuths (LOLA LDEM_64), 19 MB |
| `horizon_sub.u8` | Above 60° latitude, 4 horizons per cell (2 × 2 points), 25 MB |
| `elevation.f32` | Height of the centre of each cell |
| `slope/static.f32` | Mean slope of the cell, from `terrain.slope` G1K (T1, Jan) |
| `rough/static.f32` | Roughness (m), LOLA LDRM_16: median of the samples in each cell |
| `psr/static.f32` | Fraction of the cell in permanent shadow, LOLA LPSR 65°–90° for both poles |
| `water/static.f32` | Water equivalent (% by weight), from `ice.water_equivalent_wt_pct` G1K (T9, Joel) |
| `temp_diurnal.u8` | Temperature measured by LRO Diviner by local time, 48 bins per cell, 12 MB |
| `hillshade.png` | Shaded relief (visual aid) |

To regenerate them (only if the relief or the slope changes), from `pipeline/`:

```bash
../.venv/Scripts/python -m moonsite.fetch global      # LDEM_64 + SPICE
../.venv/Scripts/python -m moonsite.web_global        # horizons (~2 min) + slope + relief
```

**Roughness and permanent shadow.** Same as at the south pole, but with the LOLA products
for the whole Moon: roughness from LDRM_16 (same scoring rule, 0 to 1.5 m) and permanent
shadow from LPSR_65N/65S_240M. The "Leave out permanent shadow" limit discards the cells
with more than 50 % in permanent shadow. In the common area, the global roughness and the south
pole roughness have a correlation of 0.96. They are downloaded with `python -m moonsite.fetch global`.

**Water.** "Water" layer and ice factor of the score: water equivalent of the hydrogen
measured by Lunar Prospector (0.5° product, real footprint of 60–150 km), which is only attributed
to ice above 70° latitude; below that it is 0. The factor is water / 0.1 % (capped at 1):
at this resolution a deposit in a shadowed crater (~1.5 %) appears diluted to 0.05–0.1 %. It does
not depend on the date. The threshold is in `WATER_FULL_WT_PCT` (`web/src/engine/globalScore.js`).

**Surface temperature (T7).** It is not modelled: the one measured by LRO Diviner is used
(Global Cumulative Products, Williams et al. 2017), which gives the day-night curve of each
0.5° cell as a function of local time. For each hour of the mission the browser computes the local
time of the cell (12 h = Sun on its meridian) and reads its temperature; from that come the mean,
the minimum and the maximum of the mission. It varies with the dates and costs no computation (one lookup
per hour). The scoring factor is **thermal comfort**, hour by hour: each hour of
the mission scores 0 below 50 K, rises to 1 at 250 K, stays at 1 up to 350 K and
drops to 0 at 400 K; the factor is the mean of those marks. This penalises both the night
(~95 K) and the equatorial noon (~390 K), even though the mean of the two looks mild.
The thresholds are in `TEMP_BAND` (`web/src/engine/globalScore.js`); the cold side is the one used at the
south pole. Regenerating it requires the Diviner data (2.8 GB):

```bash
../.venv/Scripts/python -m moonsite.fetch thermal
../.venv/Scripts/python -m moonsite.thermal_global    # web + thermal.max_temp_k / thermal.min_temp_k layers
```

Reliability: against the original 0.25 h measurements, the 48-bin curve deviates (median)
0.4 K at night, 1.9 K by day and 4.2 K in the hour of sunrise and sunset, below
60° latitude. It is a 2009-2015 mean: it does not capture the lunar season or relief at a scale
smaller than the cell.

Light accuracy: below 60° latitude there is one horizon per cell, traced at its
centre; above that, where the Sun is grazing, 4 horizons per cell (2 × 2 points) and their
light is averaged. Compared with the 1 km grid for a single day (the worst case), the mean
error is 1–2 points out of 100 below 60°, 1.5 between 60° and 70°, 2.8 between 70° and 80°
and 4.4 above 80° (with a single point they were 3.4, 6.2 and 8.7), with no bias. For the poles
there is the 1 km module.

The G1K matrices for light and Earth (`moonsite.sun_global`, `moonsite.earth_global`) still
serve as a reference and for the data contract, but the web app no longer needs them.

## Design system

The files in `web/public/design-system/` come from the team's **shared** design system,
not from a copy. If the team changes it, it is downloaded again and this is run:

```bash
python tools/sync_design_system.py <carpeta_descargada> --version <id>
```

## Step 1 / T1: Slope and slope safety (branch `Jan`)

Aligned with **contract v0.2** (`docs/DATA_CONTRACT.md`):

| Layer | Contents | Grid |
|------|-----------|--------|
| `terrain.slope` | Physical **slope** (**degrees**) | **G1K** 10916×5458 |
| `suitability.slope` | **Slope safety** **0–100** | same G1K |

Formula: `suitability = 100 * max(0, 1 - slope_deg / 15)`.

```bash
pip install -r requirements.txt   # rasterio scipy numpy …
# Normal use: only reads already processed grids (never LOLA)
python3 scripts/pendent_seguretat.py
# Exception (once, if the binaries have to be regenerated):
# python3 scripts/pendent_seguretat.py --regenerate-from-lola --outdir data/pendent_g1k
python tools/validate_layer.py layers/terrain.slope
python tools/validate_layer.py layers/suitability.slope
```

```python
from scripts.pendent_seguretat import compute_pendent_layers, PendentLayers
result = compute_pendent_layers()    # always reads the cache; never recomputes from LOLA
pendent = result.slope_deg           # float32, degrees (slope)
seguretat = result.suitability       # float32 / alias result.safety, 0–100
```

The G1K slope/safety binaries (~228 MB + ~57 MB) go to git with **Git LFS**
(`layers/terrain.slope/G1K/static.f32`, `layers/suitability.slope/G1K/static.u8`).
After a `git pull` you need Git LFS (`git lfs install` / `git lfs pull`).
The public API does **not** recompute the slope.
**If they ever have to be regenerated.** `--regenerate-from-lola` applies the scale factor of the
GeoTIFF (value × 0.5 = metres) and stops if the elevations fall outside the lunar range
(−10 000 … +11 500 m). The first time it downloads the GeoTIFF (8.5 GB, about 30 minutes) and saves
the already resampled relief to `.cache/terrain/dem_g1k_m.npy` (238 MB, outside git); later
runs read it from there and take about 15 seconds. `--refresh-dem` forces a
new download.

## Global matrices included in the repository

These layers already carry the G1K matrix (10 916 × 5 458) stored with **Git LFS**, so
nothing has to be computed to use them. After cloning: `git lfs install` and
`git lfs pull`.

| Layer | File | Period |
|------|--------|---------|
| `terrain.slope` (slope, degrees) | `G1K/static.f32` | static |
| `suitability.slope` (slope safety, 0–100) | `G1K/static.u8` | static |
| `ice.water_equivalent_wt_pct` (water equivalent) | `G1K/static.u16` | static |
| `sun.visible_fraction.mean` (light) | `G1K/2026-11-14.u8` | 14-11-2026 |
| `sun.longest_night_h.max` (longest night) | `G1K/2026-11-14.u16` | 14-11-2026 |
| `earth.visible_fraction.mean` (visible Earth) | `G1K/2026-11-14.u8` | 14-11-2026 |

Light, night and Earth depend on the date: only 14 November 2026 is here. For
other days or months you have to run `moonsite.sun_global` and `moonsite.earth_global` (see
above). With a single day, the longest night cannot exceed 24 h.

The web app no longer reads the light, night and Earth matrices: it computes them on the spot for the mission
dates (see "Whole Moon view"). These matrices remain as a reference.
