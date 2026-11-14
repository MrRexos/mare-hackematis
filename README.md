# NASA Space Apps 2026 — Lunar Landing Site Navigator

Selector de misiones al polo sur lunar: introduces la **ventana de aterrizaje** y la
**duración** de la misión, y la web calcula un **mapa de calor de viabilidad** con
datos oficiales de la NASA. El mapa combina exposición solar, visibilidad de la Tierra,
relieve y cercanía al hielo, y marca los **puntos calientes** donde mejor aterrizar.

Reto: [Lunar Landing Site Navigator](https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/).

- **Datos:** NASA LOLA (PDS) y NASA/JPL SPICE, validados contra JPL Horizons.
- **Malla:** 1 km × 1 km, 83,5–90°S.
- **Sin servidor:** web estática; el cálculo se hace en el navegador.
- **Diseño:** design system compartido "Lunar Horizon".

- **Arquitectura completa:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- **Contrato de datos** para ampliar a la Luna entera y repartir el trabajo entre equipos:
  [docs/DATA_CONTRACT.md](docs/DATA_CONTRACT.md).
- **Validar una capa antes de entregarla:**

  ```bash
  python tools/validate_layer.py layers/<id>
  ```

## Arrancar la web (solo ver)

Los datos ya generados están en `web/public/data/`. Necesitas Node 18 o superior.

```bash
cd web
npm install
npm run dev
```

Abre http://localhost:5173.

## Regenerar los datos (pipeline)

Necesitas Python 3.11 o superior. La descarga ocupa unos 330 MB en `.cache/`, fuera de git.

```bash
python -m venv .venv
.venv/Scripts/pip install -r pipeline/requirements.txt
cd pipeline
../.venv/Scripts/python -m moonsite.fetch
../.venv/Scripts/python -m moonsite.build all
```

`build all` ejecuta, en orden:
- capas fijas;
- efemérides;
- horizontes (unos minutos);
- sitios;
- validación (necesita red para JPL Horizons).

## Capa global de la Tierra (trabajo T4)

`earth.visible_fraction.mean` en la malla G1K (10 916 × 5 458): fracción del tiempo en que
el centro de la Tierra está por encima del horizonte LOLA, con paralaje. Datos: LOLA
LDEM_64 (NASA PDS) y SPICE DE440 (NASA/JPL NAIF). También genera `suitability.earth`
(0–100 = % del tiempo con la Tierra visible; 0 por debajo de `EARTH_MIN_PCT`).

```bash
cd pipeline
../.venv/Scripts/python -m moonsite.fetch global              # SPICE + LDEM_64 (531 MB)
../.venv/Scripts/python -m moonsite.earth_global 2026-11-14   # el día que llega al programa (sin fecha: hoy UTC)
../.venv/Scripts/python -m moonsite.earth_global --mes 2026-11 2026-12
../.venv/Scripts/python -m moonsite.earth_global --estandar   # 60 meses + media 2026-2030
python ../tools/validate_layer.py ../layers/earth.visible_fraction.mean
```

No necesita los horizontes de T2: traza el horizonte de LOLA solo en los acimuts por los
que pasa la Tierra y solo en las celdas donde la libración deja la respuesta en duda.
Referencia: un mes en G1K, unos 20 min con 2 núcleos (escala con los núcleos).

## Capa global de luz (trabajo T3)

`sun.visible_fraction.mean` (fracción del disco solar visible sobre el horizonte LOLA),
`sun.longest_night_h.max` (noche continua más larga, Sol visible < 0,05) y
`suitability.sun` (0–100) en la malla G1K, la misma de todas las capas. Datos: LOLA
LDEM_64 (NASA PDS) y SPICE DE440 (NASA/JPL NAIF).

```bash
cd pipeline
../.venv/Scripts/python -m moonsite.fetch global                 # si aún no está
../.venv/Scripts/python -m moonsite.sun_global 2026-11-14         # el día que llega al programa
../.venv/Scripts/python -m moonsite.sun_global --mes 2026-11
../.venv/Scripts/python -m moonsite.sun_global --estandar        # 60 meses + media 2026-2030
cd ..
python tools/validate_layer.py layers/sun.visible_fraction.mean
```

Referencia: un día en G1K con muestras cada 10 min, unos 12 min con 2 núcleos.

## Ver una capa sobre el mapa de la Luna

```bash
python tools/view_layer.py layers/sun.visible_fraction.mean [--periodo 2026-11-14]
```

Genera `layers/<id>/viewer_<periodo>.html` (se abre con doble clic): vista global y de los
dos polos, relieve LOLA de fondo, puntos de referencia (Shackleton, Apollo 11, Tycho…) y,
al pasar el ratón, latitud, longitud, fila/columna G1K y valor. Sirve para cualquier capa.

## Vista "Whole Moon" (Luna entera)

En el paso **01 — Destination** se elige **Whole Moon**. La web calcula **al momento**, en el
navegador, la luz, la Tierra visible y la noche más larga de cada celda para las fechas de
la misión: día de aterrizaje + días en superficie (unos segundos para 14 días). Es el mismo
motor del polo sur, con una malla de toda la Luna de 0,5° (720 × 360, ~15 km en el ecuador).
De momento solo con **fecha fija de aterrizaje**; buscar las mejores fechas sigue siendo
solo del polo sur. La puntuación usa los factores con datos globales: luz, Tierra y pendiente.

**Mare y Compare** también funcionan con la Luna entera: en el mapa, una celda tiene los
botones «Open site» y «Compare». La ficha (Mare) muestra Overview y Sky & Time con la serie
hora a hora de esa celda; Terrain y Lander's View son del mapa polar de 1 km y solo existen
en el polo sur. Cada región compara sus propios lugares.

Lo que no depende de la fecha ya está calculado y va en el repositorio
(`web/public/data/global/`), así que no hay que ejecutar nada para usar la vista:

| Fichero | Contenido |
|---|---|
| `horizon.u8` | Horizonte del terreno de cada celda en 72 acimuts (LOLA LDEM_64), 19 MB |
| `horizon_sub.u8` | Por encima de 60° de latitud, 4 horizontes por celda (2 × 2 puntos), 25 MB |
| `elevation.f32` | Altura del centro de cada celda |
| `slope/static.f32` | Pendiente media de la celda, de `terrain.slope` G1K (T1, Jan) |
| `rough/static.f32` | Rugosidad (m), LOLA LDRM_16: mediana de las muestras de cada celda |
| `psr/static.f32` | Fracción de la celda en sombra permanente, LOLA LPSR 65°–90° de los dos polos |
| `water/static.f32` | Agua equivalente (% en peso), de `ice.water_equivalent_wt_pct` G1K (T9, Joel) |
| `temp_diurnal.u8` | Temperatura medida por LRO Diviner según la hora local, 48 tramos por celda, 12 MB |
| `hillshade.png` | Relieve sombreado (ayuda visual) |

Para regenerarlos (solo si cambia el relieve o la pendiente), desde `pipeline/`:

```bash
../.venv/Scripts/python -m moonsite.fetch global      # LDEM_64 + SPICE
../.venv/Scripts/python -m moonsite.web_global        # horizontes (~2 min) + pendiente + relieve
```

**Rugosidad y sombra permanente.** Igual que en el polo sur, pero con los productos de LOLA
para toda la Luna: rugosidad de LDRM_16 (misma regla de puntuación, 0 a 1,5 m) y sombra
permanente de LPSR_65N/65S_240M. El límite «Leave out permanent shadow» descarta las celdas
con más del 50 % en sombra permanente. En la zona común, la rugosidad global y la del polo
sur tienen una correlación de 0,96. Se descargan con `python -m moonsite.fetch global`.

**Agua.** Capa «Water» y factor de hielo de la puntuación: agua equivalente del hidrógeno
medido por Lunar Prospector (producto de 0,5°, huella real de 60–150 km), que solo se atribuye
a hielo por encima de 70° de latitud; por debajo vale 0. El factor es agua / 0,1 % (tope 1):
a esta resolución un depósito de cráter en sombra (~1,5 %) se ve diluido en 0,05–0,1 %. No
depende de la fecha. El umbral está en `WATER_FULL_WT_PCT` (`web/src/engine/globalScore.js`).

**Temperatura de la superficie (T7).** No se modela: se usa la medida por LRO Diviner
(Global Cumulative Products, Williams et al. 2017), que da la curva día-noche de cada celda
de 0,5° en función de la hora local. Para cada hora de la misión el navegador calcula la hora
local de la celda (12 h = Sol en su meridiano) y lee su temperatura; de ahí salen la media,
la mínima y la máxima de la misión. Varía con las fechas y no cuesta cálculo (una consulta
por hora). El factor de puntuación es el **confort térmico**, hora a hora: cada hora de
la misión puntúa 0 por debajo de 50 K, sube hasta 1 en 250 K, se mantiene en 1 hasta 350 K y
baja hasta 0 en 400 K; el factor es la media de esas notas. Así penalizan tanto la noche
(~95 K) como el mediodía ecuatorial (~390 K), aunque la media de ambos parezca templada.
Los umbrales están en `TEMP_BAND` (`web/src/engine/globalScore.js`); el lado frío es el del
polo sur. Para regenerarla hacen falta los datos de Diviner (2,8 GB):

```bash
../.venv/Scripts/python -m moonsite.fetch thermal
../.venv/Scripts/python -m moonsite.thermal_global    # web + capas thermal.max_temp_k / thermal.min_temp_k
```

Fiabilidad: frente a las medidas originales de 0,25 h, la curva de 48 tramos se desvía (mediana)
0,4 K de noche, 1,9 K de día y 4,2 K en la hora de la salida y la puesta de sol, por debajo de
60° de latitud. Es una media de 2009-2015: no recoge la estación lunar ni el relieve a escala
menor que la celda.

Precisión de la luz: por debajo de 60° de latitud hay un horizonte por celda, trazado en su
centro; por encima, donde el Sol va rasante, 4 horizontes por celda (2 × 2 puntos) y se
promedia su luz. Comparado con la malla de 1 km para un solo día (el peor caso), el error
medio es de 1–2 puntos sobre 100 por debajo de 60°, 1,5 entre 60° y 70°, 2,8 entre 70° y 80°
y 4,4 por encima de 80° (con un solo punto eran 3,4, 6,2 y 8,7), sin sesgo. Para los polos
está el módulo de 1 km.

Las matrices G1K de luz y Tierra (`moonsite.sun_global`, `moonsite.earth_global`) siguen
sirviendo como referencia y para el contrato de datos, pero la web ya no las necesita.

## Design system

Los ficheros de `web/public/design-system/` vienen del design system **compartido** del
equipo, no de una copia. Si el equipo lo cambia, se descarga de nuevo y se ejecuta:

```bash
python tools/sync_design_system.py <carpeta_descargada> --version <id>
```

## Pas 1 / T1 — Pendent i seguretat del pendent (branca `Jan`)

Alineat amb el **contracte v0.2** (`docs/DATA_CONTRACT.md`):

| Capa | Contingut | Malla |
|------|-----------|--------|
| `terrain.slope` | **Pendent** físic (**graus**) | **G1K** 10916×5458 |
| `suitability.slope` | **Seguretat del pendent** **0–100** | mateixa G1K |

Fórmula: `suitability = 100 * max(0, 1 - slope_deg / 15)`.

```bash
pip install -r requirements.txt   # rasterio scipy numpy …
# Ús normal: només llegeix malles ja processades (mai LOLA)
python3 scripts/pendent_seguretat.py
# Excepció (una vegada, si cal regenerar binaris):
# python3 scripts/pendent_seguretat.py --regenerate-from-lola --outdir data/pendent_g1k
python tools/validate_layer.py layers/terrain.slope
python tools/validate_layer.py layers/suitability.slope
```

```python
from scripts.pendent_seguretat import compute_pendent_layers, PendentLayers
result = compute_pendent_layers()    # sempre llegeix cache; mai recalcula des de LOLA
pendent = result.slope_deg           # float32, graus (pendent)
seguretat = result.suitability       # float32 / alias result.safety, 0–100
```

Els binaris G1K de pendent/seguretat (~228 MB + ~57 MB) van a git amb **Git LFS**
(`layers/terrain.slope/G1K/static.f32`, `layers/suitability.slope/G1K/static.u8`).
Després d’un `git pull` cal tenir Git LFS (`git lfs install` / `git lfs pull`).
L’API pública **no** torna a calcular el pendent.
**Si mai cal regenerar-los.** `--regenerate-from-lola` aplica el factor d'escala del
GeoTIFF (valor × 0,5 = metres) i s'atura si les elevacions surten del rang lunar
(−10 000 … +11 500 m). El primer cop baixa el GeoTIFF (8,5 GB, uns 30 minuts) i desa
el relleu ja remostrejat a `.cache/terrain/dem_g1k_m.npy` (238 MB, fora de git); els
següents el llegeixen d'allà i triguen uns 15 segons. Amb `--refresh-dem` es força una
descàrrega nova.

## Matrius globals incloses al repositori

Aquestes capes ja porten la matriu G1K (10 916 × 5 458) desada amb **Git LFS**, de manera
que no cal calcular res per fer-les servir. Després de clonar: `git lfs install` i
`git lfs pull`.

| Capa | Fitxer | Període |
|------|--------|---------|
| `terrain.slope` (pendent, graus) | `G1K/static.f32` | fix |
| `suitability.slope` (seguretat del pendent, 0–100) | `G1K/static.u8` | fix |
| `ice.water_equivalent_wt_pct` (aigua equivalent) | `G1K/static.u16` | fix |
| `sun.visible_fraction.mean` (llum) | `G1K/2026-11-14.u8` | 14-11-2026 |
| `sun.longest_night_h.max` (nit més llarga) | `G1K/2026-11-14.u16` | 14-11-2026 |
| `earth.visible_fraction.mean` (Terra visible) | `G1K/2026-11-14.u8` | 14-11-2026 |

Llum, nit i Terra depenen de la data: aquí només hi ha el 14 de novembre de 2026. Per a
altres dies o mesos cal executar `moonsite.sun_global` i `moonsite.earth_global` (vegeu
més amunt). Amb un sol dia, la nit més llarga no pot passar de 24 h.

La web ja no llegeix les matrius de llum, nit i Terra: les calcula al moment per a les dates
de la missió (vegeu «Vista Whole Moon»). Aquestes matrius queden com a referència.
