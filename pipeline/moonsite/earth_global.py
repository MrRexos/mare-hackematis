"""Trabajo T4 · Tierra visible en la malla global G1K (contrato de datos v0.2, §7).

Para cada celda de la malla 10 916 × 5 458 calcula la fracción del tiempo en que el
centro de la Tierra está por encima del horizonte del terreno, visto a 2 m del suelo.

Datos (todos de la NASA):
- Relieve: LOLA LDEM_64 global (NASA PDS), 64 px/grado.
- Tierra: SPICE DE440 (NASA/JPL NAIF), marco MOON_ME, aberración LT+S, una posición
  por hora. Se incluye la paralaje (vector Tierra − observador).

Método, celda a celda (numba, en paralelo):
1. Altura del observador = LOLA en el centro de la celda + 2 m.
2. Cota rápida: en el periodo, la dirección de la Tierra vista desde el centro de la Luna
   cae dentro de un cono de semiángulo Λ (libración). Con eso se acota la elevación de
   la Tierra en la celda. Si es seguro que siempre está visible o nunca, no se calcula más.
3. Si no, se traza el horizonte LOLA solo en los acimuts por donde pasa la Tierra
   (rayos sobre la esfera, con curvatura, hasta 300 km) y se compara hora a hora:
   visible si elevación de la Tierra > horizonte interpolado en su acimut.

Salida (layers/, formato del contrato):
- earth.visible_fraction.mean/G1K/<periodo>.u8   fracción 0-1 (scale 1/254, nodata 255)
- earth.visible_fraction.mean/G1K/2026-2030.f32  media 2026-2030 (con --estandar)
- suitability.earth/G1K/<periodo>.u8             nota 0-100 = % del tiempo con la Tierra
                                                 visible; 0 si no llega a EARTH_MIN_PCT

Desde otro script:
    from moonsite.earth_global import puntuacio_del_dia
    nota = puntuacio_del_dia(data)      # uint8 (5458, 10916), 0-100

Uso (desde pipeline/, tras `python -m moonsite.fetch global`):
    python -m moonsite.earth_global 2026-11-14            # el día que llega al programa
    python -m moonsite.earth_global                       # sin fecha: hoy (UTC)
    python -m moonsite.earth_global --mes 2026-11         # un mes
    python -m moonsite.earth_global --estandar            # 60 meses + media 2026-2030 (horas)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import time
from datetime import datetime, timedelta, timezone

import numpy as np
from numba import njit, prange

from . import config as C

R_KM = C.MOON_R_M / 1000.0
H_OBS_KM = C.OBSERVER_HEIGHT_M / 1000.0
NBINS = C.HORIZON_BINS
EL_SEGURA = 60.0      # por encima de 60° ningún horizonte de LOLA a 1 km tapa la Tierra
PARALAJE = 0.3        # grados: cota de la paralaje de la Tierra (máx. ~0,29°)
MARGEN_CONO = 0.5     # grados extra al semiángulo de libración Λ
ID_FRAC = "earth.visible_fraction.mean"
ID_NOTA = "suitability.earth"
DEG = math.pi / 180.0


# ---------------------------------------------------------------------------
# Núcleo numérico
# ---------------------------------------------------------------------------
@njit(cache=True, inline="always")
def _dem_km(raw, k_km, add_km, res, lat_max, lon_west, missing, lat, lon):
    n, m = raw.shape
    fi = (lat_max - lat) * res - 0.5
    fj = ((lon - lon_west) % 360.0) * res - 0.5
    i0 = int(math.floor(fi))
    j0 = int(math.floor(fj))
    wi = fi - i0
    wj = fj - j0
    if i0 < 0:
        i0, wi = 0, 0.0
    elif i0 > n - 2:
        i0, wi = n - 2, 1.0
    j0 = j0 % m
    j1 = (j0 + 1) % m
    a, b, c, d = raw[i0, j0], raw[i0, j1], raw[i0 + 1, j0], raw[i0 + 1, j1]
    if a == missing or b == missing or c == missing or d == missing:
        return -1e3  # sin dato: muy por debajo, no tapa nada
    v = (a * (1 - wi) * (1 - wj) + b * (1 - wi) * wj + c * wi * (1 - wj) + d * wi * wj)
    return v * k_km + add_km


@njit(cache=True)
def _horizonte(kbin, ux, uy, uz, nx, ny, nz, ex, ey, ez, r0, cd, sd, dist, dmax,
               raw, k_km, add_km, res, lat_max, lon_west, missing):
    """Elevación (grados) del horizonte en el acimut kbin·360/NBINS (horario desde el norte)."""
    a = kbin * 2.0 * math.pi / NBINS
    ca, sa = math.cos(a), math.sin(a)
    tx, ty, tz = nx * ca + ex * sa, ny * ca + ey * sa, nz * ca + ez * sa
    best = -1e9
    for s in range(dist.size):
        if dist[s] > dmax:
            break
        c, si = cd[s], sd[s]
        px, py, pz = c * ux + si * tx, c * uy + si * ty, c * uz + si * tz
        lat = math.asin(min(1.0, max(-1.0, pz))) / DEG
        lon = math.atan2(py, px) / DEG
        rt = R_KM + _dem_km(raw, k_km, add_km, res, lat_max, lon_west, missing, lat, lon)
        t = (rt * c - r0) / (rt * si)       # tangente de la elevación del punto del terreno
        if t > best:
            best = t
    return math.atan(best) / DEG


@njit(cache=True, parallel=True)
def contar_bloque(lat_f, lon_c, raw, k_km, add_km, res, lat_max, lon_west, missing,
                  hmin_km, hmax_km, E, pidx, ub, lam, dist, cd, sd, salida):
    """salida[p, fila, col] = horas del periodo p con la Tierra visible."""
    nr, nc = lat_f.size, lon_c.size
    P = pidx.size - 1
    dmax_total = dist[-1]
    lamc = lam + MARGEN_CONO
    slam = math.sin(lamc * DEG)
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
        th = math.acos(min(1.0, max(-1.0, ux * ub[0] + uy * ub[1] + uz * ub[2]))) / DEG
        el_max = 90.0 - th + lam
        el_min = 90.0 - th - lam - PARALAJE
        if el_min >= EL_SEGURA:                         # siempre visible
            for p in range(P):
                salida[p, r, col] = pidx[p + 1] - pidx[p]
            continue
        dip = math.acos(min(1.0, (R_KM + hmin_km) / r0)) / DEG
        if el_max < -dip - 0.01:                        # nunca por encima de ningún horizonte posible
            for p in range(P):
                salida[p, r, col] = 0
            continue
        # Rayos: si la Tierra está alta, el terreno que la puede tapar está cerca
        dmax = dmax_total
        if el_min > 0.2:
            dmax = min(dmax_total, (hmax_km - h0 + 0.01) / math.tan(el_min * DEG))
        hor = np.full(NBINS, np.nan)
        # Sector de acimuts por donde pasa la Tierra
        az0 = math.atan2(ub[0] * ex + ub[1] * ey + ub[2] * ez, ub[0] * nx + ub[1] * ny + ub[2] * nz) / DEG
        sth = math.sin(th * DEG)
        if sth <= slam:
            k_ini, k_fin = 0, NBINS - 1
        else:
            w = math.asin(slam / sth) / DEG
            k_ini = int(math.floor((az0 - w) / paso))
            k_fin = int(math.floor((az0 + w) / paso)) + 1
            if k_fin - k_ini >= NBINS:
                k_ini, k_fin = 0, NBINS - 1
        hz_max, hz_min = -1e9, 1e9
        for kk in range(k_ini, k_fin + 1):
            k = kk % NBINS
            if math.isnan(hor[k]):
                hor[k] = _horizonte(k, ux, uy, uz, nx, ny, nz, ex, ey, ez, r0, cd, sd, dist, dmax,
                                    raw, k_km, add_km, res, lat_max, lon_west, missing)
            hz_max = max(hz_max, hor[k])
            hz_min = min(hz_min, hor[k])
        if hz_max < el_min:                             # la Tierra siempre por encima del relieve
            for p in range(P):
                salida[p, r, col] = pidx[p + 1] - pidx[p]
            continue
        if hz_min > el_max:
            for p in range(P):
                salida[p, r, col] = 0
            continue
        ox, oy, oz = r0 * ux, r0 * uy, r0 * uz
        for p in range(P):
            cnt = 0
            for t in range(pidx[p], pidx[p + 1]):
                dx, dy, dz = E[t, 0] - ox, E[t, 1] - oy, E[t, 2] - oz
                dn = math.sqrt(dx * dx + dy * dy + dz * dz)
                el = math.asin((dx * ux + dy * uy + dz * uz) / dn) / DEG
                if el > hz_max:
                    cnt += 1
                    continue
                if el < hz_min:
                    continue
                az = math.atan2(dx * ex + dy * ey + dz * ez, dx * nx + dy * ny + dz * nz) / DEG
                f = (az % 360.0) / paso
                k0 = int(math.floor(f)) % NBINS
                k1 = (k0 + 1) % NBINS
                wf = f - math.floor(f)
                for k in (k0, k1):
                    if math.isnan(hor[k]):
                        hor[k] = _horizonte(k, ux, uy, uz, nx, ny, nz, ex, ey, ez, r0, cd, sd, dist,
                                            dmax_total, raw, k_km, add_km, res, lat_max, lon_west, missing)
                if el > hor[k0] * (1 - wf) + hor[k1] * wf:
                    cnt += 1
            salida[p, r, col] = cnt


def distancias_km() -> np.ndarray:
    d = [C.G1K_HORIZON_MIN_M]
    while d[-1] < C.HORIZON_MAX_M:
        d.append(d[-1] + max(C.G1K_HORIZON_STEP_M, 0.02 * d[-1]))
    return np.array(d) / 1000.0


def cono_libracion(E: np.ndarray) -> tuple[np.ndarray, float]:
    """Dirección media de la Tierra (desde el centro lunar) y semiángulo Λ (grados)."""
    u = E / np.linalg.norm(E, axis=1, keepdims=True)
    ub = u.mean(axis=0)
    ub /= np.linalg.norm(ub)
    lam = float(np.degrees(np.arccos(np.clip(u @ ub, -1, 1))).max())
    return ub, lam


def centros_g1k():
    paso = 360.0 / C.G1K_COLS
    lat = 90.0 - (np.arange(C.G1K_ROWS) + 0.5) * paso
    lon = -180.0 + (np.arange(C.G1K_COLS) + 0.5) * paso
    return lat, lon


def preparar(dem, E):
    """Argumentos fijos del núcleo para un DEM y unas efemérides."""
    dist = distancias_km()
    ub, lam = cono_libracion(E)
    k_km, add_km = dem.k / 1000.0, dem.add / 1000.0
    miss = dem.missing if dem.missing is not None else -32768
    hmin = float(dem.raw.min()) * k_km + add_km
    hmax = float(dem.raw.max()) * k_km + add_km
    return dict(raw=dem.raw, k_km=k_km, add_km=add_km, res=dem.res, lat_max=dem.lat_max, lon_west=dem.lon_west,
                missing=miss, hmin_km=hmin, hmax_km=hmax, ub=ub, lam=lam, dist=dist,
                cd=np.cos(dist / R_KM), sd=np.sin(dist / R_KM))


def bloques(dem, E, pidx, lat_f, lon_c, filas_bloque=16, log=print):
    """Genera (fila0, fila1, cuentas[P, filas, cols]) con las horas visibles por periodo.
    Va por bloques de filas para que la malla G1K quepa en memoria con 60 periodos."""
    a = preparar(dem, E)
    P = pidx.size - 1
    t0 = time.time()
    n = 0
    for j0 in range(0, lat_f.size, filas_bloque):
        j1 = min(lat_f.size, j0 + filas_bloque)
        out = np.zeros((P, j1 - j0, lon_c.size), np.uint16)
        contar_bloque(lat_f[j0:j1], lon_c, a["raw"], a["k_km"], a["add_km"], a["res"], a["lat_max"], a["lon_west"],
                      a["missing"], a["hmin_km"], a["hmax_km"], E, pidx, a["ub"], a["lam"], a["dist"], a["cd"],
                      a["sd"], out)
        yield j0, j1, out
        n += 1
        if log and (j1 == lat_f.size or n % 40 == 0):
            el = time.time() - t0
            log(f"   filas {j1}/{lat_f.size} · {el:.0f} s · quedan ~{el * (lat_f.size - j1) / j1:.0f} s")


def contar(dem, E, pidx, lat_f, lon_c, filas_bloque=16, log=None):
    """Versión en memoria (mallas pequeñas y tests)."""
    out = np.zeros((pidx.size - 1, lat_f.size, lon_c.size), np.uint16)
    for j0, j1, c in bloques(dem, E, pidx, lat_f, lon_c, filas_bloque, log):
        out[:, j0:j1] = c
    return out


# ---------------------------------------------------------------------------
# Efemérides (SPICE) y periodos
# ---------------------------------------------------------------------------
def _iso(d: datetime) -> str:
    return d.strftime("%Y-%m-%dT%H:%M:%SZ")


def periodos_estandar() -> dict:
    out = {}
    for y in range(2026, 2031):
        for m in range(1, 13):
            a = datetime(y, m, 1, tzinfo=timezone.utc)
            b = datetime(y + (m == 12), m % 12 + 1, 1, tzinfo=timezone.utc)
            out[f"{y}-{m:02d}"] = (a, b)
    return out


def tierra_spice(periodos: dict, paso_s: float):
    """Vectores Tierra desde el centro lunar (km, MOON_ME, LT+S) y límites de cada periodo."""
    import spiceypy as sp

    from .ephemeris import load_kernels

    load_kernels()
    bloques, pidx = [], [0]
    for a, b in periodos.values():
        et0 = sp.str2et(a.strftime("%Y-%m-%dT%H:%M:%S"))
        et1 = sp.str2et(b.strftime("%Y-%m-%dT%H:%M:%S"))
        n = int(round((et1 - et0) / paso_s))
        ets = et0 + (np.arange(n) + 0.5) * paso_s       # centro de cada intervalo
        pos, _ = sp.spkpos("EARTH", ets, C.EPHEM_FRAME, C.ABCORR, "MOON")
        bloques.append(np.asarray(pos))
        pidx.append(pidx[-1] + n)
    return np.vstack(bloques).astype(np.float64), np.array(pidx, np.int64)


# ---------------------------------------------------------------------------
# Escritura según el contrato
# ---------------------------------------------------------------------------
def _sha(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(8 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _meta_base(lid: str) -> dict:
    p = C.LAYERS_DIR / lid / "layer.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def _guardar_meta(lid: str, meta: dict, nuevos_files: list, nuevos_periodos: dict) -> None:
    viejo = _meta_base(lid)
    files = {(f["grid"], f["period"]): f for f in viejo.get("files", [])}
    for f in nuevos_files:
        files[(f["grid"], f["period"])] = f
    periods = {**viejo.get("periods", {}), **nuevos_periodos}
    meta["periods"] = dict(sorted(periods.items()))
    meta["files"] = sorted(files.values(), key=lambda f: f["period"])
    d = C.LAYERS_DIR / lid
    d.mkdir(parents=True, exist_ok=True)
    (d / "layer.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")


FUENTES = [
    {"name": "LOLA LDEM_64", "url": f"{C.PDS_LOLA}/data/lola_gdr/cylindrical/img/",
     "citation": "Smith et al. (2010), LOLA GDR, NASA PDS Geosciences Node"},
    {"name": "NAIF SPICE DE440", "url": f"{C.NAIF}/",
     "citation": "Park et al. (2021), AJ 161:105; moon_pa_de440_200625.bpc, moon_de440_250416.tf"},
]


def ejecutar(periodos: dict, paso_s: float = 3600.0, con_media: str | None = None, log=print) -> None:
    from .pds import CylRaster

    lid_dir = C.LAYERS_DIR / ID_FRAC / "G1K"
    nota_dir = C.LAYERS_DIR / ID_NOTA / "G1K"
    lid_dir.mkdir(parents=True, exist_ok=True)
    nota_dir.mkdir(parents=True, exist_ok=True)

    log("Relieve LOLA LDEM_64...")
    f = C.LOLA_GLOBAL["ldem64"]
    if not f.dest.exists():
        raise FileNotFoundError("Falta LDEM_64: ejecuta `python -m moonsite.fetch global`")
    dem = CylRaster.open(f.dest, f.url)
    comprobar_orientacion(dem)

    log(f"Tierra (SPICE) para {len(periodos)} periodos, paso {paso_s:.0f} s...")
    E, pidx = tierra_spice(periodos, paso_s)
    _, lam = cono_libracion(E)
    log(f"   {len(E)} instantes · libración Λ = {lam:.2f}°")

    lat, lon = centros_g1k()
    horas = np.diff(pidx)
    shape = (lat.size, lon.size)
    ids = list(periodos)
    mm_f = [np.memmap(lid_dir / f"{pid}.u8", np.uint8, "w+", shape=shape)
            for pid in ids]
    mm_n = [np.memmap(nota_dir / f"{pid}.u8", np.uint8, "w+", shape=shape) for pid in ids]
    total = np.zeros(shape, np.uint32) if con_media else None
    log("Visibilidad de la Tierra en G1K...")
    for j0, j1, c in bloques(dem, E, pidx, lat, lon, log=log):
        for p in range(len(ids)):
            frac = c[p] / horas[p]
            mm_f[p][j0:j1] = np.rint(frac * 254).astype(np.uint8)
            mm_n[p][j0:j1] = nota_0_100(frac)
        if total is not None:
            total[j0:j1] = c.sum(axis=0, dtype=np.uint32)

    files_f, files_n, per = [], [], {}
    for p, pid in enumerate(ids):
        a, b = periodos[pid]
        mm_f[p].flush(); mm_n[p].flush()
        q, n = mm_f[p], mm_n[p]
        files_f.append({"grid": "G1K", "period": pid, "path": f"G1K/{pid}.u8", "dtype": "uint8",
                        "scale": 1 / 254, "offset": 0, "nodata": 255, "sha256": _sha(lid_dir / f"{pid}.u8"),
                        "min": float(q.min()) / 254, "max": float(q.max()) / 254})
        files_n.append({"grid": "G1K", "period": pid, "path": f"G1K/{pid}.u8", "dtype": "uint8",
                        "sha256": _sha(nota_dir / f"{pid}.u8"), "min": float(n.min()), "max": float(n.max())})
        per[pid] = {"start": _iso(a), "end": _iso(b)}
        log(f"   {pid}: media {float(q.mean()) / 254:.3f}")
    del mm_f, mm_n
    if con_media:
        a0 = min(a for a, _ in periodos.values())
        b0 = max(b for _, b in periodos.values())
        media = (total / horas.sum()).astype("<f4")
        ruta = lid_dir / f"{con_media}.f32"
        media.tofile(ruta)
        files_f.append({"grid": "G1K", "period": con_media, "path": f"G1K/{con_media}.f32", "dtype": "float32",
                        "sha256": _sha(ruta), "min": float(media.min()), "max": float(media.max())})
        per[con_media] = {"start": _iso(a0), "end": _iso(b0)}

    params = {"observerHeightM": C.OBSERVER_HEIGHT_M, "earthCriterion": "centre above horizon, with parallax",
              "samplingSeconds": paso_s, "azimuths": NBINS, "horizonMinM": C.G1K_HORIZON_MIN_M,
              "horizonMaxM": C.HORIZON_MAX_M, "frame": C.EPHEM_FRAME, "abcorr": C.ABCORR}
    _guardar_meta(ID_FRAC, {
        "id": ID_FRAC, "version": "0.2.0", "title": "Average visible Earth fraction",
        "description": "Time-average of Earth's centre being above the local LOLA terrain horizon (direct-to-Earth line of sight).",
        "units": "fraction", "validRange": [0, 1], "kind": "series", "combine": "mean",
        "owner": "T4 · Tierra (Dani Font)", "fidelity": "computed",
        "method": ("LOLA LDEM_64 horizons ray-marched on the 1737.4 km sphere (72 azimuths, observer 2 m, 0.5-300 km, "
                   "only the azimuths Earth crosses) + SPICE DE440 Earth vector in MOON_ME, LT+S, with parallax; "
                   "hour-by-hour comparison, cells decided early when libration bounds make the answer certain."),
        "params": params, "sources": FUENTES}, files_f, per)
    _guardar_meta(ID_NOTA, {
        "id": ID_NOTA, "version": "0.2.0", "title": "Direct-to-Earth score (0-100)",
        "description": "Quick-look 0-100 score: percentage of time Earth is visible; 0 below the minimum.",
        "units": "index", "validRange": [0, 100], "kind": "series", "combine": "mean",
        "owner": "T4 · Tierra (Dani Font)", "fidelity": "computed",
        "method": "Derived from earth.visible_fraction.mean, same periods.",
        "params": {"derivedFrom": ID_FRAC, "minPct": C.EARTH_MIN_PCT,
                   "function": f"round(100 * f) if 100 * f >= {C.EARTH_MIN_PCT:g} else 0"},
        "sources": FUENTES}, files_n, {k: v for k, v in per.items() if k != con_media})
    log(f"Listo: {C.LAYERS_DIR / ID_FRAC} y {C.LAYERS_DIR / ID_NOTA}")


def nota_0_100(frac: np.ndarray) -> np.ndarray:
    pct = np.rint(frac * 100.0)
    return np.where(pct >= C.EARTH_MIN_PCT, pct, 0).astype(np.uint8)


def comprobar_orientacion(dem) -> None:
    """Shackleton y Mons Mouton (las mismas pruebas que T1) para no usar un DEM girado."""
    k_km, add_km = dem.k / 1000.0, dem.add / 1000.0
    miss = dem.missing if dem.missing is not None else -32768
    sh = _dem_km(dem.raw, k_km, add_km, dem.res, dem.lat_max, dem.lon_west, miss, -89.67, 129.78)
    mm = _dem_km(dem.raw, k_km, add_km, dem.res, dem.lat_max, dem.lon_west, miss, -85.43, 31.83)
    if not (sh < -2.0 and mm > 5.0):
        raise RuntimeError(f"LDEM_64 mal orientado: Shackleton {sh:.2f} km, Mons Mouton {mm:.2f} km")


def puntuacio_del_dia(data, paso_min: float = 10.0) -> np.ndarray:
    """Matriz G1K (5458 x 10916, uint8, 0-100) de la puntuación Tierra para un día.

    `data`: 'AAAA-MM-DD', date o datetime (día UTC completo). Escribe también las capas
    del contrato (fracción y nota) para ese día y devuelve la nota leída del disco.
    """
    if isinstance(data, datetime):
        d = data.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    elif hasattr(data, "year"):
        d = datetime(data.year, data.month, data.day, tzinfo=timezone.utc)
    else:
        d = datetime.strptime(str(data), "%Y-%m-%d").replace(tzinfo=timezone.utc)
    pid = d.strftime("%Y-%m-%d")
    ejecutar({pid: (d, d + timedelta(days=1))}, paso_min * 60)
    ruta = C.LAYERS_DIR / ID_NOTA / "G1K" / f"{pid}.u8"
    return np.fromfile(ruta, np.uint8).reshape(C.G1K_ROWS, C.G1K_COLS)


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("data", nargs="?", help="AAAA-MM-DD: día que llega al programa (por defecto, hoy en UTC)")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--dia", help="igual que el argumento posicional")
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
        dia = a.data or a.dia or datetime.now(timezone.utc).strftime("%Y-%m-%d")
        puntuacio_del_dia(dia, a.paso_min or 10)


if __name__ == "__main__":
    main()
