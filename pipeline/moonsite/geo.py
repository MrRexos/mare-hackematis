"""Geometría: proyección estereográfica polar sur (la de LOLA) y marco local.

Convenciones (las mismas que la web, ver web/src/engine/geometry.js):
- Marco del cuerpo MOON_ME. Latitud planetocéntrica, longitud positiva al este.
- Plano estereográfico: +y apunta a la longitud 0°, +x a la longitud 90°E.
  x = rho·sin(lon), y = rho·cos(lon), rho = 2R·tan(45° + lat/2).
- Marco local ENU con la normal esférica. Acimut en sentido horario desde el
  norte; "norte" = hacia el polo norte (en el polo sur, alejándose del polo).
"""

from __future__ import annotations

import numpy as np

from .config import GRID_HALF_M, GRID_N, GRID_PX_M, MOON_R_M


def latlon_to_xy(lat_deg, lon_deg, R: float = MOON_R_M):
    lat = np.radians(lat_deg)
    lon = np.radians(lon_deg)
    rho = 2 * R * np.tan(np.pi / 4 + lat / 2)
    return rho * np.sin(lon), rho * np.cos(lon)


def xy_to_latlon(x, y, R: float = MOON_R_M):
    rho = np.hypot(x, y)
    lat = -(np.pi / 2 - 2 * np.arctan(rho / (2 * R)))
    lon = np.arctan2(x, y)
    return np.degrees(lat), np.degrees(lon)


def xy_to_unit(x, y, R: float = MOON_R_M):
    """Vector unitario (MOON_ME) del punto del plano (x, y), sin trigonometría."""
    xs, ys = x / (2 * R), y / (2 * R)
    t2 = xs * xs + ys * ys
    k = 1.0 / (1.0 + t2)
    return 2 * ys * k, 2 * xs * k, -(1.0 - t2) * k


def grid_xy():
    """Centros de píxel de la malla de análisis. Fila 0 arriba (+y)."""
    c = -GRID_HALF_M + (np.arange(GRID_N) + 0.5) * GRID_PX_M
    x = np.broadcast_to(c[None, :], (GRID_N, GRID_N))
    y = np.broadcast_to(-c[:, None], (GRID_N, GRID_N))
    return np.ascontiguousarray(x), np.ascontiguousarray(y)


def plane_frame(x, y):
    """Direcciones norte y este *en el plano* para cada punto.

    La proyección es conforme, así que los acimuts del plano coinciden con
    los del terreno. Norte = alejarse del polo; este = longitud creciente.
    """
    rho = np.hypot(x, y)
    safe = np.where(rho > 0, rho, 1.0)
    nx = np.where(rho > 0, x / safe, 0.0)
    ny = np.where(rho > 0, y / safe, 1.0)
    return (nx, ny), (ny, -nx)
