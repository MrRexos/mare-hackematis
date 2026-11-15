const cache = new Map();
export const TERRAIN_BASE = () => new URL(`${import.meta.env.BASE_URL}data/astronaut/`, document.baseURI).href;

/** Each pole has its own catalog: its elevation rasters are in that pole's stereographic plane. */
export const catalogFile = (lat) => (lat >= 0 ? "catalog-north.json" : "catalog.json");

export async function loadTerrain(lat, lon, onStage, signal) {
  const response = await fetch(new URL(catalogFile(lat), TERRAIN_BASE()), { signal });
  if (!response.ok) throw new Error("Lunar DEM catalog unavailable. Run the terrain preparation command.");
  const catalog = await response.json();
  const signature = JSON.stringify([catalog.generated, catalog.sources.map((s) => [s.id, s.resolutionM]), catalog.patches.map((p) => [p.id, p.sha256])]);
  const key = `${lat.toFixed(7)}:${lon.toFixed(7)}:${signature}`;
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./terrain.worker.js", import.meta.url), { type: "module" });
    const finish = () => { worker.terminate(); signal?.removeEventListener("abort", abort); };
    const abort = () => { finish(); reject(new DOMException("Terrain load cancelled", "AbortError")); };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    worker.onerror = (event) => { finish(); reject(new Error(event.message || "Terrain worker could not start.")); };
    worker.onmessage = ({ data }) => {
      if (data.stage) onStage(data.stage);
      if (data.error) { finish(); reject(new Error(data.error)); }
      if (data.result) {
        finish();
        if (cache.size >= 3) cache.delete(cache.keys().next().value);
        cache.set(key, data.result); resolve(data.result);
      }
    };
    worker.postMessage({ lat, lon, catalog, base: TERRAIN_BASE(), proxyBase: import.meta.env.DEV ? `${location.origin}/__nasa-dem` : null });
  });
}

let skyPromise;
export function loadAstronautEphemeris() {
  if (!skyPromise) skyPromise = Promise.all([
    fetch(new URL("ephem-de421.json", TERRAIN_BASE())).then((r) => { if (!r.ok) throw new Error("Astronaut ephemerides are missing. Run tools/prepare_astronaut_ephemeris.py."); return r.json(); }),
    fetch(new URL("ephem-de421.f32", TERRAIN_BASE())).then((r) => { if (!r.ok) throw new Error("Astronaut ephemerides are missing."); return r.arrayBuffer(); }),
  ]).then(([manifest, buffer]) => {
    const ephem = new Float32Array(buffer);
    if (ephem.length !== manifest.count * 6) throw new Error("Invalid astronaut ephemeris file.");
    return { manifest, ephem };
  }).catch((error) => { skyPromise = undefined; throw error; });
  return skyPromise;
}
