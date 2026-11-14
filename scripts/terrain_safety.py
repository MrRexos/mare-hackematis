#!/usr/bin/env python3
"""
Pas 1 (global) — Matriu de seguretat topogràfica lunar
======================================================
Processa **tota la Lluna** a resolució de cel·la configurable (per defecte
1 km × 1 km) a partir del LRO LOLA DEM remot (USGS /vsicurl/).

Retorna un objecte util ``TerrainSafetyMatrix`` amb la matriu de seguretat
``safety`` ∈ [0, 1] (veto estricte a pendent ≥ 15°), llesta per al Pas 2
(combinació amb il·luminació / comunicacions).

Ús programàtic::

    from terrain_safety import compute_global_terrain_safety
    result = compute_global_terrain_safety(cell_m=1000.0)
    matriu = result.safety   # np.ndarray float32, [0, 1]

CLI::

    python scripts/terrain_safety.py --cell-m 1000 --outdir data/pas1_global
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from affine import Affine
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.transform import from_origin, xy as transform_xy
from rasterio.warp import reproject
from scipy.ndimage import maximum_filter, median_filter

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

URL_LOLA_GLOBAL = (
    "https://planetarymaps.usgs.gov/mosaic/"
    "Lunar_LRO_LOLA_Global_LDEM_118m_Mar2014.tif"
)

MOON_RADIUS_M = 1_737_400.0
LLINDAR_VETO_GRAUS = 15.0
CELL_M_DEFAULT = 1000.0
MEDIAN_SIZE = 3


# ---------------------------------------------------------------------------
# Objecte util per al Pas 2
# ---------------------------------------------------------------------------

@dataclass
class TerrainSafetyMatrix:
    """
    Objecte de retorn del Pas 1.

    Atribut principal
    -----------------
    safety : np.ndarray
        Matriu 2D float32 amb valors de seguretat topogràfica en [0.0, 1.0].
        0 = veto (pendent ≥ llindar) o NoData; 1 = terreny pla.

    Metadades (per alinear capes del Pas 2)
    ---------------------------------------
    transform, crs, resolution_m, shape, veto_deg
    """

    safety: np.ndarray
    transform: Affine
    crs: str
    resolution_m: float
    veto_deg: float = LLINDAR_VETO_GRAUS
    source_url: str = URL_LOLA_GLOBAL
    extras: dict[str, Any] = field(default_factory=dict)

    # --- API mínima per al Pas 2 ---

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
        """Retorna només la matriu de seguretat [0, 1]."""
        return self.safety

    def __array__(self, dtype=None):
        """Permet ``np.asarray(result)`` → matriu de seguretat."""
        arr = self.safety
        return arr if dtype is None else arr.astype(dtype, copy=False)

    def save(self, outdir: str | Path) -> dict[str, Path]:
        """Desa safety.npy + metadades.json (+ opcional .tif)."""
        outdir = Path(outdir)
        outdir.mkdir(parents=True, exist_ok=True)
        npy_path = outdir / "safety.npy"
        meta_path = outdir / "metadades.json"
        tif_path = outdir / "safety.tif"

        np.save(npy_path, self.safety)

        meta = {
            "crs": self.crs,
            "transform": list(self.transform)[:6],
            "width": self.width,
            "height": self.height,
            "resolution_m": self.resolution_m,
            "veto_deg": self.veto_deg,
            "source_url": self.source_url,
            "value_range": [0.0, 1.0],
            "description": "Seguretat topogràfica (pendent); 0=veto, 1=pla",
            **self.extras,
        }
        meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")

        try:
            crs_obj = CRS.from_user_input(self.crs) if self.crs else None
        except Exception:
            crs_obj = None
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

        return {"safety_npy": npy_path, "meta_json": meta_path, "safety_tif": tif_path}


# ---------------------------------------------------------------------------
# Graella global 1 km
# ---------------------------------------------------------------------------

def global_grid(cell_m: float = CELL_M_DEFAULT) -> tuple[int, int, float, float, Affine]:
    """
    Dimensions d'una graella equirectangular que cobreix tota la Lluna
    amb cel·les ~cell_m metres (a l'equador).

    Retorna (width, height, res_x, res_y, transform).
    """
    width = max(1, int(round(2.0 * np.pi * MOON_RADIUS_M / cell_m)))
    height = max(1, int(round(np.pi * MOON_RADIUS_M / cell_m)))
    # Ajustem la resolució perquè cobreixi exactament ±πR / ±πR/2
    res_x = (2.0 * np.pi * MOON_RADIUS_M) / width
    res_y = (np.pi * MOON_RADIUS_M) / height
    left = -np.pi * MOON_RADIUS_M
    top = 0.5 * np.pi * MOON_RADIUS_M
    transform = from_origin(left, top, res_x, res_y)
    return width, height, res_x, res_y, transform


def open_remote(url: str):
    if not url.startswith("/vsi"):
        url = f"/vsicurl/{url}"
    return rasterio.open(url)


def warp_full_moon_dem(
    url: str,
    cell_m: float = CELL_M_DEFAULT,
) -> tuple[np.ndarray, Affine, CRS, float, float]:
    """
    Descarrega/remaestrea tot el DEM lunar a cel·les ~cell_m (average).
    Conserva el CRS SimpleCylindrical Moon d'origen.
    """
    width, height, res_x, res_y, dst_transform = global_grid(cell_m)
    print(f"[1/4] Graella global : {width} × {height} px  (~{res_x:.1f} m × {res_y:.1f} m)")
    print(f"      Cobertura      : tota la Lluna (Equirectangular / SimpleCylindrical)")

    print(f"[2/4] Warp remot LOLA → graella 1 km (pot trigar uns minuts)…\n      {url}")
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
            dst_crs=src.crs,
            dst_nodata=np.nan,
            resampling=Resampling.average,
        )
        crs = src.crs
        n_valid = int(np.isfinite(dem).sum())
        print(
            f"      Píxels vàlids : {n_valid}/{dem.size} "
            f"({100.0 * n_valid / dem.size:.1f} %)"
        )
        print(f"      Elevació     : {float(np.nanmin(dem)):.1f} … {float(np.nanmax(dem)):.1f} m")
    return dem, dst_transform, crs, res_x, res_y


def clean_dem(dem: np.ndarray) -> np.ndarray:
    """Mediana 3×3 preservant NaN grans (sense fillnodata global, massa car)."""
    print("[3/4] Neteja (mediana 3×3)…")
    nans = ~np.isfinite(dem)
    filled = np.nan_to_num(dem, nan=0.0)
    dem_net = median_filter(filled, size=MEDIAN_SIZE).astype("float32")
    dem_net[nans] = np.nan
    return dem_net


def slope_safety_equirectangular(
    dem: np.ndarray,
    transform: Affine,
    res_x: float,
    res_y: float,
    veto_deg: float = LLINDAR_VETO_GRAUS,
) -> np.ndarray:
    """
    Pendent en graus corregint Δx per cos(lat) (Equirectangular en metres)
    i capa de seguretat [0, 1] amb veto ≥ veto_deg.

    A 1 km/cel·la el «requadre» ja és 1 km²: no apliquem footprint multi-píxel.
    """
    print("[4/4] Pendent + capa de seguretat [0, 1]…")
    h, w = dem.shape
    rows = np.arange(h, dtype="float64")
    # Northing al centre de cada fila
    northings = transform.f + (rows + 0.5) * transform.e
    # latitud (rad) en equirectangular lunar: φ = y / R
    lats = northings / MOON_RADIUS_M
    cos_lat = np.clip(np.cos(lats), 1e-6, None)

    dz_dy, dz_dx_map = np.gradient(dem, res_y, res_x)
    # Conversió a metres de terra: Δx_real = Δx_mapa · cos(φ)
    dz_dx = dz_dx_map / cos_lat[:, np.newaxis]

    pendent = np.degrees(np.arctan(np.sqrt(dz_dx**2 + dz_dy**2)))
    # A 1 km² cada cel·la és ja el requadre demanat
    pendent_segur = np.nan_to_num(pendent, nan=90.0).astype("float32")

    safety = np.clip(1.0 - (pendent_segur / veto_deg), 0.0, 1.0).astype("float32")
    safety[~np.isfinite(dem)] = 0.0
    safety[pendent_segur >= veto_deg] = 0.0

    viable = (pendent_segur < veto_deg) & np.isfinite(dem)
    pct = 100.0 * viable.sum() / np.isfinite(dem).sum()
    print(f"      Pendent max  : {float(np.nanmax(pendent_segur)):.2f} °")
    print(f"      Viable (<{veto_deg:.0f}°): {pct:.2f} %")
    print(f"      safety range : [{float(safety.min()):.3f}, {float(safety.max()):.3f}]")
    return safety


def compute_global_terrain_safety(
    cell_m: float = CELL_M_DEFAULT,
    url: str = URL_LOLA_GLOBAL,
    veto_deg: float = LLINDAR_VETO_GRAUS,
) -> TerrainSafetyMatrix:
    """
    Pipeline complet: Lluna sencera → matriu de seguretat [0, 1].

    Returns
    -------
    TerrainSafetyMatrix
        Objecte util; usa ``.safety`` o ``np.asarray(result)`` al Pas 2.
    """
    print("=" * 60)
    print("  Pas 1 GLOBAL — Seguretat topogràfica (tota la Lluna)")
    print(f"  Cel·la = {cell_m:.0f} m × {cell_m:.0f} m  (1 km² si cell_m=1000)")
    print("=" * 60)

    dem, transform, crs, res_x, res_y = warp_full_moon_dem(url, cell_m=cell_m)
    dem_net = clean_dem(dem)
    del dem
    safety = slope_safety_equirectangular(
        dem_net, transform, res_x, res_y, veto_deg=veto_deg
    )
    del dem_net

    result = TerrainSafetyMatrix(
        safety=safety,
        transform=transform,
        crs=str(crs) if crs else "",
        resolution_m=float(res_x),
        veto_deg=veto_deg,
        source_url=url,
        extras={
            "cell_m_requested": cell_m,
            "res_x_m": res_x,
            "res_y_m": res_y,
            "grid": "global_equirectangular_moon",
        },
    )
    print("Pas 1 global completat.")
    return result


# ---------------------------------------------------------------------------
# Visualització HTML (DEM + seguretat, comparació)
# ---------------------------------------------------------------------------

def _fig_to_b64(fig) -> str:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=130, bbox_inches="tight", facecolor=fig.get_facecolor())
    import matplotlib.pyplot as plt

    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _style_ax(ax, title: str) -> None:
    ax.set_facecolor("#0e1116")
    ax.set_title(title, color="#f0ebe0", fontsize=12, pad=8)
    ax.set_xlabel("Ouest ← X → Est", color="#a8a295", fontsize=9)
    ax.set_ylabel("Nord ← Y → Sud", color="#a8a295", fontsize=9)
    ax.tick_params(colors="#a8a295", labelsize=8)
    for spine in ax.spines.values():
        spine.set_color("#3a3f4a")


def _colorbar(fig, im, ax, label: str) -> None:
    cb = fig.colorbar(im, ax=ax, fraction=0.025, pad=0.02)
    cb.set_label(label, color="#d8d2c4", fontsize=9)
    cb.ax.yaxis.set_tick_params(color="#d8d2c4", labelsize=8)
    import matplotlib.pyplot as plt

    plt.setp(plt.getp(cb.ax.axes, "yticklabels"), color="#d8d2c4")


def fetch_dem_preview(
    url: str,
    result: TerrainSafetyMatrix,
    max_display_width: int = 1800,
) -> np.ndarray:
    """
    DEM global a resolució de visualització (mateixa cobertura que ``result``),
    sense recalcular tot a 1 km. Usa average resampling des del LOLA remot.
    """
    import matplotlib  # noqa: F401 — assegura deps

    h, w = result.safety.shape
    step = max(1, int(np.ceil(w / max_display_width)))
    dst_w = int(np.ceil(w / step))
    dst_h = int(np.ceil(h / step))
    # Affine escalat (mateix origen, píxel més gros)
    t = result.transform
    dst_transform = Affine(t.a * step, t.b, t.c, t.d, t.e * step, t.f)

    print(f"      DEM preview : {dst_w} × {dst_h} px (pas={step})")
    with open_remote(url) as src:
        dem = np.full((dst_h, dst_w), np.nan, dtype="float32")
        src_nodata = src.nodata if src.nodata is not None else -32768.0
        try:
            dst_crs = CRS.from_user_input(result.crs) if result.crs else src.crs
        except Exception:
            dst_crs = src.crs
        reproject(
            source=rasterio.band(src, 1),
            destination=dem,
            src_transform=src.transform,
            src_crs=src.crs,
            src_nodata=src_nodata,
            dst_transform=dst_transform,
            dst_crs=dst_crs,
            dst_nodata=np.nan,
            resampling=Resampling.average,
        )
    return dem


def render_safety_html(
    result: TerrainSafetyMatrix,
    html_path: Path,
    max_display_width: int = 1800,
    dem: np.ndarray | None = None,
    url: str = URL_LOLA_GLOBAL,
) -> Path:
    """
    HTML autosuficient amb **mapa lunar (DEM)** i **capa de seguretat**,
    en vista costa-a-costa i amb un slider de comparació.
    """
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import LinearSegmentedColormap

    safety = result.safety
    h, w = safety.shape
    step = max(1, int(np.ceil(w / max_display_width)))
    safety_view = safety[::step, ::step]

    if dem is None:
        print("[HTML] Descarregant DEM de visualització per comparar…")
        dem_view = fetch_dem_preview(url, result, max_display_width=max_display_width)
    else:
        dem_view = dem[::step, ::step] if dem.shape == safety.shape else dem
        # Alinea mides si cal
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

    # --- Figura DEM ---
    fig, ax = plt.subplots(figsize=(12.5, 6.2), facecolor="#0e1116")
    elev_vmin = float(np.nanpercentile(dem_view, 2))
    elev_vmax = float(np.nanpercentile(dem_view, 98))
    im = ax.imshow(
        dem_view, cmap=dem_cmap, origin="upper",
        vmin=elev_vmin, vmax=elev_vmax, aspect="auto",
    )
    _colorbar(fig, im, ax, "Elevació (m)")
    _style_ax(ax, "Mapa lunar (DEM LOLA) · elevació")
    b64_dem = _fig_to_b64(fig)

    # --- Figura seguretat ---
    fig, ax = plt.subplots(figsize=(12.5, 6.2), facecolor="#0e1116")
    im = ax.imshow(safety_view, cmap=safe_cmap, origin="upper", vmin=0, vmax=1, aspect="auto")
    _colorbar(fig, im, ax, "Seguretat [0–1]")
    _style_ax(
        ax,
        f"Capa de seguretat · cel·la ≈ {result.resolution_m:.0f} m · veto ≥ {result.veto_deg:.0f}°",
    )
    b64_safe = _fig_to_b64(fig)

    # --- Figura costa-a-costa ---
    fig, axes = plt.subplots(1, 2, figsize=(14.5, 5.6), facecolor="#0e1116")
    im0 = axes[0].imshow(
        dem_view, cmap=dem_cmap, origin="upper",
        vmin=elev_vmin, vmax=elev_vmax, aspect="auto",
    )
    _colorbar(fig, im0, axes[0], "m")
    _style_ax(axes[0], "DEM (elevació)")
    im1 = axes[1].imshow(safety_view, cmap=safe_cmap, origin="upper", vmin=0, vmax=1, aspect="auto")
    _colorbar(fig, im1, axes[1], "[0–1]")
    _style_ax(axes[1], "Seguretat (pendent)")
    fig.suptitle(
        "Comparació · mateixa cobertura equirectangular",
        color="#f0ebe0",
        fontsize=13,
        y=1.01,
    )
    fig.tight_layout()
    b64_cmp = _fig_to_b64(fig)

    viable = float((safety > 0).sum()) / safety.size * 100.0
    html = f"""<!DOCTYPE html>
<html lang="ca">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Pas 1 Global — DEM vs seguretat lunar</title>
<style>
  :root {{ --bg:#0b0d12; --card:#141820; --ink:#f2eee6; --muted:#9a9488; --line:#2a303c; --accent:#d4a574; }}
  * {{ box-sizing: border-box; }}
  body {{ margin:0; font-family:"IBM Plex Sans",system-ui,sans-serif; background:
    radial-gradient(900px 500px at 0% 0%, #1c2433, transparent 55%),
    radial-gradient(800px 400px at 100% 0%, #2a1f14, transparent 50%), var(--bg);
    color:var(--ink); line-height:1.55; }}
  header, main, footer {{ max-width:1100px; margin:0 auto; padding:1.5rem; }}
  h1 {{ font-family:"IBM Plex Serif",Georgia,serif; font-size:clamp(1.6rem,3.5vw,2.3rem); margin:0.3rem 0; }}
  h2 {{ font-family:"IBM Plex Serif",Georgia,serif; font-size:1.25rem; margin:2rem 0 .5rem; }}
  .sub {{ color:var(--muted); max-width:42rem; }}
  .stats {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:.7rem; margin:1.2rem 0 1.6rem; }}
  .stat {{ background:var(--card); border:1px solid var(--line); padding:.85rem 1rem; }}
  .stat b {{ display:block; font-size:1.1rem; }}
  .stat span {{ color:var(--muted); font-size:.8rem; }}
  .tabs {{ display:flex; flex-wrap:wrap; gap:.4rem; margin:0 0 1rem; }}
  .tabs button {{
    background:transparent; color:var(--muted); border:1px solid var(--line);
    padding:.45rem .9rem; cursor:pointer; font:inherit;
  }}
  .tabs button.active {{ color:var(--ink); border-color:var(--accent); color:var(--accent); }}
  .panel {{ display:none; }}
  .panel.active {{ display:block; }}
  figure {{ margin:0; background:var(--card); border:1px solid var(--line); }}
  figure img {{ display:block; width:100%; height:auto; }}
  figcaption {{ padding:.75rem 1rem; color:var(--muted); font-size:.9rem; border-top:1px solid var(--line); }}
  .compare {{
    position:relative; width:100%; background:#000; overflow:hidden;
    border:1px solid var(--line); user-select:none; touch-action:none; line-height:0;
  }}
  .compare > .base {{ display:block; width:100%; height:auto; position:relative; z-index:0; }}
  .compare .top {{
    position:absolute; left:0; top:0; bottom:0; width:50%; overflow:hidden;
    border-right:2px solid var(--accent); z-index:1; pointer-events:none;
  }}
  .compare .top img {{
    position:absolute; left:0; top:0; height:100%; width:auto; max-width:none; display:block;
  }}
  .compare input[type=range] {{
    position:absolute; inset:0; width:100%; height:100%; margin:0; opacity:0; cursor:ew-resize; z-index:3;
  }}
  .compare .hint {{
    position:absolute; left:50%; bottom:.6rem; transform:translateX(-50%);
    background:rgba(0,0,0,.55); color:var(--ink); font-size:.75rem; padding:.25rem .55rem;
    z-index:2; pointer-events:none; line-height:1.3;
  }}
  code {{ font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:.9em; }}
  pre {{ background:#0a0c10; border:1px solid var(--line); padding:1rem; overflow:auto; }}
</style>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono&family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Serif:wght@600&display=swap" rel="stylesheet" />
</head>
<body>
<header>
  <p style="color:var(--accent);font-size:.9rem;margin:0">Pas 1 global · branca <code>cursor/lunar-dem-pas1-50d8</code></p>
  <h1>DEM lunar vs seguretat topogràfica</h1>
  <p class="sub">Comparació de la mateixa cobertura global: mapa d’elevació LOLA i matriu <code>safety</code> ∈ [0, 1] (~{result.resolution_m:.0f}&nbsp;m/cel·la).</p>
</header>
<main>
  <div class="stats">
    <div class="stat"><b>{result.width} × {result.height}</b><span>cel·les (matriu)</span></div>
    <div class="stat"><b>~{result.resolution_m:.0f} m</b><span>requadre ≈ 1 km²</span></div>
    <div class="stat"><b>{viable:.1f} %</b><span>safety &gt; 0</span></div>
    <div class="stat"><b>{elev_vmin:.0f} … {elev_vmax:.0f} m</b><span>elevació (p2–p98)</span></div>
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
    <p class="sub" style="margin-top:.7rem">Esquerra: mapa de la Lluna (elevació). Dreta: capa de seguretat derivada del pendent.</p>
  </div>

  <div id="side" class="panel">
    <figure>
      <img src="data:image/png;base64,{b64_cmp}" alt="Comparació costa a costa" />
      <figcaption>Vista paral·lela: cràters i relleu (esquerra) vs zones planes/vetades (dreta).</figcaption>
    </figure>
  </div>

  <div id="dem" class="panel">
    <figure>
      <img src="data:image/png;base64,{b64_dem}" alt="DEM lunar" />
      <figcaption>DEM LOLA global (Equirectangular). Clar = elevat; fosc = depressions / fons de cràter.</figcaption>
    </figure>
  </div>

  <div id="safe" class="panel">
    <figure>
      <img src="data:image/png;base64,{b64_safe}" alt="Seguretat topogràfica" />
      <figcaption>Clar = pla (segur); fosc = pendent ≥ {result.veto_deg:.0f}° (veto). Objecte: <code>TerrainSafetyMatrix.safety</code>.</figcaption>
    </figure>
  </div>

  <h2>Ús al Pas 2</h2>
  <pre>from scripts.terrain_safety import compute_global_terrain_safety
result = compute_global_terrain_safety(cell_m=1000.0)
safety = result.safety  # matriu [0, 1]
# viabilitat_total = w_s * safety * capa_iluminacio * capa_comms</pre>
</main>
<footer style="color:var(--muted);font-size:.85rem">LRO LOLA Global LDEM · cel·la {result.resolution_m:.1f} m</footer>
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
    // L'overlay ha de tenir l'amplada del contenidor (no la del clip).
    const w = compare.clientWidth || base.clientWidth;
    const h = base.clientHeight;
    if (w > 0) overlay.style.width = w + 'px';
    if (h > 0) {{
      overlay.style.height = h + 'px';
      top.style.height = h + 'px';
    }}
    top.style.width = range.value + '%';
  }}
  range.addEventListener('input', syncCompare);
  window.addEventListener('resize', syncCompare);
  if (base.complete) syncCompare();
  else base.addEventListener('load', syncCompare);
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


def rebuild_html_from_saved(
    outdir: Path,
    html_path: Path,
    url: str = URL_LOLA_GLOBAL,
) -> Path:
    """Regenera l'HTML de comparació a partir de safety.npy ja calculat."""
    meta = json.loads((outdir / "metadades.json").read_text(encoding="utf-8"))
    safety = np.load(outdir / "safety.npy")
    result = TerrainSafetyMatrix(
        safety=safety,
        transform=Affine(*meta["transform"][:6]),
        crs=meta.get("crs", ""),
        resolution_m=float(meta["resolution_m"]),
        veto_deg=float(meta.get("veto_deg", LLINDAR_VETO_GRAUS)),
        source_url=meta.get("source_url", url),
        extras={k: meta[k] for k in ("cell_m_requested", "res_x_m", "res_y_m", "grid") if k in meta},
    )
    return render_safety_html(result, html_path, url=url)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Pas 1 global: Lluna sencera → matriu safety [0,1]")
    p.add_argument("--cell-m", type=float, default=CELL_M_DEFAULT, help="Mida de cel·la en metres (defecte 1000 = 1 km)")
    p.add_argument("--url", default=URL_LOLA_GLOBAL)
    p.add_argument("--outdir", type=Path, default=Path("data/pas1_global"))
    p.add_argument("--html", type=Path, default=Path("docs/pas1_global_seguretat.html"))
    p.add_argument("--veto", type=float, default=LLINDAR_VETO_GRAUS)
    p.add_argument(
        "--html-only",
        action="store_true",
        help="Només regenera l'HTML (DEM+seguretat) des de safety.npy ja calculat",
    )
    return p.parse_args(argv)


def _copy_html_artifact(html_path: Path) -> None:
    art = Path("/opt/cursor/artifacts/pas1_global_seguretat.html")
    if art.parent.is_dir():
        art.write_text(html_path.read_text(encoding="utf-8"), encoding="utf-8")
        print(f"HTML → {art}")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    if args.html_only:
        rebuild_html_from_saved(args.outdir, args.html, url=args.url)
        _copy_html_artifact(args.html)
        return 0

    result = compute_global_terrain_safety(
        cell_m=args.cell_m, url=args.url, veto_deg=args.veto
    )
    paths = result.save(args.outdir)
    for k, v in paths.items():
        print(f"  ✓ {v} ({k})")

    print(f"\nObjecte retornat: TerrainSafetyMatrix")
    print(f"  result.safety.shape = {result.safety.shape}")
    print(f"  result.safety dtype = {result.safety.dtype}")
    print(f"  rang = [{result.safety.min():.4f}, {result.safety.max():.4f}]")

    render_safety_html(result, args.html, url=args.url)
    _copy_html_artifact(args.html)
    return 0


if __name__ == "__main__":
    sys.exit(main())
