"""Configuración central del pipeline.

Todo lo que decide *qué* se calcula (fuentes de datos, malla, fechas,
constantes) está aquí, para poder revisar las hipótesis científicas en un
único sitio. Ver docs/ARCHITECTURE.md.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

# ---------------------------------------------------------------------------
# Rutas
# ---------------------------------------------------------------------------
REPO = Path(__file__).resolve().parents[2]
#: Descargas grandes (LOLA, SPICE). Fuera de git (ver .gitignore).
CACHE = Path(os.environ.get("MOONSITE_CACHE", REPO / ".cache"))
RAW = CACHE / "raw"
KERNELS = CACHE / "kernels"
#: Lo que consume la web (pequeño, sí va a git para publicar sin recalcular).
WEB_DATA = REPO / "web" / "public" / "data"


def web_data(pole: str = "south") -> Path:
    """Carpeta de datos del módulo polar: el polo sur en la raíz (como siempre), el norte en north/."""
    return WEB_DATA if pole == "south" else WEB_DATA / pole


# ---------------------------------------------------------------------------
# Fuentes oficiales (NASA PDS Geosciences Node y NASA/JPL NAIF)
# ---------------------------------------------------------------------------
PDS_LOLA = "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx"
NAIF = "https://naif.jpl.nasa.gov/pub/naif/generic_kernels"


@dataclass(frozen=True)
class Remote:
    url: str
    dest: Path
    size: int | None = None  # bytes esperados (comprobación de descarga)
    note: str = ""


#: Productos LOLA en proyección estereográfica polar (esfera R = 1737.4 km), por polo.
#: Los dos polos tienen los mismos productos y tamaños; solo cambia la letra (75S / 75N).
POLES = ("south", "north")
_POLE_TAG = {"south": "s", "north": "n"}
_POLE_LAT = {"south": "75-90°S", "north": "75-90°N"}


def _lola(pole: str) -> dict[str, "Remote"]:
    t, where = _POLE_TAG[pole], _POLE_LAT[pole]
    return {
        "ldem": Remote(f"{PDS_LOLA}/data/lola_gdr/polar/img/ldem_75{t}_240m.img", RAW / f"ldem_75{t}_240m.img",
                       29_062_688, f"Elevación LOLA 240 m/px, {where} (horizontes y relieve)"),
        "ldsm": Remote(f"{PDS_LOLA}/data/lola_gdr/polar/img/ldsm_75{t}_240m.img", RAW / f"ldsm_75{t}_240m.img",
                       29_062_688, f"Pendiente LOLA 240 m/px, {where}"),
        "lpsr": Remote(f"{PDS_LOLA}/extras/illumination/img/lpsr_75{t}_120m_201608.img", RAW / f"lpsr_75{t}_120m.img",
                       116_250_752, "Regiones en sombra permanente (Mazarico et al. 2011), 120 m/px"),
        "avgsun": Remote(f"{PDS_LOLA}/extras/illumination/img/avgvisib_75{t}_120m_201608.img",
                         RAW / f"avgvisib_75{t}_120m_sun.img", 116_250_752, "Visibilidad media del Sol (validación), 120 m/px"),
        "ldrm": Remote(f"{PDS_LOLA}/data/lola_gdr/polar/img/ldrm_75{t}_240m.img", RAW / f"ldrm_75{t}_240m.img",
                       29_062_688, f"Rugosidad LOLA 240 m/px (desviación de alturas, base 30-120 m), {where}"),
        "avgearth": Remote(f"{PDS_LOLA}/extras/illumination/img/avgvisib_75{t}_120m_201608_earth.img",
                           RAW / f"avgvisib_75{t}_120m_earth.img", 116_250_752,
                           "Visibilidad media de la Tierra (Mazarico et al. 2011), 120 m/px"),
    }


LOLA_BY_POLE = {pole: _lola(pole) for pole in POLES}
#: Polo sur (nombre histórico; el código nuevo usa LOLA_BY_POLE[pole]).
LOLA = LOLA_BY_POLE["south"]
LOLA_EXTRA: dict[str, "Remote"] = {}

#: LRO Diviner Polar Resource Product v2.0 (Paige et al. 2010), revisado por pares en PDS.
#: Tabla ASCII de 2 880 000 triángulos (~0,5 km) hasta 80° de latitud, una por polo:
#: temperatura media anual a 2 cm, temperatura máxima anual en superficie y profundidad
#: de estabilidad del hielo.
PDS_DIVINER = "https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1"
DIVINER = {
    "prp_south": Remote(f"{PDS_DIVINER}/data_derived_prp/dlre_prp_south.tab", RAW / "dlre_prp_south.tab",
                        604_800_210, "Diviner PRP sur (LRO-L-DLRE-5-PRP-V2.0)"),
    "prp_north": Remote(f"{PDS_DIVINER}/data_derived_prp/dlre_prp_north.tab", RAW / "dlre_prp_north.tab",
                        604_800_210, "Diviner PRP norte (LRO-L-DLRE-5-PRP-V2.0)"),
}
#: Profundidad máxima (m) a la que consideramos el hielo "accesible" para la capa de cercanía.
ICE_ACCESSIBLE_DEPTH_M = 0.5

#: LRO Diviner Global Cumulative Products (Williams et al. 2017, Icarus 283): temperatura
#: bolométrica MEDIDA de toda la Luna en celdas de 0,5° y 0,25 h de hora local (nadir,
#: 2009-2015). 18 franjas de 10° de latitud, 156 MB cada una (2,8 GB). Lo usa
#: moonsite.thermal_global. Se descarga con `python -m moonsite.fetch thermal`.
DIVINER_GCP_BANDS = [f"{a:02d}s{a - 10:02d}s" for a in range(90, 0, -10)] + [f"{a:02d}n{a + 10:02d}n" for a in range(0, 90, 10)]
DIVINER_GCP = {
    b: Remote(f"{PDS_DIVINER}/data_derived_gcp/global_cumul_avg_cyl_{b}_002.tab",
              RAW / "diviner_gcp" / f"global_cumul_avg_cyl_{b}_002.tab", 156_211_313,
              f"Diviner GCP {b} (LRO-L-DLRE-5-GCP-V1.0)")
    for b in DIVINER_GCP_BANDS
}

#: Relieve global LOLA (cilíndrica simple, 64 px/grado ≈ 474 m en el ecuador). Lo usa
#: el trabajo T4 (Tierra visible en la malla global G1K). Se descarga con
#: `python -m moonsite.fetch global`.
LOLA_GLOBAL = {
    "ldem64": Remote(f"{PDS_LOLA}/data/lola_gdr/cylindrical/img/ldem_64.img", RAW / "ldem_64.img",
                     530_841_600, "Elevación LOLA global 64 px/grado (23040 x 11520, int16)"),
    # Vista Whole Moon (moonsite.surface_global): rugosidad global y sombra permanente de los dos polos.
    "ldrm16": Remote(f"{PDS_LOLA}/data/lola_gdr/cylindrical/img/ldrm_16.img", RAW / "ldrm_16.img",
                     33_177_600, "Rugosidad LOLA global 16 px/grado (5760 x 2880, int16, mm)"),
    "lpsr65n": Remote(f"{PDS_LOLA}/extras/illumination/img/lpsr_65n_240m_201608.img", RAW / "lpsr_65n_240m.img",
                      82_432_800, "Sombra permanente 65-90°N (Mazarico et al. 2011), 240 m/px"),
    "lpsr65s": Remote(f"{PDS_LOLA}/extras/illumination/img/lpsr_65s_240m_201608.img", RAW / "lpsr_65s_240m.img",
                      82_432_800, "Sombra permanente 65-90°S (Mazarico et al. 2011), 240 m/px"),
}

#: Kernels SPICE: efemérides DE440 y orientación de la Luna.
SPICE = {
    "lsk": Remote(f"{NAIF}/lsk/naif0012.tls", KERNELS / "naif0012.tls", note="segundos intercalares"),
    "pck": Remote(f"{NAIF}/pck/pck00011.tpc", KERNELS / "pck00011.tpc", note="constantes de cuerpos"),
    "moon_fk": Remote(f"{NAIF}/fk/satellites/moon_de440_250416.tf", KERNELS / "moon_de440_250416.tf",
                      note="marcos MOON_ME / MOON_PA"),
    "moon_bpc": Remote(f"{NAIF}/pck/moon_pa_de440_200625.bpc", KERNELS / "moon_pa_de440_200625.bpc",
                       note="libración lunar DE440"),
    "spk": Remote(f"{NAIF}/spk/planets/de440s.bsp", KERNELS / "de440s.bsp", note="efemérides DE440 (1849-2150)"),
}

# ---------------------------------------------------------------------------
# Malla de análisis (estereográfica polar, igual que LOLA; la misma en los dos polos)
# ---------------------------------------------------------------------------
MOON_R_M = 1_737_400.0  # esfera de referencia LOLA
#: Semiancho de la malla. 200 km cubre hasta ~83.4° de latitud en los ejes: en el sur
#: incluye todas las regiones candidatas de Artemis III publicadas.
GRID_HALF_M = 200_000.0
GRID_PX_M = 1_000.0
GRID_N = int(round(2 * GRID_HALF_M / GRID_PX_M))  # 400 x 400 píxeles

# ---------------------------------------------------------------------------
# Horizontes
# ---------------------------------------------------------------------------
HORIZON_BINS = 72            # direcciones (cada 5°)
OBSERVER_HEIGHT_M = 2.0      # altura de los paneles / antena sobre el terreno
HORIZON_MIN_M = 300.0        # el relieve más cercano no lo resuelve la malla de 240 m
HORIZON_MAX_M = 300_000.0    # más allá la curvatura esconde cualquier relieve
#: Codificación en 1 byte: grados = q * SCALE + OFFSET  (de -5° a +20.5°).
HORIZON_Q_OFFSET_DEG = -5.0
HORIZON_Q_SCALE_DEG = 0.1

# ---------------------------------------------------------------------------
# Efemérides
# ---------------------------------------------------------------------------
EPHEM_START_UTC = "2026-01-01T00:00:00"
EPHEM_END_UTC = "2031-01-01T00:00:00"  # exclusivo
EPHEM_STEP_S = 3600.0                  # una posición por hora
EPHEM_FRAME = "MOON_ME"                # marco de LOLA (Mean Earth / Polar Axis)
ABCORR = "LT+S"                        # posiciones aparentes, como Horizons "airless apparent"
SUN_RADIUS_KM = 695_700.0

# ---------------------------------------------------------------------------
# Malla global G1K (contrato de datos v0.2, §2) y capa Tierra (T4)
# ---------------------------------------------------------------------------
G1K_COLS = 10_916            # columna 0 empieza en -180°E
G1K_ROWS = 5_458             # fila 0 empieza en +90°
#: El DEM global es de ~474 m: por debajo de esta distancia el relieve no se resuelve.
G1K_HORIZON_MIN_M = 500.0
G1K_HORIZON_STEP_M = 474.0
LAYERS_DIR = REPO / "layers"
#: Nota derivada 0-100 (suitability.earth): por debajo de este % del tiempo con la
#: Tierra visible la celda vale 0. La puntuación oficial la calcula la web con los
#: límites del usuario (contrato §6); esto es solo la vista rápida.
EARTH_MIN_PCT = 25.0
EARTH_RADIUS_KM = 6_378.1366
