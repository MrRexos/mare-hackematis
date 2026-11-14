"""Posiciones del Sol y de la Tierra vistas desde el centro de la Luna (SPICE).

Salida: Float32 (n, 6) = [Sol x, y, z, Tierra x, y, z] en km, marco MOON_ME,
una fila por hora. La web calcula desde cada píxel:
- Sol: misma dirección para toda la región (paralaje < 5″).
- Tierra: vector Tierra − punto del terreno (paralaje ~0.03° en la región).
"""

from __future__ import annotations

import numpy as np
import spiceypy as sp

from .config import ABCORR, EPHEM_END_UTC, EPHEM_FRAME, EPHEM_START_UTC, EPHEM_STEP_S, SPICE

_loaded = False


def load_kernels() -> None:
    global _loaded
    if _loaded:
        return
    for f in SPICE.values():
        if not f.dest.exists():
            raise FileNotFoundError(f"Falta {f.dest.name}: ejecuta `python -m moonsite.fetch`")
        sp.furnsh(str(f.dest))
    _loaded = True


def epochs() -> np.ndarray:
    load_kernels()
    et0 = sp.str2et(EPHEM_START_UTC)
    et1 = sp.str2et(EPHEM_END_UTC)
    n = int(round((et1 - et0) / EPHEM_STEP_S))
    return et0 + np.arange(n) * EPHEM_STEP_S


def utc_to_unix_ms(utc: str) -> int:
    from datetime import datetime, timezone

    return int(datetime.fromisoformat(utc).replace(tzinfo=timezone.utc).timestamp() * 1000)


def sun_earth(ets: np.ndarray) -> np.ndarray:
    load_kernels()
    sun, _ = sp.spkpos("SUN", ets, EPHEM_FRAME, ABCORR, "MOON")
    earth, _ = sp.spkpos("EARTH", ets, EPHEM_FRAME, ABCORR, "MOON")
    return np.hstack([np.asarray(sun), np.asarray(earth)])


def build() -> tuple[np.ndarray, dict]:
    ets = epochs()
    # La rejilla de efemérides se define en UTC (lo que ve el usuario); los
    # segundos intercalares no cambian dentro de 2026-2030 según naif0012.
    vec = sun_earth(ets).astype(np.float32)
    meta = {
        "file": "ephem.f32",
        "startUtc": EPHEM_START_UTC + "Z",
        "startUnixMs": utc_to_unix_ms(EPHEM_START_UTC),
        "stepSeconds": EPHEM_STEP_S,
        "count": int(len(ets)),
        "columns": ["sunX", "sunY", "sunZ", "earthX", "earthY", "earthZ"],
        "units": "km",
        "frame": EPHEM_FRAME,
        "abcorr": ABCORR,
        "source": "NASA/JPL NAIF SPICE: DE440 (de440s.bsp), moon_pa_de440_200625.bpc, moon_de440_250416.tf",
    }
    return vec, meta
