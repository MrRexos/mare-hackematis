"""LRO Diviner Polar Resource Product (PRP) v2.0 -> capas de la malla de 1 km.

Producto: LRO-L-DLRE-5-PRP-V2.0 (Paige et al. 2010, Science 330, 497), revisado
por pares en NASA PDS. Tabla ASCII de 2 880 000 triángulos (~0,5 km de lado) que
cubren un cuadrado centrado en el polo sur hasta 80°S. Columnas usadas:

  tri_clon, tri_clat  centro del triángulo (planetocéntrico, longitud este)
  temp_avg            temperatura media anual a 2 cm bajo la superficie (K)
  temp_max            temperatura máxima anual en superficie (K)
  ice_depth           profundidad (m) a la que el hielo de agua sublimaría a
                      1 kg m⁻² por cada mil millones de años: 0 = estable en
                      superficie; -999 = más profundo que 2,8738 m

Nota: la malla de triángulos procede del altímetro de Kaguya (JAXA); puede haber
un desfase de unos cientos de metros respecto a LOLA, pequeño frente a 1 km.

Código no documentado: 100 319 triángulos traen ice_depth = -1. La etiqueta solo
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


def load(log=print):
    f = DIVINER["prp_south"].dest
    if not f.exists():
        return None
    t0 = time.time()
    # Columnas: 9 clon, 10 clat, 12 temp_avg, 13 temp_max, 14 ice_depth (la fila 0 es la cabecera).
    a = np.loadtxt(f, delimiter=",", skiprows=1, usecols=(9, 10, 12, 13, 14), dtype=np.float64)
    log(f"   Diviner: {len(a):,} triángulos leídos en {time.time() - t0:.0f} s")
    if len(a) != 2_880_000:
        raise ValueError(f"Diviner PRP: se esperaban 2 880 000 filas y hay {len(a)}")
    return {"lon": a[:, 0], "lat": a[:, 1], "tavg": a[:, 2], "tmax": a[:, 3], "ice": a[:, 4]}


def _cells(lat, lon):
    x, y = latlon_to_xy(lat, lon)
    j = np.floor((x + GRID_HALF_M) / GRID_PX_M).astype(np.int64)
    i = np.floor((GRID_HALF_M - y) / GRID_PX_M).astype(np.int64)
    ok = (i >= 0) & (j >= 0) & (i < GRID_N) & (j < GRID_N)
    return i * GRID_N + j, ok, x, y


def layers(d, log=print) -> dict[str, np.ndarray]:
    n2 = GRID_N * GRID_N
    cell, ok, x, y = _cells(d["lat"], d["lon"])
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
