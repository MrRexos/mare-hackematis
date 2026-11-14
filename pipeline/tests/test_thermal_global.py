"""Temperatura Diviner (moonsite.thermal_global): reducción de tramos y relleno de huecos."""
import numpy as np

from moonsite import thermal_global as TG


def _curva(lt):
    """Curva día-noche sintética: 100 K de noche, hasta 390 K a mediodía."""
    return 100.0 + 290.0 * np.clip(np.cos((lt - 12.0) / 12.0 * np.pi), 0, None) ** 0.25


def test_tramos_y_relleno_conservan_la_curva():
    lt = (np.arange(TG.NLT) + 0.5) * 0.25
    tb = np.broadcast_to(_curva(lt), (TG.ROWS, TG.COLS, TG.NLT)).astype(np.float32).copy()
    rng = np.random.default_rng(3)
    huecos = rng.random(tb.shape) < 0.4                 # como en Diviner: ~40 % de tramos sin pasada
    tb[huecos] = np.nan
    tb[10, 20, :] = np.nan                              # una celda sin ninguna medida
    c, info = TG.rellenar(TG.a_tramos(tb, TG.WEB_BINS))
    assert c.shape == (TG.ROWS, TG.COLS, TG.WEB_BINS) and np.isfinite(c).all()
    ref = _curva((np.arange(TG.WEB_BINS) + 0.5) * 24 / TG.WEB_BINS)
    noche = (np.arange(TG.WEB_BINS) < 10) | (np.arange(TG.WEB_BINS) > 38)
    # La noche no se contamina del día al rellenar huecos junto al amanecer: casi nunca, y poco.
    # (Con interpolación en línea recta el peor caso de este mismo ensayo es de ~90 K.)
    err_noche = np.abs(c[:, :, noche] - 100.0)
    assert np.percentile(err_noche, 99.9) < 1.0 and err_noche.max() < 15.0
    assert np.abs(np.median(c, axis=(0, 1)) - ref).max() < 12.0        # la forma de la curva se conserva
    assert abs(float(c.max()) - 390.0) < 3.0
    assert np.abs(c[10, 20] - c[10].mean(axis=0)).max() < 15.0         # celda vacía ← curva de su latitud
    assert 10 < info["gapsFilledPct"] < 25


def test_g1k_toma_la_celda_que_contiene_su_centro():
    a = np.arange(TG.ROWS * TG.COLS, dtype=np.float32).reshape(TG.ROWS, TG.COLS)
    g = TG._a_g1k(a)
    assert g.shape == (5458, 10916)
    assert g[0, 0] == a[0, 0] and g[-1, -1] == a[-1, -1]
    assert g[2729, 5458] == a[180, 360]                 # justo al sur del ecuador, justo al este de 0°
