"""LRO Diviner Polar Resource Product (PRP) v2.0 -> capas de la malla de 1 km.

Producto: LRO-L-DLRE-5-PRP-V2.0 (Paige et al. 2010, Science 330, 497), revisado
por pares en NASA PDS. Una tabla ASCII por polo (dlre_prp_south.tab, dlre_prp_north.tab),
cada una con 2 880 000 triángulos (~0,5 km de lado) que cubren un cuadrado centrado en
el polo hasta 80° de latitud. Columnas usadas:

  tri_clon, tri_clat  centro del triángulo (planetocéntrico, longitud este)
  temp_avg            temperatura media anual a 2 cm bajo la superficie (K)
  temp_max            temperatura máxima anual en superficie (K)
  ice_depth           profundidad (m) a la que el hielo de agua sublimaría a
                      1 kg m⁻² por cada mil millones de años: 0 = estable en
                      superficie; -999 = más profundo que 2,8738 m

  tri_calt            altura del centro del triángulo sobre la esfera de 1737,4 km (km);
                      solo se usa para comprobar que la tabla cae donde debe (ver abajo)

Nota: la malla de triángulos procede del altímetro de Kaguya (JAXA); puede haber
un desfase de unos cientos de metros respecto a LOLA, pequeño frente a 1 km.

Longitudes de la tabla del NORTE. La tabla del sur trae longitud este normal. La del
norte, tal como está en PDS (dlre_prp_north.tab, creada el 21-02-2018), viene reflejada:
su marco es (−X, Y, Z) respecto a MOON_ME, es decir, longitud real = 180° − tri_clon.
No lo dice la etiqueta; sale de comparar la altura que trae cada triángulo (tri_calt)
con el relieve LOLA LDEM_75N_240M en la malla de 1 km:

    longitud tal cual        correlación 0,15   (diferencia cuadrática media 1177 m)
    180° − longitud          correlación 0,999  (44 m)
    −longitud, longitud+180  correlación ≈ 0

La proyección de LOLA es la buena: coincide con el relieve global LDEM_64 (correlación
0,9999) y los cráteres con nombre (Byrd, Hermite, Peary…) salen en sus coordenadas.
`align_check` repite esta comparación cada vez que se construyen las capas y detiene el
pipeline si la tabla deja de cuadrar (por ejemplo, si PDS publica una versión corregida).

Código no documentado: en la tabla del sur, 100 319 triángulos traen ice_depth = -1
(el número de la del norte lo escribe el pipeline al construirla). La etiqueta solo
define >= 0 y -999. Todos ellos son los puntos más fríos del producto (temp_max
<= 101 K, temp_avg <= 73 K), más fríos aún que los de ice_depth = 0 (temp_max
mediana 106 K). Interpretación nuestra: hielo estable en superficie -> se trata como 0.
"""

from __future__ import annotations

import time

import numpy as np
from scipy import ndimage

from .config import DIVINER, GRID_HALF_M, GRID_N, GRID_PX_M, ICE_ACCESSIBLE_DEPTH_M
from .geo import grid_xy, latlon_to_xy

ICE_INVALID = -999.0
ICE_MAX_DEPTH_M = 2.8738  # límite del producto
#: Correlación mínima entre la altura de Diviner y el relieve LOLA para dar la tabla por bien situada.
ALIGN_MIN_CORR = 0.98


def true_longitude(lon, pole: str):
    """Longitud este real a partir de tri_clon (ver la nota del módulo sobre la tabla del norte)."""
    return 180.0 - lon if pole == "north" else lon


def load(pole: str = "south", log=print):
    f = DIVINER[f"prp_{pole}"].dest
    if not f.exists():
        return None
    t0 = time.time()
    # Columnas: 9 clon, 10 clat, 11 calt, 12 temp_avg, 13 temp_max, 14 ice_depth (la fila 0 es la cabecera).
    a = np.loadtxt(f, delimiter=",", skiprows=1, usecols=(9, 10, 11, 12, 13, 14), dtype=np.float64)
    log(f"   Diviner: {len(a):,} triángulos leídos en {time.time() - t0:.0f} s")
    if len(a) != 2_880_000:
        raise ValueError(f"Diviner PRP: se esperaban 2 880 000 filas y hay {len(a)}")
    return {"lon": true_longitude(a[:, 0], pole), "lat": a[:, 1], "alt_m": a[:, 2] * 1000.0,
            "tavg": a[:, 3], "tmax": a[:, 4], "ice": a[:, 5]}


def align_check(d, elevation: np.ndarray, pole: str = "south", log=print) -> float:
    """Comprueba que la tabla cae sobre el relieve LOLA: correlación entre la altura media de
    Diviner en cada celda de 1 km y la capa de elevación. Lanza ValueError si no cuadra."""
    n2 = GRID_N * GRID_N
    cell, ok, _, _ = _cells(d["lat"], d["lon"], pole)
    cnt = np.bincount(cell[ok], minlength=n2)
    with np.errstate(invalid="ignore", divide="ignore"):
        alt = np.bincount(cell[ok], weights=d["alt_m"][ok], minlength=n2) / cnt
    ref = np.asarray(elevation, dtype=np.float64).ravel()
    m = np.isfinite(alt) & np.isfinite(ref)
    corr = float(np.corrcoef(alt[m], ref[m])[0, 1])
    rms = float(np.sqrt(np.mean((alt[m] - ref[m]) ** 2)))
    log(f"   Diviner: altura frente a LOLA, correlación {corr:.4f}, diferencia cuadrática media {rms:.0f} m")
    if not corr >= ALIGN_MIN_CORR:
        raise ValueError(f"Diviner PRP ({pole}): la tabla no cae sobre el relieve LOLA (correlación {corr:.3f}). "
                         "Revisa el convenio de longitudes en diviner.true_longitude.")
    return corr


def _cells(lat, lon, pole: str = "south"):
    x, y = latlon_to_xy(lat, lon, pole=pole)
    j = np.floor((x + GRID_HALF_M) / GRID_PX_M).astype(np.int64)
    i = np.floor((GRID_HALF_M - y) / GRID_PX_M).astype(np.int64)
    ok = (i >= 0) & (j >= 0) & (i < GRID_N) & (j < GRID_N)
    return i * GRID_N + j, ok, x, y


def layers(d, pole: str = "south", log=print) -> dict[str, np.ndarray]:
    n2 = GRID_N * GRID_N
    cell, ok, x, y = _cells(d["lat"], d["lon"], pole)
    c = cell[ok]
    cnt = np.bincount(c, minlength=n2).astype(np.float64)
    with np.errstate(invalid="ignore", divide="ignore"):
        tavg = np.bincount(c, weights=d["tavg"][ok], minlength=n2) / cnt
        tmax = np.bincount(c, weights=d["tmax"][ok], minlength=n2) / cnt
    tavg[cnt == 0] = np.nan
    tmax[cnt == 0] = np.nan

    # Hielo: profundidad mínima de estabilidad dentro de la celda (¿hay hielo estable en algún punto?)
    ice = d["ice"].copy()
    ice[ice == ICE_INVALID] = np.inf
    undocumented = ice == -1.0
    ice[undocumented] = 0.0  # ver nota del módulo: más frío que el umbral de estabilidad en superficie
    if np.any((ice < 0) & np.isfinite(ice)):
        raise ValueError("Diviner PRP: valores negativos de ice_depth no reconocidos")
    log(f"   Diviner: {int(undocumented.sum()):,} triángulos con ice_depth = -1 tratados como estables en superficie")
    ice_min = np.full(n2, np.inf)
    np.minimum.at(ice_min, c, ice[ok])
    ice_min[cnt == 0] = np.nan
    ice_min[np.isinf(ice_min)] = ICE_MAX_DEPTH_M  # "más profundo que 2,87 m" -> tope del producto
    accessible = ice <= ICE_ACCESSIBLE_DEPTH_M
    with np.errstate(invalid="ignore", divide="ignore"):
        share = np.bincount(c, weights=accessible[ok].astype(float), minlength=n2) / cnt
    share[cnt == 0] = np.nan

    # Distancia al hielo accesible más cercano: raster de 500 m sobre la malla + 60 km de margen.
    fine = 500.0
    half = GRID_HALF_M + 60_000.0
    m = int(round(2 * half / fine))
    jj = np.floor((x + half) / fine).astype(np.int64)
    ii = np.floor((half - y) / fine).astype(np.int64)
    inside = (ii >= 0) & (jj >= 0) & (ii < m) & (jj < m)
    target = np.zeros((m, m), bool)
    sel = inside & accessible
    target[ii[sel], jj[sel]] = True
    covered = np.zeros((m, m), bool)
    covered[ii[inside], jj[inside]] = True
    dist = ndimage.distance_transform_edt(~target) * fine / 1000.0
    gx, gy = grid_xy()
    gi = np.clip(np.floor((half - gy.ravel()) / fine).astype(int), 0, m - 1)
    gj = np.clip(np.floor((gx.ravel() + half) / fine).astype(int), 0, m - 1)
    ice_dist = dist[gi, gj]
    ice_dist[np.isnan(tavg)] = np.nan

    log(f"   Diviner: {int((cnt > 0).sum()):,} de {n2:,} celdas con datos; "
        f"{int(target.sum()):,} celdas de 500 m con hielo estable a ≤ {ICE_ACCESSIBLE_DEPTH_M} m")
    return {
        "tempAvgK": tavg.astype(np.float32),
        "tempMaxK": tmax.astype(np.float32),
        "iceDepthM": ice_min.astype(np.float32),
        "iceShare": share.astype(np.float32),
        "iceDistKm": ice_dist.astype(np.float32),
    }
