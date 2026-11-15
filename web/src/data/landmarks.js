/** Places with something to see in Astronaut Mode. Coordinates in degrees, Moon ME frame. */
export const LANDMARKS = [
  { id: "apollo11", name: "Apollo 11 · Tranquility Base", lat: 0.67416, lon: 23.47314, flag: "usa" },
];

/** The landmark inside a whole-Moon cell centred at (lat, lon), if there is one. */
export function landmarkInCell(lat, lon, stepDeg) {
  return LANDMARKS.find((l) => Math.abs(l.lat - lat) <= stepDeg / 2 && Math.abs(((l.lon - lon + 540) % 360) - 180) <= stepDeg / 2) || null;
}
