"""Genera los datos que consume la web en web/public/data/.

Uso (desde pipeline/):
    python -m moonsite.build all        # todo
    python -m moonsite.build layers     # capas fijas + relieve sombreado
    python -m moonsite.build ephem      # Sol y Tierra cada hora
    python -m moonsite.build horizon    # horizonte de cada píxel (lo más lento)
    python -m moonsite.build sites      # sitios de referencia
    python -m moonsite.build validate   # Horizons + LOLA AVGVISIB (necesita red)

Cada paso actualiza su parte de manifest.json sin borrar las demás.
"""

from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timezone

import numpy as np

from . import config as C
from . import ephemeris, horizon, layers, sites, validate

MANIFEST = C.WEB_DATA / "manifest.json"

LAYER_META = {
    "elevation": {"label": "Elevation", "units": "m", "source": "LOLA LDEM_75S_240M (PDS)", "fidelity": "computed",
                  "description": "Height above the 1737.4 km reference sphere, bilinear at the pixel centre."},
    "slope": {"label": "Slope", "units": "deg", "source": "LOLA LDSM_75S_240M (PDS)", "fidelity": "computed",
              "description": "Median of 16 slope samples (240 m baseline) inside the 1 km pixel."},
    "psrShare": {"label": "Permanent shadow share", "units": "fraction", "source": "LOLA LPSR_75S_120M (PDS)",
                 "fidelity": "computed", "description": "Share of the pixel in permanently shadowed regions."},
    "psrDistKm": {"label": "Distance to permanent shadow", "units": "km", "source": "LOLA LPSR_75S_120M (PDS)",
                  "fidelity": "computed", "description": "Distance from the pixel centre to the nearest PSR cell (ice proxy)."},
    "avgSun": {"label": "Long-term sunlight (LOLA)", "units": "fraction", "source": "LOLA AVGVISIB_75S_120M (PDS)",
               "fidelity": "validated", "description": "Average visible Sun fraction over 18.6 years (Mazarico et al. 2011)."},
    "avgEarth": {"label": "Long-term Earth view (LOLA)", "units": "fraction",
                 "source": "LOLA AVGVISIB_75S_120M_EARTH (PDS)", "fidelity": "validated",
                 "description": "Average visible Earth fraction over 18.6 years."},
}


def _load() -> dict:
    if MANIFEST.exists():
        return json.loads(MANIFEST.read_text(encoding="utf-8"))
    return {}


def _save(m: dict) -> None:
    m["generated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    m["grid"] = {
        "n": C.GRID_N, "pxM": C.GRID_PX_M, "halfM": C.GRID_HALF_M, "radiusM": C.MOON_R_M,
        "projection": "south polar stereographic (LOLA): x = rho·sin(lon), y = rho·cos(lon), row 0 = +y",
        "frame": "MOON_ME", "order": "row-major, row 0 at the top (+y, towards 0°E)",
    }
    C.WEB_DATA.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(m, indent=2, ensure_ascii=False), encoding="utf-8")


def step_layers(m: dict) -> None:
    print("Capas fijas...")
    (C.WEB_DATA / "layers").mkdir(parents=True, exist_ok=True)
    built = layers.build_all()
    m["layers"] = {}
    for name, arr in built.items():
        f = C.WEB_DATA / "layers" / f"{name}.f32"
        arr.astype("<f4").tofile(f)
        finite = arr[np.isfinite(arr)]
        m["layers"][name] = {**LAYER_META[name], "file": f"layers/{name}.f32", "dtype": "float32",
                             "min": float(finite.min()), "max": float(finite.max())}
        print(f"   {name}: {finite.min():.3f} … {finite.max():.3f}")
    m["hillshade"] = layers.hillshade_png(layers.dem_raster(), C.WEB_DATA / "hillshade.png")
    m["hillshade"]["source"] = "LOLA LDEM_75S_240M (PDS)"


def step_ephem(m: dict) -> None:
    print("Efemérides (SPICE)...")
    vec, meta = ephemeris.build()
    vec.astype("<f4").tofile(C.WEB_DATA / meta["file"])
    m["ephem"] = meta
    print(f"   {meta['count']} horas desde {meta['startUtc']}")


def step_horizon(m: dict) -> None:
    print("Horizontes (puede tardar unos minutos)...")
    t0 = time.time()
    deg = horizon.compute(layers.dem_raster())
    q = horizon.quantize(deg)
    q.tofile(C.WEB_DATA / "horizon.u8")
    m["horizon"] = {
        "file": "horizon.u8", "dtype": "uint8", "bins": C.HORIZON_BINS,
        "binCentreDeg": "k * 360 / bins, clockwise from north (north = away from the south pole)",
        "scaleDeg": C.HORIZON_Q_SCALE_DEG, "offsetDeg": C.HORIZON_Q_OFFSET_DEG,
        "observerHeightM": C.OBSERVER_HEIGHT_M, "minDistanceM": C.HORIZON_MIN_M, "maxDistanceM": C.HORIZON_MAX_M,
        "source": "Ray-marched over LOLA LDEM_75S_240M (PDS)", "fidelity": "approximate",
        "note": "1 km grid, 5° azimuth bins: regional screening, not site certification.",
    }
    print(f"   hecho en {time.time() - t0:.0f} s")


def step_sites(m: dict) -> None:
    m["sites"] = sites.catalog()


def step_validate(m: dict) -> None:
    print("Validación...")
    out = {}
    try:
        out["horizons"] = validate.horizons_check()
        print(f"   Horizons: máx. Sol {out['horizons']['maxArcmin']['sun']:.4f}′, "
              f"Tierra {out['horizons']['maxArcmin']['earth']:.4f}′")
    except Exception as e:  # sin red, etc.
        print(f"   Horizons no disponible: {e}")
    if "avgSun" in m.get("layers", {}) and "horizon" in m and "ephem" in m:
        n = C.GRID_N * C.GRID_N
        q = np.fromfile(C.WEB_DATA / "horizon.u8", dtype=np.uint8).reshape(n, C.HORIZON_BINS)
        avg = np.fromfile(C.WEB_DATA / "layers/avgSun.f32", dtype="<f4")
        eph = np.fromfile(C.WEB_DATA / m["ephem"]["file"], dtype="<f4").reshape(-1, 6)
        out["avgvisib"] = validate.avgvisib_check(q, avg, eph, C.HORIZON_Q_SCALE_DEG, C.HORIZON_Q_OFFSET_DEG)
        print(f"   LOLA AVGVISIB: diferencia media {out['avgvisib']['meanAbsDiffPct']:.2f} puntos "
              f"(sesgo {out['avgvisib']['biasPct']:+.2f})")
    (C.WEB_DATA / "validation.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    m["validation"] = "validation.json"


STEPS = {"layers": step_layers, "ephem": step_ephem, "horizon": step_horizon, "sites": step_sites,
         "validate": step_validate}


def main(argv: list[str]) -> None:
    todo = argv or ["all"]
    if "all" in todo:
        todo = ["layers", "ephem", "horizon", "sites", "validate"]
    m = _load()
    C.WEB_DATA.mkdir(parents=True, exist_ok=True)
    for s in todo:
        STEPS[s](m)
        _save(m)
    print(f"Listo: {MANIFEST}")


if __name__ == "__main__":
    main(sys.argv[1:])
