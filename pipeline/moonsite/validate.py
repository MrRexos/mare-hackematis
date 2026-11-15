"""Validación de los datos que usa la web.

1. JPL Horizons: acimut/elevación del Sol y de la Tierra en varios puntos del
   polo (sur o norte), comparados con nuestro cálculo SPICE (mismas fórmulas que la web).
2. LOLA AVGVISIB: % medio de Sol visible con nuestros horizontes frente al
   mapa independiente del equipo LOLA (Mazarico et al. 2011).
"""

from __future__ import annotations

import re

import numpy as np
import requests
import spiceypy as sp

from .config import ABCORR, EARTH_RADIUS_KM, EPHEM_FRAME
from .ephemeris import load_kernels
from .geo import grid_xy, xy_to_latlon
from .visibility import az_el, horizon_at, sun_disk_fraction

HORIZONS_API = "https://ssd.jpl.nasa.gov/api/horizons.api"

#: Puntos de prueba (lat, lon) dentro de la malla de cada polo.
TEST_POINTS = [
    ("Connecting ridge", -89.45, -137.4),
    ("Malapert Massif", -85.98, -0.26),
    ("Haworth", -86.75, -23.67),
]
TEST_POINTS_BY_POLE = {
    "south": TEST_POINTS,
    # Coordenadas redondas (no son sitios con nombre): junto al polo, y a 86° en dos longitudes.
    "north": [
        ("Near the north pole", 89.45, 137.4),
        ("86°N, near side", 86.0, 0.0),
        ("86°N, 120°W", 86.0, -120.0),
    ],
}


def _horizons(body: str, lat: float, lon: float, start: str, stop: str, step: str) -> tuple[list[str], np.ndarray]:
    params = {
        "format": "json", "COMMAND": f"'{body}'", "OBJ_DATA": "'NO'", "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'", "CENTER": "'coord@301'", "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{lon % 360:.6f},{lat:.6f},0'", "START_TIME": f"'{start}'", "STOP_TIME": f"'{stop}'",
        "STEP_SIZE": f"'{step}'", "QUANTITIES": "'4'", "ANG_FORMAT": "'DEG'", "APPARENT": "'AIRLESS'",
        "CSV_FORMAT": "'YES'", "TIME_DIGITS": "'MINUTES'",
    }
    r = requests.get(HORIZONS_API, params=params, timeout=120)
    r.raise_for_status()
    text = r.json()["result"]
    block = text.split("$$SOE")[1].split("$$EOE")[0]
    times, vals = [], []
    for line in block.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        nums = [p for p in parts[1:] if re.fullmatch(r"[-+]?\d+(\.\d+)?", p)]
        times.append(parts[0])
        vals.append([float(nums[0]), float(nums[1])])
    return times, np.array(vals)


def horizons_check(start="2027-01-01 00:00", stop="2027-01-31 00:00", step="6 h", pole: str = "south") -> dict:
    load_kernels()
    worst = {"sun": 0.0, "earth": 0.0}
    rows = []
    for name, lat, lon in TEST_POINTS_BY_POLE[pole]:
        for key, body, naif in (("sun", "10", "SUN"), ("earth", "399", "EARTH")):
            times, ref = _horizons(body, lat, lon, start, stop, step)
            ets = np.array([sp.str2et(t) for t in times])
            vec, _ = sp.spkpos(naif, ets, EPHEM_FRAME, ABCORR, "MOON")
            az, el = az_el(np.asarray(vec), lat, lon)
            daz = (az - ref[:, 0] + 180) % 360 - 180
            # separación angular aproximada en arcmin
            sep = np.hypot(daz * np.cos(np.radians(el)), el - ref[:, 1]) * 60
            worst[key] = max(worst[key], float(sep.max()))
            rows.append({"site": name, "body": key, "n": len(times), "maxArcmin": float(sep.max())})
    return {"window": [start, stop, step], "maxArcmin": worst, "rows": rows,
            "note": "Airless apparent az/el; Horizons API vs SPICE DE440 MOON_ME (same formulas as the web)."}


def avgvisib_check(horizon_q: np.ndarray, avg_sun: np.ndarray, ephem: np.ndarray, hq_scale: float, hq_off: float,
                   n_points: int = 2000, stride_h: int = 3, seed: int = 1, pole: str = "south") -> dict:
    """Compara el % medio de Sol (nuestros horizontes) con el mapa LOLA."""
    x, y = grid_xy()
    lat, lon = xy_to_latlon(x.ravel(), y.ravel(), pole=pole)
    ok = np.flatnonzero(~np.isnan(avg_sun.ravel()))
    rng = np.random.default_rng(seed)
    idx = rng.choice(ok, size=min(n_points, ok.size), replace=False)
    sun = ephem[::stride_h, 0:3].astype(float)
    dist = np.linalg.norm(sun, axis=1)
    ours = np.empty(idx.size)
    ours_disk = np.empty(idx.size)
    for n, p in enumerate(idx):
        hor = horizon_q[p].astype(float) * hq_scale + hq_off
        az, el = az_el(sun, lat[p], lon[p])
        frac = sun_disk_fraction(el, horizon_at(hor, az), dist)
        # Mismo criterio que LOLA AVGVISIB: % de instantes con CUALQUIER parte del disco visible.
        ours[n] = (frac > 0).mean()
        ours_disk[n] = frac.mean()
    lola = avg_sun.ravel()[idx]
    diff = (ours - lola) * 100
    return {"points": int(idx.size), "criterion": "share of time with any part of the solar disk visible (as LOLA AVGVISIB)",
            "meanAbsDiffPct": float(np.abs(diff).mean()), "biasPct": float(diff.mean()),
            "p90AbsDiffPct": float(np.percentile(np.abs(diff), 90)), "strideHours": stride_h,
            "meanDiskFractionMinusAnyPartPct": float((ours_disk - ours).mean() * 100),
            "note": ("Same criterion as LOLA (any part of the disk). Ours: 2026-2030 (5 years), 1 km grid, 72 azimuths, "
                     "observer 2 m; LOLA AVGVISIB: 18.6-year average at 120 m. Differences include the shorter "
                     "period, the coarser terrain and the observer height.")}


def avgearth_check(horizon_q: np.ndarray, avg_earth: np.ndarray, ephem: np.ndarray, hq_scale: float, hq_off: float,
                   n_points: int = 2000, stride_h: int = 3, seed: int = 2, pole: str = "south") -> dict:
    """Compara el % de tiempo con la Tierra visible (cualquier parte del disco) con LOLA AVGVISIB_EARTH."""
    x, y = grid_xy()
    lat, lon = xy_to_latlon(x.ravel(), y.ravel(), pole=pole)
    ok = np.flatnonzero(~np.isnan(avg_earth.ravel()))
    rng = np.random.default_rng(seed)
    idx = rng.choice(ok, size=min(n_points, ok.size), replace=False)
    earth = ephem[::stride_h, 3:6].astype(float)
    ours = np.empty(idx.size)
    for n, p in enumerate(idx):
        hor = horizon_q[p].astype(float) * hq_scale + hq_off
        az, el = az_el(earth, lat[p], lon[p])
        dist = np.linalg.norm(earth, axis=1)
        r = np.degrees(np.arcsin(EARTH_RADIUS_KM / dist))
        ours[n] = (el + r > horizon_at(hor, az)).mean()
    lola = avg_earth.ravel()[idx]
    diff = (ours - lola) * 100
    return {"points": int(idx.size), "criterion": "share of time with any part of the Earth disk visible (as LOLA)",
            "meanAbsDiffPct": float(np.abs(diff).mean()), "biasPct": float(diff.mean()),
            "p90AbsDiffPct": float(np.percentile(np.abs(diff), 90)), "strideHours": stride_h,
            "note": ("Ours: 2026-2030, 1 km grid, 72 azimuths, observer 2 m; LOLA: 18.6-year average at 120 m. "
                     "The web scores Earth by the disk centre, which is slightly stricter.")}
