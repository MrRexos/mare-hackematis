"""Prepare traceable lunar DEMs; never substitutes imagery for elevation.

python tools/prepare_lunar_dem.py --defaults
python tools/prepare_lunar_dem.py --lat -86.86 --lon 338.14 --name my-site
python tools/prepare_lunar_dem.py --source path/to/legal-lunar-dtm.tif --lat ... --lon ...
python tools/prepare_lunar_dem.py --pole north     # regional 240 m DEM of the north pole (catalog-north.json)
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
from urllib.parse import urljoin

import certifi
import numpy as np
import rasterio
from rasterio.windows import Window
import requests

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web/public/data/astronaut"
CACHE = ROOT / ".cache/astronaut"
RADIUS = 1737400.0
PGDA = "https://pgda.gsfc.nasa.gov/products/78"
REGIONAL = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_83S_10MPP_ADJ.TIF"
PDS = "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/ldem_75s_240m.img"
CRS = "+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +R=1737400 +units=m +no_defs"


def xy(lat, lon):
    rho = 2 * RADIUS * math.tan(math.pi / 4 + math.radians(lat) / 2)
    return rho * math.sin(math.radians(lon)), rho * math.cos(math.radians(lon))


def download(url):
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / url.rsplit("/", 1)[-1]
    if not path.exists():
        with requests.get(url, stream=True, timeout=120) as response:
            response.raise_for_status()
            part = path.with_suffix(path.suffix + ".part")
            with part.open("wb") as stream:
                for chunk in response.iter_content(1 << 20):
                    stream.write(chunk)
            part.replace(path)
    return path


def describe(url):
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_CAINFO=certifi.where(),
                      CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif,.TIF", GDAL_HTTP_TIMEOUT=30):
        with rasterio.open(url) as ds:
            if not ds.crs or not ds.crs.is_projected:
                raise ValueError(f"Unspecified planetary CRS: {url}")
            proj = ds.crs.to_dict()
            if proj.get("proj") != "stere" or abs(proj.get("lat_0", 0) + 90) > 0.01:
                raise ValueError(f"Unsupported lunar projection: {ds.crs}")
            if abs(float(proj.get("R", proj.get("a", 0))) - RADIUS) > 1:
                raise ValueError("DEM must use the 1737.4 km lunar reference sphere")
            step = abs(ds.transform.a)
            return {
                "id": url.rsplit("/", 1)[-1].split(".")[0], "name": url.rsplit("/", 1)[-1],
                "url": url, "provider": "NASA GSFC / LRO LOLA", "productUrl": PGDA if step == 5 else "https://pgda.gsfc.nasa.gov/products/90",
                "resolutionM": step, "width": ds.width, "height": ds.height,
                "origin": [ds.transform.c, ds.transform.f], "pixelSize": [ds.transform.a, ds.transform.e],
                "bounds": list(ds.bounds), "crs": ds.crs.to_wkt(), "proj4": CRS,
                "frame": "MOON_ME_DE421", "verticalDatum": "Height in meters above the 1737400 m reference sphere",
                "noData": ds.nodata if ds.nodata is not None and math.isfinite(ds.nodata) else None,
                "uncertainty": "Not supplied per sample; see product error maps. Pixel spacing is not measurement accuracy.",
                "interpolation": "Source LOLA DEM includes interpolated pixels; 5 m spacing is not 5 m effective resolution.",
            }


def catalog():
    path = OUT / "catalog.json"
    saved = {}
    if path.exists():
        saved = json.loads(path.read_text(encoding="utf-8"))
        if len(saved["sources"]) > 1:
            return saved
    html = requests.get(PGDA, timeout=30)
    html.raise_for_status()
    links = sorted({urljoin(PGDA, url) for url in re.findall(r'href\s*=\s*["\x27]?([^"\x27>\s]+)', html.text, re.I) if url.endswith("_surf.tif")})
    def safe(url):
        try:
            item = describe(url)
            print(f"Indexed {item['name']} ({item['resolutionM']} m)", flush=True)
            return item
        except Exception as error:
            print(f"Unavailable: {url}: {error}", flush=True)
            return None
    with ThreadPoolExecutor(max_workers=6) as pool:
        sources = [x for x in pool.map(safe, links + [REGIONAL]) if x]
    result = {**saved, "version": 1, "generated": datetime.now(timezone.utc).isoformat(), "sources": sources, "patches": saved.get("patches", []),
              "demo": {"lat": -89.45, "lon": 222.5, "name": "Connecting ridge · NASA LOLA"}}
    OUT.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    return result


def regional_north():
    """North pole: the same native 240 m PDS elevations, from LDEM_75N_240M, in their own catalog.

    The PGDA 5 m and 10 m products indexed for the south pole have no north pole counterpart
    here, so the north catalog has no `sources` or `patches`: Astronaut Mode uses this raster.
    """
    url = PDS.replace("ldem_75s_240m", "ldem_75n_240m")
    label = requests.get(url[:-4] + ".lbl", timeout=30)
    label.raise_for_status()
    text = label.text
    num = lambda key: float(re.search(rf"^\s*{key}\s*=\s*([-+0-9.Ee]+)", text, re.M).group(1))
    if num("CENTER_LATITUDE") != 90:
        raise ValueError("Expected the north polar stereographic product")
    n, m = int(num("LINES")), int(num("LINE_SAMPLES"))
    scale, line, sample = num("MAP_SCALE"), num("LINE_PROJECTION_OFFSET"), num("SAMPLE_PROJECTION_OFFSET")
    full = np.memmap(download(url), dtype="<i2", mode="r", shape=(n, m))
    half = 202000
    i0, j0 = math.floor(line - half / scale), math.floor(sample - half / scale)
    i1, j1 = math.ceil(line + half / scale), math.ceil(sample + half / scale)
    crop = np.array(full[i0:i1 + 1, j0:j1 + 1], dtype="<i2")
    crop.tofile(OUT / "regional-north.i16")
    (OUT / "pds-source-north.lbl").write_text(text, encoding="utf-8")
    result = {
        "version": 1, "generated": datetime.now(timezone.utc).isoformat(), "pole": "north", "sources": [], "patches": [],
        "regional": {"id": "LOLA-LDEM-75N-240M", "file": "regional-north.i16", "dtype": "int16", "scale": num("SCALING_FACTOR"),
            "width": crop.shape[1], "height": crop.shape[0], "origin": [(j0 - sample) * scale, (line - i0) * scale],
            "pixelSize": [scale, -scale], "resolutionM": scale, "noData": -32768,
            "sha256": hashlib.sha256(crop.tobytes()).hexdigest(),
            "name": "LOLA LDEM_75N_240M", "provider": "NASA PDS / LRO LOLA", "url": url, "productUrl": url[:-4] + ".lbl",
            "frame": "MOON_ME_DE421", "proj4": CRS.replace("-90", "90"), "verticalDatum": "Height above the 1737400 m reference sphere",
            "uncertainty": "Not supplied per sample; regional fallback. Interpolation does not add measured detail."},
    }
    (OUT / "catalog-north.json").write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Prepared north regional DEM: {crop.shape}, {scale} m", flush=True)


def regional(result):
    """Bundle native 240 m PDS elevations for every map location, not the 1 km analysis layer."""
    if (OUT / "regional.i16").exists() and result.get("regional"):
        return
    label = requests.get(PDS[:-4] + ".lbl", timeout=30)
    label.raise_for_status()
    text = label.text
    num = lambda key: float(re.search(rf"^\s*{key}\s*=\s*([-+0-9.Ee]+)", text, re.M).group(1))
    n, m = int(num("LINES")), int(num("LINE_SAMPLES"))
    scale, line, sample = num("MAP_SCALE"), num("LINE_PROJECTION_OFFSET"), num("SAMPLE_PROJECTION_OFFSET")
    full = np.memmap(download(PDS), dtype="<i2", mode="r", shape=(n, m))
    half = 202000
    i0, j0 = math.floor(line - half / scale), math.floor(sample - half / scale)
    i1, j1 = math.ceil(line + half / scale), math.ceil(sample + half / scale)
    crop = np.array(full[i0:i1 + 1, j0:j1 + 1], dtype="<i2")
    crop.tofile(OUT / "regional.i16")
    result["regional"] = {"id": "LOLA-LDEM-75S-240M", "file": "regional.i16", "dtype": "int16", "scale": num("SCALING_FACTOR"),
        "width": crop.shape[1], "height": crop.shape[0], "origin": [(j0 - sample) * scale, (line - i0) * scale],
        "pixelSize": [scale, -scale], "resolutionM": scale, "noData": -32768,
        "name": "LOLA LDEM_75S_240M", "provider": "NASA PDS / LRO LOLA", "url": PDS, "productUrl": PDS[:-4] + ".lbl",
        "frame": "MOON_ME_DE421", "proj4": CRS, "verticalDatum": "Height above the 1737400 m reference sphere",
        "uncertainty": "Not supplied per sample; regional fallback. Interpolation does not add measured detail."}
    (OUT / "pds-source.lbl").write_text(text, encoding="utf-8")


def patch(result, lat, lon, name, source=None, size=2200, source_metadata=None):
    cx, cy = xy(lat, lon)
    options = [describe(source)] if source else sorted(result["sources"], key=lambda s: s["resolutionM"])
    if source:
        if not source_metadata:
            raise ValueError("Custom DEMs require --source-metadata with provider, productUrl, frame, verticalDatum and uncertainty")
        supplied = json.loads(Path(source_metadata).read_text(encoding="utf-8"))
        for field in ["provider", "productUrl", "frame", "verticalDatum", "uncertainty"]:
            if not supplied.get(field):
                raise ValueError(f"Missing custom DEM metadata: {field}")
        if supplied["frame"] != "MOON_ME_DE421":
            raise ValueError("Register the custom DEM to MOON_ME_DE421 before importing")
        options[0].update({k: supplied[k] for k in ["name", "provider", "productUrl", "frame", "verticalDatum", "uncertainty"] if k in supplied})
        options[0]["interpolation"] = supplied.get("interpolation", "Consult the source product for interpolated or unmeasured pixels.")
    candidates = [s for s in options if s["bounds"][0] < cx - size / 2 and s["bounds"][2] > cx + size / 2
                  and s["bounds"][1] < cy - size / 2 and s["bounds"][3] > cy + size / 2]
    for meta in candidates:
        try:
            with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_CAINFO=certifi.where(),
                              CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif,.TIF", GDAL_HTTP_TIMEOUT=40):
                cached = CACHE / str(meta["url"]).rsplit("/", 1)[-1]
                with rasterio.open(cached if cached.is_file() else meta["url"]) as ds:
                    row, col = ds.index(cx, cy)
                    count = int(math.ceil(size / meta["resolutionM"]))
                    window = Window(col - count // 2, row - count // 2, count + 1, count + 1)
                    values = ds.read(1, window=window, masked=True).astype("float32").filled(np.nan)
                    if not np.isfinite(values).all():
                        continue
                    trans = ds.window_transform(window)
                    # Binary origin always refers to the first sample center.
                    origin = list(trans * (0.5, 0.5))
            filename = re.sub(r"[^a-z0-9-]", "-", name.lower()) + ".f32"
            values.astype("<f4").tofile(OUT / filename)
            item = {**meta, "id": name, "file": filename, "dtype": "float32", "width": values.shape[1], "height": values.shape[0],
                    "origin": origin, "pixelSize": [meta["resolutionM"], -meta["resolutionM"]], "center": [lat, lon],
                    "validFraction": 1.0, "sha256": hashlib.sha256(values.astype("<f4").tobytes()).hexdigest(),
                    "bounds": [origin[0], origin[1] - (values.shape[0] - 1) * meta["resolutionM"],
                               origin[0] + (values.shape[1] - 1) * meta["resolutionM"], origin[1]]}
            result["patches"] = [p for p in result["patches"] if p["id"] != name] + [item]
            print(f"Prepared {name}: {meta['resolutionM']} m, {values.shape}", flush=True)
            return
        except Exception as error:
            print(f"Patch unavailable from {meta['name']}: {error}", flush=True)
    raise RuntimeError(f"No complete scientific DEM coverage at {lat}, {lon}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--defaults", action="store_true")
    parser.add_argument("--lat", type=float)
    parser.add_argument("--lon", type=float)
    parser.add_argument("--name", default="custom-region")
    parser.add_argument("--source", help="Local or HTTP GeoTIFF, including a registered LROC NAC DTM")
    parser.add_argument("--source-metadata", help="JSON provenance for a custom DEM; frame must be MOON_ME_DE421")
    parser.add_argument("--pole", choices=["south", "north"], default="south", help="north: only the regional 240 m DEM")
    args = parser.parse_args()
    if args.pole == "north":
        OUT.mkdir(parents=True, exist_ok=True)
        regional_north()
        return
    result = catalog()
    regional(result)
    if args.defaults:
        result["demo"] = {"lat": -89.45, "lon": 222.5, "name": "Connecting ridge · NASA LOLA"}
        for lat, lon, name in [(-89.45, 222.5, "connecting-ridge-demo"), (-86.86, 338.14, "haworth-demo")]:
            patch(result, lat, lon, name)
    if args.lat is not None and args.lon is not None:
        patch(result, args.lat, args.lon, args.name, args.source, source_metadata=args.source_metadata)
    result["generated"] = datetime.now(timezone.utc).isoformat()
    (OUT / "catalog.json").write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
