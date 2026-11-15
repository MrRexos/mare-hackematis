// Carga los ficheros que genera el pipeline (web/public/data/).
// Todo es estático: no hay servidor, solo ficheros que el navegador descarga.
// El módulo polar tiene dos juegos de datos con la misma estructura: el polo sur en la raíz
// (data/) y el polo norte en data/north/. Las efemérides son comunes (data/ephem.f32).

const BASE = `${import.meta.env.BASE_URL}data/`;

/** Carpeta de los datos de cada polo, relativa a data/. */
export const POLE_DIR = { south: "", north: "north/" };

/** Manifest del polo norte, o null si sus datos todavía no se han generado. */
export async function loadNorthManifest() {
  try {
    const r = await fetch(`${BASE}${POLE_DIR.north}manifest.json`);
    if (!r.ok) return null;
    const m = await r.json();
    return m && m.grid?.pole === "north" && m.layers?.elevation ? m : null;
  } catch {
    return null;
  }
}

async function getJSON(path) {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}

async function getBuffer(path) {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.arrayBuffer();
}

function getImage(path) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`${path}: could not load image`));
    img.src = BASE + path;
  });
}

/**
 * Devuelve { manifest, layers: {name: Float32Array}, horizon: Uint8Array,
 * ephem: Float32Array, hillshade: HTMLImageElement, validation, pole, hillshadeUrl }.
 * onProgress(done, total, label) informa del progreso real.
 * pole: "south" (por defecto) o "north"; las rutas del manifest son relativas a su carpeta.
 */
export async function loadData(onProgress = () => {}, pole = "south") {
  const dir = POLE_DIR[pole];
  const manifestAt = (path) => getJSON(dir + path);
  const bufferAt = (path) => getBuffer(dir + path);
  const manifest = await manifestAt("manifest.json");
  const jobs = [];
  const layers = {};
  for (const [name, meta] of Object.entries(manifest.layers || {})) {
    jobs.push([meta.label, async () => (layers[name] = new Float32Array(await bufferAt(meta.file)))]);
  }
  let horizon = null;
  let ephem = null;
  let hillshade = null;
  let validation = null;
  if (manifest.horizon) jobs.push(["Terrain horizons", async () => (horizon = new Uint8Array(await bufferAt(manifest.horizon.file)))]);
  if (manifest.ephem) jobs.push(["Sun and Earth positions", async () => (ephem = new Float32Array(await bufferAt(manifest.ephem.file)))]);
  if (manifest.hillshade) jobs.push(["Relief shading", async () => (hillshade = await getImage(dir + manifest.hillshade.file))]);
  if (manifest.validation) jobs.push(["Validation", async () => (validation = await manifestAt(manifest.validation))]);

  let done = 0;
  onProgress(done, jobs.length, "Manifest");
  await Promise.all(
    jobs.map(async ([label, fn]) => {
      await fn();
      done += 1;
      onProgress(done, jobs.length, label);
    }),
  );
  const hillshadeUrl = manifest.hillshade ? BASE + dir + manifest.hillshade.file : null;
  return { manifest, layers, horizon, ephem, hillshade, validation, pole: manifest.grid.pole || pole, hillshadeUrl };
}
