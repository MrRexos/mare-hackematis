#!/usr/bin/env python3
"""
Preview temporal W4 de la capa Tierra (T4 · Nil): fracciones / notes 0–100 **per dia**.

No substitueix G1K amb LDEM_64 (`python -m moonsite.earth_global AAAA-MM-DD`).
Aquí es calcula a W4 (1440×720) amb horitzó **geomètric** (esfera) + direcció de la
Terra (SPICE si hi ha kernels; si no, libració analítica). Serveix per veure a la
pestanya Global com canvia la matriu amb el dia.

  python3 scripts/export_web_global_earth_preview.py
  python3 scripts/export_web_global_earth_preview.py --dias 2026-11-14 2026-12-01
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "public" / "data" / "global"
KERNELS = ROOT / ".cache" / "kernels"
COLS, ROWS = 1440, 720
STEP = 360.0 / COLS
EARTH_MIN_PCT = 25.0
DEG = math.pi / 180.0


def _parse_day(s: str) -> datetime:
    return datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=timezone.utc)


def earth_positions_analytic(day0: datetime, n_hours: int = 24) -> np.ndarray:
    """Vector Terra (km) en MOON_ME aproximat: distància mitjana + libració ±7–8°."""
    # Dia del cicle ~27.3 d des d'una època arbitrària
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    out = np.empty((n_hours, 3), dtype=np.float64)
    for h in range(n_hours):
        t = day0 + timedelta(hours=h)
        days = (t - t0).total_seconds() / 86400.0
        lon = 7.9 * math.sin(2 * math.pi * days / 27.55)   # °
        lat = 6.7 * math.sin(2 * math.pi * days / 27.21)
        d = 384_400.0 + 21_000.0 * math.cos(2 * math.pi * days / 27.55)
        la, lo = lat * DEG, lon * DEG
        out[h] = [d * math.cos(la) * math.cos(lo), d * math.cos(la) * math.sin(lo), d * math.sin(la)]
    return out


def earth_positions_spice(day0: datetime, n_hours: int = 24) -> np.ndarray | None:
    needed = [
        KERNELS / "naif0012.tls",
        KERNELS / "pck00011.tpc",
        KERNELS / "moon_de440_250416.tf",
        KERNELS / "moon_pa_de440_200625.bpc",
        KERNELS / "de440s.bsp",
    ]
    if not all(p.exists() for p in needed):
        return None
    try:
        import spiceypy as spice
    except ImportError:
        return None
    for p in needed:
        spice.furnsh(str(p))
    out = np.empty((n_hours, 3), dtype=np.float64)
    try:
        for h in range(n_hours):
            t = day0 + timedelta(hours=h)
            et = spice.str2et(t.strftime("%Y-%m-%dT%H:%M:%S UTC"))
            # Posició aparent de la Terra des del centre de la Lluna (MOON_ME)
            state, _ = spice.spkezr("EARTH", et, "MOON_ME", "LT+S", "MOON")
            out[h] = state[:3]
    finally:
        spice.kclear()
    return out


def fraction_w4(E: np.ndarray) -> np.ndarray:
    """Fracció d'hores amb elevació geomètrica de la Terra > 0° (paral·laxi simple)."""
    lon = -180.0 + (np.arange(COLS) + 0.5) * STEP
    lat = 90.0 - (np.arange(ROWS) + 0.5) * STEP
    la, lo = np.meshgrid(np.radians(lat), np.radians(lon), indexing="ij")
    # up local
    ux = np.cos(la) * np.cos(lo)
    uy = np.cos(la) * np.sin(lo)
    uz = np.sin(la)
    R = 1737.4  # km
    obs = np.stack([R * ux, R * uy, R * uz], axis=-1)  # (rows, cols, 3)
    vis = np.zeros((ROWS, COLS), dtype=np.float64)
    for h in range(E.shape[0]):
        # vector Terra des de l'observador (paral·laxi)
        v = E[h][None, None, :] - obs
        # elevació ≈ angle respecte pla local: asin(up·vhat)
        norm = np.linalg.norm(v, axis=-1).clip(1e-9)
        el = np.arcsin(np.clip((v[..., 0] * ux + v[..., 1] * uy + v[..., 2] * uz) / norm, -1, 1))
        vis += (el > 0).astype(np.float64)
    return (vis / E.shape[0]).astype(np.float32)


def nota_0_100(frac: np.ndarray) -> np.ndarray:
    pct = np.rint(frac * 100.0)
    return np.where(pct >= EARTH_MIN_PCT, pct, 0).astype(np.float32)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--dias",
        nargs="+",
        default=["2026-11-14", "2026-11-21", "2026-12-01"],
        help="Dies UTC AAAA-MM-DD a exportar",
    )
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)

    man_path = OUT / "manifest.json"
    meta = json.loads(man_path.read_text(encoding="utf-8")) if man_path.exists() else {
        "temporary": True,
        "grid": {
            "id": "W4", "cols": COLS, "rows": ROWS,
            "lon0": -180.0, "lat0": 90.0, "stepDeg": STEP,
            "order": "row-major, row 0 = north",
        },
        "layers": {},
    }
    meta["temporary"] = True
    meta.setdefault("layers", {})
    meta["note"] = (
        "Preview W4: Jan slope/suitability + Nil T4 Earth-by-day (geometric horizon). "
        "Full G1K with LDEM_64: python -m moonsite.earth_global AAAA-MM-DD"
    )
    earth_days = []

    for s in args.dias:
        day0 = _parse_day(s)
        print(f"Dia {s}…")
        E = earth_positions_spice(day0)
        src = "spice"
        if E is None:
            print("  (sense SPICE → libració analítica)")
            E = earth_positions_analytic(day0)
            src = "analytic_libration"
        frac = fraction_w4(E)
        suit = nota_0_100(frac)
        f_frac = f"earth_frac_{s}.f32"
        f_suit = f"earth_suit_{s}.f32"
        frac.astype("<f4").tofile(OUT / f_frac)
        suit.astype("<f4").tofile(OUT / f_suit)
        lid_f = f"earth.visible_fraction.mean@{s}"
        lid_s = f"suitability.earth@{s}"
        meta["layers"][lid_f] = {
            "file": f_frac, "dtype": "float32", "units": "fraction",
            "label": f"Earth frac {s}", "group": "nil", "period": s,
            "min": float(frac.min()), "max": float(frac.max()),
            "sourceResolution": f"W4 geometric preview ({src}); full Nil uses LDEM_64 horizons",
        }
        meta["layers"][lid_s] = {
            "file": f_suit, "dtype": "float32", "units": "score_0_100",
            "label": f"Earth suit {s}", "group": "nil", "period": s,
            "min": float(suit.min()), "max": float(suit.max()),
            "function": f"round(100*f) if >= {EARTH_MIN_PCT:g} else 0",
            "sourceResolution": f"W4 geometric preview ({src})",
        }
        earth_days.append(s)
        print(f"  frac [{frac.min():.3f}, {frac.max():.3f}]  suit [{suit.min():.0f}, {suit.max():.0f}]")

    for k in ("slope", "suitability"):
        if k in meta["layers"]:
            meta["layers"][k]["group"] = "jan"
            meta["layers"][k].setdefault("label", "Slope" if k == "slope" else "Suitability")

    meta["earthDays"] = earth_days
    meta["sources"] = {
        "jan": "scripts/export_web_global_preview.py (LOLA)",
        "nil": "scripts/export_web_global_earth_preview.py (T4 day-based; geometric W4)",
    }
    man_path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(f"OK → {OUT}  days={earth_days}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
