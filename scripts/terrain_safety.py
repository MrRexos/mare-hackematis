#!/usr/bin/env python3
"""
Pas 1 — Seguretat topogràfica (cara visible de la Lluna)
========================================================
Genera la matriu de **seguretat de pendent** per a la **cara visible**
(sense cara oculta), alineada amb el contracte de dades del repo:

* Malla ``G32N``: 32 píxels/° · **5760 × 5760**
* Longitud **−90° … +90°** (cara visible), latitud **−90° … +90°**
* Valors ``safety`` ∈ **[0, 100]** (veto estricte a pendent ≥ 15° → 0)

Objecte util per combinar amb altres capes al Pas 2::

    from scripts.terrain_safety import (
        TerrainSafetyMatrix,
        compute_nearside_terrain_safety,
    )
    result = compute_nearside_terrain_safety()
    safety = result.safety  # float32 (5760, 5760), 0–100

CLI::

    python3 scripts/terrain_safety.py --outdir data/pas1_global
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from affine import Affine
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.warp import reproject
from scipy.ndimage import median_filter

# ---------------------------------------------------------------------------
# Constants — malla G32N (cara visible) i LOLA
# ---------------------------------------------------------------------------

URL_LOLA_GLOBAL = (
    "https://planetarymaps.usgs.gov/mosaic/"
    "Lunar_LRO_LOLA_Global_LDEM_118m_Mar2014.tif"
)

MOON_RADIUS_M = 1_737_400.0
PX_PER_DEG = 32  # mateix pas que G32 del contracte
LON_MIN_DEG = -90.0
LON_MAX_DEG = 90.0
LAT_MIN_DEG = -90.0
LAT_MAX_DEG = 90.0

# 180° × 32 px/° = 5760
GRID_WIDTH = int(round((LON_MAX_DEG - LON_MIN_DEG) * PX_PER_DEG))   # 5760
GRID_HEIGHT = int(round((LAT_MAX_DEG - LAT_MIN_DEG) * PX_PER_DEG))  # 5760
GRID_ID = "G32N"

LLINDAR_VETO_GRAUS = 15.0
SAFETY_MAX = 100.0
MEDIAN_SIZE = 3

# CRS equirectangular lunar (metres), compatible amb el mosaic USGS
CRS_MOON_EQC = CRS.from_proj4(
    f"+proj=eqc +lat_0=0 +lon_0=0 +lat_ts=0 +x_0=0 +y_0=0 "
    f"+R={MOON_RADIUS_M} +units=m +no_defs +type=crs"
)


# ---------------------------------------------------------------------------
# Objecte util (Pas 2)
# ---------------------------------------------------------------------------

@dataclass
class TerrainSafetyMatrix:
    """
    Objecte de retorn del Pas 1.

    Atribut principal
    -----------------
    safety : np.ndarray
        Matriu 2D float32 amb seguretat de pendent en **[0, 100]**.
        0 = veto (pendent ≥ llindar) o NoData; 100 = terreny pla.
    """

    safety: np.ndarray
    transform: Affine
    crs: str
    resolution_m: float
    veto_deg: float = LLINDAR_VETO_GRAUS
    safety_max: float = SAFETY_MAX
    grid_id: str = GRID_ID
    lon_range_deg: tuple[float, float] = (LON_MIN_DEG, LON_MAX_DEG)
    lat_range_deg: tuple[float, float] = (LAT_MIN_DEG, LAT_MAX_DEG)
    source_url: str = URL_LOLA_GLOBAL
    extras: dict[str, Any] = field(default_factory=dict)

    @property
    def shape(self) -> tuple[int, int]:
        return tuple(self.safety.shape)  # type: ignore[return-value]

    @property
    def height(self) -> int:
        return int(self.safety.shape[0])

    @property
    def width(self) -> int:
        return int(self.safety.shape[1])

    def as_array(self) -> np.ndarray:
        """Retorna només la matriu de seguretat [0, 100]."""
        return self.safety

    def __array__(self, dtype=None):
        arr = self.safety
        return arr if dtype is None else arr.astype(dtype, copy=False)

    def save(self, outdir: str | Path) -> dict[str, Path]:
        """Desa safety.npy, safety.f32 (contracte), metadades.json i GeoTIFF."""
        outdir = Path(outdir)
        outdir.mkdir(parents=True, exist_ok=True)
        npy_path = outdir / "safety.npy"
        f32_path = outdir / "safety.f32"
        meta_path = outdir / "metadades.json"
        tif_path = outdir / "safety.tif"

        np.save(npy_path, self.safety)
        self.safety.astype("<f4").tofile(f32_path)  # little-endian raw (contracte)
        sha = hashlib.sha256(f32_path.read_bytes()).hexdigest()

        meta = {
            "id": "terrain.slope_safety",
            "grid": self.grid_id,
            "crs": self.crs,
            "transform": list(self.transform)[:6],
            "width": self.width,
            "height": self.height,
            "resolution_m": self.resolution_m,
            "px_per_deg": PX_PER_DEG,
            "lon_range_deg": list(self.lon_range_deg),
            "lat_range_deg": list(self.lat_range_deg),
            "veto_deg": self.veto_deg,
            "value_range": [0.0, self.safety_max],
            "units": "score_0_100",
            "description": (
                "Seguretat topogràfica per pendent; 0=veto (≥15°), 100=pla. "
                "Cara visible només (sense cara oculta)."
            ),
            "source_url": self.source_url,
            "files": {
                "safety_npy": npy_path.name,
                "safety_f32": f32_path.name,
                "safety_tif": tif_path.name,
                "sha256_f32": sha,
            },
            **self.extras,
        }
        meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")

        try:
            crs_obj = CRS.from_user_input(self.crs) if self.crs else CRS_MOON_EQC
        except Exception:
            crs_obj = CRS_MOON_EQC
        profile = {
            "driver": "GTiff",
            "height": self.height,
            "width": self.width,
            "count": 1,
            "dtype": "float32",
            "crs": crs_obj,
            "transform": self.transform,
            "compress": "deflate",
            "tiled": True,
            "blockxsize": 256,
            "blockysize": 256,
        }
        with rasterio.open(tif_path, "w", **profile) as dst:
            dst.write(self.safety.astype("float32"), 1)

        return {
            "safety_npy": npy_path,
            "safety_f32": f32_path,
            "meta_json": meta_path,
            "safety_tif": tif_path,
        }


# ---------------------------------------------------------------------------
# Graella cara visible (G32N)
# ---------------------------------------------------------------------------

def nearside_grid() -> tuple[int, int, float, float, Affine]:
    """
    Graella equirectangular de la cara visible a 32 px/°.

    Retorna (width, height, res_x_m, res_y_m, transform) en CRS eqc lunar (metres).
    """
    width, height = GRID_WIDTH, GRID_HEIGHT
    lon0 = np.radians(LON_MIN_DEG)
    lon1 = np.radians(LON_MAX_DEG)
    lat0 = np.radians(LAT_MIN_DEG)
    lat1 = np.radians(LAT_MAX_DEG)
    left = MOON_RADIUS_M * lon0
    right = MOON_RADIUS_M * lon1
    bottom = MOON_RADIUS_M * lat0
    top = MOON_RADIUS_M * lat1
    res_x = (right - left) / width
    res_y = (top - bottom) / height
    transform = from_origin(left, top, res_x, res_y)
    return width, height, res_x, res_y, transform


def lonlat_of_cell(row: int, col: int) -> tuple[float, float]:
    """Centre geogràfic (lon, lat) en graus d'una cel·la (contracte-style)."""
    lon = LON_MIN_DEG + (col + 0.5) / PX_PER_DEG
    lat = LAT_MAX_DEG - (row + 0.5) / PX_PER_DEG
    return lon, lat


def open_remote(url: str):
    if not url.startswith("/vsi"):
        url = f"/vsicurl/{url}"
    return rasterio.open(url)


def warp_nearside_dem(url: str = URL_LOLA_GLOBAL) -> tuple[np.ndarray, Affine, float, float]:
    """Warp remot del DEM LOLA només sobre la cara visible (G32N)."""
    width, height, res_x, res_y, dst_transform = nearside_grid()
    print(f"[1/4] Graella {GRID_ID}: {width} × {height} px  (32 px/°)")
    print(f"      Lon [{LON_MIN_DEG}, {LON_MAX_DEG}]°  ·  Lat [{LAT_MIN_DEG}, {LAT_MAX_DEG}]°")
    print(f"      Resolució ≈ {res_x:.2f} m (equador) — CARA OCULTA EXCLOSA")

    print(f"[2/4] Warp remot LOLA → {GRID_ID}…\n      {url}")
    with open_remote(url) as src:
        print(f"      Origen : {src.width} × {src.height} @ {src.res}")
        dem = np.full((height, width), np.nan, dtype="float32")
        src_nodata = src.nodata if src.nodata is not None else -32768.0
        reproject(
            source=rasterio.band(src, 1),
            destination=dem,
            src_transform=src.transform,
            src_crs=src.crs,
            src_nodata=src_nodata,
            dst_transform=dst_transform,
            dst_crs=src.crs,  # SimpleCylindrical Moon ≈ eqc metres
            dst_nodata=np.nan,
            resampling=Resampling.average,
        )
        n_valid = int(np.isfinite(dem).sum())
        print(
            f"      Píxels vàlids : {n_valid}/{dem.size} "
            f"({100.0 * n_valid / dem.size:.1f} %)"
        )
        print(f"      Elevació     : {float(np.nanmin(dem)):.1f} … {float(np.nanmax(dem)):.1f} m")
    return dem, dst_transform, res_x, res_y


def clean_dem(dem: np.ndarray) -> np.ndarray:
    print("[3/4] Neteja (mediana 3×3)…")
    nans = ~np.isfinite(dem)
    dem_net = median_filter(np.nan_to_num(dem, nan=0.0), size=MEDIAN_SIZE).astype("float32")
    dem_net[nans] = np.nan
    return dem_net


def slope_safety_score(
    dem: np.ndarray,
    transform: Affine,
    res_x: float,
    res_y: float,
    veto_deg: float = LLINDAR_VETO_GRAUS,
) -> np.ndarray:
    """
    Pendent (graus) amb correcció cos(lat) i puntuació de seguretat **[0, 100]**.
    """
    print("[4/4] Pendent + seguretat [0, 100]…")
    h, _w = dem.shape
    rows = np.arange(h, dtype="float64")
    northings = transform.f + (rows + 0.5) * transform.e
    lats = northings / MOON_RADIUS_M
    cos_lat = np.clip(np.cos(lats), 1e-6, None)

    dz_dy, dz_dx_map = np.gradient(dem, res_y, res_x)
    dz_dx = dz_dx_map / cos_lat[:, np.newaxis]
    pendent = np.degrees(np.arctan(np.sqrt(dz_dx**2 + dz_dy**2)))
    pendent_segur = np.nan_to_num(pendent, nan=90.0).astype("float32")

    safety = np.clip(
        SAFETY_MAX * (1.0 - (pendent_segur / veto_deg)),
        0.0,
        SAFETY_MAX,
    ).astype("float32")
    safety[~np.isfinite(dem)] = 0.0
    safety[pendent_segur >= veto_deg] = 0.0

    viable = (pendent_segur < veto_deg) & np.isfinite(dem)
    pct = 100.0 * viable.sum() / max(1, int(np.isfinite(dem).sum()))
    print(f"      Pendent max  : {float(np.nanmax(pendent_segur)):.2f} °")
    print(f"      Viable (<{veto_deg:.0f}°): {pct:.2f} %")
    print(f"      safety range : [{float(safety.min()):.1f}, {float(safety.max()):.1f}]")
    return safety


def compute_nearside_terrain_safety(
    url: str = URL_LOLA_GLOBAL,
    veto_deg: float = LLINDAR_VETO_GRAUS,
) -> TerrainSafetyMatrix:
    """
    Pipeline: cara visible → matriu de seguretat [0, 100].

    Returns
    -------
    TerrainSafetyMatrix
        Usa ``.safety`` o ``np.asarray(result)`` al Pas 2.
    """
    print("=" * 60)
    print("  Pas 1 — Seguretat de pendent (CARA VISIBLE)")
    print(f"  Malla {GRID_ID}: {GRID_WIDTH}×{GRID_HEIGHT} · safety ∈ [0, {SAFETY_MAX:.0f}]")
    print("=" * 60)

    dem, transform, res_x, res_y = warp_nearside_dem(url)
    dem_net = clean_dem(dem)
    del dem
    safety = slope_safety_score(dem_net, transform, res_x, res_y, veto_deg=veto_deg)
    del dem_net

    result = TerrainSafetyMatrix(
        safety=safety,
        transform=transform,
        crs=str(CRS_MOON_EQC),
        resolution_m=float(res_x),
        veto_deg=veto_deg,
        source_url=url,
        extras={
            "res_x_m": res_x,
            "res_y_m": res_y,
            "hemisphere": "nearside",
            "far_side_excluded": True,
        },
    )
    print("Pas 1 (cara visible) completat.")
    return result


# Alias estable per al Pas 2 / codi antic
compute_global_terrain_safety = compute_nearside_terrain_safety


# ---------------------------------------------------------------------------
# Visualització HTML
# ---------------------------------------------------------------------------

def _fig_to_b64(fig) -> str:
    import matplotlib.pyplot as plt

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=130, bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _style_ax(ax, title: str) -> None:
    ax.set_facecolor("#0e1116")
    ax.set_title(title, color="#f0ebe0", fontsize=12, pad=8)
    ax.set_xlabel("Ouest ← X → Est (cara visible)", color="#a8a295", fontsize=9)
    ax.set_ylabel("Nord ← Y → Sud", color="#a8a295", fontsize=9)
    ax.tick_params(colors="#a8a295", labelsize=8)
    for spine in ax.spines.values():
        spine.set_color("#3a3f4a")


def _colorbar(fig, im, ax, label: str) -> None:
    import matplotlib.pyplot as plt

    cb = fig.colorbar(im, ax=ax, fraction=0.025, pad=0.02)
    cb.set_label(label, color="#d8d2c4", fontsize=9)
    cb.ax.yaxis.set_tick_params(color="#d8d2c4", labelsize=8)
    plt.setp(plt.getp(cb.ax.axes, "yticklabels"), color="#d8d2c4")


def fetch_dem_preview(
    url: str,
    result: TerrainSafetyMatrix,
    max_display_width: int = 1600,
) -> np.ndarray:
    h, w = result.safety.shape
    step = max(1, int(np.ceil(w / max_display_width)))
    dst_w = int(np.ceil(w / step))
    dst_h = int(np.ceil(h / step))
    t = result.transform
    dst_transform = Affine(t.a * step, t.b, t.c, t.d, t.e * step, t.f)
    print(f"      DEM preview : {dst_w} × {dst_h} px (pas={step})")
    with open_remote(url) as src:
        dem = np.full((dst_h, dst_w), np.nan, dtype="float32")
        src_nodata = src.nodata if src.nodata is not None else -32768.0
        reproject(
            source=rasterio.band(src, 1),
            destination=dem,
            src_transform=src.transform,
            src_crs=src.crs,
            src_nodata=src_nodata,
            dst_transform=dst_transform,
            dst_crs=src.crs,
            dst_nodata=np.nan,
            resampling=Resampling.average,
        )
    return dem


def render_safety_html(
    result: TerrainSafetyMatrix,
    html_path: Path,
    max_display_width: int = 1600,
    dem: np.ndarray | None = None,
    url: str = URL_LOLA_GLOBAL,
) -> Path:
    """HTML amb DEM + seguretat [0,100] (cara visible) i slider de comparació."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import LinearSegmentedColormap

    safety = result.safety
    h, w = safety.shape
    step = max(1, int(np.ceil(w / max_display_width)))
    safety_view = safety[::step, ::step]

    if dem is None:
        print("[HTML] DEM de visualització…")
        dem_view = fetch_dem_preview(url, result, max_display_width=max_display_width)
    else:
        dem_view = dem[::step, ::step] if dem.shape == safety.shape else dem
        if dem_view.shape != safety_view.shape:
            rh = min(dem_view.shape[0], safety_view.shape[0])
            rw = min(dem_view.shape[1], safety_view.shape[1])
            dem_view = dem_view[:rh, :rw]
            safety_view = safety_view[:rh, :rw]

    dem_cmap = LinearSegmentedColormap.from_list(
        "lunar_dem", ["#0b1020", "#2a3348", "#6b5e4e", "#c4b49a", "#f0e6d4"]
    )
    safe_cmap = LinearSegmentedColormap.from_list(
        "safe", ["#1a1210", "#5c2e1a", "#c47a2a", "#e8d48a", "#f5f0dc"]
    )

    elev_vmin = float(np.nanpercentile(dem_view, 2))
    elev_vmax = float(np.nanpercentile(dem_view, 98))

    fig, ax = plt.subplots(figsize=(11.5, 11.0), facecolor="#0e1116")
    im = ax.imshow(dem_view, cmap=dem_cmap, origin="upper", vmin=elev_vmin, vmax=elev_vmax, aspect="equal")
    _colorbar(fig, im, ax, "Elevació (m)")
    _style_ax(ax, f"DEM cara visible · {GRID_ID}")
    b64_dem = _fig_to_b64(fig)

    fig, ax = plt.subplots(figsize=(11.5, 11.0), facecolor="#0e1116")
    im = ax.imshow(safety_view, cmap=safe_cmap, origin="upper", vmin=0, vmax=SAFETY_MAX, aspect="equal")
    _colorbar(fig, im, ax, "Seguretat [0–100]")
    _style_ax(ax, f"Seguretat pendent · veto ≥ {result.veto_deg:.0f}°")
    b64_safe = _fig_to_b64(fig)

    fig, axes = plt.subplots(1, 2, figsize=(14.5, 7.0), facecolor="#0e1116")
    im0 = axes[0].imshow(dem_view, cmap=dem_cmap, origin="upper", vmin=elev_vmin, vmax=elev_vmax, aspect="equal")
    _colorbar(fig, im0, axes[0], "m")
    _style_ax(axes[0], "DEM")
    im1 = axes[1].imshow(safety_view, cmap=safe_cmap, origin="upper", vmin=0, vmax=SAFETY_MAX, aspect="equal")
    _colorbar(fig, im1, axes[1], "0–100")
    _style_ax(axes[1], "Seguretat")
    fig.suptitle("Cara visible · DEM vs seguretat", color="#f0ebe0", fontsize=13, y=1.01)
    fig.tight_layout()
    b64_cmp = _fig_to_b64(fig)

    viable = float((safety > 0).sum()) / safety.size * 100.0
    html = f"""<!DOCTYPE html>
<html lang="ca">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Pas 1 — Cara visible · seguretat 0–100</title>
<style>
  :root {{ --bg:#0b0d12; --card:#141820; --ink:#f2eee6; --muted:#9a9488; --line:#2a303c; --accent:#d4a574; }}
  * {{ box-sizing: border-box; }}
  body {{ margin:0; font-family:"IBM Plex Sans",system-ui,sans-serif; background:
    radial-gradient(900px 500px at 0% 0%, #1c2433, transparent 55%),
    radial-gradient(800px 400px at 100% 0%, #2a1f14, transparent 50%), var(--bg);
    color:var(--ink); line-height:1.55; }}
  header, main, footer {{ max-width:1100px; margin:0 auto; padding:1.5rem; }}
  h1 {{ font-family:"IBM Plex Serif",Georgia,serif; font-size:clamp(1.6rem,3.5vw,2.3rem); margin:0.3rem 0; }}
  .sub {{ color:var(--muted); max-width:42rem; }}
  .stats {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:.7rem; margin:1.2rem 0 1.6rem; }}
  .stat {{ background:var(--card); border:1px solid var(--line); padding:.85rem 1rem; }}
  .stat b {{ display:block; font-size:1.05rem; }}
  .stat span {{ color:var(--muted); font-size:.8rem; }}
  .tabs {{ display:flex; flex-wrap:wrap; gap:.4rem; margin:0 0 1rem; }}
  .tabs button {{ background:transparent; color:var(--muted); border:1px solid var(--line); padding:.45rem .9rem; cursor:pointer; font:inherit; }}
  .tabs button.active {{ border-color:var(--accent); color:var(--accent); }}
  .panel {{ display:none; }} .panel.active {{ display:block; }}
  figure {{ margin:0; background:var(--card); border:1px solid var(--line); }}
  figure img {{ display:block; width:100%; height:auto; }}
  figcaption {{ padding:.75rem 1rem; color:var(--muted); font-size:.9rem; border-top:1px solid var(--line); }}
  .compare {{ position:relative; width:100%; background:#000; overflow:hidden; border:1px solid var(--line); user-select:none; touch-action:none; line-height:0; }}
  .compare > .base {{ display:block; width:100%; height:auto; position:relative; z-index:0; }}
  .compare .top {{ position:absolute; left:0; top:0; bottom:0; width:50%; overflow:hidden; border-right:2px solid var(--accent); z-index:1; pointer-events:none; }}
  .compare .top img {{ position:absolute; left:0; top:0; height:100%; width:auto; max-width:none; display:block; }}
  .compare input[type=range] {{ position:absolute; inset:0; width:100%; height:100%; margin:0; opacity:0; cursor:ew-resize; z-index:3; }}
  .compare .hint {{ position:absolute; left:50%; bottom:.6rem; transform:translateX(-50%); background:rgba(0,0,0,.55); color:var(--ink); font-size:.75rem; padding:.25rem .55rem; z-index:2; pointer-events:none; line-height:1.3; }}
  code {{ font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:.9em; }}
  pre {{ background:#0a0c10; border:1px solid var(--line); padding:1rem; overflow:auto; }}
</style>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Serif:wght@600&display=swap" rel="stylesheet" />
</head>
<body>
<header>
  <p style="color:var(--accent);font-size:.9rem;margin:0">Pas 1 · branca <code>Jan</code> · malla <code>{GRID_ID}</code></p>
  <h1>Cara visible · seguretat 0–100</h1>
  <p class="sub">Matriu {result.width}×{result.height} (lon −90°…+90°). Cara oculta eliminada. <code>safety</code> ∈ [0, 100].</p>
</header>
<main>
  <div class="stats">
    <div class="stat"><b>{result.width} × {result.height}</b><span>cel·les G32N</span></div>
    <div class="stat"><b>32 px/°</b><span>pas (= G32 contracte)</span></div>
    <div class="stat"><b>{viable:.1f} %</b><span>safety &gt; 0</span></div>
    <div class="stat"><b>[{float(safety.min()):.0f}, {float(safety.max()):.0f}]</b><span>rang safety</span></div>
  </div>
  <div class="tabs" role="tablist">
    <button type="button" class="active" data-tab="slider">Slider compara</button>
    <button type="button" data-tab="side">Costa a costa</button>
    <button type="button" data-tab="dem">Només DEM</button>
    <button type="button" data-tab="safe">Només seguretat</button>
  </div>
  <div id="slider" class="panel active">
    <div class="compare" id="compare">
      <img class="base" id="compareBase" src="data:image/png;base64,{b64_safe}" alt="Seguretat" />
      <div class="top" id="compareTop">
        <img id="compareOverlay" src="data:image/png;base64,{b64_dem}" alt="DEM" />
      </div>
      <input type="range" min="0" max="100" value="50" id="compareRange" aria-label="Comparar DEM i seguretat" />
      <div class="hint">← DEM | Seguretat → · arrossega</div>
    </div>
  </div>
  <div id="side" class="panel"><figure><img src="data:image/png;base64,{b64_cmp}" alt="Comparació" /><figcaption>DEM vs seguretat (cara visible).</figcaption></figure></div>
  <div id="dem" class="panel"><figure><img src="data:image/png;base64,{b64_dem}" alt="DEM" /><figcaption>DEM LOLA · cara visible.</figcaption></figure></div>
  <div id="safe" class="panel"><figure><img src="data:image/png;base64,{b64_safe}" alt="Seguretat" /><figcaption>Seguretat 0–100 · veto ≥ {result.veto_deg:.0f}°.</figcaption></figure></div>
  <h2 style="font-family:'IBM Plex Serif',Georgia,serif;font-size:1.2rem;margin-top:2rem">API Pas 2</h2>
  <pre>from scripts.terrain_safety import compute_nearside_terrain_safety, TerrainSafetyMatrix
result = compute_nearside_terrain_safety()
safety = result.safety  # float32 (5760, 5760), valors 0–100</pre>
</main>
<footer style="color:var(--muted);font-size:.85rem">G32N · cara visible · safety 0–100</footer>
<script>
  document.querySelectorAll('.tabs button').forEach(btn => {{
    btn.addEventListener('click', () => {{
      document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'slider') syncCompare();
    }});
  }});
  const range = document.getElementById('compareRange');
  const top = document.getElementById('compareTop');
  const overlay = document.getElementById('compareOverlay');
  const base = document.getElementById('compareBase');
  const compare = document.getElementById('compare');
  function syncCompare() {{
    const w = compare.clientWidth || base.clientWidth;
    const h = base.clientHeight;
    if (w > 0) overlay.style.width = w + 'px';
    if (h > 0) {{ overlay.style.height = h + 'px'; top.style.height = h + 'px'; }}
    top.style.width = range.value + '%';
  }}
  range.addEventListener('input', syncCompare);
  window.addEventListener('resize', syncCompare);
  if (base.complete) syncCompare(); else base.addEventListener('load', syncCompare);
  overlay.addEventListener('load', syncCompare);
  requestAnimationFrame(syncCompare);
  setTimeout(syncCompare, 50);
  setTimeout(syncCompare, 250);
</script>
</body>
</html>
"""
    html_path = Path(html_path)
    html_path.parent.mkdir(parents=True, exist_ok=True)
    html_path.write_text(html, encoding="utf-8")
    print(f"HTML → {html_path}")
    return html_path


def rebuild_html_from_saved(outdir: Path, html_path: Path, url: str = URL_LOLA_GLOBAL) -> Path:
    meta = json.loads((outdir / "metadades.json").read_text(encoding="utf-8"))
    safety = np.load(outdir / "safety.npy")
    result = TerrainSafetyMatrix(
        safety=safety,
        transform=Affine(*meta["transform"][:6]),
        crs=meta.get("crs", ""),
        resolution_m=float(meta["resolution_m"]),
        veto_deg=float(meta.get("veto_deg", LLINDAR_VETO_GRAUS)),
        source_url=meta.get("source_url", url),
        grid_id=meta.get("grid", GRID_ID),
    )
    return render_safety_html(result, html_path, url=url)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Pas 1: cara visible → safety [0,100] (G32N)")
    p.add_argument("--url", default=URL_LOLA_GLOBAL)
    p.add_argument("--outdir", type=Path, default=Path("data/pas1_global"))
    p.add_argument("--html", type=Path, default=Path("docs/pas1_global_seguretat.html"))
    p.add_argument("--veto", type=float, default=LLINDAR_VETO_GRAUS)
    p.add_argument("--html-only", action="store_true")
    p.add_argument("--skip-html", action="store_true")
    return p.parse_args(argv)


def _copy_html_artifact(html_path: Path) -> None:
    art = Path("/opt/cursor/artifacts/pas1_global_seguretat.html")
    if art.parent.is_dir() and html_path.is_file():
        art.write_text(html_path.read_text(encoding="utf-8"), encoding="utf-8")
        print(f"HTML → {art}")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.html_only:
        rebuild_html_from_saved(args.outdir, args.html, url=args.url)
        _copy_html_artifact(args.html)
        return 0

    result = compute_nearside_terrain_safety(url=args.url, veto_deg=args.veto)
    paths = result.save(args.outdir)
    for k, v in paths.items():
        print(f"  ✓ {v} ({k})")
    print(f"\nObjecte: TerrainSafetyMatrix  shape={result.safety.shape}  "
          f"rang=[{result.safety.min():.1f}, {result.safety.max():.1f}]")

    if not args.skip_html:
        render_safety_html(result, args.html, url=args.url)
        _copy_html_artifact(args.html)
    return 0


if __name__ == "__main__":
    sys.exit(main())
