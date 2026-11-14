"""Rugosidad y sombra permanente globales (moonsite.surface_global): geometría de los mapas polares."""
import numpy as np

from moonsite import config as C
from moonsite import surface_global as SG
from moonsite.pds import PolarRaster


def _raster(n=801, escala=1000.0):
    return PolarRaster(np.zeros((n, n), np.float32), escala, (n - 1) / 2, (n - 1) / 2)


def test_latlon_de_los_mapas_polares():
    """Centro = polo; +x = 90°E en los dos polos; +y = 0° en el sur y 180° en el norte (LOLA)."""
    q = _raster()
    c = 400
    for norte, signo in ((True, 1), (False, -1)):
        lat, lon = SG._latlon_polar(q, norte)
        assert abs(lat[c, c] - signo * 90) < 1e-9
        assert abs(lon[c, c + 100] - 90) < 1e-9                       # +x → 90°E
        arriba = lon[c - 100, c]                                      # +y (fila menor)
        assert abs(abs(arriba) - (180 if norte else 0)) < 1e-9
        # 100 km del polo ≈ 3,3° de latitud; la distancia sobre la esfera coincide
        colat = 90 - abs(lat[c, c + 100])
        assert abs(2 * C.MOON_R_M * np.tan(np.radians(colat) / 2) - 100_000) < 1e-3


def test_la_malla_de_05_grados_es_la_de_la_web():
    from moonsite import horizon_global as HG
    assert (SG.ROWS, SG.COLS, SG.STEP) == (HG.ROWS, HG.COLS, HG.STEP_DEG)
