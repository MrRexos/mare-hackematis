"""Trabajo T3 · Luz en la malla global G1K (contrato de datos v0.2, §7).

Para cada celda de la malla 10 916 × 5 458 (la misma de todas las capas: la celda
(fila, columna) es el mismo trozo de Luna) calcula:

- sun.visible_fraction.mean  fracción media del disco solar visible sobre el horizonte
                              del terreno, vista a 2 m del suelo (0-1).
- sun.longest_night_h.max     racha continua más larga con Sol visible < 0,05 (horas).
- suitability.sun             nota rápida 0-100 = 100 × fracción media (contrato §6).

Datos (todos de la NASA):
- Relieve: LOLA LDEM_64 global (NASA PDS), 64 px/grado.
- Sol: SPICE DE440 (NASA/JPL NAIF), marco MOON_ME, aberración LT+S, radio angular real.

Método, celda a celda (numba, en paralelo). Mismo trazado de horizonte que T4
(earth_global.py), pero el Sol recorre todos los acimuts, así que el horizonte se
calcula a demanda y por tramos:
- En cada instante solo hace falta el horizonte en el acimut del Sol (2 de 72 bins,
  con interpolación) y solo hasta la distancia a la que el relieve aún podría tapar el
  borde inferior del disco: d = (cota máxima LOLA − altura propia) / tan(elevación).
  Con el Sol alto eso son pocos km; el rayo se alarga solo cuando el Sol está bajo.
- Si el borde inferior queda por encima del horizonte: disco entero (1). Si no, se
  completa el rayo hasta 300 km y se calcula la fracción exacta del disco.

Uso (desde pipeline/, tras `python -m moonsite.fetch global`):
    python -m moonsite.sun_global 2026-11-14       # el día que llega al programa
    python -m moonsite.sun_global --mes 2026-11
    python -m moonsite.sun_global --estandar       # 60 meses + media 2026-2030
"""

from __future__ import annotations

import argparse
import math
import time
from datetime import datetime, timedelta, timezone

import numpy as np
from numba import njit, prange

from . import config as C
from .earth_global import (DEG, FUENTES, H_OBS_KM, NBINS, R_KM, _dem_km, _guardar_meta, _iso, _sha,
                           centros_g1k, comprobar_orientacion, distancias_km, periodos_estandar)

ID_FRAC = "sun.visible_fraction.mean"
ID_NOCHE = "sun.longest_night_h.max"
ID_NOTA = "suitability.sun"
NOCHE_UMBRAL = 0.05          # Sol visible < 5 % del disco = noche (contrato §5)
FUENTES_SOL = [FUENTES[0], {**FUENTES[1], "citation": FUENTES[1]["citation"] + "; Sun position and radius"}]


# ---------------------------------------------------------------------------
# Núcleo numérico
# ---------------------------------------------------------------------------
@njit(cache=True)
def _alargar(k, hasta, tanb, reach, ux, uy, uz, nx, ny, nz, ex, ey, ez, r0, cd, sd, dist,
             raw, k_km, add_km, res, lat_max, lon_west, missing):
    """Alarga el rayo del bin k hasta `hasta` km (guarda la mejor tangente y el paso alcanzado)."""
    s = reach[k]
    if s >= dist.size or dist[s] > hasta:
        return
    a = k * 2.0 * math.pi / NBINS
    ca, sa = math.cos(a), math.sin(a)
    tx, ty, tz = nx * ca + ex * sa, ny * ca + ey * sa, nz * ca + ez * sa
    best = tanb[k]
    while s < dist.size and dist[s] <= hasta:
        c, si = cd[s], sd[s]
        px, py, pz = c * ux + si * tx, c * uy + si * ty, c * uz + si * tz
        lat = math.asin(min(1.0, max(-1.0, pz))) / DEG
        lon = math.atan2(py, px) / DEG
        rt = R_KM + _dem_km(raw, k_km, add_km, res, lat_max, lon_west, missing, lat, lon)
        t = (rt * c - r0) / (rt * si)
        if t > best:
            best = t
        s += 1
    tanb[k] = best
    reach[k] = s


@njit(cache=True, inline="always")
def _fraccion_disco(el, hz, rad):
    """Fracción del disco solar por encima de un horizonte horizontal (igual que visibility.py)."""
    h = (el - hz) / rad
    if h >= 1.0:
        return 1.0
    if h <= -1.0:
        return 0.0
    return 1.0 - (math.acos(h) - h * math.sqrt(1.0 - h * h)) / math.pi


@njit(cache=True, parallel=True)
def luz_bloque(lat_f, lon_c, raw, k_km, add_km, res, lat_max, lon_west, missing, hmin_km, hmax_km,
               S, RAD, pidx, dist, cd, sd, frac_out, noche_out):
    """frac_out[p, f, c] = fracción media del disco; noche_out[p, f, c] = racha nocturna más larga (muestras)."""
    nr, nc = lat_f.size, lon_c.size
    P = pidx.size - 1
    dmax = dist[-1]
    paso = 360.0 / NBINS
    for q in prange(nr * nc):
        r = q // nc
        col = q - r * nc
        la, lo = lat_f[r] * DEG, lon_c[col] * DEG
        cl, sl, co, so = math.cos(la), math.sin(la), math.cos(lo), math.sin(lo)
        ux, uy, uz = cl * co, cl * so, sl
        ex, ey, ez = -so, co, 0.0
        nx, ny, nz = -sl * co, -sl * so, cl
        h0 = _dem_km(raw, k_km, add_km, res, lat_max, lon_west, missing, lat_f[r], lon_c[col])
        r0 = R_KM + h0 + H_OBS_KM
        dip = math.acos(min(1.0, (R_KM + hmin_km) / r0)) / DEG
        tanb = np.full(NBINS, -1e9)
        reach = np.zeros(NBINS, np.int64)
        for p in range(P):
            acc = 0.0
            racha = 0
            peor = 0
            for t in range(pidx[p], pidx[p + 1]):
                sx, sy, sz = S[t, 0], S[t, 1], S[t, 2]
                rad = RAD[t]
                el = math.asin(max(-1.0, min(1.0, sx * ux + sy * uy + sz * uz))) / DEG
                f = 0.0
                if el + rad >= -dip:
                    az = math.atan2(sx * ex + sy * ey + sz * ez, sx * nx + sy * ny + sz * nz) / DEG
                    fa = (az % 360.0) / paso
                    k0 = int(math.floor(fa)) % NBINS
                    k1 = (k0 + 1) % NBINS
                    w = fa - math.floor(fa)
                    bajo = el - rad
                    hasta = dmax
                    if bajo > 0.05:
                        hasta = min(dmax, (hmax_km - h0 + 0.01) / math.tan(bajo * DEG))
                    for k in (k0, k1):
                        _alargar(k, hasta, tanb, reach, ux, uy, uz, nx, ny, nz, ex, ey, ez, r0, cd, sd, dist,
                                 raw, k_km, add_km, res, lat_max, lon_west, missing)
                    h0b = math.atan(tanb[k0]) / DEG
                    h1b = math.atan(tanb[k1]) / DEG
                    if max(h0b, h1b) < bajo:
                        f = 1.0                                    # disco entero sobre el relieve
                    else:
                        for k in (k0, k1):
                            _alargar(k, dmax, tanb, reach, ux, uy, uz, nx, ny, nz, ex, ey, ez, r0, cd, sd,
                                     dist, raw, k_km, add_km, res, lat_max, lon_west, missing)
                        hz = (math.atan(tanb[k0]) / DEG) * (1 - w) + (math.atan(tanb[k1]) / DEG) * w
                        f = _fraccion_disco(el, hz, rad)
                acc += f
                if f < NOCHE_UMBRAL:
                    racha += 1
                    if racha > peor:
                        peor = racha
                else:
                    racha = 0
            n = pidx[p + 1] - pidx[p]
            frac_out[p, r, col] = acc / n
            noche_out[p, r, col] = peor


def preparar(dem):
    dist = distancias_km()
    k_km, add_km = dem.k / 1000.0, dem.add / 1000.0
    miss = dem.missing if dem.missing is not None else -32768
    return dict(raw=dem.raw, k_km=k_km, add_km=add_km, res=dem.res, lat_max=dem.lat_max, lon_west=dem.lon_west,
                missing=miss, hmin_km=float(dem.raw.min()) * k_km + add_km,
                hmax_km=float(dem.raw.max()) * k_km + add_km, dist=dist,
                cd=np.cos(dist / R_KM), sd=np.sin(dist / R_KM))


def bloques(dem, S, RAD, pidx, lat_f, lon_c, filas_bloque=16, log=print):
    a = preparar(dem)
    P = pidx.size - 1
    t0, n = time.time(), 0
    for j0 in range(0, lat_f.size, filas_bloque):
        j1 = min(lat_f.size, j0 + filas_bloque)
        fr = np.zeros((P, j1 - j0, lon_c.size), np.float32)
        no = np.zeros((P, j1 - j0, lon_c.size), np.int32)
        luz_bloque(lat_f[j0:j1], lon_c, a["raw"], a["k_km"], a["add_km"], a["res"], a["lat_max"], a["lon_west"],
                   a["missing"], a["hmin_km"], a["hmax_km"], S, RAD, pidx, a["dist"], a["cd"], a["sd"], fr, no)
        yield j0, j1, fr, no
        n += 1
        if log and (j1 == lat_f.size or n % 40 == 0):
            el = time.time() - t0
            log(f"   filas {j1}/{lat_f.size} · {el:.0f} s · quedan ~{el * (lat_f.size - j1) / j1:.0f} s")


def calcular(dem, S, RAD, pidx, lat_f, lon_c, filas_bloque=16):
    """Versión en memoria (mallas pequeñas y tests)."""
    P = pidx.size - 1
    fr = np.zeros((P, lat_f.size, lon_c.size), np.float32)
    no = np.zeros((P, lat_f.size, lon_c.size), np.int32)
    for j0, j1, a, b in bloques(dem, S, RAD, pidx, lat_f, lon_c, filas_bloque, log=None):
        fr[:, j0:j1], no[:, j0:j1] = a, b
    return fr, no


# ---------------------------------------------------------------------------
# Efemérides del Sol (SPICE)
# ---------------------------------------------------------------------------
def sol_spice(periodos: dict, paso_s: float):
    """Dirección unitaria del Sol desde el centro lunar (MOON_ME, LT+S), radio angular (°) y límites."""
    import spiceypy as sp

    from .ephemeris import load_kernels

    load_kernels()
    bloques_, pidx = [], [0]
    for a, b in periodos.values():
        et0 = sp.str2et(a.strftime("%Y-%m-%dT%H:%M:%S"))
        et1 = sp.str2et(b.strftime("%Y-%m-%dT%H:%M:%S"))
        n = int(round((et1 - et0) / paso_s))
        ets = et0 + (np.arange(n) + 0.5) * paso_s
        pos, _ = sp.spkpos("SUN", ets, C.EPHEM_FRAME, C.ABCORR, "MOON")
        bloques_.append(np.asarray(pos))
        pidx.append(pidx[-1] + n)
    v = np.vstack(bloques_).astype(np.float64)
    d = np.linalg.norm(v, axis=1)
    # La paralaje del Sol entre celdas es < 3″: se usa la dirección desde el centro lunar.
    return v / d[:, None], np.degrees(np.arcsin(C.SUN_RADIUS_KM / d)), np.array(pidx, np.int64)


# ---------------------------------------------------------------------------
# Escritura según el contrato
# ---------------------------------------------------------------------------
def ejecutar(periodos: dict, paso_s: float = 3600.0, con_media: str | None = None, log=print) -> None:
    from .pds import CylRaster

    dirs = {lid: C.LAYERS_DIR / lid / "G1K" for lid in (ID_FRAC, ID_NOCHE, ID_NOTA)}
    for d in dirs.values():
        d.mkdir(parents=True, exist_ok=True)

    log("Relieve LOLA LDEM_64...")
    f = C.LOLA_GLOBAL["ldem64"]
    if not f.dest.exists():
        raise FileNotFoundError("Falta LDEM_64: ejecuta `python -m moonsite.fetch global`")
    dem = CylRaster.open(f.dest, f.url)
    comprobar_orientacion(dem)

    log(f"Sol (SPICE) para {len(periodos)} periodos, paso {paso_s:.0f} s...")
    S, RAD, pidx = sol_spice(periodos, paso_s)
    n_mues = np.diff(pidx)
    paso_h = paso_s / 3600.0

    lat, lon = centros_g1k()
    shape = (lat.size, lon.size)
    ids = list(periodos)
    mm_f = [np.memmap(dirs[ID_FRAC] / f"{pid}.u8", np.uint8, "w+", shape=shape) for pid in ids]
    mm_n = [np.memmap(dirs[ID_NOCHE] / f"{pid}.u16", "<u2", "w+", shape=shape) for pid in ids]
    mm_s = [np.memmap(dirs[ID_NOTA] / f"{pid}.u8", np.uint8, "w+", shape=shape) for pid in ids]
    suma = np.zeros(shape, np.float64) if con_media else None

    log("Luz en G1K...")
    for j0, j1, fr, no in bloques(dem, S, RAD, pidx, lat, lon, log=log):
        for p in range(len(ids)):
            mm_f[p][j0:j1] = np.rint(fr[p] * 254).astype(np.uint8)
            mm_n[p][j0:j1] = np.minimum(np.rint(no[p] * paso_h * 60), 65534).astype("<u2")   # minutos
            mm_s[p][j0:j1] = np.rint(fr[p] * 100).astype(np.uint8)
        if suma is not None:
            suma[j0:j1] = (fr * n_mues[:, None, None]).sum(axis=0)

    files = {ID_FRAC: [], ID_NOCHE: [], ID_NOTA: []}
    per = {}
    for p, pid in enumerate(ids):
        a, b = periodos[pid]
        for m in (mm_f[p], mm_n[p], mm_s[p]):
            m.flush()
        q, nn, s = mm_f[p], mm_n[p], mm_s[p]
        files[ID_FRAC].append({"grid": "G1K", "period": pid, "path": f"G1K/{pid}.u8", "dtype": "uint8",
                               "scale": 1 / 254, "offset": 0, "nodata": 255, "sha256": _sha(dirs[ID_FRAC] / f"{pid}.u8"),
                               "min": float(q.min()) / 254, "max": float(q.max()) / 254})
        files[ID_NOCHE].append({"grid": "G1K", "period": pid, "path": f"G1K/{pid}.u16", "dtype": "uint16",
                                "scale": 1 / 60, "offset": 0, "nodata": 65535,
                                "sha256": _sha(dirs[ID_NOCHE] / f"{pid}.u16"),
                                "min": float(nn.min()) / 60, "max": float(nn.max()) / 60})
        files[ID_NOTA].append({"grid": "G1K", "period": pid, "path": f"G1K/{pid}.u8", "dtype": "uint8",
                               "sha256": _sha(dirs[ID_NOTA] / f"{pid}.u8"), "min": float(s.min()), "max": float(s.max())})
        per[pid] = {"start": _iso(a), "end": _iso(b)}
        log(f"   {pid}: luz media {float(q.mean()) / 254:.3f} · noche máx {float(nn.max()) / 60:.1f} h")
    del mm_f, mm_n, mm_s
    per_media = {}
    if con_media:
        a0 = min(a for a, _ in periodos.values())
        b0 = max(b for _, b in periodos.values())
        media = (suma / n_mues.sum()).astype("<f4")
        ruta = dirs[ID_FRAC] / f"{con_media}.f32"
        media.tofile(ruta)
        files[ID_FRAC].append({"grid": "G1K", "period": con_media, "path": f"G1K/{con_media}.f32", "dtype": "float32",
                               "sha256": _sha(ruta), "min": float(media.min()), "max": float(media.max())})
        per_media[con_media] = {"start": _iso(a0), "end": _iso(b0)}

    params = {"observerHeightM": C.OBSERVER_HEIGHT_M, "sunCriterion": "diskFraction",
              "samplingSeconds": paso_s, "azimuths": NBINS, "horizonMinM": C.G1K_HORIZON_MIN_M,
              "horizonMaxM": C.HORIZON_MAX_M, "frame": C.EPHEM_FRAME, "abcorr": C.ABCORR}
    metodo = ("LOLA LDEM_64 horizons ray-marched on the 1737.4 km sphere (72 azimuths, observer 2 m, 0.5-300 km), "
              "computed on demand in the Sun's azimuth and only as far as terrain could still hide the lower solar "
              "limb; SPICE DE440 Sun in MOON_ME, LT+S, real angular radius; visible disk fraction per sample.")
    comun = {"version": "0.2.0", "owner": "T3 · Luz (pol)", "fidelity": "computed", "sources": FUENTES_SOL}
    _guardar_meta(ID_FRAC, {**comun, "id": ID_FRAC, "title": "Average visible Sun fraction",
                            "description": "Time-average of the visible solar disk fraction above the local LOLA horizon.",
                            "units": "fraction", "validRange": [0, 1], "kind": "series", "combine": "mean",
                            "method": metodo, "params": params}, files[ID_FRAC], {**per, **per_media})
    _guardar_meta(ID_NOCHE, {**comun, "id": ID_NOCHE, "title": "Longest night",
                             "description": "Longest continuous run with visible Sun fraction < 0.05 inside the period.",
                             "units": "h", "validRange": [0, 1100], "kind": "series", "combine": "max",
                             "method": metodo + " Night = visible fraction < 0.05; run length in samples × step.",
                             "params": {**params, "nightThreshold": NOCHE_UMBRAL}}, files[ID_NOCHE], per)
    _guardar_meta(ID_NOTA, {**comun, "id": ID_NOTA, "title": "Sunlight score (0-100)",
                            "description": "Quick-look 0-100 score: percentage of the solar disk visible on average.",
                            "units": "index", "validRange": [0, 100], "kind": "series", "combine": "mean",
                            "method": "Derived from sun.visible_fraction.mean, same periods.",
                            "params": {"derivedFrom": ID_FRAC, "function": "round(100 * f)"}}, files[ID_NOTA], per)
    log(f"Listo: {C.LAYERS_DIR / ID_FRAC}")


def puntuacio_del_dia(data, paso_min: float = 10.0) -> np.ndarray:
    """Matriz G1K (5458 x 10916, uint8, 0-100) de la nota de luz para un día UTC."""
    if isinstance(data, datetime):
        d = data.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    elif hasattr(data, "year"):
        d = datetime(data.year, data.month, data.day, tzinfo=timezone.utc)
    else:
        d = datetime.strptime(str(data), "%Y-%m-%d").replace(tzinfo=timezone.utc)
    pid = d.strftime("%Y-%m-%d")
    ejecutar({pid: (d, d + timedelta(days=1))}, paso_min * 60)
    return np.fromfile(C.LAYERS_DIR / ID_NOTA / "G1K" / f"{pid}.u8", np.uint8).reshape(C.G1K_ROWS, C.G1K_COLS)


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("data", nargs="?", help="AAAA-MM-DD: día que llega al programa (por defecto, hoy en UTC)")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--mes", nargs="+", help="AAAA-MM [AAAA-MM ...]")
    g.add_argument("--estandar", action="store_true", help="60 meses 2026-2030 + media 2026-2030")
    ap.add_argument("--paso-min", type=float, default=None, help="minutos entre muestras (10 por día, 60 por mes)")
    a = ap.parse_args(argv)
    if a.mes:
        todos = periodos_estandar()
        ejecutar({m: todos[m] for m in a.mes}, (a.paso_min or 60) * 60)
    elif a.estandar:
        ejecutar(periodos_estandar(), (a.paso_min or 60) * 60, con_media="2026-2030")
    else:
        puntuacio_del_dia(a.data or datetime.now(timezone.utc).strftime("%Y-%m-%d"), a.paso_min or 10)


if __name__ == "__main__":
    main()
