"""Capas fijas sobre la malla de análisis (no dependen de las fechas).

Cada capa se guarda como Float32 little-endian, fila a fila (fila 0 arriba),
NaN = sin dato. El manifiesto (build.py) describe unidades y fuente.
"""

from __future__ import annotations

import numpy as np
from PIL import Image
from scipy import ndimage

from .config import GRID_HALF_M, GRID_PX_M, LOLA, LOLA_EXTRA
from .geo import grid_xy
from .pds import PolarRaster


def _open(key: str) -> PolarRaster | None:
    f = LOLA.get(key) or LOLA_EXTRA.get(key)
    if not f.dest.exists():
        return None
    return PolarRaster.open(f.dest, f.url)


def _subsamples(sub: int):
    """Puntos regularmente repartidos dentro de cada píxel: (N, N, sub*sub)."""
    x, y = grid_xy()
    o = (np.arange(sub) + 0.5) / sub - 0.5
    dx, dy = np.meshgrid(o * GRID_PX_M, o * GRID_PX_M)
    return x[..., None] + dx.ravel(), y[..., None] + dy.ravel()


def block_stat(r: PolarRaster, sub: int, stat: str = "mean") -> np.ndarray:
    xs, ys = _subsamples(sub)
    v = r.nearest(xs, ys)
    with np.errstate(all="ignore"):
        if stat == "median":
            return np.nanmedian(v, axis=-1).astype(np.float32)
        return np.nanmean(v, axis=-1).astype(np.float32)


def elevation(dem: PolarRaster) -> np.ndarray:
    x, y = grid_xy()
    return dem.bilinear(x, y).astype(np.float32)


def psr_distance_km(psr: PolarRaster) -> np.ndarray:
    """Distancia (km) del centro de cada píxel a la sombra permanente más cercana.

    Se calcula sobre la propia malla de 120 m del producto LOLA, recortada a la
    zona de la malla + 60 km de margen (para no perder sombras justo al lado).
    """
    margin = 60_000.0
    half = GRID_HALF_M + margin
    i0, j0 = psr.index(-half, half)
    i1, j1 = psr.index(half, -half)
    i0, j0 = int(np.floor(i0)), int(np.floor(j0))
    i1, j1 = int(np.ceil(i1)), int(np.ceil(j1))
    crop = psr.data[i0:i1 + 1, j0:j1 + 1]
    shadow = crop > 0.5
    dist_px = ndimage.distance_transform_edt(~shadow)
    x, y = grid_xy()
    ii, jj = psr.index(x, y)
    ii = np.clip(np.rint(ii).astype(int) - i0, 0, dist_px.shape[0] - 1)
    jj = np.clip(np.rint(jj).astype(int) - j0, 0, dist_px.shape[1] - 1)
    return (dist_px[ii, jj] * psr.scale / 1000.0).astype(np.float32)


def hillshade_png(dem: PolarRaster, path, px_m: float = 250.0) -> dict:
    """Relieve sombreado para el mapa base (ayuda visual, no es luz solar)."""
    n = int(round(2 * GRID_HALF_M / px_m))
    c = -GRID_HALF_M + (np.arange(n) + 0.5) * px_m
    x, y = np.meshgrid(c, -c)
    z = dem.bilinear(x, y).astype(np.float64)
    z = np.where(np.isnan(z), np.nanmean(z), z)
    gy, gx = np.gradient(z, px_m)          # gy: hacia abajo de la imagen (−y)
    exag = 2.0
    slope = np.arctan(exag * np.hypot(gx, gy))
    aspect = np.arctan2(gx, gy)            # en el plano de la imagen
    az, alt = np.radians(315.0), np.radians(35.0)
    shade = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    img = np.clip(shade, 0, 1)
    img = (img ** 0.9 * 235 + 10).astype(np.uint8)
    Image.fromarray(img, mode="L").save(path, optimize=True)
    return {"file": path.name, "size": n, "pxM": px_m, "exaggeration": exag,
            "light": {"azimuthDeg": 315, "altitudeDeg": 35},
            "note": "Relief shading is a visual aid, not sunlight."}


def build_all() -> dict[str, np.ndarray]:
    """Devuelve las capas calculadas (las que tengan su producto descargado)."""
    out: dict[str, np.ndarray] = {}
    dem = _open("ldem")
    if dem is None:
        raise FileNotFoundError("Falta ldem_75s_240m.img: ejecuta `python -m moonsite.fetch`")
    out["elevation"] = elevation(dem)
    if (slope := _open("ldsm")) is not None:
        out["slope"] = block_stat(slope, 4, "median")
    if (psr := _open("lpsr")) is not None:
        out["psrShare"] = block_stat(psr, 8, "mean")
        out["psrDistKm"] = psr_distance_km(psr)
    if (avg := _open("avgsun")) is not None:
        out["avgSun"] = block_stat(avg, 8, "mean")
    if (avg := _open("avgearth")) is not None:
        out["avgEarth"] = block_stat(avg, 8, "mean")
    if (rough := _open("ldrm")) is not None:
        out["roughness"] = block_stat(rough, 4, "median")
    from . import diviner  # producto grande: solo si está descargado
    if (d := diviner.load()) is not None:
        out |= diviner.layers(d)
    return out


def dem_raster() -> PolarRaster:
    dem = _open("ldem")
    if dem is None:
        raise FileNotFoundError("Falta ldem_75s_240m.img")
    return dem
