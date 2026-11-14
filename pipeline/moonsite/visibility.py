"""Visibilidad del Sol y de la Tierra desde un punto (versión de referencia).

Son las mismas fórmulas que usa la web (web/src/engine/geometry.js); aquí
sirven para validar contra JPL Horizons y contra los mapas de LOLA.
"""

from __future__ import annotations

import numpy as np

from .config import EARTH_RADIUS_KM, MOON_R_M, SUN_RADIUS_KM


def local_frame(lat_deg, lon_deg):
    lat, lon = np.radians(lat_deg), np.radians(lon_deg)
    up = np.array([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)])
    east = np.array([-np.sin(lon), np.cos(lon), 0.0 * lon])
    north = np.array([-np.sin(lat) * np.cos(lon), -np.sin(lat) * np.sin(lon), np.cos(lat)])
    return up, east, north


def az_el(vec_km: np.ndarray, lat_deg: float, lon_deg: float, height_m: float = 0.0):
    """Acimut/elevación (grados) de objetos dados como vectores desde el centro lunar.

    vec_km: (n, 3). Se resta la posición del observador (paralaje incluida).
    """
    up, east, north = local_frame(lat_deg, lon_deg)
    obs = up * (MOON_R_M + height_m) / 1000.0
    d = vec_km - obs
    d = d / np.linalg.norm(d, axis=1, keepdims=True)
    el = np.degrees(np.arcsin(d @ up))
    az = np.degrees(np.arctan2(d @ east, d @ north)) % 360.0
    return az, el


def horizon_at(hor_deg: np.ndarray, az_deg):
    """Interpola el perfil de horizonte (bins centrados en k·360/bins)."""
    bins = hor_deg.shape[-1]
    f = (np.asarray(az_deg) % 360.0) / (360.0 / bins)
    k0 = np.floor(f).astype(int) % bins
    k1 = (k0 + 1) % bins
    w = f - np.floor(f)
    return hor_deg[..., k0] * (1 - w) + hor_deg[..., k1] * w


def sun_disk_fraction(el_deg, hor_deg, dist_km):
    """Fracción del disco solar por encima del horizonte (corte horizontal)."""
    r = np.degrees(np.arcsin(SUN_RADIUS_KM / dist_km))
    h = np.clip((el_deg - hor_deg) / r, -1.0, 1.0)
    return 1.0 - (np.arccos(h) - h * np.sqrt(1.0 - h * h)) / np.pi


def earth_angular_radius_deg(dist_km):
    return np.degrees(np.arcsin(EARTH_RADIUS_KM / dist_km))
