"""Sitios de referencia que se muestran sobre el mapa.

Regiones candidatas de Artemis III anunciadas por la NASA el 28-10-2024. La
NASA publica regiones de ~15×15 km, no puntos; aquí se usa un centro
aproximado de cada región. Coordenadas tomadas del proyecto Lunar Horizon
(github.com/localizedprojects/CLPS-MOON-BROWSER, licencia MIT), que las
deriva de mosaicos LROC (Henriksen et al. 2023). Falta "Slater Plain": no
tenemos un centro fiable todavía.

Para la vista "Whole Moon": los seis alunizajes tripulados del programa Apollo. Posición
del módulo lunar medida sobre imágenes de LROC (tabla "Lunar landing site coordinates" de
NASA NSSDCA). La web puntúa la celda de 0,5° que contiene cada punto.
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


APOLLO = [
    ("apollo-11", "Apollo 11", "A11", 0.67416, 23.47314),
    ("apollo-12", "Apollo 12", "A12", -3.01239, -23.42157),
    ("apollo-14", "Apollo 14", "A14", -3.64530, -17.47136),
    ("apollo-15", "Apollo 15", "A15", 26.13222, 3.63386),
    ("apollo-16", "Apollo 16", "A16", -8.97301, 15.50019),
    ("apollo-17", "Apollo 17", "A17", 20.19080, 30.77168),
]


def catalog_global() -> dict:
    """Referencias de la vista "Whole Moon" (web/public/data/global/manifest.json → sites)."""
    return {
        "groups": [{
            "id": "apollo",
            "label": "Apollo references",
            "kind": "Apollo landing site",
            "shape": "circle",
            "fidelity": "approximate",
            "note": ("The six crewed Apollo landings (1969–1972). Each one is scored as the 0.5° cell "
                     "that contains the lunar module, so the score describes about 15 km of terrain, not the exact spot."),
            "source": "NASA NSSDCA, lunar module positions measured on LROC images",
        }],
        "sites": [{"id": i, "name": n, "short": sh, "lat": lat, "lon": lon, "group": "apollo"} for i, n, sh, lat, lon in APOLLO],
    }
