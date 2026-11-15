"""Tests de geometría y visibilidad (no necesitan descargas)."""

import numpy as np

from moonsite.config import GRID_HALF_M, GRID_N, GRID_PX_M, MOON_R_M
from moonsite.geo import grid_xy, latlon_to_xy, plane_frame, xy_to_latlon, xy_to_unit
from moonsite.visibility import az_el, horizon_at, local_frame, sun_disk_fraction


def test_projection_round_trip():
    lat = np.array([-89.9, -88.0, -85.0, -83.6])
    lon = np.array([-170.0, -23.7, 31.8, 120.0])
    x, y = latlon_to_xy(lat, lon)
    lat2, lon2 = xy_to_latlon(x, y)
    assert np.allclose(lat, lat2) and np.allclose(lon, lon2)


def test_lon0_is_up_and_90e_is_right():
    x, y = latlon_to_xy(-85.0, 0.0)
    assert abs(x) < 1e-6 and y > 0
    x, y = latlon_to_xy(-85.0, 90.0)
    assert x > 0 and abs(y) < 1e-6


def test_unit_vector_matches_latlon():
    x, y = latlon_to_xy(-86.5, 40.0)
    u = np.array(xy_to_unit(x, y))
    up, _, _ = local_frame(-86.5, 40.0)
    assert np.allclose(u, up)


def test_grid_layout():
    x, y = grid_xy()
    assert x.shape == (GRID_N, GRID_N)
    assert np.isclose(x[0, 0], -GRID_HALF_M + GRID_PX_M / 2)
    assert np.isclose(y[0, 0], GRID_HALF_M - GRID_PX_M / 2)  # fila 0 arriba
    assert GRID_PX_M == 1000.0  # resolución acordada: 1 km × 1 km


def test_plane_north_points_away_from_pole():
    (nx, ny), (ex, ey) = plane_frame(np.array([0.0]), np.array([50_000.0]))
    assert np.allclose([nx[0], ny[0]], [0, 1])   # a lon 0, alejarse del polo = +y
    assert np.allclose([ex[0], ey[0]], [1, 0])   # longitud creciente = +x


def test_zenith_and_horizon_directions():
    lat, lon = -88.0, 10.0
    up, east, north = local_frame(lat, lon)
    far = 1e9
    az, el = az_el(np.array([up * far, north * far, east * far]), lat, lon)
    assert np.isclose(el[0], 90, atol=1e-3)
    assert np.isclose(el[1], 0, atol=1e-3) and np.isclose(az[1] % 360, 0, atol=1e-3)
    assert np.isclose(az[2], 90, atol=1e-3)


def test_horizon_interpolation_wraps():
    hor = np.zeros(72)
    hor[0] = 2.0
    assert np.isclose(horizon_at(hor, 0.0), 2.0)
    assert np.isclose(horizon_at(hor, 357.5), 1.0)  # mitad entre el último bin y el primero


def test_sun_disk_fraction_limits():
    d = 1.496e8
    assert np.isclose(sun_disk_fraction(1.0, 0.0, d), 1.0)
    assert np.isclose(sun_disk_fraction(-1.0, 0.0, d), 0.0)
    assert np.isclose(sun_disk_fraction(0.0, 0.0, d), 0.5)


def test_moon_radius():
    assert MOON_R_M == 1_737_400.0


# --- Polo norte: misma malla, proyección estereográfica norte de LOLA -----------------


def test_north_projection_round_trip():
    lat = np.array([89.9, 88.0, 85.0, 83.6])
    lon = np.array([-170.0, -23.7, 31.8, 120.0])
    x, y = latlon_to_xy(lat, lon, pole="north")
    lat2, lon2 = xy_to_latlon(x, y, pole="north")
    assert np.allclose(lat, lat2) and np.allclose(lon, lon2)


def test_north_lon0_is_down_and_90e_is_right():
    # Convenio de LOLA (LDEM_75N): la cara visible queda abajo; 90°E, a la derecha.
    x, y = latlon_to_xy(85.0, 0.0, pole="north")
    assert abs(x) < 1e-6 and y < 0
    x, y = latlon_to_xy(85.0, 90.0, pole="north")
    assert x > 0 and abs(y) < 1e-6
    # La misma distancia al polo que el punto simétrico del sur.
    assert np.isclose(np.hypot(*latlon_to_xy(85.0, 40.0, pole="north")), np.hypot(*latlon_to_xy(-85.0, 40.0)))


def test_north_unit_vector_matches_latlon():
    for lon in (0.0, 40.0, -130.0, 179.0):
        x, y = latlon_to_xy(86.5, lon, pole="north")
        u = np.array(xy_to_unit(x, y, pole="north"))
        up, _, _ = local_frame(86.5, lon)
        assert np.allclose(u, up)


def test_north_plane_frame_matches_local_frame():
    # En el norte, "norte" es acercarse al polo; el este sigue siendo longitud creciente.
    (nx, ny), (ex, ey) = plane_frame(np.array([0.0]), np.array([-50_000.0]), pole="north")
    assert np.allclose([nx[0], ny[0]], [0, 1])   # a lon 0 (abajo), el polo está hacia +y
    assert np.allclose([ex[0], ey[0]], [1, 0])   # longitud creciente = +x
    # Un paso en el plano hacia el norte/este coincide con el norte/este del marco local 3D.
    for pole, lat in (("south", -86.5), ("north", 86.5)):
        for lon in (10.0, 100.0, -140.0):
            x, y = latlon_to_xy(lat, lon, pole=pole)
            u = np.array(xy_to_unit(x, y, pole=pole))
            _, east, north = local_frame(lat, lon)
            (nx, ny), (ex, ey) = plane_frame(np.array([x]), np.array([y]), pole=pole)
            for (dx, dy), ref in (((nx[0], ny[0]), north), ((ex[0], ey[0]), east)):
                v = np.array(xy_to_unit(x + 100.0 * dx, y + 100.0 * dy, pole=pole)) - u
                assert np.dot(v / np.linalg.norm(v), ref) > 0.9999


def test_south_is_the_default_pole():
    x, y = latlon_to_xy(-85.0, 30.0)
    assert np.allclose((x, y), latlon_to_xy(-85.0, 30.0, pole="south"))
    assert np.allclose(xy_to_unit(x, y), xy_to_unit(x, y, pole="south"))


def test_diviner_north_table_longitude_is_mirrored():
    from moonsite.diviner import true_longitude

    lon = np.array([-45.0, 0.0, 90.0, 170.0])
    assert np.allclose(true_longitude(lon, "south"), lon)
    assert np.allclose(true_longitude(lon, "north"), 180.0 - lon)


def test_north_sites_are_inside_the_grid():
    from moonsite.sites import catalog

    for pole, sign in (("south", -1), ("north", 1)):
        c = catalog(pole)
        assert c["groups"][0]["placeLabel"] and c["groups"][0]["rankingLabel"]
        for s in c["sites"]:
            assert sign * s["lat"] > 0
            x, y = latlon_to_xy(s["lat"], s["lon"], pole=pole)
            assert abs(x) < GRID_HALF_M and abs(y) < GRID_HALF_M, s["name"]
