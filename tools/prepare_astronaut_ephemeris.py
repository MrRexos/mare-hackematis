"""Rotate existing DE440 ephemerides into the DEM's MOON_ME_DE421 frame.

Uses actual NAIF PCK/FK rotations at every existing hourly UTC sample.
The original map ephemerides remain unchanged.
"""
import json
from pathlib import Path
import numpy as np
import spiceypy as sp
from prepare_lunar_dem import download, OUT, ROOT

NAIF = "https://naif.jpl.nasa.gov/pub/naif/generic_kernels"
FILES = ["lsk/naif0012.tls", "fk/satellites/moon_080317.tf", "fk/satellites/moon_de440_250416.tf",
         "pck/moon_pa_de440_200625.bpc", "pck/moon_pa_de421_1900-2050.bpc"]


def main():
    for file in FILES:
        sp.furnsh(str(download(f"{NAIF}/{file}")))
    manifest = json.loads((ROOT / "web/public/data/manifest.json").read_text(encoding="utf-8"))["ephem"]
    original = np.fromfile(ROOT / "web/public/data" / manifest["file"], dtype="<f4").reshape(-1, 6)
    transformed = np.empty_like(original)
    max_arcsec = 0.0
    for k, vectors in enumerate(original):
        # UTC samples match the application manifest, including UTC/ET conversion.
        utc_seconds = manifest["startUnixMs"] / 1000 + k * manifest["stepSeconds"]
        from datetime import datetime, timezone
        utc = datetime.fromtimestamp(utc_seconds, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
        rotation = sp.pxform("MOON_ME_DE440_ME421", "MOON_ME_DE421", sp.str2et(utc))
        transformed[k, :3] = rotation @ vectors[:3]
        transformed[k, 3:] = rotation @ vectors[3:]
        angle = np.arccos(np.clip((np.trace(rotation) - 1) / 2, -1, 1))
        max_arcsec = max(max_arcsec, float(np.degrees(angle) * 3600))
    transformed.astype("<f4").tofile(OUT / "ephem-de421.f32")
    meta = {**manifest, "file": "ephem-de421.f32", "frame": "MOON_ME_DE421",
            "transform": "NAIF SPICE pxform from MOON_ME_DE440_ME421 at each hourly UTC sample",
            "kernels": [f"{NAIF}/{file}" for file in FILES], "maxFrameRotationArcsec": max_arcsec}
    (OUT / "ephem-de421.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"Transformed {len(original)} hourly vectors; maximum frame offset {max_arcsec:.6f} arcsec")
    sp.kclear()


if __name__ == "__main__":
    main()
