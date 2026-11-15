"""Exporta las capas polares que ya tenemos al formato del contrato de datos.

Uso (desde pipeline/):
    python -m moonsite.export_contract          # polo sur (PS1K) y, si está generado, polo norte (PN1K)

Escribe en layers/<id>/ (raíz del repositorio) el binario PS1K / PN1K y su layer.json.
Así el equipo polar cumple el contrato y el validador tiene datos reales para
probar: python tools/validate_layer.py layers/terrain.elevation
"""

from __future__ import annotations

import hashlib
import json

import numpy as np

from . import config as C

OUT = C.REPO / "layers"
PDS = "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx"

LAYERS = {
    "terrain.elevation": {
        "src": "elevation", "title": "Elevation", "units": "m", "validRange": [-10000, 11000],
        "method": "LOLA LDEM_75S_240M, bilinear at the 1 km pixel centre; height above the 1737.4 km sphere.",
        "sources": [{"name": "LOLA LDEM_75S_240M", "url": f"{PDS}/data/lola_gdr/polar/img/", "citation": "Smith et al. (2010), NASA PDS"}],
    },
    "terrain.slope": {
        "src": "slope", "title": "Slope", "units": "deg", "validRange": [0, 90],
        "method": "Median of 16 LOLA LDSM_75S_240M samples inside each 1 km pixel.",
        "params": {"baselineM": 240},
        "sources": [{"name": "LOLA LDSM_75S_240M", "url": f"{PDS}/data/lola_gdr/polar/img/", "citation": "Smith et al. (2010), NASA PDS"}],
    },
    "sun.psr_mask": {
        "src": "psrShare", "title": "Permanent shadow share", "units": "fraction", "validRange": [0, 1],
        "method": "Share of 120 m LOLA LPSR cells in permanent shadow inside each 1 km pixel (8×8 samples).",
        "sources": [{"name": "LOLA LPSR_75S_120M", "url": f"{PDS}/extras/illumination/img/", "citation": "Mazarico et al. (2011), Icarus 211"}],
    },
    "ice.psr_distance_km": {
        "src": "psrDistKm", "title": "Distance to permanent shadow", "units": "km", "validRange": [0, 1000],
        "method": "Euclidean distance from the pixel centre to the nearest 120 m LOLA LPSR shadow cell.",
        "sources": [{"name": "LOLA LPSR_75S_120M", "url": f"{PDS}/extras/illumination/img/", "citation": "Mazarico et al. (2011), Icarus 211"}],
    },
}


#: Malla polar de cada polo en el contrato (misma malla de 400 × 400 px de 1 km).
POLE_GRID = {"south": "PS1K", "north": "PN1K"}


def export_pole(pole: str) -> list[str]:
    """Añade a cada layer.json el fichero de la malla polar de `pole`, sin tocar los demás ficheros."""
    grid = POLE_GRID[pole]
    done = []
    for lid, spec in LAYERS.items():
        src = C.web_data(pole) / "layers" / f"{spec['src']}.f32"
        if not src.exists():
            print(f"   (sin {src.relative_to(C.REPO)}: ejecuta antes `python -m moonsite.build layers"
                  f"{'' if pole == 'south' else ' --pole ' + pole}`)")
            continue
        a = np.fromfile(src, dtype="<f4")
        d = OUT / lid / grid
        d.mkdir(parents=True, exist_ok=True)
        f = d / "static.f32"
        a.astype("<f4").tofile(f)
        finite = a[np.isfinite(a)]
        entry = {"grid": grid, "period": "static", "path": f"{grid}/static.f32", "dtype": "float32",
                 "sha256": hashlib.sha256(f.read_bytes()).hexdigest(),
                 "min": float(finite.min()), "max": float(finite.max())}
        path = OUT / lid / "layer.json"
        old = path.read_text(encoding="utf-8") if path.exists() else ""
        if old:
            # La capa ya existe (puede traer otras mallas, p. ej. G1K, y campos añadidos a mano):
            # solo se sustituye la entrada de esta malla, en su sitio, o se añade al final.
            meta = json.loads(old)
            files = meta.get("files", [])
            at = next((k for k, x in enumerate(files) if x.get("grid") == grid), None)
            meta["files"] = files + [entry] if at is None else files[:at] + [entry] + files[at + 1:]
            if pole == "north":
                names = {s["name"] for s in meta.get("sources", [])}
                meta["sources"] = meta.get("sources", []) + [
                    {**s, "name": s["name"].replace("75S", "75N")} for s in spec["sources"]
                    if s["name"].replace("75S", "75N") not in names]
        else:
            tag = "75S" if pole == "south" else "75N"
            meta = {
                "id": lid, "version": "0.1.0", "title": spec["title"], "units": spec["units"],
                "validRange": spec["validRange"], "kind": "static", "owner": "Equipo Polar + Web",
                "fidelity": "computed", "method": spec["method"].replace("75S", tag), "params": spec.get("params", {}),
                "sources": [{**s, "name": s["name"].replace("75S", tag)} for s in spec["sources"]],
                "files": [entry],
            }
        path.write_text(json.dumps(meta, indent=2, ensure_ascii=False) + ("\n" if old.endswith("\n") else ""), encoding="utf-8")
        print(f"   {lid} [{grid}]")
        done.append(lid)
    return done


def main() -> None:
    for pole in C.POLES:
        if (C.web_data(pole) / "layers" / "elevation.f32").exists():
            export_pole(pole)
    path = OUT / "catalog.json"
    old = path.read_text(encoding="utf-8") if path.exists() else ""
    known = json.loads(old) if old else {"contractVersion": "0.1", "layers": []}
    # El catálogo lo mantiene el equipo: aquí solo se añaden las capas polares que falten.
    missing = [lid for lid in LAYERS if lid not in known["layers"] and (OUT / lid / "layer.json").exists()]
    if missing or not old:
        known["layers"] += missing
        path.write_text(json.dumps(known, indent=2) + ("\n" if old.endswith("\n") else ""), encoding="utf-8")
    print(f"Listo: {OUT}")


if __name__ == "__main__":
    main()
