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

Els binaris G1K són grans (~228 MB pendent + ~57 MB seguretat): es desen localment
a `layers/.../G1K/` (o release / carpeta d’equip, contracte §3.3); a git només
`layer.json` (+ catàleg). L’API pública **no** torna a calcular el pendent.