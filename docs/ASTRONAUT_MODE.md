# Astronaut Mode

Mode built into **Mare → Lander's View → Astronaut Mode helmet**. It uses the selected coordinates and the shared UTC clock. Map clock playback stops on entry so that only the Astronaut Mode panel controls time. **Exit** returns to the site page; it keeps the point and the date, including time changes made inside the mode.

## Run

```powershell
cd web
npm install
npm run dev
```

The required data is included in `web/public/data/astronaut/`: there is no need to run Python to explore the prepared regions or the regional DEM. The physics and rendering code is loaded when the helmet is pressed.

Controls: **Start exploring**, WASD or arrow keys to walk, mouse to look, Shift to move faster, Space to jump, R to return to the centre. Holding Z or the right mouse button zooms the view 4 times, like a telephoto lens, to look at the Earth or a distant ridge. **Escape releases the mouse, pauses and opens the date and time directly**. The menu switches between **Date & time**, **Settings** and **Sources**; **Resume exploring**, available in all three panels, captures the mouse again through a user gesture. The mouse pointer disappears while exploring. On desktop it uses only relative deltas with Pointer Lock, with no dragging by screen coordinates; the first capture event and spurious driver jumps are discarded. Losing focus also pauses. If the browser rejects the capture, it stays paused and offers to retry. It requires `localhost` or HTTPS. On a touchscreen the view is dragged and the movement buttons are used.

The calendar panel changes the UTC date/time and offers a time lapse of 6 real hours per second. **Find sunlight** searches for an hour with the solar disc visible from the current position within the mission period; it changes the date only when pressed and warns if it finds no light. A positive solar elevation does not imply visibility if there is relief in front. No Earth day is simulated. Settings: LOW, MEDIUM, HIGH, ULTRA, field of view, sensitivity, visual gravel density and minimap. The helmet has an artificial light, identified as such, that can be switched off; it allows exploring places without sunlight.

## Scientific data included

| Product | Use | Spacing | Source |
| --- | --- | --- | --- |
| LOLA Site01, Connecting ridge | Demo at −89.45°, 222.5°E; 2.2 km crop to choose an explorable 1 km region | 5 m | [NASA PGDA 78](https://pgda.gsfc.nasa.gov/products/78) |
| LOLA Haworth | 2.2 km crop at −86.86°, 338.14°E | 5 m | [NASA PGDA 78](https://pgda.gsfc.nasa.gov/products/78) |
| LDEM_75S_240M | Regional coverage for any point on the map and context terrain out to 16 km | 240 m | [NASA PDS LOLA](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/ldem_75s_240m.lbl) |
| PGDA catalog of 5 m DEMs and LDEM_83S_10MPP_ADJ | Selection by coverage and resolution in development | 5 / 10 m | [PGDA 78](https://pgda.gsfc.nasa.gov/products/78), [PGDA 90](https://pgda.gsfc.nasa.gov/products/90) |

`catalog.json` records product, URL, provider, coverage, projection, frame, vertical datum, resolution and uncertainty limitations. Each crop includes its SHA-256 and valid fraction; all values in the included crops are valid. The 5 m LOLA DEMs contain interpolation between measurements; **5 m spacing does not mean 5 m effective resolution or height accuracy**. Per-sample uncertainty is not included; the original products are linked with their error maps.

Heights come from the scientific raster. The reference mesh measures exactly **1,000 × 1,000 units**, one unit per metre, and includes lunar curvature. There is no vertical exaggeration. That mesh, bilinearly interpolated, is kept unchanged: it is used for the minimap, the near-horizon calculation and the join with the regional terrain. When the 240 m DEM is interpolated onto a denser mesh, the interface still shows **240 m**.

The surface that is drawn and walked on is a different one, described in the next section: it starts from the same DEM and adds the relief that the DEM cannot resolve.

A region with NoData or incomplete coverage is rejected; the next compatible source is tried. Gaps in the DEM are not filled with noise or invented elevations. The worker avoids blocking the interface. The three-terrain cache keeps coordinates, catalog version, sources, resolutions and hashes; it reuses the result when the terrain is opened again and is invalidated when the data changes.

### Relief below the DEM resolution

A 5 m DEM does not contain 3 m craters, and a 240 m one contains almost none of those seen when walking. With the DEM alone the ground was a smooth ramp, which is exactly what is not seen in the Apollo surface photographs. `SurfaceRelief.js` generates what is missing. It is plausible relief, not measured, and the interface says so in the footer and in the **Sources** panel.

- The surface has 2049 × 2049 samples, one every 0.49 m. The DEM is interpolated with Catmull-Rom, which passes through all measured samples and avoids the creases of bilinear interpolation under grazing light.
- Craters are added from 2 m up to four times the DEM spacing (20 m with the 5 m DEM, 140 m with the 240 m one). Above that size the DEM rules.
- Sizes follow the lunar equilibrium population of Trask (1966): N(>D) = 10^-1.1 · D^-2 craters per m². Only 26 % of that population is drawn. The rest corresponds to craters so worn that nobody standing there would pick them out; with 100 % the ground looked like an orbital view. That percentage is a visual decision checked against the photographs, not a datum.
- Nine out of ten are old: bowls a few centimetres deep, with no rim. The young ones, with a raised rim and ejecta, are the exception. The outline is never a perfect circle.
- A young, larger crater erases the smaller, older ones that lay inside it. The arrival point is kept clear and there is always a young crater within 46 m.
- A gentle undulation with a wavelength of tens of metres is added, between 0.2 and 0.9 m depending on the DEM resolution.
- In the last 34 m before the edge of the kilometre the added relief fades out, and in the last 12 m the surface returns to the DEM mesh. This way it meets the regional terrain without a step.

The seed comes from the coordinates: the same place always gives the same ground. The worker takes about 1 s to generate it. Outside the walkable kilometre the regional terrain is still the 240 m DEM with no added relief.

### Online loading and static publishing

NASA PGDA does not expose CORS for these GeoTIFFs. In `npm run dev`, Vite acts as a proxy only towards `pgda.gsfc.nasa.gov/data/`; GeoTIFF.js reads windows through HTTP Range inside the worker. It chooses the compatible DEM with the smallest real spacing, including the 5 m ones. It does not download a complete multi-GB GeoTIFF. If that fails, it uses the next product and finally the local 240 m DEM.

In `npm run build`, the **packaged crops and the local regional DEM** are used. The development proxy does not exist in the static publication. To publish new high-resolution areas, their crops are prepared before building. High resolution online is not guaranteed on static hosting without an own service that supports Range. This distinction is explicit; the fallback is not presented as a 5 m DEM.

### Preparing other places

From the repository root:

```powershell
python -m pip install -r tools/requirements-astronaut.txt
python tools/prepare_lunar_dem.py --defaults
python tools/prepare_lunar_dem.py --lat -86.8 --lon 338 --name haworth-extra
python tools/prepare_astronaut_ephemeris.py
python tools/validate_lunar_dem.py
```

Source downloads and kernels are stored in `.cache/astronaut/`, excluded from Git. Online validation keeps a copy of each demo GeoTIFF to compare samples with the original data; it is a preparation step, not part of opening the mode. `--offline` verifies hashes, metadata, valid heights and ephemerides without downloading sources.

To import an **LROC NAC DTM** or another higher-resolution DEM:

```powershell
python tools/prepare_lunar_dem.py --source C:/data/nac-registered.tif --source-metadata C:/data/nac-provenance.json --lat -89.45 --lon 222.5 --name nac-demo
```

It must be registered in **MOON_ME_DE421**, south polar stereographic on a 1,737,400 m sphere, with heights in metres relative to that sphere. WGS84 is not accepted. The JSON must provide `provider`, `productUrl`, `frame`, `verticalDatum`, `uncertainty` and, optionally, `name` and `interpolation`. The importer checks projection and radius; the owner must check the frame and vertical datum of the source, which a CRS alone does not fully describe. Incompatible datums are not silently transformed. The catalog does not automatically discover all NAC DTMs; compatible ones are imported and take priority because of their resolution. An orbital image is not accepted as a substitute for a DEM.

## Sun, Earth and horizon

The existing hourly SPICE vectors are reused (DE440, LT+S correction). `prepare_astronaut_ephemeris.py` applies `pxform` from `MOON_ME_DE440_ME421` to `MOON_ME_DE421` at each UTC sample using the original NAIF kernels; it does not modify the map data. The maximum rotation over the included period is about 0.057 arcseconds, recorded in the metadata file.

The local system is **+X east, +Y up, −Z north**. The observer position is subtracted from the Sun and Earth vectors to obtain topocentric directions. The hourly vectors are interpolated and the physical angular sizes are kept (solar radius 695,700 km; Earth radius 6,378.1366 km). The Earth is not enlarged to see it better: it measures 1.8° across, about 3.7 times the Moon seen from Earth. It takes up little of the screen because the field of view is wide; the telephoto (Z or right button) is there to see it large. The default field of view drops from 72° to 64°.

The Earth uses the NASA Blue Marble Next Generation image (public domain, taken from the `three-globe` npm package) reduced to 2048 × 1024. The clouds are synthetic: fractal noise with the bands of the general circulation, generated with `tools/make_astronaut_earth.py`. They do not reproduce the weather of any date. The orientation is computed for the chosen instant: the Earth's axis and the Greenwich meridian are obtained from the ecliptic longitude of the Sun and from sidereal time, and the lit side from the Earth-Sun direction of the ephemerides. The ecliptic plane is approximated by the lunar equator, which leaves an error of up to 1.5° in the tilt of the globe. The tests check the subsolar point (latitude within 0.5°, longitude within the equation of time) on four dates.

The Sun keeps its 0.53° disc and adds a halo: a narrow core and a wide, faint veil, like the one a very bright point produces in the eye or in a lens. The halo fades with the visible fraction of the disc.

Visibility combines the existing regional horizon (1 km mesh, 5° bins, heights computed for an observer of about 2 m, distances 300 m–300 km) with sampling of the local relief from the camera. The direction is recomputed when moving or changing the clock. The HUD distinguishes solar visibility from geometric line of sight to the Earth's centre. It is not equivalent to real availability of a communications network.

Visual shadows use CSM (3 or 4 cascades, 1024–4096 depending on quality), PCF, bias and normal bias. The skirts that cover the joints between terrain pieces are left out of the shadow map: with the Sun at 2° a vertical wall at the joint shaded tens of metres of ground behind it. Sunlight is attenuated by the visibility computed at the observer; that global attenuation approximates distant obstruction over the area and is not a certified per-vertex illumination map. The context terrain does not replace the far-horizon calculation.

## Physics and graphics

Rapier uses a heightfield with the same 2049 × 2049 samples that are drawn, a capsule controller, a fixed step of 1/60 s, gravity of 1.62 m/s², acceleration, braking, jumping, sliding on slopes, obstacles and solid region boundaries. The camera is about 1.7 m above the ground. Rocks larger than 0.3 m have conservative spherical collisions; smaller gravel can be stepped over. The render clock does not determine the physics step.

Three.js keeps the existing React/JavaScript stack: sRGB colour, ACES, colour and normal maps, instanced rocks and culling. The terrain is a quadtree of 32 × 32 cell nodes. A node splits into four while the walker is closer than a fraction of its width (0.3 on LOW, 0.85 on ULTRA), so that underfoot there are 0.49 m cells and, hundreds of metres away, cells of 8 or 16 m. Nodes are built when needed and the least used ones are released. Physics always uses the full surface. Under sustained low performance, DPR, shadows and detail range are reduced. Static shadows are reused. Graphics quality does not change scale or collisions. Photographic exposure is not a calibrated radiometric measurement.

Lunar soil does not reflect like a matte surface. It returns light towards the Sun, brightens sharply around the observer's own shadow and keeps its brightness under grazing light. The shader replaces Lambert's law with the Hapke model using the whole-Moon values of Helfenstein and Veverka (1987, [NASA technical report](https://ntrs.nasa.gov/citations/19870013999)): particle albedo 0.21, opposition effect width 0.07, phase terms 0.29 and 0.39. The opposition amplitude 2.01 does not appear as such in their table: it comes from their S(0) = 0.71 divided by the albedo and by the phase function at opposition (0.21 × 1.68). Hapke's macroscopic roughness term is missing; it is replaced by an empirical factor that darkens ground seen against a low Sun by up to 60 %. There is no specular term. With the Sun at 2.5°, level ground reflects between 2 and 14 times more than with Lambert depending on where one looks (more with the Sun behind and in the distance, almost the same against the light). Lambert left it almost black, and the rocks, with faces turned to the Sun, looked lit up beside it. Rocks and ground share model and reflectance: each rock texture is scaled to the mean reflectance of the regolith.

The sky is black and gives no light. The only fill is the sunlight returned by the ground itself: it reaches vertical faces and the underside of things, and almost none of it reaches level ground in shadow. Earthlight is included with its phase; by day it is imperceptible and at night it is the only natural light. Night is shown brighter than it would come out with the daytime exposure, as an adapted eye would see it.

The regional terrain is joined to **all** the perimeter vertices of the local DTM. A transition band between 500 and 750 m from the centre absorbs the height differences between sources outside the walkable area. This avoids the black gaps that appeared when only the four corners were joined. The transition is interpolated visual context; it does not alter the elevations, collisions or horizon calculations of the scientific kilometre.

There is no atmosphere, fog or blue sky. In lunar night the surface is dark: a neutral helmet light is offered, identified as artificial, which by day is almost off because it cannot compete with sunlit ground. It casts no shadows: a light placed at the eye leaves them right behind what it lights, where they cannot be seen. Exposure is adjustable. The astronomical time and solar direction are kept. 60 fps is not guaranteed for every GPU or browser.

## Fab / Quixel Megascans

Four surfaces from the ZIPs provided by the owner are included: Dry Sand `vd0lbfd`, Soil Sand `pkcbq0`, Dry Sand `xd0jeh2` and Sand `sgfodj1a`. Colour and normals are blended in the shader with an ash-grey grade with a warm tint. Two WebGL2 array textures hold the four layers. The ORM maps (AO in R, roughness in G) are still in the package but are no longer loaded: without a specular term roughness changes nothing, and without ambient light there is no occlusion to apply. That is about 20 MB less GPU memory and 5.3 MB less download.

Craters from 12 cm to 2 m, too small for the mesh, are represented by a 1024 × 1024 slope map that covers 24 m and repeats seamlessly. It is read twice, at 24 and 37 m and with different rotations, and the two copies never line up.

The grey sand `vd0lbfd` is still the base of the plains. Soil Sand `pkcbq0` reaches at most 64.5% in the stoniest areas, leaving sand between its details. Its mask combines a wide warped falloff with variations at two scales, forming veins and gaps instead of a compact oval. The 512 × 512 mask keeps transitions of about 2 m per sample. It belongs to the material only: it does not change elevations, stones or collisions. The other scans add secondary variations of dust and grain. On load, the mean linear luminance of each scan is approximated to compensate for brightness differences; the lunar grade and the overall reflectance of 0.82 are kept. The extra darkening of Soil Sand is removed to avoid a stained look. Near normal relief goes from 0.62 on sand to a maximum of 0.88 on gravel.

To hide the one-metre tiling, the base sand blends three samples with offsets and 90° rotations derived from a triangular lattice and the seed of the place. Soil Sand uses free 360° rotations, a per-copy scale between 0.88 and 1.15, smaller cells of 0.72 and less concentrated blend weights. This way each area no longer shows a whole copy repeated several times. Its normals do not receive the amplitude boost that accentuated the pattern. Colour, normals and ORM share transforms; `textureGrad` keeps the mipmaps stable and the normals are rotated back to the original tangent frame. The secondary layers use different rotations and a gentle warp. Ground texture reads drop from 24 per fragment to 11 in the usual case: 6 for the sand, 2 for the dust, 2 for micro-craters and 1 for the mask. The gravel and the coarse layer are only read next to rocks, where they carry weight in the blend. Beyond about 30 m the ground is so foreshortened that the one-metre scan is a blur of a few texels, and one plain read of colour and one of normal are enough. Graphics performance still depends on the GPU and the resolution.

Eight packs were downloaded from the owner's Fab session, under the Standard licence shown by Fab. The manifest records the original links and source files:

- Small Rocks Pack `ucdjdfmva`: 5 variants.
- Limestone Rocks `ub3sddsda`: 1 variant.
- Thai Beach Rocks `ueopcguga`: 1 variant.
- Volcanic Dolerite Rocks `qjmvt`: 1 variant.
- Icelandic Porous Rocks `skxqf`: 1 variant.
- Sharp Rocks Set `rbov2`: 4 variants.
- Small Limestone Rocks Pack `ufllcisva`: 6 variants.
- Granite Rocks `pfyss`: 1 variant.

The originals remain in Downloads. The imported GLBs have 1K textures and two geometric levels that share the same materials and maps. The components of each pack are separated into 20 variants; each one is centred and rests on its own base, keeping its shape. Instancing and distance-based selection reduce the cost of distant gravel. The simplifier limits geometric error; some models keep more triangles to preserve their outline.

On the Moon, rock comes from impacts, and the distribution now follows the generated craters. It replaces the previous 19 elliptical fields and uniform scatter, which left loose stones spread at random.

- Young craters of 5 m or more keep blocks. The larger the crater, the more and the bigger: an 11 m one gives blocks of up to 1.2 m; a 100 m one, blocks of several metres. A quarter stays on the floor and wall. The rest falls outside, densest at the rim and spread in rays, with the large blocks closest.
- The rest of the terrain has loose groups: a broken block with its fragments around it, plus some isolated stones.
- Sizes follow a power law. Each time the size halves there are several times more pieces.
- Each rock is sunk between 6 and 48 % of its radius, with its own proportions and tilt. Blocks do not stay on steep walls and do not overlap.

On the flat south pole fixture at maximum density there are 12,812 rocks of 20 cm or more, 701 of them with collision. 81 % have another rock within 3 m; a uniform scatter of the same density would give 30 %.

Stones from 4 to 20 cm are no longer stored for the whole kilometre. A real surface has about one per square metre (Surveyor counts), more than a million in total. They are generated in 6 m cells around the walker, each cell with its own seed, and drawn in four instanced calls. Half fall in small groups. Only those within 12 m cast a shadow, and each stone stops being drawn when it would cover one pixel. The visual density setting controls it.

The same geology mask blends the stoniest ground around young craters and in some stretches of regolith with more pebbles. Rocks, gravel and mask are reproducible from coordinates and **are not measured positions**.

Rock transforms and colours are precomputed. Distance-based selection is reviewed after walking 2 m or changing quality or density, and buffers are only uploaded if it changes. Each instanced batch now has a bounding sphere fitted to what it draws, so a shadow cascade that does not contain it does not process it. Shadows are invalidated by real changes of camera, Sun, time or geometry, at a maximum of about 30 Hz. Shaders and the first frame are prepared before the controls are shown. A hidden tab is not rendered.

GTAO has been removed. Ambient occlusion attenuates ambient light, and under a black sky there is hardly any; applied to the whole frame it also darkened direct sunlight, which is incorrect. With it go the post-processing chain and its extra passes on HIGH and ULTRA.

Re-import from the local originals:

```powershell
python tools/import_quixel_surfaces.py C:/Users/Usuario/Downloads
cd web
node scripts/prepare-quixel-rocks.mjs C:/Users/Usuario/Downloads
```

The surface importer needs Pillow. The optimiser uses glTF Transform, Meshoptimizer and Sharp, included as development dependencies. The assets used and their sources are in `web/public/assets/astronaut/manifest.json`; the application does not access Fab, accounts or credentials. It is still possible to add static models to the manifest. Meshopt is supported; KTX2/Draco require configuring their decoders. If an optional asset fails, the fallback material or model is kept and the warning is logged.

## Validation

```powershell
cd web
npm test
npm run build
cd ../pipeline
python -m pytest tests -q
cd ..
python tools/validate_lunar_dem.py
```

The tests check ENU orientation, scale, curvature, sampling, NoData, triangle diagonals, astronomical vectors and interpolation, angular size, horizon obstruction, determinism, NASA hashes, walking, lunar jumping, rock collision and boundaries. Since 15 November they also check the crater size distribution, the profile of a crater, the match between the surface and the DEM at the edge, the terrain quadtree, the photometric model, the orientation of the Earth, the clustering of rocks and the per-cell gravel. The earlier geometry/visibility tests are kept. Browser checks verify opening, movement, time change, return to the map and reading of real data. Performance depends on the machine and requires measuring on the target devices.

### Validation result of 15 November 2026

Revision of lighting, relief, rocks and sky. **30 Node tests** and the build pass. Three tests that described the previous system (tile LOD, 19 rock fields and their exact count of 803 blocks) are replaced by those of the new system, and ten are added.

Visual check with Chromium and a software renderer (SwiftShader) in three cases: a map point with the 240 m DEM, the Connecting ridge demo with the 5 m DEM, and at night. They were compared with the Apollo photographs provided by the owner. There were no shader errors.

Cost per frame, same point, same time, 960 × 540, software renderer:

| | Before | Now |
| --- | --- | --- |
| MEDIUM, camera still | 4.0 s | 3.6 s |
| MEDIUM, turning | 4.1 s | 3.8 s |
| HIGH, camera still | 2.2 s | 3.6 s |
| Draw calls (main pass) | 104 | 79 |
| Triangles (main pass) | 438,000 | 330,000 |

These figures are not frames per second on a GPU. The software renderer penalises things a GPU resolves almost for free, above all multisample antialiasing. That is why the previous HIGH comes out faster: its post-processing chain drew without multisampling, with jagged edges. In this environment 98 % of the frame time is the ground shader. **It has not been measured on a real GPU**; the improvement on MEDIUM is 10 % here and nothing more can be claimed.

What remains undone or unchecked:

- The south pole has the Sun less than 3° above the horizon. The Apollo photographs were taken with the Sun between 15° and 45°, and that light cannot be reproduced at these places. The polar scene has more contrast and longer shadows.
- Shadows are sharp. With the Sun this low the real penumbra is wide (the solar disc measures 0.53°) and it is not simulated.
- The terrain beyond the walkable kilometre has no added craters and looks smoother than the interior.
- On approach, terrain nodes change level of detail and small craters pop in at mid distance.
- It has not been opened on mobile devices and mouse capture has not been tested after these changes; the `FirstPersonControls` tests still pass.

### Validation result of 14 November 2026

Soil Sand integration: **21 Node tests** and the build pass. The material test checks at four places that stony details still appear near the start, that there is sand between them and that the blend changes gradually while walking, keeping the plains. The render is reviewed with the helmet light on and off to tell the material apart from the artificial lighting.

Fix for the visibility of the rocky texture: **21 Node tests** pass. The added test verifies that the stony band is reachable within a few steps, covers a region and also appears in other fields, keeping sand over most of the terrain. The browser shows the difference between sand and gravel at the starting point of the place selected by the user, with no shader errors.

Revision of subtle blending, tiling and gravel: **20 Node tests** pass. The amount and size of the new gravel are checked, along with the preservation of the 803 blocks of the previous fixture, the use of the simplified batches without extra shadows, distance culling and buffer reuse. The browser loads the stochastic shader and the four surfaces with no compile errors; the same Haworth point is compared with the same clock and lighting. A stable frame rate is not certified from these checks.

Revision of time, variety and performance: **19 Node tests** pass, including buffer reuse at rest, LOD changes, preservation of collision blocks when reducing gravel, instance cleanup and the 20 Quixel models. Browser check: real mouse capture, Escape with active capture opening the time, time change with buttons and keyboard, resume and WASD movement, and MEDIUM/ULTRA/HIGH changes. The 20 models and four surfaces load without fallbacks; no shader errors appear. These checks do not certify a stable frame rate on other devices.

- **18 Node tests**: pass, including capture/pause/resume, relative deltas, capture rejections, rock fields, Quixel assets and joining DEMs with different heights. The **9 Python tests** passed in the previous validation; this revision does not change the scientific pipeline.
- Production build and `git diff --check`: pass. Vite warns about the size of the on-demand physics module and about public CSS references that resolve at runtime; it was verified that those files are included and load in the static version.
- Two crops: **194,481 valid heights each**, SHA-256 checked and four samples per crop compared against each original NASA GeoTIFF. Ephemerides: **43,824** valid hourly samples.
- Browser on the static build: entry from the helmet, coordinates, WASD, date change, sunlight search, quality settings, demo, 240 m fallback and exit keeping coordinates/clock. Touch emulation: movement confirmed through coordinate changes.
- Development: reading of another Haworth place at **5 m**, outside the packaged crop, through HTTP Range and the NASA proxy.
- After fixing the materials shader, no rendering errors were observed in the final checks. A missing favicon predates this feature.
- Native capture confirmed in Chromium: `pointerLockElement` is the canvas and `cursor` is `none`; rotation by relative deltas, Escape and settings panel checked. Some attempts in unfocused windows were rejected and correctly stayed paused. 13 Quixel variants and four surface maps were verified as loaded without fallbacks. Physical mobile devices have not been tested.
- Reproduction of the point **84.18408° S, 76.12220° E, 2027-10-02 22:00 UTC**, with the NASA 10 m DTM: the gaps persisted without shadows and disappeared when the context was hidden, identifying the join between DEMs as the cause. After joining all edges the black bands disappear; solar intensity is reduced to keep the grey of the regolith.
- The 60 fps target is not certified: quality adapts and LOD reduces distant geometry work, but measurements on the target hardware are still needed.

## Files in this implementation

- `web/src/screens/Site.jsx`: helmet activation and exit keeping the state.
- `web/src/astronaut/AstronautMode.jsx`, `astronaut.css`: interface, loading, settings, touch controls and clock.
- `web/src/astronaut/AstronautScene.js`: renderer, CSM, lights, Sun and Earth, telephoto, camera control, adaptation and GPU cleanup.
- `web/src/astronaut/coordinates.js`, `terrain.worker.js`, `TerrainLoader.js`: scientific geometry, coverage, GeoTIFF reading, crops and cache.
- `web/src/astronaut/SurfaceRelief.js`: craters and undulation below the DEM resolution, walkable surface and its levels of detail.
- `web/src/astronaut/TerrainLOD.js`: terrain quadtree, with nodes built on demand.
- `web/src/astronaut/TerrainContext.js`: continuous join between local and regional DEM outside the walkable area.
- `web/src/astronaut/FirstPersonControls.js`: relative capture, pause, Escape and touch controls.
- `web/src/astronaut/CelestialPosition.js`: topocentric positions, sizes, visibility and orientation of the Earth.
- `web/src/astronaut/LunarPhysics.js`: Rapier and physics controller.
- `web/src/astronaut/SurfaceMaterials.js`, `SurfaceGeology.js`, `ProceduralRocks.js`, `MegascansLibrary.js`: photometric model and materials, crater ejecta, rocks, gravel and the owner's assets.
- `web/src/astronaut/astronaut.test.mjs`: scientific and physics tests.
- `web/public/data/astronaut/`: catalog, two 5 m crops, native regional DEM, PDS label and transformed ephemerides.
- `web/public/assets/astronaut/manifest.json`: configuration of models and materials.
- `web/public/assets/astronaut/sky/earth_2k.jpg`: Earth texture (NASA Blue Marble with synthetic clouds).
- `web/package.json`, `web/package-lock.json`: dependencies and test command.
- `web/vite.config.js`: read proxy for public DEMs during development.
- `tools/prepare_lunar_dem.py`, `prepare_astronaut_ephemeris.py`, `validate_lunar_dem.py`, `requirements-astronaut.txt`: reproducible pipeline and validation.
- `README.md`, `docs/ASTRONAUT_MODE.md`: access, sources and limits.

Earlier project changes are kept; no database modifications or deployments are made.
