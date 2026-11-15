"""Genera los datos que consume la web en web/public/data/.

Uso (desde pipeline/):
    python -m moonsite.build all        # todo
    python -m moonsite.build layers     # capas fijas + relieve sombreado
    python -m moonsite.build ephem      # Sol y Tierra cada hora
    python -m moonsite.build horizon    # horizonte de cada píxel (lo más lento)
    python -m moonsite.build sites      # sitios de referencia
    python -m moonsite.build validate   # Horizons + LOLA AVGVISIB (necesita red)

Polo norte: los mismos pasos con `--pole north` (antes, `python -m moonsite.fetch north`).
    python -m moonsite.build all --pole north

El polo sur se escribe en web/public/data/ y el norte en web/public/data/north/, con la
misma estructura. Las efemérides no dependen del polo: hay un solo ephem.f32, en la raíz.

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

MANIFEST = C.WEB_DATA / "manifest.json"  # polo sur (nombre histórico); ver _manifest(pole)

#: Etiqueta de los productos LOLA de cada polo: LDEM_75S_240M / LDEM_75N_240M.
POLE_TAG = {"south": "75S", "north": "75N"}


def _manifest(pole: str):
    return C.web_data(pole) / "manifest.json"


def layer_meta(pole: str) -> dict:
    """Metadatos de las capas, con el nombre del producto del polo que toca."""
    tag = POLE_TAG[pole]
    return {name: {**meta, "source": meta["source"].replace("75S", tag)} for name, meta in LAYER_META.items()}


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
                 "description": "Share of time with any part of the Earth disk visible, 18.6 years (Mazarico et al. 2011)."},
    "roughness": {"label": "Roughness", "units": "m", "source": "LOLA LDRM_75S_240M (PDS)", "fidelity": "computed",
                  "description": "Median of 16 LOLA roughness samples (residual height std, 30-120 m baseline) per 1 km pixel."},
    "tempAvgK": {"label": "Average temperature", "units": "K", "source": "LRO Diviner PRP v2.0 (PDS)", "fidelity": "computed",
                 "description": "Annual average temperature 2 cm below the surface (Paige et al. 2010), mean per 1 km pixel."},
    "tempMaxK": {"label": "Maximum temperature", "units": "K", "source": "LRO Diviner PRP v2.0 (PDS)", "fidelity": "computed",
                 "description": "Annual maximum surface temperature (Paige et al. 2010), mean per 1 km pixel."},
    "iceDepthM": {"label": "Ice stability depth", "units": "m", "source": "LRO Diviner PRP v2.0 (PDS)", "fidelity": "computed",
                  "description": "Shallowest depth in the pixel where water ice is stable (0 = at the surface; 2.87 = deeper or never)."},
    "iceShare": {"label": "Accessible ice share", "units": "fraction", "source": "LRO Diviner PRP v2.0 (PDS)", "fidelity": "computed",
                 "description": "Share of the pixel where ice is stable within 0.5 m of the surface."},
    "iceDistKm": {"label": "Distance to accessible ice", "units": "km", "source": "LRO Diviner PRP v2.0 (PDS)", "fidelity": "computed",
                  "description": "Distance to the nearest spot where ice is stable within 0.5 m of the surface."},
}


PROJECTION = {
    "south": "south polar stereographic (LOLA): x = rho·sin(lon), y = rho·cos(lon), row 0 = +y",
    "north": "north polar stereographic (LOLA): x = rho·sin(lon), y = −rho·cos(lon), row 0 = +y",
}
ORDER = {
    "south": "row-major, row 0 at the top (+y, towards 0°E)",
    "north": "row-major, row 0 at the top (+y, towards 180°E)",
}
NORTH_IS = {"south": "away from the south pole", "north": "towards the north pole"}


def _load(pole: str = "south") -> dict:
    f = _manifest(pole)
    if f.exists():
        return json.loads(f.read_text(encoding="utf-8"))
    return {}


def _save(m: dict, pole: str = "south") -> None:
    m["generated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    m["grid"] = {
        "n": C.GRID_N, "pxM": C.GRID_PX_M, "halfM": C.GRID_HALF_M, "radiusM": C.MOON_R_M,
        "pole": pole, "projection": PROJECTION[pole],
        "frame": "MOON_ME", "order": ORDER[pole],
    }
    C.web_data(pole).mkdir(parents=True, exist_ok=True)
    _manifest(pole).write_text(json.dumps(m, indent=2, ensure_ascii=False), encoding="utf-8")


def step_layers(m: dict, pole: str = "south") -> None:
    print("Capas fijas...")
    out = C.web_data(pole)
    (out / "layers").mkdir(parents=True, exist_ok=True)
    built = layers.build_all(pole)
    meta = layer_meta(pole)
    m["layers"] = {}
    for name, arr in built.items():
        f = out / "layers" / f"{name}.f32"
        arr.astype("<f4").tofile(f)
        finite = arr[np.isfinite(arr)]
        m["layers"][name] = {**meta[name], "file": f"layers/{name}.f32", "dtype": "float32",
                             "min": float(finite.min()), "max": float(finite.max())}
        print(f"   {name}: {finite.min():.3f} … {finite.max():.3f}")
    m["hillshade"] = layers.hillshade_png(layers.dem_raster(pole), out / "hillshade.png")
    m["hillshade"]["source"] = f"LOLA LDEM_{POLE_TAG[pole]}_240M (PDS)"


def step_ephem(m: dict, pole: str = "south") -> None:
    """Sol y Tierra cada hora. No depende del polo: un solo fichero, en la raíz de los datos."""
    print("Efemérides (SPICE)...")
    vec, meta = ephemeris.build()
    f = C.WEB_DATA / meta["file"]
    vec = vec.astype("<f4")
    # Solo se reescribe si cambia algo: así construir un polo no toca el fichero del otro.
    if not f.exists() or not np.array_equal(np.fromfile(f, dtype="<f4"), vec.ravel()):
        vec.tofile(f)
    # Ruta relativa a la carpeta del manifest de cada polo.
    m["ephem"] = {**meta, "file": meta["file"] if pole == "south" else f"../{meta['file']}"}
    print(f"   {meta['count']} horas desde {meta['startUtc']}")


def step_horizon(m: dict, pole: str = "south") -> None:
    print("Horizontes (puede tardar unos minutos)...")
    t0 = time.time()
    deg = horizon.compute(layers.dem_raster(pole), pole=pole)
    q = horizon.quantize(deg)
    q.tofile(C.web_data(pole) / "horizon.u8")
    m["horizon"] = {
        "file": "horizon.u8", "dtype": "uint8", "bins": C.HORIZON_BINS,
        "binCentreDeg": f"k * 360 / bins, clockwise from north (north = {NORTH_IS[pole]})",
        "scaleDeg": C.HORIZON_Q_SCALE_DEG, "offsetDeg": C.HORIZON_Q_OFFSET_DEG,
        "observerHeightM": C.OBSERVER_HEIGHT_M, "minDistanceM": C.HORIZON_MIN_M, "maxDistanceM": C.HORIZON_MAX_M,
        "source": f"Ray-marched over LOLA LDEM_{POLE_TAG[pole]}_240M (PDS)", "fidelity": "approximate",
        "note": "1 km grid, 5° azimuth bins: regional screening, not site certification.",
    }
    print(f"   hecho en {time.time() - t0:.0f} s")


def step_sites(m: dict, pole: str = "south") -> None:
    m["sites"] = sites.catalog(pole)


def step_validate(m: dict, pole: str = "south") -> None:
    print("Validación...")
    data = C.web_data(pole)
    out = {}
    try:
        out["horizons"] = validate.horizons_check(pole=pole)
        print(f"   Horizons: máx. Sol {out['horizons']['maxArcmin']['sun']:.4f}′, "
              f"Tierra {out['horizons']['maxArcmin']['earth']:.4f}′")
    except Exception as e:  # sin red, etc.
        print(f"   Horizons no disponible: {e}")
    if "avgSun" in m.get("layers", {}) and "horizon" in m and "ephem" in m:
        n = C.GRID_N * C.GRID_N
        q = np.fromfile(data / "horizon.u8", dtype=np.uint8).reshape(n, C.HORIZON_BINS)
        avg = np.fromfile(data / "layers/avgSun.f32", dtype="<f4")
        eph = np.fromfile(data / m["ephem"]["file"], dtype="<f4").reshape(-1, 6)
        out["avgvisib"] = validate.avgvisib_check(q, avg, eph, C.HORIZON_Q_SCALE_DEG, C.HORIZON_Q_OFFSET_DEG, pole=pole)
        print(f"   LOLA AVGVISIB: diferencia media {out['avgvisib']['meanAbsDiffPct']:.2f} puntos "
              f"(sesgo {out['avgvisib']['biasPct']:+.2f})")
    if "avgEarth" in m.get("layers", {}) and "horizon" in m and "ephem" in m:
        n = C.GRID_N * C.GRID_N
        q = np.fromfile(data / "horizon.u8", dtype=np.uint8).reshape(n, C.HORIZON_BINS)
        avg = np.fromfile(data / "layers/avgEarth.f32", dtype="<f4")
        eph = np.fromfile(data / m["ephem"]["file"], dtype="<f4").reshape(-1, 6)
        out["avgearth"] = validate.avgearth_check(q, avg, eph, C.HORIZON_Q_SCALE_DEG, C.HORIZON_Q_OFFSET_DEG, pole=pole)
        print(f"   LOLA Tierra: diferencia media {out['avgearth']['meanAbsDiffPct']:.2f} puntos "
              f"(sesgo {out['avgearth']['biasPct']:+.2f})")
    (data / "validation.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    m["validation"] = "validation.json"


STEPS = {"layers": step_layers, "ephem": step_ephem, "horizon": step_horizon, "sites": step_sites,
         "validate": step_validate}


def _pole_arg(argv: list[str]) -> tuple[str, list[str]]:
    """Separa `--pole north` (o `--pole=north`) del resto de argumentos."""
    pole, rest, k = "south", [], 0
    while k < len(argv):
        a = argv[k]
        if a == "--pole":
            if k + 1 >= len(argv):
                raise SystemExit("--pole necesita un valor: south o north")
            pole, k = argv[k + 1], k + 1
        elif a.startswith("--pole="):
            pole = a.split("=", 1)[1]
        else:
            rest.append(a)
        k += 1
    if pole not in C.POLES:
        raise SystemExit(f"--pole debe ser uno de {', '.join(C.POLES)}")
    return pole, rest


def main(argv: list[str]) -> None:
    pole, todo = _pole_arg(argv)
    todo = todo or ["all"]
    if "all" in todo:
        todo = ["layers", "ephem", "horizon", "sites", "validate"]
    unknown = [s for s in todo if s not in STEPS]
    if unknown:
        raise SystemExit(f"Paso desconocido: {', '.join(unknown)}. Pasos: {', '.join(STEPS)}, all")
    m = _load(pole)
    C.web_data(pole).mkdir(parents=True, exist_ok=True)
    for s in todo:
        STEPS[s](m, pole)
        _save(m, pole)
    print(f"Listo: {_manifest(pole)}")


if __name__ == "__main__":
    main(sys.argv[1:])
