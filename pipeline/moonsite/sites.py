"""Sitios de referencia que se muestran sobre el mapa.

Regiones candidatas de Artemis III anunciadas por la NASA el 28-10-2024. La
NASA publica regiones de ~15×15 km, no puntos; aquí se usa un centro
aproximado de cada región. Coordenadas tomadas del proyecto Lunar Horizon
(github.com/localizedprojects/CLPS-MOON-BROWSER, licencia MIT), que las
deriva de mosaicos LROC (Henriksen et al. 2023). Falta "Slater Plain": no
tenemos un centro fiable todavía.
"""

ARTEMIS_III = [
    ("artemis3-peak-near-cabeus-b", "Peak near Cabeus B", -83.60, -68.80),
    ("artemis3-haworth", "Haworth", -86.75, -23.67),
    ("artemis3-malapert-massif", "Malapert Massif", -85.98, -0.26),
    ("artemis3-mons-mouton-plateau", "Mons Mouton Plateau", -84.30, 30.60),
    ("artemis3-mons-mouton", "Mons Mouton", -85.43, 31.83),
    ("artemis3-nobile-rim-1", "Nobile Rim 1", -85.44, 37.44),
    ("artemis3-nobile-rim-2", "Nobile Rim 2", -83.95, 58.74),
    ("artemis3-de-gerlache-rim-2", "de Gerlache Rim 2", -88.22, -63.43),
]


def catalog() -> dict:
    return {
        "groups": [{
            "id": "artemis3",
            "label": "Artemis III candidate regions",
            "shape": "circle",
            "fidelity": "approximate",
            "note": ("NASA announced nine ~15 × 15 km candidate regions on 2024-10-28. "
                     "Points are approximate region centres, not landing sites."),
            "source": "NASA (2024); centres via Lunar Horizon / LROC mosaics (Henriksen et al. 2023)",
        }],
        "sites": [{"id": i, "name": n, "lat": lat, "lon": lon, "group": "artemis3"} for i, n, lat, lon in ARTEMIS_III],
    }
