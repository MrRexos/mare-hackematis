"""Exporta las capas polares que ya tenemos al formato del contrato de datos.

Uso (desde pipeline/):
    python -m moonsite.export_contract

Escribe en layers/<id>/ (raíz del repositorio) el binario PS1K y su layer.json.
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


def main() -> None:
    for lid, spec in LAYERS.items():
        src = C.WEB_DATA / "layers" / f"{spec['src']}.f32"
        if not src.exists():
            print(f"   (sin {src.name}: ejecuta antes `python -m moonsite.build layers`)")
            continue
        a = np.fromfile(src, dtype="<f4")
        d = OUT / lid / "PS1K"
        d.mkdir(parents=True, exist_ok=True)
        f = d / "static.f32"
        a.astype("<f4").tofile(f)
        finite = a[np.isfinite(a)]
        meta = {
            "id": lid, "version": "0.1.0", "title": spec["title"], "units": spec["units"],
            "validRange": spec["validRange"], "kind": "static", "owner": "Equipo Polar + Web",
            "fidelity": "computed", "method": spec["method"], "params": spec.get("params", {}),
            "sources": spec["sources"],
            "files": [{"grid": "PS1K", "period": "static", "path": "PS1K/static.f32", "dtype": "float32",
                       "sha256": hashlib.sha256(f.read_bytes()).hexdigest(),
                       "min": float(finite.min()), "max": float(finite.max())}],
        }
        (OUT / lid / "layer.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"   {lid}")
    catalog = {"contractVersion": "0.1", "layers": sorted(p.name for p in OUT.iterdir() if (p / "layer.json").exists())}
    (OUT / "catalog.json").write_text(json.dumps(catalog, indent=2), encoding="utf-8")
    print(f"Listo: {OUT}")


if __name__ == "__main__":
    main()
