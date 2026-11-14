# NASA Space Apps 2026 — Lunar Landing Site Navigator

Avaluació de zones d'aterratge lunar (CLPS / Artemis) amb mapa de calor de viabilitat, combinant seguretat topogràfica (pendent), il·luminació solar i comunicacions amb la Terra.

## Pas 1 — Seguretat topogràfica

### Mode global (recomanat per al Pas 2)

Processa **tota la Lluna** en requadres d’≈ **1 km²** i retorna un objecte amb la matriu `safety` ∈ [0, 1].

```bash
pip install -r requirements.txt
python3 scripts/terrain_safety.py --cell-m 1000 --outdir data/pas1_global
```

Ús programàtic:

```python
from scripts.terrain_safety import compute_global_terrain_safety
# o:
# import sys; sys.path.insert(0, "scripts")
# from terrain_safety import compute_global_terrain_safety

result = compute_global_terrain_safety(cell_m=1000.0)
safety = result.safety          # np.ndarray float32, [0, 1]
# equivalent: np.asarray(result)
```

Sortides:

| Fitxer | Contingut |
|--------|-----------|
| `data/pas1_global/safety.npy` | Matriu de seguretat [0, 1] |
| `data/pas1_global/safety.tif` | GeoTIFF georeferenciat |
| `data/pas1_global/metadades.json` | CRS, transform, resolució |
| `docs/pas1_global_seguretat.html` | Visualització HTML |

Graella típica (@ 1 km): **10916 × 5458** cel·les (Equirectangular Moon).

### Mode retall polar (AOI local)

```bash
python3 scripts/pas1_dem_pendent.py --outdir data/pas1 --window 2000 --lon 0.0 --lat -89.5
```

Visualització anterior: `docs/pas1_visualitzacio.html`.
