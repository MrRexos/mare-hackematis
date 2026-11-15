import { ROUGH_MAX_M } from "../engine/score.js";

const LOLA = "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/";
const POLAR_LIGHT = "https://pgda.gsfc.nasa.gov/products/69";
const DIVINER = "https://doi.org/10.17189/1520650";
const DE440 = "https://ssd.jpl.nasa.gov/planets/eph_export.html";
const percent = (v) => `${Math.round(v * 100)}%`;
const elevation = (v) => `${Math.round(v).toLocaleString("en-US")} m`;
const degrees = (v) => `${v.toFixed(1)}°`;
const metres = (v) => `${v.toFixed(2)} m`;
const kelvin = (v) => `${Math.round(v)} K`;
const kilometres = (v) => `${v.toFixed(1)} km`;

export const LAYERS = {
  score: {
    label: "Mission score", short: "Score", ramp: "score", legend: ["Lower", "Higher"],
    format: (v) => `${Math.round(v)}/100`,
    description: "Suitability from 0 to 100, computed from the six weighted mission factors. The active limits can exclude a cell from the map.",
    sources: [],
  },
  photo: {
    label: "Lunar surface", short: "Photo", ramp: "photo",
    description: "Surface without a coloured data overlay. Detailed shaded relief from LOLA at 250 m per image pixel; the shading is independent of the mission dates.",
    sources: [["NASA PDS · LOLA LDEM_75S_240M", LOLA + "ldem_75s_240m.lbl"]],
  },
  sun: {
    label: "Sun visibility", short: "Sun", ramp: "sun", legend: ["0%", "100%"], format: percent,
    description: "Share of the selected surface stay when the Sun clears the local terrain horizon, using the solar disk setting. Before a run, the map shows the LOLA 18.6-year average. Solar power also depends on panel orientation and sunlight intensity.",
    sources: [["NASA polar illumination", POLAR_LIGHT], ["JPL DE440 ephemerides", DE440]],
  },
  earth: {
    label: "Earth visibility", short: "Earth", ramp: "earth", legend: ["0%", "100%"], format: percent,
    description: "Share of the surface stay with Earth above the local terrain horizon, using the Earth disk setting. Before a run, the map shows the LOLA 18.6-year average. A radio link also requires an available ground station and suitable equipment.",
    sources: [["NASA polar illumination", POLAR_LIGHT], ["JPL DE440 ephemerides", DE440]],
  },
  elevation: {
    label: "Terrain elevation", short: "Elevation", ramp: "elevation", format: elevation,
    description: "Height at the centre of a 1 km cell, relative to the Moon’s 1,737.4 km reference sphere. Negative values are below that reference.",
    sources: [["NASA PDS · LOLA LDEM_75S_240M", LOLA + "ldem_75s_240m.lbl"]],
  },
  slope: {
    label: "Terrain slope", short: "Slope", ramp: "slope", legend: ["0°", "30°+"], format: degrees,
    description: "Slope in degrees, reported as the median of 16 samples from the LOLA 240 m map. Small steep areas can be missed at this scale.",
    sources: [["NASA PDS · LOLA LDSM_75S_240M", LOLA + "ldsm_75s_240m.lbl"]],
  },
  rough: {
    label: "Terrain roughness", short: "Roughness", ramp: "rough", legend: ["0 m", `${ROUGH_MAX_M} m+`], format: metres,
    description: "Typical variation in height after fitting a local plane to laser measurements over spans of about 30–120 m. The simulator uses the median of 16 samples per cell. Individual boulders are below this layer’s resolution.",
    sources: [["NASA PDS · LOLA LDRM_75S_240M", LOLA + "ldrm_75s_240m.lbl"]],
  },
  temp: {
    label: "Mean ground temperature", short: "Ground temp.", ramp: "temp", format: kelvin,
    description: "Modelled annual mean at 2 cm below the surface, averaged within each cell. Mare also shows the mean of the annual surface maxima in the cell. Both are fixed values across mission dates.",
    sources: [["NASA PDS · Diviner Polar Resource Product", DIVINER]],
  },
  shadow: {
    label: "Modelled ice proximity", short: "Ice proximity", ramp: "shadow", legend: ["Far", "Near"], format: kilometres,
    description: "Straight-line distance to terrain where water ice could remain stable within 0.5 m of the surface. Brighter areas are closer within the selected reach. Hatching marks cells with more than 50% permanent shadow. The thermal model estimates conditions for preservation.",
    sources: [["NASA PDS · Diviner thermal model", DIVINER], ["NASA · LOLA permanent shadow", POLAR_LIGHT]],
  },
};

/**
 * Las mismas capas para el polo norte: solo cambian los productos LOLA que se citan
 * (75S → 75N). Las descripciones valen para los dos polos.
 */
const northSources = (sources) => sources.map(([name, url]) => [name.replace("75S", "75N"), url.replace("_75s_", "_75n_")]);
const NORTH_LAYERS = Object.fromEntries(Object.entries(LAYERS).map(([key, layer]) => [key, { ...layer, sources: northSources(layer.sources) }]));

/** Capas del mapa polar de un polo ("south" o "north"). */
export const layersOf = (pole) => (pole === "north" ? NORTH_LAYERS : LAYERS);

const ICE_DEPTH_LIMIT = Math.fround(2.8738);

export const GROUND_GROUPS = [
  { label: "Terrain", fields: [
    { key: "elevation", label: "Elevation", format: elevation },
    { key: "slope", label: "Slope", format: degrees },
    { key: "roughness", label: "Roughness", format: metres },
  ] },
  { label: "Temperature", fields: [
    { key: "tempAvgK", label: "Annual mean at 2 cm", format: kelvin },
    { key: "tempMaxK", label: "Annual surface high", format: kelvin },
  ] },
  { label: "Shadow and visibility", fields: [
    { key: "psrShare", label: "Permanent shadow", format: percent },
    { key: "psrDistKm", label: "Distance to permanent shadow", format: kilometres },
    { key: "avgSun", label: "Long-term Sun visibility", format: percent },
    { key: "avgEarth", label: "Long-term Earth visibility", format: percent },
  ] },
  { label: "Ice", fields: [
    { key: "iceDistKm", label: "Distance to ice-stable terrain", format: kilometres },
    { key: "iceDepthM", label: "Modelled ice stability depth", format: (v) => v >= ICE_DEPTH_LIMIT ? "Beyond model depth" : metres(v) },
    { key: "iceShare", label: "Terrain favourable to shallow ice", format: percent },
    { key: "nearestIce", label: "Nearest M³ detection", format: kilometres },
  ] },
];

export function layerReading(layer, values, layers, pixel) {
  // The colour buffer for this layer encodes shadow and proximity, so read the original distance.
  const value = layer.ramp === "shadow" ? layers.iceDistKm?.[pixel] : values?.[pixel];
  return Number.isFinite(value) ? layer.format(value) : "No data";
}
