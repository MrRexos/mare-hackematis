"""Rugosidad y sombra permanente de toda la Luna para la vista "Whole Moon".

Las dos son propiedades fijas del terreno (no dependen de la fecha) y salen de productos
oficiales de LOLA (NASA PDS), los mismos que usa el polo sur pero en su versión global:

- Rugosidad: LDRM_16 (global, 16 px/grado ≈ 1,9 km). Desviación de la altura respecto a un
  plano local medida con los cinco puntos del láser (decenas de metros). Cada celda de 0,5°
  toma la mediana de sus 8 × 8 muestras.
- Sombra permanente: LPSR_65N_240M y LPSR_65S_240M (Mazarico et al. 2011), mapas binarios de
  240 m de 65° a 90° en los dos polos. Cada celda de 0,5° guarda la FRACCIÓN de su superficie
  en sombra permanente. Por debajo de 65° vale 0: no hay sombra permanente apreciable.

Salida (malla web de 0,5°, 720 × 360, fila 0 desde +90°, columna 0 desde −180°):
    global/rough/static.f32   rugosidad, m
    global/psr/static.f32     fracción de la celda en sombra permanente, 0-1

Uso: lo llama `python -m moonsite.web_global` (tras `python -m moonsite.fetch global`).
"""

from __future__ import annotations

import numpy as np

from . import config as C
from .pds import CylRaster, PolarRaster

ROWS, COLS, STEP = 360, 720, 0.5


def rugosidad() -> np.ndarray | None:
    """Rugosidad (m) por celda de 0,5°: mediana de las muestras de LDRM_16 que caen dentro."""
    f = C.LOLA_GLOBAL["ldrm16"]
    if not f.dest.exists():
        return None
    r = CylRaster.open(f.dest, f.url)
    v = r.raw.astype(np.float32) * np.float32(r.k) + np.float32(r.add)
    v[(r.raw == r.missing) | (r.raw == 32767)] = np.nan
    # LDRM_16 empieza en lon_west (0°): se gira para que la columna 0 empiece en −180°.
    v = np.roll(v, -int(round(((-180.0 - r.lon_west) % 360.0) * r.res)), axis=1)
    b = int(round(r.res * STEP))
    g = v.reshape(ROWS, b, COLS, b).transpose(0, 2, 1, 3).reshape(ROWS, COLS, b * b)
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)       # celdas sin ninguna muestra → NaN
        return np.nanmedian(g, axis=2).astype(np.float32)


def _latlon_polar(q: PolarRaster, norte: bool):
    """Latitud y longitud (grados) de cada píxel de un raster polar estereográfico de LOLA.

    Sur:   x = rho·sin(lon), y =  rho·cos(lon)      Norte: x = rho·sin(lon), y = −rho·cos(lon)
    con rho = 2R·tan(45° − |lat|/2). (+x siempre hacia 90°E.)
    """
    n, m = q.data.shape
    x = (np.arange(m, dtype=np.float64) - q.sample0)[None, :] * q.scale
    y = (q.line0 - np.arange(n, dtype=np.float64))[:, None] * q.scale
    rho = np.hypot(x, y)
    colat = 2.0 * np.degrees(np.arctan(rho / (2.0 * C.MOON_R_M)))
    if norte:
        return 90.0 - colat, np.degrees(np.arctan2(x, -y))
    return colat - 90.0, np.degrees(np.arctan2(x, y))


def sombra_permanente() -> np.ndarray | None:
    """Fracción de cada celda de 0,5° en sombra permanente (0 fuera de 65°-90°)."""
    out = np.zeros((ROWS, COLS), np.float64)
    for clave, norte in (("lpsr65n", True), ("lpsr65s", False)):
        f = C.LOLA_GLOBAL[clave]
        if not f.dest.exists():
            return None
        q = PolarRaster.open(f.dest, f.url)
        lat, lon = _latlon_polar(q, norte)
        ok = ((q.data == 0) | (q.data == 1)) & (np.abs(lat) >= 65.0)      # 0,5 = fuera del mapa
        i = np.clip(((90.0 - lat[ok]) / STEP).astype(np.int64), 0, ROWS - 1)
        j = np.clip(((lon[ok] + 180.0) / STEP).astype(np.int64), 0, COLS - 1)
        k = i * COLS + j
        n = np.bincount(k, minlength=ROWS * COLS).reshape(ROWS, COLS)
        s = np.bincount(k, weights=q.data[ok].astype(np.float64), minlength=ROWS * COLS).reshape(ROWS, COLS)
        con = n > 0
        out[con] = s[con] / n[con]
    return out.astype(np.float32)
