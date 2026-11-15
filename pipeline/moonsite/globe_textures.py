"""Texturas del globo 3D de la vista "Whole Moon" (web/public/data/global/globe/).

El globo es solo la Luna, sin capas de datos: una fotografía real y relieve real.

- albedo_4k.jpg / albedo_8k.jpg  mosaico global LROC WAC de 100 m/px (NASA/GSFC/ASU, vía USGS),
                                 reducido por promedio a 4096 × 2048 y 8192 × 4096. La web carga
                                 primero la de 4k y pasa a la de 8k solo si el equipo puede.
- normal_4k.jpg                  mapa de normales (espacio tangente, convenio OpenGL) derivado
                                 de LOLA LDEM_64: da el relieve fino con la luz, sin geometría.
- height_1k.png                  alturas LOLA en 8 bits (1024 × 512) para desplazar la malla de la
                                 esfera: cuencas y montañas se ven en el limbo.

- ../../img/moon-map.png        la misma fotografía a 512 × 256 (web/public/img/): la usan los
                                 iconos de la Luna de la portada (web/src/ui/MoonZone.jsx).

Todas en proyección equirectangular, columna 0 en −180° y fila 0 en +90° (como la malla web).

Uso (desde pipeline/):
    python -m moonsite.fetch global          # LDEM_64 (ya lo usa el resto de la vista)
    python -m moonsite.globe_textures        # baja el mosaico LROC (6 GB) si no está en .cache
"""

from __future__ import annotations

import json
import sys

import numpy as np
from PIL import Image

from . import config as C
from .config import Remote

OUT = C.WEB_DATA / "global" / "globe"
ICON_MAP = (512, 256)          # fotografía pequeña para los iconos de la portada
WAC = Remote("https://planetarymaps.usgs.gov/mosaic/Lunar_LRO_LROC-WAC_Mosaic_global_100m_June2013.tif",
             C.RAW / "lroc_wac_global_100m.tif", 5_959_263_751, "Mosaico LROC WAC global, 100 m/px (USGS Astrogeology)")
NORMAL_EXAG = 6.0        # el relieve lunar real apenas se vería a escala de globo
HEIGHT_RANGE_M = (-9200.0, 10800.0)   # extremos de LOLA; se guardan en el manifest
Image.MAX_IMAGE_PIXELS = None


def _alturas(cols: int, rows: int) -> np.ndarray:
    """Alturas LOLA (m) remuestreadas a cols × rows, con la columna 0 en −180°."""
    from .pds import CylRaster

    f = C.LOLA_GLOBAL["ldem64"]
    d = CylRaster.open(f.dest, f.url)
    z = d.raw.astype(np.float32) * np.float32(d.k) + np.float32(d.add)
    z = np.roll(z, -int(round(((-180.0 - d.lon_west) % 360.0) * d.res)), axis=1)
    b = 4                                                   # 23040 × 11520 → 5760 × 2880 por promedio
    z = z.reshape(z.shape[0] // b, b, z.shape[1] // b, b).mean(axis=(1, 3))
    if (cols, rows) != (z.shape[1], z.shape[0]):
        z = np.asarray(Image.fromarray(z, "F").resize((cols, rows), Image.BILINEAR), np.float32)
    return z


def suavizar_polos(a: np.ndarray, desde_lat: float = 70.0) -> np.ndarray:
    """Quita el ruido radial de los polos en una imagen equirectangular.

    Cerca del polo cada píxel cubre muy pocos metros de este a oeste, así que el detalle se
    convierte en rayas que convergen en el polo. Cada fila se promedia a lo largo de la
    longitud con una ventana proporcional a 1 / cos(latitud): la resolución sobre el terreno
    queda igual que en el resto del mapa.
    """
    rows, cols = a.shape[:2]
    out = a.astype(np.float32).copy()
    lat = 90.0 - (np.arange(rows) + 0.5) * 180.0 / rows
    for i in np.nonzero(np.abs(lat) > desde_lat)[0]:
        w = int(min(cols // 4, round(1.0 / max(np.cos(np.radians(lat[i])), 1e-3) * np.cos(np.radians(desde_lat)))))
        if w < 2:
            continue
        fila = out[i]
        ext = np.concatenate([fila[-w:], fila, fila[:w]], axis=0)                 # la longitud es periódica
        c = np.cumsum(np.concatenate([np.zeros((1,) + fila.shape[1:], np.float32), ext], axis=0), axis=0, dtype=np.float64)
        h = w // 2
        out[i] = ((c[w + h + 1: w + h + 1 + cols] - c[w - h: w - h + cols]) / (2 * h + 1)).astype(np.float32)
    return out


def normales(cols: int = 4096, rows: int = 2048, exag: float = NORMAL_EXAG) -> np.ndarray:
    """Mapa de normales RGB (uint8): x = este, y = norte, z = hacia fuera."""
    z = _alturas(min(cols, 5760), min(rows, 2880))
    if z.shape != (rows, cols):                              # más fino que LOLA a 16 px/°: se interpola
        z = np.asarray(Image.fromarray(z, "F").resize((cols, rows), Image.BILINEAR), np.float32)
    z = suavizar_polos(z)
    lat = np.radians(90.0 - (np.arange(rows) + 0.5) * 180.0 / rows)
    dx = 2.0 * np.pi * C.MOON_R_M / cols * np.clip(np.cos(lat), 0.02, None)[:, None]   # m por píxel hacia el este
    dy = np.pi * C.MOON_R_M / rows                                                      # m por píxel hacia el norte
    dz_e = (np.roll(z, -1, axis=1) - np.roll(z, 1, axis=1)) / (2.0 * dx)
    dz_n = np.zeros_like(z)
    dz_n[1:-1] = (z[:-2] - z[2:]) / (2.0 * dy)             # fila menor = más al norte
    nx, ny = -dz_e * exag, -dz_n * exag
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + 1.0)
    rgb = np.stack([nx * inv, ny * inv, inv], axis=-1) * 0.5 + 0.5
    return np.clip(np.rint(rgb * 255.0), 0, 255).astype(np.uint8)


def alturas_8bit(cols: int = 1024, rows: int = 512) -> np.ndarray:
    z = _alturas(cols, rows)
    lo, hi = HEIGHT_RANGE_M
    return np.clip(np.rint((z - lo) / (hi - lo) * 255.0), 0, 255).astype(np.uint8)


def albedo(cols: int, rows: int) -> np.ndarray:
    """Mosaico LROC WAC promediado a cols × rows (uint8)."""
    import rasterio
    from rasterio.enums import Resampling

    with rasterio.open(WAC.dest) as src:
        return src.read(1, out_shape=(rows, cols), resampling=Resampling.average)


def acabar(a: np.ndarray) -> np.ndarray:
    """Deja el mosaico listo para el globo: tonos más claros y casquetes polares sin huecos.

    - El mosaico es oscuro (mediana ~63 de 255): se estira hasta su percentil 99,7 con una
      curva suave (gamma 0,8), sin quemar los cráteres brillantes.
    - Cerca de los polos no tiene datos o solo sombras larguísimas (franjas negras). De 80° a
      88° se funde con un sombreado del relieve LOLA en el tono medio de esas latitudes, y
      de 88° al polo queda solo el relieve. Lejos de los polos no se toca nada.
    """
    rows, cols = a.shape
    v = a.astype(np.float32)
    hi = float(np.percentile(v[rows // 6: -rows // 6: 4, ::4], 99.7))
    v = 255.0 * np.clip(v / hi, 0, 1) ** 0.8
    lat = 90.0 - (np.arange(rows) + 0.5) * 180.0 / rows
    n = normales(cols, rows, exag=10.0).astype(np.float32) / 127.5 - 1.0
    sombra = n[..., 0] * -0.45 + n[..., 1] * 0.45 + n[..., 2] * 0.77          # luz desde el noroeste
    borde = (np.abs(lat) > 72) & (np.abs(lat) < 79)
    tono = float(np.median(v[borde][:, ::8]))
    relieve = np.clip(tono * (0.25 + 1.0 * sombra), 0, 255)
    t = np.clip((np.abs(lat) - 80.0) / 8.0, 0, 1)
    w = (t * t * (3 - 2 * t))[:, None] * np.ones((1, cols), np.float32)       # 0 hasta 80°, 1 desde 88°
    w = np.maximum(w, ((a <= 2) & (np.abs(lat)[:, None] > 70)).astype(np.float32))   # píxeles sin dato
    return np.clip(np.rint(suavizar_polos(v * (1 - w) + relieve * w, desde_lat=82.0)), 0, 255).astype(np.uint8)


def mapa_iconos() -> None:
    """Fotografía reducida para los iconos de la portada, a partir de albedo_4k.jpg."""
    destino = C.WEB_DATA.parent / "img" / "moon-map.png"
    Image.open(OUT / "albedo_4k.jpg").convert("L").resize(ICON_MAP, Image.LANCZOS).save(destino, optimize=True)
    print(f"   iconos: {destino.name}")


def main(argv=None) -> None:
    from .fetch import download

    OUT.mkdir(parents=True, exist_ok=True)
    info = {}
    Image.fromarray(normales(), "RGB").save(OUT / "normal_4k.jpg", quality=88, optimize=True)
    Image.fromarray(alturas_8bit(), "L").save(OUT / "height_1k.png", optimize=True)
    info["normal"] = {"file": "global/globe/normal_4k.jpg", "exaggeration": NORMAL_EXAG, "convention": "tangent space, OpenGL (green = north)"}
    info["height"] = {"file": "global/globe/height_1k.png", "minM": HEIGHT_RANGE_M[0], "maxM": HEIGHT_RANGE_M[1]}
    print("   relieve: normal_4k.jpg, height_1k.png")
    download(WAC)
    a8 = acabar(albedo(8192, 4096))
    Image.fromarray(a8, "L").save(OUT / "albedo_8k.jpg", quality=76, optimize=True, progressive=True)
    Image.fromarray(a8, "L").resize((4096, 2048), Image.LANCZOS).save(OUT / "albedo_4k.jpg", quality=85, optimize=True, progressive=True)
    info["albedo"] = {"file": "global/globe/albedo_4k.jpg", "fileHi": "global/globe/albedo_8k.jpg"}
    mapa_iconos()
    info["source"] = "LROC WAC global mosaic 100 m (NASA/GSFC/Arizona State University, USGS Astrogeology) · LOLA LDEM_64 (NASA PDS)"
    info["projection"] = "equirectangular, column 0 at −180°E, row 0 at +90°"
    for f in sorted(OUT.iterdir()):
        print(f"   {f.name}: {f.stat().st_size / 1e6:.2f} MB")
    mp = C.WEB_DATA / "global" / "manifest.json"
    if mp.exists():
        m = json.loads(mp.read_text(encoding="utf-8"))
        m["globe"] = info
        mp.write_text(json.dumps(m, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Listo: {OUT}")


if __name__ == "__main__":
    main(sys.argv[1:])
