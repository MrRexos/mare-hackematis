"""Trabajo T7 · Temperatura de la superficie de toda la Luna (LRO Diviner).

La temperatura de un punto de la Luna depende casi solo de su **hora local** (dónde está
el Sol en su cielo) y de su latitud: unos 390 K a mediodía en el ecuador, unos 95 K antes
del amanecer. Por eso no hace falta un modelo ni un cálculo por fecha: Diviner ya midió la
curva completa día-noche de cada celda.

Datos: LRO Diviner Global Cumulative Products (Williams et al. 2017, Icarus 283, 300-325;
NASA PDS, LRO-L-DLRE-5-GCP-V1.0). Temperatura bolométrica media de todas las pasadas en
nadir de 2009 a 2015, en celdas de 0,5° (la misma malla de la vista Whole Moon) y 0,25 h de
hora local. Al ser medida, ya incluye el relieve, el albedo y las rocas de cada celda.

Qué genera:

1. Para la web (web/public/data/global/temp_diurnal.u8): la curva de temperatura de cada
   celda en 48 tramos de hora local (cada 0,5 h lunar ≈ 14,8 h reales), 1 byte por valor
   (K = q · 1,6). Con ella el navegador saca la temperatura de cada hora de la misión con
   una simple consulta: hora local = 12 + (longitud − longitud subsolar) / 15.
   Así la temperatura SÍ varía con las fechas de la misión, sin coste de cálculo.

2. Para el contrato (layers/, malla G1K): `thermal.max_temp_k` y `thermal.min_temp_k`,
   el máximo y el mínimo de la curva de cada celda (no dependen de la fecha).

Huecos: un tramo sin observaciones se rellena con la forma de la curva media de su latitud
más la diferencia de la propia celda respecto a ella (interpolada en hora local); las
celdas casi vacías toman la curva de su latitud.

Uso (desde pipeline/):
    python -m moonsite.fetch thermal          # 18 ficheros, 2,8 GB
    python -m moonsite.thermal_global         # web + capas del contrato
    python -m moonsite.thermal_global --web   # solo los datos de la web
"""

from __future__ import annotations

import hashlib
import json
import sys
import time
import warnings

import numpy as np

from . import config as C

OUT = C.WEB_DATA / "global"
ROWS, COLS = 360, 720            # 0,5°: fila 0 desde +90°, columna 0 desde −180°
NLT = 96                         # tramos de hora local del producto (0,25 h)
WEB_BINS = 48                    # tramos que usa la web (0,5 h de hora local)
SCALE_K = 1.6                    # 1 byte: K = q · 1,6 (0 … 406 K), 255 = sin dato
MIN_VALID = 6                    # con menos tramos medidos, la celda usa la curva de su latitud
ROW_BYTES = 113
CAMPOS = np.dtype({"names": ["clon", "clat", "ltim", "tbol"], "formats": ["S7", "S6", "S6", "S9"],
                   "offsets": [0, 9, 17, 102], "itemsize": ROW_BYTES})
FUENTES = [{
    "name": "LRO Diviner Global Cumulative Products (GCP)",
    "url": f"{C.PDS_DIVINER}/data_derived_gcp/",
    "citation": "Williams et al. (2017), Icarus 283, 300-325; LRO-L-DLRE-5-GCP-V1.0, NASA PDS Geosciences Node",
}]


def leer(log=print) -> np.ndarray:
    """Temperatura bolométrica medida [fila, columna, tramo de hora local], NaN sin dato."""
    tb = np.full((ROWS, COLS, NLT), np.nan, np.float32)
    for banda, f in C.DIVINER_GCP.items():
        if not f.dest.exists():
            raise FileNotFoundError(f"Falta {f.dest.name}: ejecuta `python -m moonsite.fetch thermal`")
        a = np.memmap(f.dest, CAMPOS, "r", offset=ROW_BYTES)          # salta la cabecera
        lon, lat = a["clon"].astype(np.float32), a["clat"].astype(np.float32)
        lt, t = a["ltim"].astype(np.float32), a["tbol"].astype(np.float32)
        i = np.rint((89.75 - lat) / 0.5).astype(np.int64)
        j = np.rint((lon + 179.75) / 0.5).astype(np.int64)
        k = np.floor(lt / 0.25).astype(np.int64)
        ok = t > 0                                                     # −9999 = sin observaciones
        tb[i[ok], j[ok], k[ok]] = t[ok]
        log(f"   {banda}: {int(ok.sum())} tramos con medida de {t.size}")
    return tb


def a_tramos(tb: np.ndarray, bins: int) -> np.ndarray:
    """Media de los tramos de 0,25 h que caen en cada tramo más ancho (sin contar huecos)."""
    g = tb.reshape(ROWS, COLS, bins, NLT // bins)
    n = np.isfinite(g).sum(axis=3)
    return np.where(n > 0, np.nansum(g, axis=3) / np.maximum(n, 1), np.nan).astype(np.float32)


def _curva_de_latitud(c: np.ndarray) -> np.ndarray:
    """Curva media día-noche de cada fila (latitud), sin huecos: [filas, tramos]."""
    filas, _cols, nb = c.shape
    with np.errstate(invalid="ignore"), warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        m = np.nanmean(c, axis=1)
    x = np.arange(nb, dtype=np.float64)
    for i in range(filas):
        ok = np.isfinite(m[i])
        if ok.all():
            continue
        if ok.sum() >= 2:
            m[i, ~ok] = np.interp(x[~ok], x[ok], m[i, ok], period=nb)
    for i in np.nonzero(~np.isfinite(m).all(axis=1))[0]:                # fila entera vacía: la vecina
        vec = [r for r in (i - 1, i + 1) if 0 <= r < filas and np.isfinite(m[r]).all()]
        if vec:
            m[i] = m[vec[0]]
    return m


def rellenar(c: np.ndarray, min_valid: int = MIN_VALID) -> tuple[np.ndarray, dict]:
    """Rellena los tramos sin medida de cada celda.

    Un hueco no se interpola en línea recta entre sus vecinos (si cae sobre el amanecer
    mezclaría noche y día): se usa la FORMA de la curva media de esa latitud y se le suma
    la diferencia de la celda respecto a esa curva, interpolada en hora local (periódica).
    Las celdas con menos de `min_valid` tramos medidos toman la curva de su latitud.
    """
    filas, cols, nb = c.shape
    base = _curva_de_latitud(c)
    out = c.copy()
    x = np.arange(nb, dtype=np.float64)
    ok = np.isfinite(c)
    nval = ok.sum(axis=2)
    pobres = nval < min_valid
    for i in range(filas):
        res = c[i] - base[i]
        for j in np.nonzero((nval[i] < nb) & ~pobres[i])[0]:
            m = ok[i, j]
            out[i, j, ~m] = base[i, ~m] + np.interp(x[~m], x[m], res[j, m], period=nb)
        out[i][pobres[i]] = base[i]
    np.maximum(out, 0, out=out)
    info = {"gapsFilledPct": round(100.0 * float((~ok).mean()), 2), "cellsFromLatitudeMeanPct": round(100.0 * float(pobres.mean()), 3)}
    return out, info


def curvas(log=print) -> tuple[np.ndarray, dict]:
    """Curva de temperatura de cada celda en WEB_BINS tramos de hora local, sin huecos (K)."""
    t0 = time.time()
    tb = leer(log)
    c, info = rellenar(a_tramos(tb, WEB_BINS))
    info["measuredQuarterHourBinsPct"] = round(100.0 * float(np.isfinite(tb).mean()), 2)
    log(f"   curvas {ROWS} × {COLS} × {WEB_BINS} en {time.time() - t0:.0f} s · de {float(np.nanmin(c)):.0f} a "
        f"{float(np.nanmax(c)):.0f} K · huecos rellenados {info['gapsFilledPct']} % · "
        f"celdas con curva de su latitud {info['cellsFromLatitudeMeanPct']} %")
    return c, info


def generar_web(c: np.ndarray, info: dict) -> dict:
    """Escribe global/temp_diurnal.u8 y devuelve la entrada del manifest."""
    q = np.where(np.isfinite(c), np.clip(np.rint(c / SCALE_K), 0, 254), 255).astype(np.uint8)
    OUT.mkdir(parents=True, exist_ok=True)
    q.tofile(OUT / "temp_diurnal.u8")
    return {"thermal": {
        "file": "global/temp_diurnal.u8", "dtype": "uint8", "bins": WEB_BINS, "scaleK": SCALE_K, "nodata": 255,
        "binCentreHours": "(k + 0.5) * 24 / bins of local solar time (12 = noon)",
        "localTime": "12 + (cell longitude − subsolar longitude) / 15, in hours, wrapped to 0–24",
        "quantity": "bolometric brightness temperature of the surface (K), 2009–2015 mean of nadir observations",
        "source": "LRO Diviner Global Cumulative Products (Williams et al. 2017), NASA PDS",
        "sources": FUENTES, "fidelity": "measured", **info,
    }}


def _sha(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(8 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _a_g1k(a: np.ndarray) -> np.ndarray:
    """Celda G1K ← celda de 0,5° que contiene su centro (el dato de origen es de 0,5°)."""
    paso = 360.0 / C.G1K_COLS
    i = np.minimum(((np.arange(C.G1K_ROWS) + 0.5) * paso / 0.5).astype(np.int64), ROWS - 1)
    j = np.minimum(((np.arange(C.G1K_COLS) + 0.5) * paso / 0.5).astype(np.int64), COLS - 1)
    return a[np.ix_(i, j)]


def generar_contrato(c: np.ndarray, info: dict, log=print) -> None:
    """layers/thermal.max_temp_k y layers/thermal.min_temp_k en G1K (UInt16, K = q · 0,01)."""
    capas = {
        "thermal.max_temp_k": ("Maximum surface temperature", "Hottest point of the day-night cycle", np.nanmax(c, axis=2)),
        "thermal.min_temp_k": ("Minimum surface temperature", "Coldest point of the day-night cycle", np.nanmin(c, axis=2)),
    }
    for lid, (titulo, que, a) in capas.items():
        d = C.LAYERS_DIR / lid
        (d / "G1K").mkdir(parents=True, exist_ok=True)
        g = _a_g1k(a)
        q = np.where(np.isfinite(g), np.clip(np.rint(g * 100.0), 0, 65534), 65535).astype("<u2")
        ruta = d / "G1K" / "static.u16"
        q.tofile(ruta)
        meta = {
            "id": lid, "version": "0.2.0", "title": titulo,
            "description": f"{que}: bolometric surface temperature measured by LRO Diviner, per 0.5° cell.",
            "units": "K", "validRange": [0, 450], "kind": "static", "owner": "T7 · Temperatura",
            "fidelity": "approximate",
            "method": ("Diviner Global Cumulative Product: bolometric brightness temperature binned at 0.5° and 0.25 h of "
                       f"local time (nadir, 2009-2015). Averaged to {WEB_BINS} local-time bins, gaps filled by periodic "
                       "interpolation in local time, then the extreme of each cell's diurnal curve. Each G1K cell takes "
                       "the 0.5° cell that contains its centre: finer grids add no detail."),
            "params": {"sourceResolutionDeg": 0.5, "localTimeBins": WEB_BINS, "resampling": "nearest", **info},
            "sources": FUENTES,
            "files": [{"grid": "G1K", "period": "static", "path": "G1K/static.u16", "dtype": "uint16", "scale": 0.01,
                       "offset": 0, "nodata": 65535, "sha256": _sha(ruta),
                       "min": float(np.nanmin(g)), "max": float(np.nanmax(g))}],
        }
        (d / "layer.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        log(f"   {lid}: de {float(np.nanmin(g)):.1f} a {float(np.nanmax(g)):.1f} K")
    cat = C.LAYERS_DIR / "catalog.json"
    if cat.exists():
        j = json.loads(cat.read_text(encoding="utf-8"))
        for lid in capas:
            if lid not in j["layers"]:
                j["layers"].append(lid)
        cat.write_text(json.dumps(j, indent=2) + "\n", encoding="utf-8")


def disponible() -> bool:
    return all(f.dest.exists() for f in C.DIVINER_GCP.values())


def main(argv=None) -> None:
    argv = sys.argv[1:] if argv is None else argv
    print("Temperatura Diviner (GCP)...")
    c, info = curvas()
    entrada = generar_web(c, info)
    mp = OUT / "manifest.json"
    if mp.exists():                       # añade su parte sin tocar el resto
        m = json.loads(mp.read_text(encoding="utf-8"))
        m.update(entrada)
        mp.write_text(json.dumps(m, indent=2, ensure_ascii=False), encoding="utf-8")
    if "--web" not in argv:
        generar_contrato(c, info)
    print(f"Listo: {OUT / 'temp_diurnal.u8'}")


if __name__ == "__main__":
    main()
