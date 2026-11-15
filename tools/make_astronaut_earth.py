"""Textura de la Tierra para el cielo del modo astronauta.

Base: NASA Blue Marble Next Generation (dominio público), tal como la distribuye el paquete
npm three-globe (example/img/earth-blue-marble.jpg). Las nubes NO son una observación: son
ruido fractal con la estructura de bandas de la circulación general (ITCZ, cinturones
subtropicales despejados, borrascas de latitudes medias), porque desde la Luna la Tierra
se ve siempre medio cubierta de blanco.

Uso (desde la raíz del repositorio; necesita numpy y Pillow):
    npm pack three-globe && tar -xzf three-globe-*.tgz package/example/img/earth-blue-marble.jpg
    python tools/make_astronaut_earth.py package/example/img/earth-blue-marble.jpg web/public/assets/astronaut/sky/earth_2k.jpg
"""
import sys
import numpy as np
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
W, H = 2048, 1024
base = np.asarray(Image.open(src).convert("RGB").resize((W, H), Image.LANCZOS), np.float32) / 255.0
rng = np.random.default_rng(20261115)

lon = (np.arange(W) + 0.5) / W * 2 * np.pi - np.pi
lat = np.pi / 2 - (np.arange(H) + 0.5) / H * np.pi
LON, LAT = np.meshgrid(lon, lat)
P = np.stack([np.cos(LAT) * np.cos(LON), np.cos(LAT) * np.sin(LON), np.sin(LAT)], -1)

def lattice(n):
    return rng.random((n, n, n), dtype=np.float32)

def noise3(p, grid):
    n = grid.shape[0]
    q = (p % 1.0) * n
    i = np.floor(q).astype(np.int32); f = q - i; f = f * f * (3 - 2 * f)
    i0 = i % n; i1 = (i + 1) % n
    def g(a, b, c): return grid[a[..., 0], b[..., 1], c[..., 2]]
    x00 = g(i0, i0, i0) * (1 - f[..., 0]) + g(i1, i0, i0) * f[..., 0]
    x10 = g(i0, i1, i0) * (1 - f[..., 0]) + g(i1, i1, i0) * f[..., 0]
    x01 = g(i0, i0, i1) * (1 - f[..., 0]) + g(i1, i0, i1) * f[..., 0]
    x11 = g(i0, i1, i1) * (1 - f[..., 0]) + g(i1, i1, i1) * f[..., 0]
    y0 = x00 * (1 - f[..., 1]) + x10 * f[..., 1]; y1 = x01 * (1 - f[..., 1]) + x11 * f[..., 1]
    return y0 * (1 - f[..., 2]) + y1 * f[..., 2]

def fbm(p, octaves, lacunarity=2.03, gain=0.55):
    total = np.zeros(p.shape[:-1], np.float32); amp = 1.0; norm = 0.0; freq = 1.0
    for _ in range(octaves):
        total += noise3(p * freq / 8.0 + rng.random(3), lattice(32)) * amp; norm += amp; amp *= gain; freq *= lacunarity
    return total / norm

# Deformación del dominio: remolinos y frentes alargados de oeste a este.
warp = np.stack([fbm(P * 1.6 + 3.1, 4), fbm(P * 1.6 - 7.7, 4), fbm(P * 1.6 + 11.3, 4)], -1) - 0.5
Q = P * np.array([1.0, 1.0, 1.7], np.float32) + warp * 0.9
field = fbm(Q * 1.9, 5, gain=0.46)
field = (field - field.mean()) / field.std()
deg = np.degrees(LAT)
band = (0.10 + 0.45 * np.exp(-(deg / 8.0) ** 2)                      # ITCZ
        - 0.50 * np.exp(-((np.abs(deg) - 23.0) / 10.0) ** 2)         # cinturones subtropicales despejados
        + 0.55 * np.exp(-((np.abs(deg) - 55.0) / 15.0) ** 2))         # borrascas de latitudes medias
cover = np.clip((field + band - 0.42) / 1.1 + 0.5, 0, 1)
cover = cover * cover * (3 - 2 * cover)
wisps = fbm(Q * 6.0, 4, gain=0.5)
thick = np.clip(cover ** 1.4 * (0.45 + 1.0 * wisps) * 1.25 - 0.06, 0, 0.94)
print("cobertura de nubes: %.0f %%" % (100 * (thick > 0.4).mean()))

# Hielo marino y casquetes: el mosaico ya los trae; solo se refuerza el blanco polar.
ice = np.clip((np.abs(deg) - 74.0) / 8.0, 0, 1)[..., None]
img = base * (1 - ice * 0.35) + ice * 0.35 * np.array([0.93, 0.95, 0.97], np.float32)
# El mosaico es oscuro y muy saturado: desde el espacio el océano es azul oscuro y la tierra, apagada.
img = np.clip(img * 1.12, 0, 1) ** 0.92
white = np.array([0.96, 0.97, 0.98], np.float32)
img = img * (1 - thick[..., None]) + white * thick[..., None]
Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8), "RGB").save(out, quality=86, optimize=True, progressive=True)
print("escrito", out)
