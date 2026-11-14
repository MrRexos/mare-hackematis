"""Import owner-supplied Quixel ZIPs. Pack AO/roughness; never displace the DEM."""
import argparse
import io
import json
from pathlib import Path
from zipfile import ZipFile

from PIL import Image

PACKS = ["dry_sand_vd0lbfd", "soil_sand_pkcbq0", "dry_sand_xd0jeh2", "sand_sgfodj1a"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path, help="Directory containing the four original ZIPs")
    args = parser.parse_args()
    base = Path(__file__).resolve().parents[1] / "web/public/assets/astronaut"
    manifest_path = base / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    layers = []
    for pack in PACKS:
        asset_id = pack.rsplit("_", 1)[1]
        target = base / "quixel/surfaces" / asset_id
        target.mkdir(parents=True, exist_ok=True)
        with ZipFile(args.source / f"{pack}_1k.zip") as archive:
            files = archive.namelist()
            def image(suffix):
                name = next(n for n in files if n.endswith(f"_1K_{suffix}.jpg"))
                return Image.open(io.BytesIO(archive.read(name))).convert("RGB")
            image("BaseColor").save(target / "color.jpg", quality=96, subsampling=0)
            image("Normal").save(target / "normal.jpg", quality=97, subsampling=0)
            ao = image("AO").getchannel("R")
            roughness = image("Roughness").getchannel("R")
            Image.merge("RGB", (ao, roughness, Image.new("L", ao.size, 0))).save(target / "orm.png", optimize=True)
            metadata = json.loads(archive.read(next(n for n in files if n.endswith(".json"))).decode("utf-8"))
            # Retain useful provenance, excluding obsolete remote download links.
            scan_area = next(m["value"] for m in metadata["meta"] if m["key"] == "scanArea")
            tile_meters = float(scan_area.split("x")[0])
            info = {"id": asset_id, "name": metadata.get("name", pack), "sourceArchive": f"{pack}_1k.zip", "scanArea": scan_area, "import": "Original color/normal; R=AO, G=roughness, B=0. No displacement."}
            (target / "source.json").write_text(json.dumps(info, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        layers.append({"id": asset_id, "name": info["name"], "tileMeters": tile_meters, "color": f"quixel/surfaces/{asset_id}/color.jpg", "normal": f"quixel/surfaces/{asset_id}/normal.jpg", "orm": f"quixel/surfaces/{asset_id}/orm.png"})
        print(f"Imported {asset_id}: {ao.size}")
    manifest.update(version=2, surfaces=layers, surface=None)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
