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

En la pantalla de prioridades, **Whole Moon** usa las matrices globales G1K de las ramas
Jan (pendiente, T1), Nil (Tierra visible, T4) y pol (luz y noche más larga, T3);
**South Pole** sigue usando el motor horario del polo sur, sin cambios. En el mapa se puede
ver la puntuación combinada (mismos pesos y límites que el polo sur, solo con los factores
que tienen capa global) o cada matriz por separado, con las 10 mejores celdas.

Pasos para tener datos (desde la raíz del repositorio):

```bash
python scripts/terrain_safety.py --export-layers                          # T1 pendiente (Jan)
cd pipeline
../.venv/Scripts/python -m moonsite.fetch global                         # LDEM_64 + SPICE
../.venv/Scripts/python -m moonsite.sun_global 2026-11-14                # T3 luz, un día (o --mes / --estandar)
../.venv/Scripts/python -m moonsite.earth_global 2026-11-14              # T4 Tierra, el mismo día
../.venv/Scripts/python -m moonsite.web_global                           # G1K → web/public/data/global (W4)
```

La web combina los periodos calculados que caen dentro de las fechas de la misión (media
ponderada por horas) y avisa si solo hay datos para una parte de esas fechas.

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
