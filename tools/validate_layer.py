"""Valida una capa contra el contrato de datos v0.2 (docs/DATA_CONTRACT.md).

Uso:
    python tools/validate_layer.py layers/<id_de_capa> [layers/<otra> ...]

Comprueba, para cada fichero del layer.json:
  1. campos obligatorios e id con el formato correcto
  2. tamaño = filas × columnas × bandas × bytes del tipo
  3. SHA-256
  4. valores dentro de validRange (ignorando nodata / NaN)
  5. orientación con puntos conocidos (si la capa tiene prueba definida)
  6. solape global ↔ polar en 84–86° de latitud (si existen ambas mallas)

Sale con código 1 si algo falla. Solo necesita numpy.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import sys
from pathlib import Path

import numpy as np

R_M = 1_737_400.0
DTYPES = {"float32": "<f4", "int16": "<i2", "uint16": "<u2", "uint8": "u1"}
REQUIRED = ["id", "version", "title", "units", "validRange", "kind", "owner", "fidelity", "method", "sources", "files"]
GRIDS = {
    # Malla oficial: 10 916 × 5 458, columna 0 desde −180°, fila 0 desde +90° (contrato v0.2, §2)
    "G1K": {"type": "eqc", "cols": 10916, "rows": 5458},
    # Derivada para la web (la genera la integración)
    "W4": {"type": "eqc", "cols": 1440, "rows": 720},
    # Módulo polar interno de la web
    "PS1K": {"type": "polar", "south": True, "n": 400, "px": 1000.0},
}
GLOBAL_REF = "G1K"

# Pruebas de orientación: (lat, lon, comparación, umbral, explicación)
ORIENTATION = {
    "terrain.elevation": [(-89.67, 129.78, "<", -2000, "Shackleton crater floor (LOLA −2786 m)"),
                          (-85.43, 31.83, ">", 5000, "Mons Mouton (LOLA +6395 m)")],
    "earth.visible_fraction.mean": [(0, 0, ">", 0.95, "centre of the near side"),
                                    (0, 180, "<", 0.05, "centre of the far side")],
    "sun.visible_fraction.mean": [(0, 0, "between", (0.40, 0.55), "equator, long periods")],
}


#: Pruebas que solo tienen sentido con periodos largos (≥ 1 año).
LONG_PERIOD_ONLY = {"sun.visible_fraction.mean"}


def _period_days(meta: dict, period: str) -> float:
    p = meta.get("periods", {}).get(period)
    if not p:
        return float("inf")  # static
    from datetime import datetime
    a = datetime.fromisoformat(p["start"].replace("Z", "+00:00"))
    b = datetime.fromisoformat(p["end"].replace("Z", "+00:00"))
    return (b - a).total_seconds() / 86400.0


def grid_shape(g: str) -> tuple[int, int]:
    d = GRIDS[g]
    if d["type"] == "eqc":
        return d["rows"], d["cols"]
    return d["n"], d["n"]


def pixel_of(g: str, lat: float, lon: float):
    """(fila, columna) del píxel que contiene (lat, lon), o None si cae fuera."""
    d = GRIDS[g]
    rows, cols = grid_shape(g)
    if d["type"] == "eqc":
        step = 360.0 / cols  # = 180 / rows
        c = int(math.floor(((lon + 180.0) % 360.0) / step)) % cols
        r = min(rows - 1, max(0, int(math.floor((90.0 - lat) / step))))
        return r, c
    if d["south"]:
        rho = 2 * R_M * math.tan(math.radians(45 + lat / 2))
        x, y = rho * math.sin(math.radians(lon)), rho * math.cos(math.radians(lon))
    else:
        rho = 2 * R_M * math.tan(math.radians(45 - lat / 2))
        x, y = rho * math.sin(math.radians(lon)), -rho * math.cos(math.radians(lon))
    half = d["n"] * d["px"] / 2
    c = int(math.floor((x + half) / d["px"]))
    r = int(math.floor((half - y) / d["px"]))
    return (r, c) if 0 <= r < rows and 0 <= c < cols else None


def polar_centre_latlon(g: str, r: int, c: int):
    d = GRIDS[g]
    half = d["n"] * d["px"] / 2
    x = -half + (c + 0.5) * d["px"]
    y = half - (r + 0.5) * d["px"]
    rho = math.hypot(x, y)
    colat = 2 * math.atan(rho / (2 * R_M))
    if d["south"]:
        return math.degrees(-(math.pi / 2 - colat)), math.degrees(math.atan2(x, y))
    return math.degrees(math.pi / 2 - colat), math.degrees(math.atan2(x, -y))


def load(layer_dir: Path, f: dict) -> np.ndarray:
    rows, cols = grid_shape(f["grid"])
    bands = f.get("bands", 1)
    a = np.fromfile(layer_dir / f["path"], dtype=DTYPES[f["dtype"]])
    a = a.reshape(rows, cols, bands) if bands > 1 else a.reshape(rows, cols)
    if f["dtype"] == "float32":
        return a
    v = a.astype(np.float32)  # float32 para no duplicar memoria con matrices G1K
    if "nodata" in f:
        v[a == f["nodata"]] = np.nan
    return v * np.float32(f.get("scale", 1.0)) + np.float32(f.get("offset", 0.0))


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for chunk in iter(lambda: fh.read(8 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def validate(layer_dir: Path) -> list[str]:
    errors: list[str] = []
    meta_path = layer_dir / "layer.json"
    if not meta_path.exists():
        return [f"{layer_dir}: falta layer.json"]
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    for k in REQUIRED:
        if k not in meta:
            errors.append(f"falta el campo obligatorio '{k}'")
    if errors:
        return errors
    lid = meta["id"]
    if not re.fullmatch(r"[a-z]+(\.[a-z0-9_]+)+", lid):
        errors.append(f"id '{lid}' no sigue <dominio>.<magnitud>[.<estadística>]")
    if meta["kind"] in ("stat", "series"):
        if not meta.get("periods"):
            errors.append("kind stat/series necesita 'periods'")
        if meta.get("combine") not in ("mean", "max", "none"):
            errors.append("kind stat/series necesita 'combine' (mean, max o none)")
    lo, hi = meta["validRange"]
    arrays: dict[tuple[str, str], np.ndarray] = {}

    for f in meta["files"]:
        tag = f"[{f['grid']}/{f['period']}]"
        p = layer_dir / f["path"]
        if f["grid"] not in GRIDS:
            errors.append(f"{tag} malla desconocida"); continue
        if f["dtype"] not in DTYPES:
            errors.append(f"{tag} tipo desconocido {f['dtype']}"); continue
        if f["period"] != "static" and f["period"] not in meta.get("periods", {}):
            errors.append(f"{tag} periodo '{f['period']}' no está en 'periods'")
        if not p.exists():
            errors.append(f"{tag} no existe {f['path']}"); continue
        rows, cols = grid_shape(f["grid"])
        expected = rows * cols * f.get("bands", 1) * np.dtype(DTYPES[f["dtype"]]).itemsize
        if p.stat().st_size != expected:
            errors.append(f"{tag} tamaño {p.stat().st_size} B, esperado {expected} B ({rows}×{cols})"); continue
        sha = sha256_file(p)
        if sha != f["sha256"]:
            errors.append(f"{tag} SHA-256 no coincide ({sha[:12]}… ≠ {f['sha256'][:12]}…)")
        a = load(layer_dir, f)
        finite = a[np.isfinite(a)]
        if finite.size == 0:
            errors.append(f"{tag} no hay ningún valor válido"); continue
        if finite.min() < lo - 1e-6 or finite.max() > hi + 1e-6:
            errors.append(f"{tag} valores fuera de validRange [{lo}, {hi}]: {finite.min():.4g} … {finite.max():.4g}")
        arrays[(f["grid"], f["period"])] = a

        for lat, lon, op, thr, why in ORIENTATION.get(lid, []):
            if lid in LONG_PERIOD_ONLY and _period_days(meta, f["period"]) < 365:
                continue  # contrato §9: la prueba del Sol solo vale para periodos ≥ 1 año
            px = pixel_of(f["grid"], lat, lon)
            if px is None or a.ndim != 2:
                continue
            v = a[px]
            ok = (v < thr) if op == "<" else (v > thr) if op == ">" else (thr[0] <= v <= thr[1])
            if not ok:
                errors.append(f"{tag} orientación: {why} ({lat}, {lon}) = {v:.4g}, se esperaba {op} {thr}")

    # Solape global ↔ polar
    for (g, per), a in arrays.items():
        if GRIDS[g]["type"] != "polar" or a.ndim != 2:
            continue
        glob = arrays.get((GLOBAL_REF, per))
        if glob is None:
            continue
        diffs = []
        for r in range(a.shape[0]):
            for c in range(a.shape[1]):
                lat, lon = polar_centre_latlon(g, r, c)
                if 84 <= abs(lat) <= 86 and np.isfinite(a[r, c]):
                    gr, gc = pixel_of(GLOBAL_REF, lat, lon)
                    if np.isfinite(glob[gr, gc]):
                        diffs.append(abs(a[r, c] - glob[gr, gc]))
        if diffs and np.median(diffs) > 0.05 * (hi - lo):
            errors.append(f"[{g} vs {GLOBAL_REF}/{per}] solape: mediana |Δ| = {np.median(diffs):.4g} > 5 % del rango")
    return errors


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    failed = 0
    for d in argv:
        errs = validate(Path(d))
        if errs:
            failed += 1
            print(f"✗ {d}")
            for e in errs:
                print(f"   - {e}")
        else:
            print(f"✓ {d}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
