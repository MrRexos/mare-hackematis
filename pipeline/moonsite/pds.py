"""Lectura de imágenes PDS3 de LOLA (fichero .img + su etiqueta .lbl).

La etiqueta se descarga junto a la imagen (es pequeña) y de ella salen el
tamaño, el tipo de dato, la escala y el origen de la proyección, así que no
hay números "mágicos" por producto.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import requests


def _label_text(img_path: Path, img_url: str) -> str:
    lbl = img_path.with_suffix(".lbl")
    if not lbl.exists():
        r = requests.get(img_url[: -len(".img")] + ".lbl", timeout=60)
        r.raise_for_status()
        lbl.write_text(r.text, encoding="utf-8")
    return lbl.read_text(encoding="utf-8")


def _num(text: str, key: str) -> float:
    m = re.search(rf"^\s*{key}\s*=\s*([-+0-9.Ee]+)", text, re.M)
    if not m:
        raise KeyError(key)
    return float(m.group(1))


@dataclass
class PolarRaster:
    """Raster LOLA en estereográfica polar, indexable en metros del plano."""

    data: np.ndarray  # valores físicos (float32), NaN = sin dato
    scale: float      # m/píxel
    line0: float      # LINE_PROJECTION_OFFSET
    sample0: float    # SAMPLE_PROJECTION_OFFSET

    @classmethod
    def open(cls, img_path: Path, img_url: str) -> "PolarRaster":
        text = _label_text(img_path, img_url)
        lines = int(_num(text, "LINES"))
        samples = int(_num(text, "LINE_SAMPLES"))
        bits = int(_num(text, "SAMPLE_BITS"))
        if bits != 16 or "LSB_INTEGER" not in text:
            raise ValueError(f"{img_path.name}: solo se admite LSB_INTEGER de 16 bits")
        k = _num(text, "SCALING_FACTOR")
        off = _num(text, "OFFSET")
        raw = np.fromfile(img_path, dtype="<i2", count=lines * samples).reshape(lines, samples)
        data = raw.astype(np.float32) * np.float32(k)
        # En los DEM, OFFSET es el radio de referencia (1737400 m): guardamos
        # la altura relativa a esa esfera, no el radio.
        if not re.search(r"OFFSET\s*=\s*1737400", text):
            data += np.float32(off)
        m = re.search(r"MISSING_CONSTANT\s*=\s*(-?\d+)", text)
        if m:
            data[raw == int(m.group(1))] = np.nan
        return cls(data, _num(text, "MAP_SCALE"), _num(text, "LINE_PROJECTION_OFFSET"),
                   _num(text, "SAMPLE_PROJECTION_OFFSET"))

    def index(self, x, y):
        """Índices fraccionarios (fila, columna) del centro de píxel 0-based."""
        return self.line0 - np.asarray(y) / self.scale, np.asarray(x) / self.scale + self.sample0

    def bilinear(self, x, y):
        i, j = self.index(x, y)
        n, m = self.data.shape
        i0 = np.floor(i).astype(np.int64)
        j0 = np.floor(j).astype(np.int64)
        fi = (i - i0).astype(np.float32)
        fj = (j - j0).astype(np.float32)
        ok = (i0 >= 0) & (j0 >= 0) & (i0 < n - 1) & (j0 < m - 1)
        i0c = np.clip(i0, 0, n - 2)
        j0c = np.clip(j0, 0, m - 2)
        d = self.data
        v = (d[i0c, j0c] * (1 - fi) * (1 - fj) + d[i0c, j0c + 1] * (1 - fi) * fj
             + d[i0c + 1, j0c] * fi * (1 - fj) + d[i0c + 1, j0c + 1] * fi * fj)
        return np.where(ok, v, np.nan)

    def nearest(self, x, y):
        i, j = self.index(x, y)
        n, m = self.data.shape
        ii = np.rint(i).astype(np.int64)
        jj = np.rint(j).astype(np.int64)
        ok = (ii >= 0) & (jj >= 0) & (ii < n) & (jj < m)
        v = self.data[np.clip(ii, 0, n - 1), np.clip(jj, 0, m - 1)]
        return np.where(ok, v, np.nan)


def _num_opt(text: str, key: str):
    try:
        return _num(text, key)
    except KeyError:
        return None


@dataclass
class CylRaster:
    """Raster LOLA global en cilíndrica simple (p. ej. LDEM_64), indexable en grados.

    Se guarda el entero crudo (int16) para no gastar 1 GB en float32 con LDEM_64:
    altura (m) = raw * k (el OFFSET de los DEM es el radio de la esfera, 1737400 m).
    La geometría sale de la etiqueta: latitud máxima, longitud oeste y px/grado.
    """

    raw: np.ndarray      # int16 (líneas, muestras), línea 0 = norte
    k: float             # m por unidad
    add: float           # m que se suman (0 en los DEM)
    res: float           # píxeles por grado
    lat_max: float       # borde norte de la primera línea (grados)
    lon_west: float      # borde oeste de la primera muestra (grados este)
    missing: int | None

    @classmethod
    def open(cls, img_path: Path, img_url: str) -> "CylRaster":
        text = _label_text(img_path, img_url)
        lines = int(_num(text, "LINES"))
        samples = int(_num(text, "LINE_SAMPLES"))
        if int(_num(text, "SAMPLE_BITS")) != 16 or "LSB_INTEGER" not in text:
            raise ValueError(f"{img_path.name}: solo se admite LSB_INTEGER de 16 bits")
        res = _num(text, "MAP_RESOLUTION")
        lat_max = _num_opt(text, "MAXIMUM_LATITUDE")
        lon_west = _num_opt(text, "WESTERNMOST_LONGITUDE")
        if lat_max is None or lon_west is None:
            # Convenio PDS3 (centros de píxel, 1-based):
            # lat = (LINE_PROJECTION_OFFSET - linea) / res ; lon = CENTER_LONGITUDE + (muestra - SAMPLE_PROJECTION_OFFSET) / res
            lp, sp = _num(text, "LINE_PROJECTION_OFFSET"), _num(text, "SAMPLE_PROJECTION_OFFSET")
            lc = _num(text, "CENTER_LONGITUDE")
            lat_max = (lp - 1) / res + 0.5 / res
            lon_west = lc + (1 - sp) / res - 0.5 / res
        if abs(lines / res - 180.0) > 1e-6 or abs(samples / res - 360.0) > 1e-6:
            raise ValueError(f"{img_path.name}: se esperaba un mapa global ({lines}x{samples} a {res} px/°)")
        raw = np.fromfile(img_path, dtype="<i2", count=lines * samples).reshape(lines, samples)
        k = _num(text, "SCALING_FACTOR")
        off = _num(text, "OFFSET")
        add = 0.0 if re.search(r"OFFSET\s*=\s*1737400", text) else off
        m = re.search(r"MISSING_CONSTANT\s*=\s*(-?\d+)", text)
        return cls(raw, k, add, res, lat_max, lon_west % 360.0, int(m.group(1)) if m else None)
