// Run with: node scripts/prepare-quixel-rocks.mjs C:/Users/Usuario/Downloads
// Originals stay outside the repository. Near/far meshes share embedded PBR maps.
import { NodeIO } from "@gltf-transform/core";
import { dedup, prune, simplifyPrimitive, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const source = process.argv[2];
if (!source) throw new Error("Pass the directory containing the original Fab GLBs.");
const base = fileURLToPath(new URL("../public/assets/astronaut/", import.meta.url));
const sources = [
  ["small_rocks_pack_ucdjdfmva", "Small Rocks Pack", "3aeaa063-c37f-4f85-b010-73e3f65e8e59"],
  ["limestone_rocks_ub3sddsda", "Limestone Rocks", "29ad6190-2546-4bfd-b3b2-bf609f6a4dec"],
  ["thai_beach_rocks_ueopcguga", "Thai Beach Rocks", "bf1cf231-d846-4045-82f0-448d572345be"],
  ["volcanic_dolerite_rocks_qjmvt", "Volcanic Dolerite Rocks", "cf620093-32aa-490d-93b1-0854081ad17f"],
  ["icelandic_porous_rocks_skxqf", "Icelandic Porous Rocks", "559ccca3-e4ac-4fbc-8612-4c8ad977cad7"],
  ["sharp_rocks_set_rbov2", "Sharp Rocks Set", "4ecef2c6-4ef7-414a-91d2-6ae87b91b6c2"],
  ["small_limestone_rocks_pack_ufllcisva", "Small Limestone Rocks Pack", "14920092-8eba-4f00-acd5-5ac62881b327"],
  ["granite_rocks_pfyss", "Granite Rocks", "da9190e9-43a5-4823-95b9-e11a44878206"],
];
await MeshoptSimplifier.ready;
await mkdir(join(base, "quixel/rocks"), { recursive: true });
const io = new NodeIO(), entries = [];
for (const [id, name, listing] of sources) {
  const document = await io.read(resolve(source, `${id}_mid.glb`));
  await document.transform(weld(), textureCompress({ encoder: sharp, targetFormat: "jpeg", resize: [1024, 1024], quality: 94, chromaSubsampling: "4:4:4" }));
  for (const mesh of document.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    const triangles = primitive.getIndices().getCount() / 3;
    if (triangles > 2200) simplifyPrimitive(primitive, { simplifier: MeshoptSimplifier, ratio: 2200 / triangles, error: 0.004 });
  }
  const nodes = document.getRoot().listNodes().filter((node) => node.getMesh());
  let triangles = 0, farTriangles = 0;
  for (const [index, node] of nodes.entries()) {
    const variant = `${id}-${index}`, mesh = node.getMesh();
    node.setExtras({ lunarVariant: variant, lunarLod: "near" });
    const farMesh = document.createMesh(`${mesh.getName()}_far`);
    for (const primitive of mesh.listPrimitives()) {
      const far = primitive.clone();
      farMesh.addPrimitive(far);
      simplifyPrimitive(far, { simplifier: MeshoptSimplifier, ratio: 0.13, error: 0.025 });
      triangles += primitive.getIndices().getCount() / 3;
      farTriangles += far.getIndices().getCount() / 3;
    }
    const farNode = document.createNode(`${node.getName()}_far`).setMesh(farMesh).setMatrix(node.getMatrix()).setExtras({ lunarVariant: variant, lunarLod: "far" });
    const parent = node.getParentNode();
    if (parent) parent.addChild(farNode);
    else for (const scene of document.getRoot().listScenes()) if (scene.listChildren().includes(node)) scene.addChild(farNode);
  }
  await document.transform(dedup(), prune());
  const file = `quixel/rocks/${id}.glb`;
  await io.write(join(base, file), document);
  entries.push({ name, file, source: `https://www.fab.com/listings/${listing}`, sourceFile: `${id}_mid.glb`, license: "Fab Standard License · downloaded through the owner's account", variants: nodes.length, triangles, farTriangles });
  console.log(`${name}: ${nodes.length} variants, ${triangles}/${farTriangles} near/far triangles`);
}
const manifestPath = join(base, "manifest.json"), manifest = JSON.parse(await readFile(manifestPath, "utf8"));
Object.assign(manifest, { version: 3, description: "Owner-supplied Quixel surfaces and eight Fab/Quixel rock packs. Lunar color grading; decorative placement is not measured geology.", models: entries });
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
