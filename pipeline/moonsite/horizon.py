"""Horizonte del terreno para cada píxel de la malla (la parte pesada).

Desde el centro de cada píxel, a OBSERVER_HEIGHT_M sobre el terreno, se lanza
un rayo en cada una de HORIZON_BINS direcciones sobre el DEM LOLA de 240 m y
se guarda la mayor elevación angular encontrada. La elevación se calcula con
vectores 3D exactos sobre la esfera lunar (incluye la curvatura).

Se vectoriza sobre todos los píxeles a la vez: un bucle por dirección y por
distancia. Con 400×400 píxeles, 72 direcciones y ~210 distancias tarda unos
minutos en un portátil.

Salida: Uint8 (N*N, HORIZON_BINS), píxel a píxel (fila 0 arriba), con
grados = q * HORIZON_Q_SCALE_DEG + HORIZON_Q_OFFSET_DEG.
La dirección k está centrada en el acimut k * 360/HORIZON_BINS (0 = norte).
"""

from __future__ import annotations

import time

import numpy as np

from .config import (HORIZON_BINS, HORIZON_MAX_M, HORIZON_MIN_M, HORIZON_Q_OFFSET_DEG, HORIZON_Q_SCALE_DEG,
                     MOON_R_M, OBSERVER_HEIGHT_M)
from .geo import grid_xy, plane_frame, xy_to_unit
from .pds import PolarRaster


def distances() -> np.ndarray:
    """Pasos del rayo: cada 240 m cerca, luego crecen un 2 % por paso."""
    d = [HORIZON_MIN_M]
    while d[-1] < HORIZON_MAX_M:
        d.append(d[-1] + max(240.0, 0.02 * d[-1]))
    return np.array(d)


def compute(dem: PolarRaster, x=None, y=None, bins: int = HORIZON_BINS, log=print, pole: str = "south") -> np.ndarray:
    """Horizonte en grados, forma (puntos, bins). Por defecto, toda la malla.

    `pole` fija el paso del plano a la esfera y dónde queda el norte (acimut 0).
    """
    if x is None:
        gx, gy = grid_xy()
        x, y = gx.ravel(), gy.ravel()
    x = np.asarray(x, float)
    y = np.asarray(y, float)
    h0 = dem.bilinear(x, y).astype(float)
    h0 = np.where(np.isnan(h0), 0.0, h0)
    ux, uy, uz = xy_to_unit(x, y, pole=pole)
    r0 = MOON_R_M + h0 + OBSERVER_HEIGHT_M
    ox, oy, oz = r0 * ux, r0 * uy, r0 * uz
    (nx, ny), (ex, ey) = plane_frame(x, y, pole)
    D = distances()
    out = np.full((x.size, bins), -90.0)
    t0 = time.time()
    for k in range(bins):
        a = np.radians(k * 360.0 / bins)
        dx = nx * np.cos(a) + ex * np.sin(a)
        dy = ny * np.cos(a) + ey * np.sin(a)
        best = np.full(x.size, -np.pi / 2)
        for d in D:
            px = x + d * dx
            py = y + d * dy
            ht = dem.bilinear(px, py)
            tx, ty, tz = xy_to_unit(px, py, pole=pole)
            rt = MOON_R_M + np.where(np.isnan(ht), -1e9, ht)  # sin dato: muy por debajo
            vx, vy, vz = rt * tx - ox, rt * ty - oy, rt * tz - oz
            el = np.arcsin(np.clip((vx * ux + vy * uy + vz * uz) / np.sqrt(vx * vx + vy * vy + vz * vz), -1, 1))
            np.maximum(best, el, out=best)
        out[:, k] = np.degrees(best)
        if log and (k % 8 == 7 or k == bins - 1):
            log(f"   horizonte: {k + 1}/{bins} direcciones ({time.time() - t0:.0f} s)")
    return out


def quantize(deg: np.ndarray) -> np.ndarray:
    q = np.rint((deg - HORIZON_Q_OFFSET_DEG) / HORIZON_Q_SCALE_DEG)
    return np.clip(q, 0, 255).astype(np.uint8)


def dequantize(q: np.ndarray) -> np.ndarray:
    return q.astype(float) * HORIZON_Q_SCALE_DEG + HORIZON_Q_OFFSET_DEG
