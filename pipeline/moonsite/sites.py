"""Sitios de referencia que se muestran sobre el mapa de cada polo.

Polo sur: regiones candidatas de Artemis III anunciadas por la NASA el 28-10-2024. La
NASA publica regiones de ~15×15 km, no puntos; aquí se usa un centro
aproximado de cada región. Coordenadas tomadas del proyecto Lunar Horizon
(github.com/localizedprojects/CLPS-MOON-BROWSER, licencia MIT), que las
deriva de mosaicos LROC (Henriksen et al. 2023). Falta "Slater Plain": no
tenemos un centro fiable todavía.

Polo norte: no existe una lista publicada de regiones candidatas comparable a la de
Artemis III, así que las referencias son cráteres con nombre (nomenclatura de la IAU),
que sirven para orientarse en el mapa. NO son sitios de aterrizaje propuestos. Cada
centro se ha comprobado contra el relieve LOLA LDEM_75N_240M: en todos hay un cráter del
diámetro esperado (borde entre 0,4 y 2,6 km por encima del fondo) y su centro medido
queda a menos de un 15 % del diámetro del valor de la tabla. Los que no pasaron esa
comprobación (Hinshelwood, Florey, Haskin) se dejaron fuera.
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

#: (id, nombre, latitud, longitud este, diámetro en km). Centro del cráter.
NORTH_CRATERS = [
    ("crater-whipple", "Whipple", 89.14, 118.2, 15.7),
    ("crater-peary", "Peary", 88.63, 24.4, 79),
    ("crater-aepinus", "Aepinus", 87.9, -109.7, 18),
    ("crater-erlanger", "Erlanger", 86.9, 28.6, 10),
    ("crater-fibiger", "Fibiger", 86.1, 37.2, 21),
    ("crater-hermite", "Hermite", 86.0, -89.9, 104),
    ("crater-byrd", "Byrd", 85.3, 9.8, 94),
    ("crater-rozhdestvenskiy", "Rozhdestvenskiy", 85.2, -155.4, 177),
    ("crater-lenard", "Lenard", 85.2, -109.4, 48),
]


def catalog(pole: str = "south") -> dict:
    """Grupo y sitios de referencia de un polo.

    Los campos `placeLabel`, `rankingLabel`, `markerLabel` y `legendLabel` son los textos
    que muestra la web para este grupo (ficha, ranking, marcador y leyenda del mapa).
    """
    if pole == "north":
        return {
            "groups": [{
                "id": "craters",
                "label": "Named craters near the north pole",
                "shape": "circle",
                "fidelity": "approximate",
                "placeLabel": "Named crater",
                "rankingLabel": "Named craters",
                "markerLabel": "Named crater (landmark)",
                "legendLabel": "Named crater",
                "note": ("Landmarks, not proposed landing sites: there is no published list of candidate regions "
                         "for the north pole comparable to Artemis III. Points are crater centres."),
                "source": ("IAU Gazetteer of Planetary Nomenclature (USGS), crater centres; "
                           "each one checked against the LOLA LDEM_75N_240M relief"),
            }],
            "sites": [{"id": i, "name": n, "lat": lat, "lon": lon, "group": "craters", "diameterKm": d}
                      for i, n, lat, lon, d in NORTH_CRATERS],
        }
    return {
        "groups": [{
            "id": "artemis3",
            "label": "Artemis III candidate regions",
            "shape": "circle",
            "fidelity": "approximate",
            "placeLabel": "Artemis III region",
            "rankingLabel": "Artemis III references",
            "markerLabel": "Artemis III reference region",
            "legendLabel": "Artemis III reference",
            "note": ("NASA announced nine ~15 × 15 km candidate regions on 2024-10-28. "
                     "Points are approximate region centres, not landing sites."),
            "source": "NASA (2024); centres via Lunar Horizon / LROC mosaics (Henriksen et al. 2023)",
        }],
        "sites": [{"id": i, "name": n, "lat": lat, "lon": lon, "group": "artemis3"} for i, n, lat, lon in ARTEMIS_III],
    }
