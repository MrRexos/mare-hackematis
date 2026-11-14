"""Horizontes de toda la Luna para el cálculo en el navegador (vista "Whole Moon").

El relieve no cambia, así que el horizonte de cada celda se traza una sola vez. Con él,
la web calcula al momento la luz y la Tierra visible para las fechas que elija el
usuario (igual que el polo sur): solo compara, hora a hora, la posición del Sol y de la
Tierra con el horizonte en ese acimut.

Para cada celda de la malla web (0,5°, 720 × 360; fila 0 desde +90°, columna 0 desde
−180°) calcula, en el centro de la celda y a 2 m del suelo:

- global/horizon.u8     elevación del horizonte en 72 acimuts (cada 5°, horario desde el
                        norte), 1 byte: grados = q · 0,25 − 6,5 (de −6,5° a +57,25°;
                        el relieve global tiene paredes de cráter de más de 50°).
- global/elevation.f32  altura LOLA del centro de la celda (m sobre la esfera de 1737,4 km).

Mismo trazado que T3/T4 (earth_global._horizonte): rayos sobre la esfera con curvatura,
de 0,5 a 300 km, sobre LOLA LDEM_64.

Uso (desde pipeline/, tras `python -m moonsite.fetch global`):
    python -m moonsite.horizon_global        # lo llama también moonsite.web_global
"""

from __future__ import annotations

import math
import time

import numpy as np
from numba import njit, prange

from . import config as C
from .earth_global import DEG, H_OBS_KM, NBINS, R_KM, _dem_km, _horizonte, comprobar_orientacion, distancias_km

OUT = C.WEB_DATA / "global"
STEP_DEG = 0.5
COLS, ROWS = 720, 360
#: Codificación en 1 byte (más ancha que la del polo sur: aquí hay horizontes de −6° a +56°).
Q_OFFSET_DEG = -6.5
Q_SCALE_DEG = 0.25


@njit(cache=True, parallel=True)
def _bloque(lat_f, lon_c, raw, k_km, add_km, res, lat_max, lon_west, missing, dist, cd, sd, hor, elev):
    nr, nc = lat_f.size, lon_c.size
    dmax = dist[-1]
    for q in prange(nr * nc):
        r = q // nc
        col = q - r * nc
        la, lo = lat_f[r] * DEG, lon_c[col] * DEG
        cl, sl, co, so = math.cos(la), math.sin(la), math.cos(lo), math.sin(lo)
        ux, uy, uz = cl * co, cl * so, sl
        ex, ey, ez = -so, co, 0.0
        nx, ny, nz = -sl * co, -sl * so, cl
        h0 = _dem_km(raw, k_km, add_km, res, lat_max, lon_west, missing, lat_f[r], lon_c[col])
        if h0 < -100.0:                       # sin dato en LOLA
            elev[r, col] = np.nan
            continue
        elev[r, col] = h0 * 1000.0
        r0 = R_KM + h0 + H_OBS_KM
        for k in range(NBINS):
            hor[r, col, k] = _horizonte(k, ux, uy, uz, nx, ny, nz, ex, ey, ez, r0, cd, sd, dist, dmax,
                                        raw, k_km, add_km, res, lat_max, lon_west, missing)


def centros():
    lat = 90.0 - (np.arange(ROWS) + 0.5) * STEP_DEG
    lon = -180.0 + (np.arange(COLS) + 0.5) * STEP_DEG
    return lat, lon


def calcular(dem, lat, lon):
    """(horizonte en grados [filas, columnas, 72], elevación en m [filas, columnas])."""
    dist = distancias_km()
    miss = dem.missing if dem.missing is not None else -32768
    hor = np.zeros((lat.size, lon.size, NBINS), np.float32)
    elev = np.zeros((lat.size, lon.size), np.float32)
    _bloque(lat, lon, dem.raw, dem.k / 1000.0, dem.add / 1000.0, dem.res, dem.lat_max, dem.lon_west, miss,
            dist, np.cos(dist / R_KM), np.sin(dist / R_KM), hor, elev)
    return hor, elev


def generar(log=print) -> dict | None:
    """Escribe global/horizon.u8 y global/elevation.f32. Devuelve la entrada del manifest."""
    from .pds import CylRaster

    f = C.LOLA_GLOBAL["ldem64"]
    if not f.dest.exists():
        log("   (falta LDEM_64: sin horizontes globales; ejecuta `python -m moonsite.fetch global`)")
        return None
    dem = CylRaster.open(f.dest, f.url)
    comprobar_orientacion(dem)
    lat, lon = centros()
    t0 = time.time()
    hor, elev = calcular(dem, lat, lon)
    q = np.clip(np.rint((hor - Q_OFFSET_DEG) / Q_SCALE_DEG), 0, 255).astype(np.uint8)
    OUT.mkdir(parents=True, exist_ok=True)
    q.tofile(OUT / "horizon.u8")
    elev.astype("<f4").tofile(OUT / "elevation.f32")
    fuera = float(((hor < Q_OFFSET_DEG) | (hor > Q_OFFSET_DEG + 255 * Q_SCALE_DEG)).mean())
    log(f"   horizontes {ROWS} × {COLS} × {NBINS} en {time.time() - t0:.0f} s · "
        f"de {float(hor.min()):.1f}° a {float(hor.max()):.1f}° · {100 * fuera:.3f} % recortado al rango del byte")
    return {
        "horizon": {"file": "global/horizon.u8", "dtype": "uint8", "bins": NBINS,
                    "binCentreDeg": "k * 360 / bins, clockwise from north",
                    "scaleDeg": Q_SCALE_DEG, "offsetDeg": Q_OFFSET_DEG,
                    "observerHeightM": C.OBSERVER_HEIGHT_M, "minDistanceM": C.G1K_HORIZON_MIN_M,
                    "maxDistanceM": C.HORIZON_MAX_M, "source": "Ray-marched over LOLA LDEM_64 (PDS)",
                    "fidelity": "approximate",
                    "note": "One horizon per 0.5° cell, traced at the cell centre: regional screening, not site certification."},
        "elevation": {"file": "global/elevation.f32", "units": "m",
                      "source": "LOLA LDEM_64 (PDS), bilinear at the cell centre"},
    }


if __name__ == "__main__":
    generar()
