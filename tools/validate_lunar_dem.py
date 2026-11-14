"""Validate packaged scientific elevations against original NASA raster samples.

python tools/validate_lunar_dem.py [--offline]
"""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
import rasterio
import certifi
from prepare_lunar_dem import download

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "web/public/data/astronaut"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    catalog = json.loads((BASE / "catalog.json").read_text(encoding="utf-8"))
    for meta in catalog["patches"]:
        raw = (BASE / meta["file"]).read_bytes()
        assert hashlib.sha256(raw).hexdigest() == meta["sha256"]
        values = np.frombuffer(raw, dtype="<f4").reshape(meta["height"], meta["width"])
        assert np.isfinite(values).all()
        assert (values > -12000).all() and (values < 12000).all()
        assert meta["frame"] == "MOON_ME_DE421"
        assert "1737400" in meta["proj4"]
        count = 0
        if not args.offline:
            with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_CAINFO=certifi.where(),
                              CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif,.TIF", GDAL_HTTP_TIMEOUT=40):
                # Validation deliberately keeps a complete source copy in .cache;
                # runtime terrain loading uses bounded windows instead.
                source_path = download(meta["url"]) if meta["url"].startswith(("https://", "http://")) else Path(meta["url"])
                with rasterio.open(source_path) as source:
                    points, expected = [], []
                    for row, col in [(0, 0), (30, 50), (meta["height"] // 2, meta["width"] // 2), (meta["height"] - 1, meta["width"] - 1)]:
                        points.append((meta["origin"][0] + col * meta["pixelSize"][0], meta["origin"][1] + row * meta["pixelSize"][1]))
                        expected.append(values[row, col])
                    actual = np.array([sample[0] for sample in source.sample(points)])
                    assert np.allclose(actual, expected, rtol=0, atol=1e-4), (actual, expected)
                    count = len(points)
        print(f"PASS {meta['id']}: {values.size} valid elevations, {meta['resolutionM']} m spacing, SHA-256 verified; {count} original NASA samples compared")
    sky_meta = json.loads((BASE / "ephem-de421.json").read_text(encoding="utf-8"))
    sky = np.fromfile(BASE / sky_meta["file"], dtype="<f4").reshape(-1, 6)
    assert len(sky) == sky_meta["count"] and np.isfinite(sky).all()
    assert sky_meta["frame"] == "MOON_ME_DE421"
    assert ((np.linalg.norm(sky[:, :3], axis=1) > 1.4e8) & (np.linalg.norm(sky[:, :3], axis=1) < 1.6e8)).all()
    assert ((np.linalg.norm(sky[:, 3:], axis=1) > 350000) & (np.linalg.norm(sky[:, 3:], axis=1) < 410000)).all()
    print(f"PASS {len(sky)} finite hourly SPICE vectors; physically valid Sun/Earth distances")


if __name__ == "__main__":
    main()
