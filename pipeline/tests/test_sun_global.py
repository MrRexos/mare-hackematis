"""Tests de T3 (luz, malla global). Sin descargas: relieve y Sol sintéticos, y comparación
con un cálculo directo (horizonte completo en 72 acimuts, muestra a muestra, sin atajos)."""

import math

import numpy as np

from moonsite import sun_global as S
from moonsite.visibility import az_el, horizon_at, sun_disk_fraction

from test_earth_global import dem_sintetico, horizonte_ref

D_SOL = 1.496e8


def sol_sintetico(dias=30, paso_h=1.0):
    """Sol en MOON_ME: da una vuelta en 29,53 días (hacia el oeste) y oscila ±1,54° en latitud."""
    t = np.arange(0, dias * 24, paso_h) / 24.0
    lon = np.radians(-360.0 * t / 29.53 + 40.0)
    lat = np.radians(1.54 * np.sin(2 * np.pi * t / 346.6 + 1.0))
    u = np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], -1)
    rad = np.full(len(t), math.degrees(math.asin(695_700.0 / D_SOL)))
    return u, rad, np.array([0, len(t) // 2, len(t)], np.int64)


def luz_ref(dem, U, rad, pidx, lat, lon):
    hor, r0 = horizonte_ref(dem, lat, lon)
    az, el = az_el(U * D_SOL, lat, lon, height_m=r0 - 1_737_400.0)
    f = sun_disk_fraction(el, horizon_at(hor, az), D_SOL)
    frac = [f[pidx[p]:pidx[p + 1]].mean() for p in range(len(pidx) - 1)]
    noches = []
    for p in range(len(pidx) - 1):
        racha = peor = 0
        for v in f[pidx[p]:pidx[p + 1]]:
            racha = racha + 1 if v < 0.05 else 0
            peor = max(peor, racha)
        noches.append(peor)
    return np.array(frac), np.array(noches)


def test_luz_coincide_con_referencia():
    dem = dem_sintetico()
    U, rad, pidx = sol_sintetico()
    rng = np.random.default_rng(3)
    lats = np.concatenate([rng.uniform(-89.5, 89.5, 20), rng.uniform(80, 89.8, 10) * rng.choice([-1, 1], 10)])
    lons = rng.uniform(-180, 180, lats.size)
    for la, lo in zip(lats, lons):
        fr, no = S.calcular(dem, U, rad, pidx, np.array([la]), np.array([lo]))
        fr_ref, no_ref = luz_ref(dem, U, rad, pidx, la, lo)
        assert np.allclose(fr[:, 0, 0], fr_ref, atol=2e-3), (la, lo, fr[:, 0, 0], fr_ref)
        assert np.all(np.abs(no[:, 0, 0] - no_ref) <= 1), (la, lo, no[:, 0, 0], no_ref)


def test_ecuador_medio_mes_de_luz():
    """En el ecuador, durante un mes sinódico, el Sol está arriba ~la mitad del tiempo
    (es la misma prueba del validador para periodos largos: 0,40-0,55)."""
    dem = dem_sintetico()
    U, rad, _ = sol_sintetico(dias=29.53 * 2)
    pidx = np.array([0, len(U)], np.int64)
    fr, no = S.calcular(dem, U, rad, pidx, np.array([0.01]), np.array([0.01]))
    assert 0.40 <= fr[0, 0, 0] <= 0.55
    assert 300 <= no[0, 0, 0] <= 380          # una noche lunar ≈ 354 h
