// Carga los ficheros que genera el pipeline (web/public/data/).
// Todo es estático: no hay servidor, solo ficheros que el navegador descarga.

const BASE = `${import.meta.env.BASE_URL}data/`;

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
 * ephem: Float32Array, hillshade: HTMLImageElement, validation }.
 * onProgress(done, total, label) informa del progreso real.
 */
export async function loadData(onProgress = () => {}) {
  const manifest = await getJSON("manifest.json");
  const jobs = [];
  const layers = {};
  for (const [name, meta] of Object.entries(manifest.layers || {})) {
    jobs.push([meta.label, async () => (layers[name] = new Float32Array(await getBuffer(meta.file)))]);
  }
  let horizon = null;
  let ephem = null;
  let hillshade = null;
  let validation = null;
  if (manifest.horizon) jobs.push(["Terrain horizons", async () => (horizon = new Uint8Array(await getBuffer(manifest.horizon.file)))]);
  if (manifest.ephem) jobs.push(["Sun and Earth positions", async () => (ephem = new Float32Array(await getBuffer(manifest.ephem.file)))]);
  if (manifest.hillshade) jobs.push(["Relief shading", async () => (hillshade = await getImage(manifest.hillshade.file))]);
  if (manifest.validation) jobs.push(["Validation", async () => (validation = await getJSON(manifest.validation))]);

  let done = 0;
  onProgress(done, jobs.length, "Manifest");
  await Promise.all(
    jobs.map(async ([label, fn]) => {
      await fn();
      done += 1;
      onProgress(done, jobs.length, label);
    }),
  );
  return { manifest, layers, horizon, ephem, hillshade, validation };
}
