"""Tests de T4 (Tierra visible, malla global). No necesitan descargas: usan un relieve
sintético y una Tierra con libración sintética, y comparan el núcleo rápido (numba,
con atajos) con un cálculo de referencia directo, hora a hora y sin atajos."""

import math

import numpy as np

from moonsite import earth_global as T
from moonsite.pds import CylRaster
from moonsite.visibility import az_el, horizon_at

RES = 4.0  # px/grado: relieve pequeño para que el test sea rápido


def dem_sintetico(seed=1):
    rng = np.random.default_rng(seed)
    n, m = int(180 * RES), int(360 * RES)
    lat = 90 - (np.arange(n) + 0.5) / RES
    lon = (np.arange(m) + 0.5) / RES
    LA, LO = np.meshgrid(np.radians(lat), np.radians(lon), indexing="ij")
    z = np.zeros((n, m))
    for _ in range(40):  # montañas y cráteres de hasta ±4 km
        la0, lo0 = math.asin(rng.uniform(-1, 1)), rng.uniform(0, 2 * math.pi)
        cosd = np.sin(LA) * math.sin(la0) + np.cos(LA) * math.cos(la0) * np.cos(LO - lo0)
        d = np.arccos(np.clip(cosd, -1, 1))
        z += rng.uniform(-4000, 4000) * np.exp(-(d / rng.uniform(0.01, 0.05)) ** 2)
    raw = np.rint(z / 0.5).astype(np.int16)            # como LOLA: 0,5 m por unidad
    return CylRaster(raw, 0.5, 0.0, RES, 90.0, 0.0, None)


def tierra_sintetica(horas=24 * 30):
    t = np.arange(horas) / 24.0
    lon = np.radians(7.9 * np.sin(2 * np.pi * t / 27.55))
    lat = np.radians(6.7 * np.sin(2 * np.pi * t / 27.21))
    d = 384_400 + 21_000 * np.cos(2 * np.pi * t / 27.55)
    E = np.stack([d * np.cos(lat) * np.cos(lon), d * np.cos(lat) * np.sin(lon), d * np.sin(lat)], -1)
    return E, np.array([0, horas // 2, horas], np.int64)


def _dem_ref(dem, lat, lon):
    fi = (dem.lat_max - lat) * dem.res - 0.5
    fj = ((lon - dem.lon_west) % 360.0) * dem.res - 0.5
    n, m = dem.raw.shape
    i0 = np.clip(np.floor(fi).astype(int), 0, n - 2)
    wi = np.clip(fi - i0, 0, 1)
    j0 = np.floor(fj).astype(int) % m
    wj = fj - np.floor(fj)
    j1 = (j0 + 1) % m
    r = dem.raw.astype(float) * dem.k
    return (r[i0, j0] * (1 - wi) * (1 - wj) + r[i0, j1] * (1 - wi) * wj
            + r[i0 + 1, j0] * wi * (1 - wj) + r[i0 + 1, j1] * wi * wj)


def horizonte_ref(dem, lat, lon):
    """72 acimuts, rayos completos hasta 300 km, en metros y sin atajos."""
    R = 1_737_400.0
    up = np.array([math.cos(math.radians(lat)) * math.cos(math.radians(lon)),
                   math.cos(math.radians(lat)) * math.sin(math.radians(lon)), math.sin(math.radians(lat))])
    east = np.array([-math.sin(math.radians(lon)), math.cos(math.radians(lon)), 0.0])
    north = np.cross(up, east)
    r0 = R + float(_dem_ref(dem, np.array([lat]), np.array([lon]))[0]) + 2.0
    d = T.distancias_km() * 1000.0
    out = np.empty(72)
    for k in range(72):
        a = math.radians(k * 5.0)
        t = north * math.cos(a) + east * math.sin(a)
        dl = d / R
        p = np.cos(dl)[:, None] * up + np.sin(dl)[:, None] * t
        la, lo = np.degrees(np.arcsin(p[:, 2])), np.degrees(np.arctan2(p[:, 1], p[:, 0]))
        rt = R + _dem_ref(dem, la, lo)
        v = rt[:, None] * p - r0 * up
        out[k] = np.degrees(np.arcsin((v @ up) / np.linalg.norm(v, axis=1))).max()
    return out, r0


def visibles_ref(dem, E, pidx, lat, lon):
    hor, r0 = horizonte_ref(dem, lat, lon)
    az, el = az_el(E, lat, lon, height_m=r0 - 1_737_400.0)
    vis = el > horizon_at(hor, az)
    return [int(vis[pidx[p]:pidx[p + 1]].sum()) for p in range(len(pidx) - 1)]


def test_tierra_coincide_con_referencia():
    dem = dem_sintetico()
    E, pidx = tierra_sintetica()
    rng = np.random.default_rng(7)
    # Celdas de todo tipo, con muchas cerca del limbo (donde de verdad se decide)
    lats = np.concatenate([rng.uniform(-89, 89, 25), rng.uniform(-30, 30, 25)])
    lons = np.concatenate([rng.uniform(-180, 180, 25), rng.choice([-1, 1], 25) * rng.uniform(75, 105, 25)])
    for la, lo in zip(lats, lons):
        rapido = T.contar(dem, E, pidx, np.array([la]), np.array([lo]))[:, 0, 0]
        ref = visibles_ref(dem, E, pidx, la, lo)
        # Interpolación lineal idéntica; solo pueden diferir horas en el borde por redondeo
        assert np.all(np.abs(rapido.astype(int) - ref) <= 1), (la, lo, rapido, ref)


def test_orientacion_contrato():
    """Las pruebas del validador: >0,95 en 0°N 0°E y <0,05 en 0°N 180°E."""
    dem = dem_sintetico()
    E, pidx = tierra_sintetica()
    c = T.contar(dem, E, pidx, np.array([0.01]), np.array([0.01, 179.99]))
    f = c.sum(axis=0) / pidx[-1]
    assert f[0, 0] > 0.95 and f[0, 1] < 0.05


def test_nota_0_100():
    f = np.array([0.0, 0.2, 0.25, 0.5, 1.0])
    assert T.nota_0_100(f).tolist() == [0, 0, 25, 50, 100]


def test_malla_g1k():
    lat, lon = T.centros_g1k()
    assert lat.size == 5458 and lon.size == 10916
    assert math.isclose(lon[0], -180 + 180 / 10916) and math.isclose(lat[0], 90 - 90 / 5458)


def test_dia_que_arriba(monkeypatch, tmp_path):
    """puntuacio_del_dia pasa a ejecutar exactamente el día UTC recibido."""
    from datetime import date
    from moonsite import config as C
    vistos = {}

    def falso(periodos, paso_s, con_media=None, log=print):
        vistos.update(periodos=periodos, paso=paso_s)
        for pid in periodos:
            d = tmp_path / T.ID_NOTA / "G1K"
            d.mkdir(parents=True, exist_ok=True)
            np.zeros(C.G1K_ROWS * C.G1K_COLS, np.uint8).tofile(d / f"{pid}.u8")

    monkeypatch.setattr(T, "ejecutar", falso)
    monkeypatch.setattr(C, "LAYERS_DIR", tmp_path)
    m = T.puntuacio_del_dia(date(2026, 11, 14))
    (pid, (a, b)), = vistos["periodos"].items()
    assert pid == "2026-11-14" and (b - a).days == 1 and a.hour == 0 and vistos["paso"] == 600
    assert m.shape == (5458, 10916) and m.dtype == np.uint8
