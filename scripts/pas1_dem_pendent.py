#!/usr/bin/env python3
"""
Pas 1 — Lunar Landing Site Navigator (NASA Space Apps Challenge)
=================================================================
Descarrega un retall remot del LRO LOLA DEM (USGS / NASA), neteja les dades,
reprojecta a metres si cal (Moon 2000 South Pole Stereographic), calcula la
matriu de pendent i genera la capa normalitzada de seguretat del terreny
(0–1 amb veto estricte a ≥ 15°).

Exporta:
  - dem_net.npy
  - capa_pendent_norm.npy
  - dem_net.tif / capa_pendent_norm.tif  (georeferenciats)
  - metadades.json

Ús:
  python scripts/pas1_dem_pendent.py
  python scripts/pas1_dem_pendent.py --outdir data/pas1 --window 2000
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from affine import Affine
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.fill import fillnodata
from rasterio.transform import array_bounds, from_origin
from rasterio.warp import reproject, transform as warp_transform
from rasterio.windows import Window
from scipy.ndimage import maximum_filter, median_filter

# ---------------------------------------------------------------------------
# Configuració per defecte
# ---------------------------------------------------------------------------

# Mosaic global LOLA (SimpleCylindrical / Equirectangular en metres nominals).
# Font oficial USGS Planetary Maps. Prop del pol cal reprojecció a SPS.
URL_LOLA_GLOBAL = (
    "https://planetarymaps.usgs.gov/mosaic/"
    "Lunar_LRO_LOLA_Global_LDEM_118m_Mar2014.tif"
)

# Radi lunar IAU (m) — Moon 2000
MOON_RADIUS_M = 1_737_400.0

# Moon 2000 South Pole Stereographic (metres)
CRS_MOON_SPS = CRS.from_proj4(
    f"+proj=stere +lat_0=-90 +lon_0=0 +k=1 +x_0=0 +y_0=0 "
    f"+R={MOON_RADIUS_M} +units=m +no_defs +type=crs"
)

CRS_MOON_LONLAT = CRS.from_proj4(
    f"+proj=longlat +R={MOON_RADIUS_M} +no_defs +type=crs"
)

# Centre AOI per defecte (regió Artemis / CLPS al Pol Sud)
DEFAULT_CENTER_LON = 0.0
DEFAULT_CENTER_LAT = -89.5

LLINDAR_VETO_GRAUS = 15.0
FINESTRA_PX = 2000
FILL_NODATA_DIST = 5
MEDIAN_SIZE = 3
LANDER_FOOTPRINT_SIZE = 3  # filtre de màxim ≈ base de la nau


# ---------------------------------------------------------------------------
# Utilitats CRS / unitats
# ---------------------------------------------------------------------------

def crs_is_geographic(crs: CRS | None) -> bool:
    """True si el CRS està en graus (longitud/latitud), no en metres."""
    if crs is None:
        return True
    try:
        return bool(crs.is_geographic)
    except Exception:
        return True


def crs_is_south_pole_stereographic(crs: CRS | None) -> bool:
    """True si el CRS ja és estereogràfic centrat al Pol Sud (metres)."""
    if crs is None or crs_is_geographic(crs):
        return False
    try:
        text = (crs.to_proj4() or "").lower() + " " + (crs.to_wkt() or "").lower()
    except Exception:
        return False
    has_stere = ("+proj=stere" in text) or ("stereographic" in text)
    has_south = ("lat_0=-90" in text) or ('latitude_of_origin",-90' in text.replace(" ", ""))
    return has_stere and has_south


def crs_is_cylindrical_or_equirectangular(crs: CRS | None) -> bool:
    """
    Detecta projeccions cilíndriques / equirectangulars (ex. mosaic global LOLA
    «SimpleCylindrical Moon»), on Δx en metres NO és distància real prop del pol.
    """
    if crs is None:
        return False
    try:
        text = (crs.to_proj4() or "").lower() + " " + (crs.to_wkt() or "").lower()
    except Exception:
        return False
    markers = (
        "+proj=eqc",
        "+proj=longlat",
        "equirectangular",
        "simplecylindrical",
        "plate_caree",
        "plate caree",
        "cylindrical",
    )
    return any(m in text for m in markers)


def needs_sps_reprojection(crs: CRS | None) -> bool:
    """
    Cal reprojecció a Moon 2000 South Pole Stereographic abans del pendent si:
      - el CRS és geogràfic (graus), o
      - és equirectangular/cilíndric (distorsió polar), o
      - no és ja estereogràfic del Pol Sud.
    """
    if crs_is_south_pole_stereographic(crs):
        return False
    if crs_is_geographic(crs) or crs_is_cylindrical_or_equirectangular(crs):
        return True
    # Qualsevol altre CRS projectat desconegut: millor anar a SPS per AOI polar
    return True


def describe_source_units(crs: CRS | None, res_x: float, res_y: float) -> str:
    """Etiqueta diagnòstica de les unitats / projecció d'origen."""
    abs_x, abs_y = abs(float(res_x)), abs(float(res_y))
    if crs_is_geographic(crs):
        return f"graus (CRS geogràfic), res=({abs_x:.6g}, {abs_y:.6g})°"
    if crs_is_cylindrical_or_equirectangular(crs):
        return (
            f"metres nominals en Equirectangular/cilíndric "
            f"(res={abs_x:.3f}×{abs_y:.3f} m) — NO vàlids al pol sense reprojecció"
        )
    if crs_is_south_pole_stereographic(crs):
        return f"metres (South Pole Stereographic), res={abs_x:.3f}×{abs_y:.3f} m"
    return f"metres (CRS projectat), res={abs_x:.3f}×{abs_y:.3f} m"


# ---------------------------------------------------------------------------
# Descàrrega remota (retall via /vsicurl/)
# ---------------------------------------------------------------------------

def open_remote(url: str):
    """Obre un GeoTIFF remot amb GDAL /vsicurl/ (només llegeix el necessari)."""
    if not url.startswith("/vsi"):
        url = f"/vsicurl/{url}"
    return rasterio.open(url)


def lonlat_to_sps(lon: float, lat: float) -> tuple[float, float]:
    """Converteix (lon, lat) → (easting, northing) en Moon 2000 SPS."""
    xs, ys = warp_transform(CRS_MOON_LONLAT, CRS_MOON_SPS, [lon], [lat])
    return float(xs[0]), float(ys[0])


def sps_grid_transform(
    center_lon: float,
    center_lat: float,
    window_px: int,
    res_m: float,
) -> Affine:
    """Affine d'una graella quadrada window_px×window_px centrada a lon/lat."""
    cx, cy = lonlat_to_sps(center_lon, center_lat)
    half = window_px * res_m / 2.0
    left = cx - half
    top = cy + half
    return from_origin(left, top, res_m, res_m)


def infer_source_resolution_m(src: rasterio.DatasetReader) -> float:
    """Resolució N–S d'origen convertida a metres (aproximació estable)."""
    res_y = abs(float(src.res[1]))
    if crs_is_geographic(src.crs):
        return res_y * (np.pi * MOON_RADIUS_M / 180.0)
    return res_y


def fetch_dem_sps_window(
    url: str,
    center_lon: float,
    center_lat: float,
    window_px: int,
    target_res_m: float | None = None,
) -> dict[str, Any]:
    """
    Obté un retall window_px×window_px ja en Moon 2000 South Pole Stereographic.

    - Si l'origen ja és SPS: llegeix la finestra remotament (vsicurl).
    - Si l'origen és geogràfic o equirectangular: reprojecta *directament* des del
      dataset remot cap a una graella SPS objectiu (GDAL només demana els blocs
      necessaris; no cal baixar el mosaic global).

    Això garanteix que Δx/Δy del gradient de pendent siguin metres reals al pol.
    """
    print(f"[1/5] Obrint DEM remot:\n      {url}")
    with open_remote(url) as src:
        print(f"      Mida global : {src.width} × {src.height} px")
        print(f"      CRS origen  : {src.crs}")
        print(f"      Resolució   : {src.res}")
        print(f"      NoData      : {src.nodata}")
        print(f"      Bounds      : {tuple(src.bounds)}")
        print(f"      Unitats origen: {describe_source_units(src.crs, *src.res)}")

        res_m = float(target_res_m) if target_res_m else infer_source_resolution_m(src)
        dst_transform = sps_grid_transform(center_lon, center_lat, window_px, res_m)
        meta = {
            "source_url": url,
            "source_width": src.width,
            "source_height": src.height,
            "source_crs": str(src.crs) if src.crs else None,
            "source_res": [float(src.res[0]), float(src.res[1])],
            "source_nodata": src.nodata,
        }

        # --- Cas A: origen ja en SPS → lectura directa de finestra ---
        if not needs_sps_reprojection(src.crs):
            print("[2/5] CRS ja és South Pole Stereographic — lectura directa del retall…")
            cx, cy = lonlat_to_sps(center_lon, center_lat)
            row, col = src.index(cx, cy)
            col_off = int(col) - window_px // 2
            row_off = int(row) - window_px // 2
            col_off = max(0, min(col_off, max(0, src.width - window_px)))
            row_off = max(0, min(row_off, max(0, src.height - window_px)))
            w = min(window_px, src.width - col_off)
            h = min(window_px, src.height - row_off)
            finestra = Window(col_off, row_off, w, h)
            dem = src.read(1, window=finestra).astype("float32")
            transform = src.window_transform(finestra)
            res_x, res_y = abs(transform.a), abs(transform.e)
            print(f"      Retall      : {w} × {h} px @ {res_x:.3f} m")
            return {
                **meta,
                "dem": dem,
                "transform": transform,
                "crs": src.crs or CRS_MOON_SPS,
                "res_x_m": res_x,
                "res_y_m": res_y,
                "nodata": src.nodata,
                "reprojected_to_sps": False,
                "window": finestra,
            }

        # --- Cas B: graus / equirectangular → warp remot → graella SPS ---
        reason = (
            "CRS geogràfic (graus)"
            if crs_is_geographic(src.crs)
            else "Equirectangular/cilíndric (distorsió polar)"
            if crs_is_cylindrical_or_equirectangular(src.crs)
            else "CRS no estereogràfic polar"
        )
        print(
            f"[2/5] {reason} → reprojecció remota a graella "
            f"{window_px}×{window_px} SPS @ {res_m:.3f} m…"
        )

        dem = np.full((window_px, window_px), np.nan, dtype="float32")
        src_nodata = src.nodata if src.nodata is not None else -32768.0

        reproject(
            source=rasterio.band(src, 1),
            destination=dem,
            src_transform=src.transform,
            src_crs=src.crs,
            src_nodata=src_nodata,
            dst_transform=dst_transform,
            dst_crs=CRS_MOON_SPS,
            dst_nodata=np.nan,
            resampling=Resampling.bilinear,
        )

        # vsicurl només ha demanat els blocs que cobreixen la graella destí
        n_valid = int(np.isfinite(dem).sum())
        print(f"      Sortida     : {window_px} × {window_px} px")
        print(f"      Resolució   : {res_m:.3f} m × {res_m:.3f} m")
        print(f"      Píxels vàlids: {n_valid} ({100.0 * n_valid / dem.size:.1f} %)")
        print("      CRS destí   : Moon 2000 South Pole Stereographic")

        return {
            **meta,
            "dem": dem,
            "transform": dst_transform,
            "crs": CRS_MOON_SPS,
            "res_x_m": res_m,
            "res_y_m": res_m,
            "nodata": None,  # NaN ja marca NoData
            "reprojected_to_sps": True,
            "window": None,
        }


# ---------------------------------------------------------------------------
# Neteja DEM + pendent + normalització
# ---------------------------------------------------------------------------

def clean_dem(dem: np.ndarray, nodata_val: float | None) -> tuple[np.ndarray, np.ndarray]:
    """
    1) Marca NoData com a NaN
    2) Omple forats petits (fillnodata, radi ≤ 5 px)
    3) Filtre de mediana 3×3 (soroll del sensor, preserva cràters)
    Retorna (dem_net, mask_nan_grans).
    """
    print("[3/5] Neteja del DEM (NoData + mediana 3×3)…")
    dem_work = dem.astype("float32").copy()

    if nodata_val is not None:
        dem_work[dem_work == nodata_val] = np.nan
    # Valors absurdament baixos (sentinel GDAL) també a NaN
    dem_work[dem_work < -1.0e10] = np.nan

    mask_valids = ~np.isnan(dem_work)
    if not mask_valids.any():
        raise RuntimeError("El retall DEM no conté cap píxel vàlid.")

    # fillnodata espera mask=1 per a píxels vàlids
    dem_filled = fillnodata(
        dem_work,
        mask=mask_valids.astype("uint8"),
        max_search_distance=FILL_NODATA_DIST,
    )

    nans_grans = np.isnan(dem_filled)
    dem_net = median_filter(np.nan_to_num(dem_filled, nan=0.0), size=MEDIAN_SIZE)
    dem_net = dem_net.astype("float32")
    dem_net[nans_grans] = np.nan

    n_nan = int(np.isnan(dem_net).sum())
    pct_nan = 100.0 * n_nan / dem_net.size
    print(f"      Píxels NaN residuals : {n_nan} ({pct_nan:.2f} %)")
    return dem_net, nans_grans


def compute_slope_and_safety(
    dem_net: np.ndarray,
    res_x_m: float,
    res_y_m: float,
    nans_grans: np.ndarray,
    llindar: float = LLINDAR_VETO_GRAUS,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Calcula pendent en graus (resolució en metres), aplica filtre de màxim
    (base de la nau) i normalitza a [0, 1] amb veto ≥ llindar → 0.
    """
    print("[4/5] Càlcul de pendent i capa de seguretat…")
    print(f"      Δx = {res_x_m:.3f} m,  Δy = {res_y_m:.3f} m")

    # np.gradient(f, spacing_y, spacing_x) — eixos (fila=y, col=x)
    dz_dy, dz_dx = np.gradient(dem_net, res_y_m, res_x_m)
    pendent_graus = np.degrees(np.arctan(np.sqrt(dz_dx**2 + dz_dy**2)))

    # Tota la base de la nau ha de ser plana → màxim local
    pendent_segur = maximum_filter(
        np.nan_to_num(pendent_graus, nan=90.0),
        size=LANDER_FOOTPRINT_SIZE,
    )

    capa = np.clip(1.0 - (pendent_segur / llindar), 0.0, 1.0).astype("float32")
    capa[nans_grans] = 0.0
    capa[pendent_segur >= llindar] = 0.0

    return pendent_graus.astype("float32"), pendent_segur.astype("float32"), capa


# ---------------------------------------------------------------------------
# Exportació i validació
# ---------------------------------------------------------------------------

def save_geotiff(
    path: Path,
    data: np.ndarray,
    transform: Affine,
    crs: CRS,
    nodata: float | None = None,
) -> None:
    profile = {
        "driver": "GTiff",
        "height": data.shape[0],
        "width": data.shape[1],
        "count": 1,
        "dtype": data.dtype,
        "crs": crs,
        "transform": transform,
        "compress": "deflate",
    }
    if nodata is not None:
        profile["nodata"] = nodata
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(np.nan_to_num(data, nan=nodata if nodata is not None else 0.0), 1)


def export_results(
    outdir: Path,
    dem_net: np.ndarray,
    capa: np.ndarray,
    pendent_segur: np.ndarray,
    transform: Affine,
    crs: CRS,
    res_x_m: float,
    res_y_m: float,
    meta_extra: dict[str, Any],
) -> dict[str, Path]:
    print(f"[5/5] Exportació → {outdir}")
    outdir.mkdir(parents=True, exist_ok=True)

    paths = {
        "dem_npy": outdir / "dem_net.npy",
        "capa_npy": outdir / "capa_pendent_norm.npy",
        "pendent_npy": outdir / "pendent_segur_graus.npy",
        "dem_tif": outdir / "dem_net.tif",
        "capa_tif": outdir / "capa_pendent_norm.tif",
        "meta_json": outdir / "metadades.json",
    }

    np.save(paths["dem_npy"], dem_net)
    np.save(paths["capa_npy"], capa)
    np.save(paths["pendent_npy"], pendent_segur)

    save_geotiff(paths["dem_tif"], dem_net, transform, crs, nodata=-9999.0)
    save_geotiff(paths["capa_tif"], capa, transform, crs, nodata=None)

    h, w = dem_net.shape
    left, bottom, right, top = array_bounds(h, w, transform)
    metadades = {
        "crs_wkt": crs.to_wkt() if crs else None,
        "crs_proj4": crs.to_proj4() if crs else None,
        "transform": list(transform)[:6],
        "width": w,
        "height": h,
        "resolution_m": {"x": res_x_m, "y": res_y_m},
        "bounds_crs_units": {
            "left": left,
            "bottom": bottom,
            "right": right,
            "top": top,
        },
        "llindar_veto_graus": LLINDAR_VETO_GRAUS,
        "lander_footprint_px": LANDER_FOOTPRINT_SIZE,
        "files": {k: str(v.name) for k, v in paths.items() if k != "meta_json"},
        **meta_extra,
    }
    paths["meta_json"].write_text(
        json.dumps(metadades, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    for label, p in paths.items():
        print(f"      ✓ {p.name}  ({label})")
    return paths


def print_validation(
    dem_net: np.ndarray,
    capa: np.ndarray,
    pendent_segur: np.ndarray,
    res_x_m: float,
    res_y_m: float,
) -> None:
    valid = ~np.isnan(dem_net)
    elev_min = float(np.nanmin(dem_net)) if valid.any() else float("nan")
    elev_max = float(np.nanmax(dem_net)) if valid.any() else float("nan")
    viable = (pendent_segur < LLINDAR_VETO_GRAUS) & valid
    pct_viable = 100.0 * viable.sum() / valid.sum() if valid.any() else 0.0

    print("\n======== VALIDACIÓ ========")
    print(f"  Mida matriu          : {dem_net.shape[1]} × {dem_net.shape[0]} px")
    print(f"  Resolució            : {res_x_m:.3f} m × {res_y_m:.3f} m")
    print(f"  Elevació min / max   : {elev_min:.2f} m / {elev_max:.2f} m")
    print(f"  Pendent (segur) max  : {float(np.nanmax(pendent_segur)):.2f} °")
    print(f"  Terreny viable (<{LLINDAR_VETO_GRAUS:.0f}°) : {pct_viable:.2f} %")
    print(f"  Capa seguretat       : [{float(capa.min()):.3f}, {float(capa.max()):.3f}]")
    print("===========================\n")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Pas 1: DEM lunar remot → pendent → capa de seguretat"
    )
    p.add_argument(
        "--url",
        default=URL_LOLA_GLOBAL,
        help="URL del GeoTIFF LOLA (per defecte: mosaic global USGS 118 m)",
    )
    p.add_argument("--lon", type=float, default=DEFAULT_CENTER_LON, help="Longitud centre AOI (°)")
    p.add_argument("--lat", type=float, default=DEFAULT_CENTER_LAT, help="Latitud centre AOI (°)")
    p.add_argument("--window", type=int, default=FINESTRA_PX, help="Mida del retall (px)")
    p.add_argument(
        "--outdir",
        type=Path,
        default=Path("data/pas1"),
        help="Directori de sortida",
    )
    p.add_argument(
        "--target-res",
        type=float,
        default=None,
        help="Resolució objectiu en metres després de reprojecció (opcional)",
    )
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    print("=" * 60)
    print("  Pas 1 — DEM LOLA + pendent + capa de seguretat")
    print("  Lunar Landing Site Navigator · NASA Space Apps")
    print("=" * 60)

    clip = fetch_dem_sps_window(
        args.url,
        args.lon,
        args.lat,
        args.window,
        target_res_m=args.target_res,
    )

    dem_net, nans_grans = clean_dem(clip["dem"], clip["nodata"])

    _pendent_graus, pendent_segur, capa = compute_slope_and_safety(
        dem_net, clip["res_x_m"], clip["res_y_m"], nans_grans
    )

    export_results(
        args.outdir,
        dem_net,
        capa,
        pendent_segur,
        clip["transform"],
        clip["crs"],
        clip["res_x_m"],
        clip["res_y_m"],
        meta_extra={
            "source_url": clip["source_url"],
            "source_size_px": [clip["source_width"], clip["source_height"]],
            "source_res": clip["source_res"],
            "aoi_center_lonlat": [args.lon, args.lat],
            "window_px_requested": args.window,
            "source_crs": clip["source_crs"],
            "reprojected_to_sps": clip["reprojected_to_sps"],
        },
    )

    print_validation(
        dem_net, capa, pendent_segur, clip["res_x_m"], clip["res_y_m"]
    )
    print("Pas 1 completat amb èxit.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
