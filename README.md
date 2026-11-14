# NASA Space Apps 2026 — Lunar Landing Site Navigator

Avaluació de zones d'aterratge al Pol Sud lunar (missions CLPS / Artemis) mitjançant un mapa de calor matricial de viabilitat (0–100), combinant seguretat topogràfica (pendent), il·luminació solar i comunicacions amb la Terra.

## Pas 1 — DEM LOLA, pendent i capa de seguretat

Script autònom que:

1. Descarrega **només un retall** (2000×2000 px) del LRO LOLA DEM via `rasterio` + `/vsicurl/` (USGS / NASA).
2. Detecta si el CRS és en **graus** o en **metres** i, si cal, reprojecta a **Moon 2000 South Pole Stereographic**.
3. Neteja NoData i soroll del sensor (mediana 3×3).
4. Calcula el pendent en graus (filtre de màxim = base de la nau) i la capa normalitzada 0–1 amb veto ≥ 15°.
5. Exporta `.npy`, GeoTIFF i `metadades.json` per al Pas 2 (efemèrides).

### Instal·lació

```bash
pip install numpy scipy rasterio affine
```

O amb el fitxer del repositori:

```bash
pip install -r requirements.txt
```

### Execució

```bash
python scripts/pas1_dem_pendent.py
```

Opcions útils:

```bash
python scripts/pas1_dem_pendent.py \
  --outdir data/pas1 \
  --window 2000 \
  --lon 0.0 \
  --lat -89.5
```

### Sortides (`data/pas1/`)

| Fitxer | Contingut |
|--------|-----------|
| `dem_net.npy` / `.tif` | DEM net (metres) |
| `capa_pendent_norm.npy` / `.tif` | Seguretat de pendent [0, 1] |
| `pendent_segur_graus.npy` | Pendent (°) amb footprint de la nau |
| `metadades.json` | CRS, transform, resolució, bounds |
