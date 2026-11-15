import { fromUrl } from "geotiff";
import { buildTerrain, localToLunar, makeFrame, seedAt } from "./coordinates.js";
import { buildSurface } from "./SurfaceRelief.js";
import { buildTerrainContext } from "./TerrainContext.js";

const rasters = new Map();
async function loadRaster(meta, base) {
  if (rasters.has(meta.file)) return rasters.get(meta.file);
  const response = await fetch(new URL(meta.file, base));
  if (!response.ok) throw new Error(`Elevation file unavailable (${response.status}).`);
  const buffer = await response.arrayBuffer();
  const values = meta.dtype === "int16" ? new Int16Array(buffer) : new Float32Array(buffer);
  if (values.length !== meta.width * meta.height) throw new Error("Elevation file has an invalid size.");
  const raster = { ...meta, values };
  rasters.set(meta.file, raster);
  return raster;
}

function covers(meta, frame, radius = 500 + meta.resolutionM * 1.5) {
  const bounds = meta.bounds || [meta.origin[0], meta.origin[1] + (meta.height - 1) * meta.pixelSize[1],
    meta.origin[0] + (meta.width - 1) * meta.pixelSize[0], meta.origin[1]];
  return [[-radius, -radius], [-radius, radius], [radius, -radius], [radius, radius]].every(([x, z]) => {
    const point = localToLunar(frame, x, z);
    return point.px > bounds[0] && point.py > bounds[1] && point.px < bounds[2] && point.py < bounds[3];
  });
}

async function remoteRaster(meta, frame, proxyBase) {
  const path = new URL(meta.url).pathname;
  const tiff = await fromUrl(`${proxyBase}${path}`, { allowFullFile: false, blockSize: 65536, cacheSize: 100 });
  try {
    const image = await tiff.getImage();
    const [ox, oy] = image.getOrigin(), [dx, dy] = image.getResolution();
    const offset = image.pixelIsArea() ? 0.5 : 0;
    const origin = [ox + dx * offset, oy + dy * offset];
    const margin = 500 + meta.resolutionM;
    const corners = [[-margin, -margin], [-margin, margin], [margin, -margin], [margin, margin]].map(([x, z]) => localToLunar(frame, x, z));
    const cols = corners.map((p) => (p.px - origin[0]) / dx), rows = corners.map((p) => (p.py - origin[1]) / dy);
    const left = Math.floor(Math.min(...cols)) - 1, top = Math.floor(Math.min(...rows)) - 1;
    const right = Math.ceil(Math.max(...cols)) + 2, bottom = Math.ceil(Math.max(...rows)) + 2;
    if (left < 0 || top < 0 || right > image.getWidth() || bottom > image.getHeight()) throw new Error("Incomplete DEM coverage.");
    const values = await image.readRasters({ window: [left, top, right, bottom], samples: [0], interleave: true });
    return { ...meta, origin: [origin[0] + left * dx, origin[1] + top * dy], pixelSize: [dx, dy],
      width: right - left, height: bottom - top, values, noData: image.getGDALNoData() };
  } finally { await tiff.close(); }
}

self.onmessage = async ({ data: request }) => {
  const stage = (label) => self.postMessage({ stage: label });
  try {
    stage("Loading lunar terrain");
    const catalog = request.catalog, frame = makeFrame(request.lat, request.lon);
    if (!catalog.regional) throw new Error("Regional NASA elevation data are missing.");
    const regional = await loadRaster(catalog.regional, request.base);
    let raster = null, terrain = null;
    const errors = [];
    const prepared = catalog.patches.filter((p) => covers(p, frame)).sort((a, b) => a.resolutionM - b.resolutionM);
    const available = catalog.sources.filter((p) => covers(p, frame)).sort((a, b) => a.resolutionM - b.resolutionM);
    const choices = [...prepared.map((meta) => ({ meta, local: true })),
      ...(request.proxyBase ? available.filter((p) => !prepared.some((q) => q.resolutionM <= p.resolutionM)).map((meta) => ({ meta, local: false })) : []),
      { meta: catalog.regional, local: true }].sort((a, b) => a.meta.resolutionM - b.meta.resolutionM);
    for (const choice of choices) {
      try {
        raster = choice.local ? await loadRaster(choice.meta, request.base) : await remoteRaster(choice.meta, frame, request.proxyBase);
        stage("Processing elevation data");
        // Resampling is explicitly interpolation, never claimed as new measured detail.
        terrain = buildTerrain(raster, request.lat, request.lon, { spacing: Math.max(2, Math.min(10, raster.resolutionM)) });
        break;
      } catch (error) { errors.push(`${choice.meta.name}: ${error.message}`); }
    }
    if (!terrain) throw new Error("No complete scientific elevation coverage at this location.");
    const metadata = { ...raster }; delete metadata.values;
    const context = buildTerrainContext(regional, terrain);
    stage("Shaping craters and regolith");
    // Relief the DEM cannot resolve: statistical, never presented as measured.
    terrain.surface = buildSurface(raster, terrain, { seed: seedAt(request.lat, request.lon), resolutionM: raster.resolutionM });
    metadata.relief = { ...terrain.surface.options, craters: terrain.surface.craters.length, sampleM: terrain.surface.cell };
    const result = { terrain, context, metadata, demo: catalog.demo, warnings: errors };
    self.postMessage({ result }, [terrain.positions.buffer, terrain.indices.buffer, terrain.uv.buffer, terrain.heights.buffer,
      context.positions.buffer, context.indices.buffer, context.uv.buffer, ...terrain.surface.levels.map((level) => level.buffer)]);
  } catch (error) { self.postMessage({ error: error.message }); }
};
