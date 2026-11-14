#!/usr/bin/env python3
"""
Pas 1 / T1 — Pendent i seguretat del pendent (contracte v0.2)
=============================================================
Genera, sobre la malla oficial **G1K** (10 916 × 5 458):

1. ``terrain.slope``     — **pendent** físic en **graus** (Float32)
2. ``suitability.slope`` — **seguretat del pendent** **0–100** (UInt8)

Fórmula de seguretat (contracte §6)::

    suitability = 100 * max(0, 1 - slope_deg / 15)

Objecte util::

    from scripts.pendent_seguretat import compute_pendent_layers, PendentLayers
    result = compute_pendent_layers()  # sempre llegeix malles ja processades
    pendent = result.slope_deg         # float32, graus
    seguretat = result.suitability     # float32 0–100 (també result.safety)

El pendent lunar **no es recalcula mai** des de LOLA en l’API pública
(``compute_pendent_layers`` / ``load_pendent_layers``). Calen els binaris G1K
(fora de git, contracte §3.3). Només ``--regenerate-from-lola`` (CLI) torna a
generar-los (lent, ~DEM remot).

CLI::

    python3 scripts/pendent_seguretat.py                 # només llegeix
    python3 scripts/pendent_seguretat.py --regenerate-from-lola  # excepció
"""

from __future__ import annotations

import argparse
import hashlib
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
# Contracte v0.2 — malla G1K
# ---------------------------------------------------------------------------

URL_LOLA_GLOBAL = (
    "https://planetarymaps.usgs.gov/mosaic/"
    "Lunar_LRO_LOLA_Global_LDEM_118m_Mar2014.tif"
)

MOON_RADIUS_M = 1_737_400.0
GRID_ID = "G1K"
GRID_COLS = 10916
GRID_ROWS = 5458
# Δ = 360°/10916 = 180°/5458
GRID_STEP_DEG = 360.0 / GRID_COLS

LLINDAR_VETO_GRAUS = 15.0
SAFETY_MAX = 100.0
MEDIAN_SIZE = 3
BASELINE_M = 1000.0  # ~1 km (params.baselineM del contracte T1)

CRS_MOON_EQC = CRS.from_proj4(
    f"+proj=eqc +lat_0=0 +lon_0=0 +lat_ts=0 +x_0=0 +y_0=0 "
    f"+R={MOON_RADIUS_M} +units=m +no_defs +type=crs"
)


# ---------------------------------------------------------------------------
# Objecte util
# ---------------------------------------------------------------------------

@dataclass
class PendentLayers:
    """
    Resultat del Pas 1 / T1.

    Attributes
    ----------
    slope_deg : np.ndarray
        Pendent físic en graus (capa ``terrain.slope``).
    suitability : np.ndarray
        Seguretat 0–100 (capa ``suitability.slope``). Alias: ``.safety``.
    """

    slope_deg: np.ndarray
    suitability: np.ndarray
    transform: Affine
    crs: str
    resolution_m: float
    veto_deg: float = LLINDAR_VETO_GRAUS
    grid_id: str = GRID_ID
    source_url: str = URL_LOLA_GLOBAL
    extras: dict[str, Any] = field(default_factory=dict)

    @property
    def safety(self) -> np.ndarray:
        """Alias de ``suitability`` (0–100) per al Pas 2."""
        return self.suitability

    @property
    def shape(self) -> tuple[int, int]:
        return tuple(self.slope_deg.shape)  # type: ignore[return-value]

    @property
    def height(self) -> int:
        return int(self.slope_deg.shape[0])

    @property
    def width(self) -> int:
        return int(self.slope_deg.shape[1])

    def as_array(self) -> np.ndarray:
        """Per compatibilitat: retorna la matriu de seguretat 0–100."""
        return self.suitability

    def __array__(self, dtype=None):
        arr = self.suitability
        return arr if dtype is None else arr.astype(dtype, copy=False)


# Alias històric
TerrainLayers = PendentLayers  # alias compat
TerrainSafetyMatrix = PendentLayers


# ---------------------------------------------------------------------------
# Graella G1K
# ---------------------------------------------------------------------------

def g1k_grid() -> tuple[int, int, float, float, Affine]:
    """(width, height, res_x_m, res_y_m, transform) en CRS eqc lunar (metres)."""
    width, height = GRID_COLS, GRID_ROWS
    left = -np.pi * MOON_RADIUS_M
    right = np.pi * MOON_RADIUS_M
    top = 0.5 * np.pi * MOON_RADIUS_M
    bottom = -0.5 * np.pi * MOON_RADIUS_M
    res_x = (right - left) / width
    res_y = (top - bottom) / height
    transform = from_origin(left, top, res_x, res_y)
    return width, height, res_x, res_y, transform


def lonlat_of_cell(row: int, col: int) -> tuple[float, float]:
    """Centre (lon, lat) ° d'una cel·la G1K (contracte §2)."""
    lon = -180.0 + (col + 0.5) * GRID_STEP_DEG
    lat = 90.0 - (row + 0.5) * GRID_STEP_DEG
    return lon, lat


def open_remote(url: str):
    if not url.startswith("/vsi"):
        url = f"/vsicurl/{url}"
    return rasterio.open(url)


def warp_g1k_dem(url: str = URL_LOLA_GLOBAL) -> tuple[np.ndarray, Affine, float, float]:
    width, height, res_x, res_y, dst_transform = g1k_grid()
    print(f"[1/4] Graella {GRID_ID}: {width} × {height} px")
    print(f"      Pas = {GRID_STEP_DEG:.6f}° ≈ {res_x:.2f} m a l'equador")
    print(f"      Cobertura: Lluna sencera (−180…+180°, −90…+90°)")

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
            dst_crs=src.crs,
            dst_nodata=np.nan,
            resampling=Resampling.average,
        )
        n_valid = int(np.isfinite(dem).sum())
        print(
            f"      Píxels vàlids : {n_valid}/{dem.size} "
            f"({100.0 * n_valid / dem.size:.1f} %)"
        )
        print(
            f"      Elevació     : {float(np.nanmin(dem)):.1f} … "
            f"{float(np.nanmax(dem)):.1f} m"
        )
    return dem, dst_transform, res_x, res_y


def clean_dem(dem: np.ndarray) -> np.ndarray:
    print("[3/4] Neteja (mediana 3×3)…")
    nans = ~np.isfinite(dem)
    out = median_filter(np.nan_to_num(dem, nan=0.0), size=MEDIAN_SIZE).astype("float32")
    out[nans] = np.nan
    return out


def compute_slope_and_suitability(
    dem: np.ndarray,
    transform: Affine,
    res_x: float,
    res_y: float,
    veto_deg: float = LLINDAR_VETO_GRAUS,
) -> tuple[np.ndarray, np.ndarray]:
    """Retorna (slope_deg, suitability_0_100)."""
    print("[4/4] Pendent (°) + suitability [0, 100]…")
    h, _w = dem.shape
    rows = np.arange(h, dtype="float64")
    northings = transform.f + (rows + 0.5) * transform.e
    lats = northings / MOON_RADIUS_M
    cos_lat = np.clip(np.cos(lats), 1e-6, None)

    dz_dy, dz_dx_map = np.gradient(dem, res_y, res_x)
    dz_dx = dz_dx_map / cos_lat[:, np.newaxis]
    slope = np.degrees(np.arctan(np.sqrt(dz_dx**2 + dz_dy**2))).astype("float32")
    slope[~np.isfinite(dem)] = np.nan

    # suitability = 100 * max(0, 1 - slope/15)  (contracte §6)
    slope_for_score = np.nan_to_num(slope, nan=90.0)
    suitability = np.clip(
        SAFETY_MAX * (1.0 - (slope_for_score / veto_deg)),
        0.0,
        SAFETY_MAX,
    ).astype("float32")
    suitability[~np.isfinite(dem)] = 0.0
    suitability[slope_for_score >= veto_deg] = 0.0

    valid = np.isfinite(slope)
    pct = 100.0 * ((slope < veto_deg) & valid).sum() / max(1, int(valid.sum()))
    print(f"      slope max    : {float(np.nanmax(slope)):.2f} °")
    print(f"      viable (<{veto_deg:.0f}°): {pct:.2f} %")
    print(
        f"      suitability  : [{float(suitability.min()):.0f}, "
        f"{float(suitability.max()):.0f}]"
    )
    return slope, suitability


def _g1k_paths(layers_root: Path = Path("layers")) -> tuple[Path, Path]:
    root = Path(layers_root)
    return (
        root / "terrain.slope" / "G1K" / "static.f32",
        root / "suitability.slope" / "G1K" / "static.u8",
    )


def _expected_nbytes(dtype: str) -> int:
    item = {"float32": 4, "uint8": 1}[dtype]
    return GRID_COLS * GRID_ROWS * item


def g1k_binaries_ready(layers_root: Path = Path("layers")) -> bool:
    """True si les malles G1K de pendent/seguretat ja són al disc amb la mida correcta."""
    slope_p, suit_p = _g1k_paths(layers_root)
    return (
        slope_p.is_file()
        and slope_p.stat().st_size == _expected_nbytes("float32")
        and suit_p.is_file()
        and suit_p.stat().st_size == _expected_nbytes("uint8")
    )


def load_pendent_layers(
    layers_root: Path = Path("layers"),
    npy_dir: Path | None = Path("data/pendent_g1k"),
    veto_deg: float = LLINDAR_VETO_GRAUS,
) -> PendentLayers:
    """
    Carrega pendent + seguretat **sense recalcular**.

    Ordre de preferència:
      1. ``layers/terrain.slope/G1K/static.f32`` + ``suitability.slope/G1K/static.u8``
      2. ``data/pendent_g1k/pendent_deg.npy`` + ``seguretat_pendent.npy``
    """
    layers_root = Path(layers_root)
    slope_p, suit_p = _g1k_paths(layers_root)
    _, _, res_x, res_y, transform = g1k_grid()

    if g1k_binaries_ready(layers_root):
        print(f"Carregant malles G1K des de {layers_root} (sense recalcular)…")
        slope = np.fromfile(slope_p, dtype="<f4").reshape(GRID_ROWS, GRID_COLS)
        suit_u8 = np.fromfile(suit_p, dtype="uint8").reshape(GRID_ROWS, GRID_COLS)
        suitability = suit_u8.astype("float32")
        source = f"file:{slope_p}"
    else:
        if npy_dir is None:
            raise FileNotFoundError(
                f"Falten binaris G1K ({slope_p}, {suit_p}). "
                "Posa els binaris G1K o regenera un cop: "
                "python3 scripts/pendent_seguretat.py --regenerate-from-lola"
            )
        npy_dir = Path(npy_dir)
        pendent_npy = npy_dir / "pendent_deg.npy"
        seg_npy = npy_dir / "seguretat_pendent.npy"
        # Compat amb noms antics
        if not pendent_npy.is_file() and (npy_dir / "slope_deg.npy").is_file():
            pendent_npy = npy_dir / "slope_deg.npy"
        if not seg_npy.is_file() and (npy_dir / "safety.npy").is_file():
            seg_npy = npy_dir / "safety.npy"
        if not (pendent_npy.is_file() and seg_npy.is_file()):
            raise FileNotFoundError(
                f"Falten malles a {layers_root} i a {npy_dir}. "
                "Regenera un cop: python3 scripts/pendent_seguretat.py --regenerate-from-lola"
            )
        print(f"Carregant .npy de treball des de {npy_dir} (sense recalcular)…")
        slope = np.load(pendent_npy).astype("float32", copy=False)
        suitability = np.load(seg_npy).astype("float32", copy=False)
        if suitability.max() <= 1.0 + 1e-6:
            # safety antiga 0–1 → 0–100
            suitability = (suitability * SAFETY_MAX).astype("float32")
        if slope.shape != (GRID_ROWS, GRID_COLS):
            raise ValueError(f"Forma pendent {slope.shape} ≠ G1K {(GRID_ROWS, GRID_COLS)}")
        source = f"file:{pendent_npy}"

    return PendentLayers(
        slope_deg=slope,
        suitability=suitability,
        transform=transform,
        crs=str(CRS_MOON_EQC),
        resolution_m=float(res_x),
        veto_deg=veto_deg,
        source_url=source,
        extras={
            "res_x_m": res_x,
            "res_y_m": res_y,
            "baseline_m": BASELINE_M,
            "function": f"{SAFETY_MAX:.0f} * max(0, 1 - slope_deg / {veto_deg:g})",
            "loaded_from_cache": True,
        },
    )


def _recompute_pendent_layers_from_lola(
    url: str = URL_LOLA_GLOBAL,
    veto_deg: float = LLINDAR_VETO_GRAUS,
) -> PendentLayers:
    """
    Intern / CLI ``--regenerate-from-lola`` només.

    No usar des de codi d’aplicació: el pendent no canvia i les malles
    ja processades s’han de llegir amb ``compute_pendent_layers``.
    """
    print("=" * 60)
    print("  T1 / REGENERATE — terrain.slope + suitability.slope des de LOLA")
    print(f"  Malla {GRID_ID}: {GRID_COLS}×{GRID_ROWS} (contracte v0.2)")
    print("=" * 60)

    dem, transform, res_x, res_y = warp_g1k_dem(url)
    dem_net = clean_dem(dem)
    del dem
    slope, suitability = compute_slope_and_suitability(
        dem_net, transform, res_x, res_y, veto_deg=veto_deg
    )
    del dem_net

    result = PendentLayers(
        slope_deg=slope,
        suitability=suitability,
        transform=transform,
        crs=str(CRS_MOON_EQC),
        resolution_m=float(res_x),
        veto_deg=veto_deg,
        source_url=url,
        extras={
            "res_x_m": res_x,
            "res_y_m": res_y,
            "baseline_m": BASELINE_M,
            "function": f"{SAFETY_MAX:.0f} * max(0, 1 - slope_deg / {veto_deg:g})",
            "loaded_from_cache": False,
        },
    )
    print("Regeneració T1 completada.")
    return result


def compute_pendent_layers(
    layers_root: Path = Path("layers"),
    npy_dir: Path | None = Path("data/pendent_g1k"),
    veto_deg: float = LLINDAR_VETO_GRAUS,
    **_ignored: Any,
) -> PendentLayers:
    """
    API pública T1: retorna pendent + seguretat **sempre** des de malles ja processades.

    No descarrega LOLA ni recalcula el pendent. Si falten els binaris, aixeca
    ``FileNotFoundError`` (posa’ls a ``layers/.../G1K/`` o regenera amb la CLI
    ``--regenerate-from-lola`` una sola vegada).
    """
    # Compat: crides antigues passaven url=...; s’ignoren (mai LOLA aquí).
    _ignored.pop("url", None)
    try:
        return load_pendent_layers(
            layers_root=layers_root, npy_dir=npy_dir, veto_deg=veto_deg
        )
    except FileNotFoundError:
        # Prova carpeta legacy una vegada
        try:
            return load_pendent_layers(
                layers_root=layers_root,
                npy_dir=Path("data/pas1_global"),
                veto_deg=veto_deg,
            )
        except FileNotFoundError as e:
            raise FileNotFoundError(
                f"{e}\n"
                "El pendent no es recalcula des de LOLA en runtime. "
                "Copia les malles G1K o executa un cop: "
                "python3 scripts/pendent_seguretat.py --regenerate-from-lola"
            ) from e


# Alias (noms antics + API) — tots llegeixen cache, mai LOLA
compute_terrain_layers = compute_pendent_layers
compute_nearside_terrain_safety = compute_pendent_layers
compute_global_terrain_safety = compute_pendent_layers


# ---------------------------------------------------------------------------
# Exportació contracte (layer.json + binaris)
# ---------------------------------------------------------------------------

def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _write_f32(path: Path, arr: np.ndarray) -> tuple[float, float, str]:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = arr.astype("<f4", copy=False)
    data.tofile(path)
    finite = data[np.isfinite(data)]
    amin = float(finite.min()) if finite.size else float("nan")
    amax = float(finite.max()) if finite.size else float("nan")
    return amin, amax, _sha256(path)


def _write_u8_score(path: Path, score_0_100: np.ndarray) -> tuple[float, float, str]:
    """UInt8 0–100; nodata = 255 on NaN a la font (aquí ja és 0 als forats)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    u8 = np.clip(np.rint(score_0_100), 0, 100).astype("uint8")
    u8.tofile(path)
    return float(u8.min()), float(u8.max()), _sha256(path)


def export_contract_layers(
    result: PendentLayers,
    layers_root: Path = Path("layers"),
    also_npy_dir: Path | None = Path("data/pendent_g1k"),
) -> dict[str, Path]:
    """
    Escriu:
      layers/terrain.slope/G1K/static.f32 + layer.json
      layers/suitability.slope/G1K/static.u8 + layer.json
    i opcionalment .npy de treball a ``also_npy_dir``.
    """
    layers_root = Path(layers_root)
    out: dict[str, Path] = {}

    # --- terrain.slope (fusiona amb layer.json polar existent si hi és) ---
    slope_dir = layers_root / "terrain.slope"
    slope_bin = slope_dir / "G1K" / "static.f32"
    smin, smax, ssha = _write_f32(slope_bin, result.slope_deg)
    g1k_file = {
        "grid": "G1K",
        "period": "static",
        "path": "G1K/static.f32",
        "dtype": "float32",
        "sha256": ssha,
        "min": smin,
        "max": smax,
    }
    slope_json = slope_dir / "layer.json"
    if slope_json.is_file():
        slope_meta = json.loads(slope_json.read_text(encoding="utf-8"))
        slope_meta["version"] = "0.2.0"
        files = [f for f in slope_meta.get("files", []) if f.get("grid") != "G1K"]
        files.append(g1k_file)
        slope_meta["files"] = files
        # Ampia method/params sense esborrar la part polar
        slope_meta.setdefault("params", {})["baselineM_G1K"] = BASELINE_M
    else:
        slope_meta = {
            "id": "terrain.slope",
            "version": "0.2.0",
            "title": "Pendent (slope)",
            "description": (
                "Terrain slope in degrees relative to the local horizontal, "
                "derived from LOLA LDEM resampled to G1K (~1 km baseline)."
            ),
            "units": "deg",
            "validRange": [0, 90],
            "kind": "static",
            "owner": "Jan / Equipo Global (T1)",
            "fidelity": "computed",
            "method": (
                "LOLA Global LDEM (USGS mosaic) area-average resampled to G1K; "
                "slope via np.gradient with cos(lat) correction on equirectangular metres; "
                "3×3 median pre-filter."
            ),
            "params": {"baselineM": BASELINE_M},
            "sources": [
                {
                    "name": "LOLA Global LDEM 118m (USGS Planetary Maps)",
                    "url": URL_LOLA_GLOBAL,
                    "citation": "Smith et al. (2010), LOLA GDR, NASA PDS / USGS",
                }
            ],
            "files": [g1k_file],
        }
    slope_json.write_text(json.dumps(slope_meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    out["terrain.slope.json"] = slope_json
    out["terrain.slope.bin"] = slope_bin

    # --- suitability.slope ---
    suit_dir = layers_root / "suitability.slope"
    suit_bin = suit_dir / "G1K" / "static.u8"
    umin, umax, usha = _write_u8_score(suit_bin, result.suitability)
    suit_meta = {
        "id": "suitability.slope",
        "version": "0.2.0",
        "title": "Seguretat del pendent (0–100)",
        "description": (
            "Derived 0–100 score from terrain.slope. "
            "Optional companion layer (contract §6); official scoring still uses degrees."
        ),
        "units": "score",
        "validRange": [0, 100],
        "kind": "static",
        "owner": "Jan / Equipo Global (T1)",
        "fidelity": "computed",
        "method": (
            "Derived from terrain.slope on the same G1K grid. "
            f"function: {result.extras.get('function', '100 * max(0, 1 - slope_deg / 15)')}"
        ),
        "params": {
            "derivedFrom": "terrain.slope",
            "function": result.extras.get(
                "function", f"{SAFETY_MAX:.0f} * max(0, 1 - slope_deg / {LLINDAR_VETO_GRAUS:g})"
            ),
            "vetoDeg": result.veto_deg,
        },
        "sources": [
            {
                "name": "Derived from terrain.slope",
                "url": URL_LOLA_GLOBAL,
                "citation": "Contract v0.2 §6 optional suitability layer",
            }
        ],
        "files": [
            {
                "grid": "G1K",
                "period": "static",
                "path": "G1K/static.u8",
                "dtype": "uint8",
                "scale": 1,
                "offset": 0,
                "nodata": 255,
                "sha256": usha,
                "min": umin,
                "max": umax,
            }
        ],
    }
    suit_json = suit_dir / "layer.json"
    suit_json.write_text(json.dumps(suit_meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    out["suitability.slope.json"] = suit_json
    out["suitability.slope.bin"] = suit_bin

    if also_npy_dir is not None:
        also_npy_dir = Path(also_npy_dir)
        also_npy_dir.mkdir(parents=True, exist_ok=True)
        np.save(also_npy_dir / "pendent_deg.npy", result.slope_deg)
        np.save(also_npy_dir / "seguretat_pendent.npy", result.suitability)
        meta = {
            "grid": GRID_ID,
            "shape": [result.height, result.width],
            "resolution_m": result.resolution_m,
            "transform": list(result.transform)[:6],
            "crs": result.crs,
            "veto_deg": result.veto_deg,
            "layers": ["terrain.slope", "suitability.slope"],
        }
        (also_npy_dir / "metadades.json").write_text(
            json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        out["npy_dir"] = also_npy_dir

    print("Export contracte:")
    for k, p in out.items():
        print(f"  ✓ {p} ({k})")
    return out


def update_catalog(layers_root: Path = Path("layers")) -> None:
    catalog_path = layers_root / "catalog.json"
    if catalog_path.is_file():
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    else:
        catalog = {"contractVersion": "0.2", "layers": []}
    catalog["contractVersion"] = "0.2"
    layers = list(catalog.get("layers", []))
    for lid in ("terrain.slope", "suitability.slope"):
        if lid not in layers:
            layers.append(lid)
    catalog["layers"] = layers
    catalog_path.write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")
    print(f"  ✓ {catalog_path}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=(
            "T1/Pendent: llegeix malles G1K ja processades (mai recalcula el pendent "
            "en ús normal). El pendent lunar no canvia."
        )
    )
    p.add_argument("--url", default=URL_LOLA_GLOBAL)
    p.add_argument("--veto", type=float, default=LLINDAR_VETO_GRAUS)
    p.add_argument("--outdir", type=Path, default=Path("data/pendent_g1k"), help="npy de treball (pendent + seguretat)")
    p.add_argument("--layers-root", type=Path, default=Path("layers"))
    p.add_argument(
        "--regenerate-from-lola",
        "--force-recompute",  # alias antic
        dest="regenerate_from_lola",
        action="store_true",
        help="EXCEPCIÓ: regenera des de LOLA (lent). No usar en runtime normal.",
    )
    p.add_argument(
        "--export-layers",
        action="store_true",
        default=True,
        help="Escriu layers/ després d’una regeneració (defecte: sí)",
    )
    p.add_argument("--no-export-layers", action="store_true")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    if args.regenerate_from_lola:
        result = _recompute_pendent_layers_from_lola(url=args.url, veto_deg=args.veto)
        do_export = args.export_layers and not args.no_export_layers
        if do_export:
            export_contract_layers(
                result, layers_root=args.layers_root, also_npy_dir=args.outdir
            )
            update_catalog(args.layers_root)
        else:
            args.outdir.mkdir(parents=True, exist_ok=True)
            np.save(args.outdir / "pendent_deg.npy", result.slope_deg)
            np.save(args.outdir / "seguretat_pendent.npy", result.suitability)
    else:
        try:
            result = compute_pendent_layers(
                layers_root=args.layers_root,
                npy_dir=args.outdir,
                veto_deg=args.veto,
            )
        except FileNotFoundError as e:
            print(str(e), file=sys.stderr)
            return 1
        print("Malles llegides des de disc — sense LOLA ni recalcul de pendent.")
        args.outdir.mkdir(parents=True, exist_ok=True)
        if not (args.outdir / "pendent_deg.npy").is_file():
            np.save(args.outdir / "pendent_deg.npy", result.slope_deg)
            np.save(args.outdir / "seguretat_pendent.npy", result.suitability)
            print(f"  ✓ còpia de treball a {args.outdir}")

    print(
        f"\nObjecte PendentLayers  shape={result.shape}\n"
        f"  slope_deg     [{np.nanmin(result.slope_deg):.2f}, {np.nanmax(result.slope_deg):.2f}] °\n"
        f"  suitability   [{result.suitability.min():.0f}, {result.suitability.max():.0f}]\n"
        f"  cache         {bool(result.extras.get('loaded_from_cache'))}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
