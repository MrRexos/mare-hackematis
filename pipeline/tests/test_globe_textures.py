"""Texturas del globo 3D (moonsite.globe_textures): suavizado de los polos."""
import numpy as np

from moonsite import globe_textures as G


def test_suavizar_polos_solo_toca_los_polos():
    rng = np.random.default_rng(1)
    a = rng.normal(100.0, 20.0, (180, 360)).astype(np.float32)
    b = G.suavizar_polos(a, desde_lat=70.0)
    lat = 90.0 - (np.arange(180) + 0.5)
    medio = np.abs(lat) < 69
    assert np.array_equal(b[medio], a[medio])                    # fuera de los polos no cambia nada
    assert b[0].std() < 0.2 * a[0].std()                         # junto al polo el ruido casi desaparece
    assert abs(float(b[0].mean()) - float(a[0].mean())) < 1e-2   # sin cambiar el nivel medio
    assert b[0].std() < b[5].std() < a[5].std()                  # a 84,5° se suaviza menos que en el polo
    assert np.array_equal(b[15], a[15])                          # a 74,5° la ventana aún es de 1 píxel


def test_suavizar_polos_respeta_el_borde_de_longitud():
    a = np.zeros((180, 360), np.float32)
    a[:, :180] = 1.0                                             # escalón en 0° y en ±180°
    b = G.suavizar_polos(a, desde_lat=70.0)
    assert abs(float(b[2, 0]) - float(b[2, -1])) < 0.2           # la costura de ±180° queda continua
    assert 0.3 < float(b[2, 0]) < 0.7
