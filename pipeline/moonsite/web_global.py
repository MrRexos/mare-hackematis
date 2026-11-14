"""Integración: capas G1K → versión web W4 para la vista "Whole Moon".

Lee las capas del contrato (layers/<id>/layer.json + binarios G1K) y escribe en
web/public/data/global/ una copia reducida a W4 (1440 × 720, 0,25° por celda, misma
orientación que G1K: columna 0 desde −180°, fila 0 desde +90°). Cada celda W4 es la
media de las celdas G1K cuyo centro cae dentro (contrato §2: "media ponderada por área";
dentro de una celda de 0,25° el peso cos(lat) es prácticamente constante).

Capas que usa la web (las que hay en las ramas Jan, Nil y pol):
    sun     sun.visible_fraction.mean      (T3, pol)   fracción 0-1, por periodo
    night   sun.longest_night_h.max        (T3, pol)   horas, por periodo
    earth   earth.visible_fraction.mean    (T4, Nil)   fracción 0-1, por periodo
    slope   terrain.slope                  (T1, Jan)   grados, estática

También genera global/hillshade.png (relieve sombreado de LOLA LDEM_64) si está en .cache.

Uso (desde pipeline/, después de generar las capas):
    python -m moonsite.web_global
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

from . import config as C

OUT = C.WEB_DATA / "global"
W4_COLS, W4_ROWS = 1440, 720
DTYPES = {"float32": "<f4", "int16": "<i2", "uint16": "<u2", "uint8": "u1"}

CAPAS = {
    "sun": {"id": "sun.visible_fraction.mean", "label": "Sunlight", "branch": "pol (T3)"},
    "night": {"id": "sun.longest_night_h.max", "label": "Longest night", "branch": "pol (T3)"},
    "earth": {"id": "earth.visible_fraction.mean", "label": "Earth view", "branch": "Nil (T4)"},
    "slope": {"id": "terrain.slope", "label": "Slope", "branch": "Jan (T1)"},
}


def _cargar(layer_dir: Path, f: dict) -> np.ndarray:
    a = np.fromfile(layer_dir / f["path"], dtype=DTYPES[f["dtype"]])
    a = a.reshape(C.G1K_ROWS, C.G1K_COLS)
    if f["dtype"] == "float32":
        return a.astype(np.float32, copy=False)
    v = a.astype(np.float32)
    if "nodata" in f:
        v[a == f["nodata"]] = np.nan
    return v * np.float32(f.get("scale", 1.0)) + np.float32(f.get("offset", 0.0))


def _cortes(n_src: int, n_dst: int) -> np.ndarray:
    """Índice de la primera celda G1K de cada celda W4 (por centro de celda)."""
    centros = (np.arange(n_src) + 0.5) / n_src
    destino = np.floor(centros * n_dst).astype(np.int64)
    return np.searchsorted(destino, np.arange(n_dst))


def a_w4(a: np.ndarray) -> np.ndarray:
    """Media (sin NaN) de las celdas G1K que caen en cada celda W4."""
    fc = _cortes(C.G1K_COLS, W4_COLS)
    fr = _cortes(C.G1K_ROWS, W4_ROWS)
    ok = np.isfinite(a)
    s = np.add.reduceat(np.where(ok, a, 0).astype(np.float64), fc, axis=1)
    n = np.add.reduceat(ok.astype(np.int32), fc, axis=1)
    s = np.add.reduceat(s, fr, axis=0)
    n = np.add.reduceat(n, fr, axis=0)
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(n > 0, s / n, np.nan).astype(np.float32)


def _sombreado():
    img = C.LOLA_GLOBAL["ldem64"].dest
    if not img.exists():
        return None
    from PIL import Image

    from .pds import CylRaster

    d = CylRaster.open(img, C.LOLA_GLOBAL["ldem64"].url)
    b = d.raw.shape[0] // W4_ROWS
    z = d.raw.reshape(W4_ROWS, b, W4_COLS, b).mean(axis=(1, 3)) * d.k + d.add
    # Recolocar para que la columna 0 empiece en −180° (LDEM_64 empieza en lon_west)
    desplaza = int(round(((-180.0 - d.lon_west) % 360.0) / 0.25))
    z = np.roll(z, -desplaza, axis=1)
    lat = np.radians(90 - (np.arange(W4_ROWS) + 0.5) * 0.25)
    px = 2 * np.pi * C.MOON_R_M / W4_COLS
    gy, gx = np.gradient(z)
    gx = gx / (px * np.cos(lat).clip(0.05)[:, None])
    gy = -gy / (np.pi * C.MOON_R_M / W4_ROWS)
    nx, ny = -gx * 6, -gy * 6
    s = (-0.5 * nx + 0.5 * ny + 0.707) / np.sqrt(nx * nx + ny * ny + 1)
    g = np.clip(70 + 150 * s, 0, 255).astype(np.uint8)
    OUT.mkdir(parents=True, exist_ok=True)
    Image.fromarray(g, "L").save(OUT / "hillshade.png", optimize=True)
    return "global/hillshade.png"


def main(argv=None) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {
        "grid": {"name": "W4", "cols": W4_COLS, "rows": W4_ROWS, "stepDeg": 0.25, "lon0": -180.0, "lat0": 90.0,
                 "order": "row-major, row 0 at +90°, column 0 at −180°E", "from": "G1K 10916 × 5458, mean of cells"},
        "layers": {},
    }
    for key, spec in CAPAS.items():
        d = C.LAYERS_DIR / spec["id"]
        mp = d / "layer.json"
        if not mp.exists():
            print(f"   (falta {spec['id']}: se omite)")
            continue
        meta = json.loads(mp.read_text(encoding="utf-8"))
        files = [f for f in meta["files"] if f["grid"] == "G1K" and (d / f["path"]).exists()]
        if not files:
            print(f"   ({spec['id']}: sin binarios G1K en {d}; se omite)")
            continue
        periodos = {}
        (OUT / key).mkdir(parents=True, exist_ok=True)
        for f in files:
            w4 = a_w4(_cargar(d, f))
            nombre = f"{key}/{f['period']}.f32"
            w4.astype("<f4").tofile(OUT / nombre)
            p = meta.get("periods", {}).get(f["period"], {})
            periodos[f["period"]] = {"file": f"global/{nombre}", "start": p.get("start"), "end": p.get("end")}
            print(f"   {spec['id']} [{f['period']}] → {nombre}")
        manifest["layers"][key] = {
            "id": spec["id"], "label": spec["label"], "branch": spec["branch"], "units": meta.get("units"),
            "kind": meta.get("kind"), "combine": meta.get("combine", "none"), "fidelity": meta.get("fidelity"),
            "title": meta.get("title"), "sources": meta.get("sources", []), "periods": periodos,
        }
    hs = _sombreado()
    if hs:
        manifest["hillshade"] = hs
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Listo: {OUT / 'manifest.json'} ({', '.join(manifest['layers']) or 'sin capas'})")


if __name__ == "__main__":
    main(sys.argv[1:])
