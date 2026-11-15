"""Whole-Moon elevation for Astronaut Mode (web/public/data/astronaut/global-16ppd.i16).

The mode walks one kilometre of real terrain. Outside the south polar DEMs the web has no
elevation at all, so this exports NASA LOLA LDEM_64 reduced by block mean from 64 to 16 pixels
per degree (about 1.9 km at the equator): small enough to download when the mode opens.

At that sampling the walkable kilometre is close to a tilted plane. The hills and large craters
around it are real; craters under 140 m, rocks and gravel are generated in the browser.

Layout: int16, value × 0.5 = metres above the 1737.4 km sphere. Equirectangular, row 0 north.
Two extra columns on each side repeat the opposite edge and two extra rows repeat the polar
row, so interpolation near ±180° and at the poles needs no special case in the browser.

Usage (from pipeline/):
    python -m moonsite.fetch global          # LDEM_64, if it is not cached yet
    python -m moonsite.astronaut_global
"""

from __future__ import annotations

import hashlib
import json

import numpy as np

from . import config as C
from .globe_textures import _alturas

OUT = C.WEB_DATA / "astronaut"
PPD, PAD, SCALE = 16, 2, 0.5
COLS, ROWS = 360 * PPD, 180 * PPD


def exportar(log=print) -> dict:
    z = _alturas(COLS, ROWS)                                   # metres, column 0 at −180°, row 0 at +90°
    q = np.clip(np.rint(z / SCALE), -32767, 32767).astype("<i2")
    q = np.concatenate([q[:, -PAD:], q, q[:, :PAD]], axis=1)    # longitude is periodic
    q = np.concatenate([np.repeat(q[:1], PAD, axis=0), q, np.repeat(q[-1:], PAD, axis=0)], axis=0)
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / "global-16ppd.i16"
    q.tofile(path)
    step = 1.0 / PPD
    entry = {
        "id": "LOLA-LDEM-64-16PPD", "file": path.name, "dtype": "int16", "scale": SCALE,
        "width": int(q.shape[1]), "height": int(q.shape[0]),
        "projection": "cylindrical",
        # Longitude and latitude (degrees) of the centre of sample (0, 0), and the step per sample.
        "origin": [-180.0 + step / 2 - PAD * step, 90.0 - step / 2 + PAD * step],
        "pixelSize": [step, -step],
        "resolutionM": round(float(np.pi * C.MOON_R_M / 180.0 * step), 1),
        "noData": -32768,
        "name": "LOLA LDEM_64, reduced to 16 px/deg",
        "provider": "NASA PDS / LRO LOLA",
        "url": C.LOLA_GLOBAL["ldem64"].url,
        "productUrl": C.LOLA_GLOBAL["ldem64"].url.replace(".img", ".lbl"),
        "frame": "MOON_ME",
        "verticalDatum": "Height above the 1737400 m reference sphere",
        "uncertainty": "Block mean of 4 × 4 LDEM_64 samples. Nothing smaller than about 4 km is resolved.",
        "interpolation": "Whole-Moon fallback at about 1.9 km per sample: the walkable kilometre is close to a plane and "
                         "its small relief is generated, not measured.",
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }
    cat = OUT / "catalog.json"
    if cat.exists():                                           # add this entry, leave the rest alone
        data = json.loads(cat.read_text(encoding="utf-8"))
        data["global"] = entry
        cat.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    log(f"   {path.name}: {q.shape[1]} × {q.shape[0]} · {path.stat().st_size / 1e6:.1f} MB · "
        f"{float(z.min()):.0f} to {float(z.max()):.0f} m")
    return entry


if __name__ == "__main__":
    exportar()
