import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { installSurfaceLayers } from "./SurfaceMaterials.js";

// Mean linear reflectance of a scanned rock texture, ignoring the empty atlas margins.
function meanReflectance(texture) {
  try {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 64;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(texture.image, 0, 0, 64, 64);
    const pixels = context.getImageData(0, 0, 64, 64).data, linear = (byte) => { const v = byte / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    let total = 0, count = 0;
    for (let k = 0; k < pixels.length; k += 4) {
      const value = linear(pixels[k]) * 0.2126 + linear(pixels[k + 1]) * 0.7152 + linear(pixels[k + 2]) * 0.0722;
      if (value > 0.01) { total += value; count++; }
    }
    return count ? total / count : 0.2;
  } catch { return 0.2; }
}

// Only reads assets the site owner supplies. No Fab authentication or downloads.
export async function loadAssetLibrary(renderer, materials, signal, geology) {
  const base = new URL(`${import.meta.env.BASE_URL}assets/astronaut/`, document.baseURI);
  const response = await fetch(new URL("manifest.json", base), { signal });
  if (!response.ok) throw new Error("Astronaut asset manifest unavailable.");
  const manifest = await response.json(), loader = new GLTFLoader(), variants = [], warnings = [];
  loader.setMeshoptDecoder(MeshoptDecoder);
  let ktx, draco;
  if (manifest.decoders?.ktx2) { ktx = new KTX2Loader().setTranscoderPath(new URL(manifest.decoders.ktx2, base).href).detectSupport(renderer); loader.setKTX2Loader(ktx); }
  if (manifest.decoders?.draco) { draco = new DRACOLoader().setDecoderPath(new URL(manifest.decoders.draco, base).href); loader.setDRACOLoader(draco); }
  try {
    if (manifest.surfaces?.length) {
      try { await installSurfaceLayers(manifest.surfaces, base, renderer, materials, geology, signal); }
      catch (error) { if (signal.aborted) throw error; warnings.push(`Quixel surfaces: ${error.message}`); }
    }
    if (manifest.surface) {
      for (const [property, file] of Object.entries(manifest.surface.textures || {})) {
        if (!["map", "normalMap", "roughnessMap", "aoMap"].includes(property)) continue;
        try {
          const url = new URL(file, base).href;
          const texture = await (file.endsWith(".ktx2") && ktx ? ktx : new THREE.TextureLoader()).loadAsync(url);
          if (signal.aborted) { texture.dispose(); throw new DOMException("Cancelled", "AbortError"); }
          texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.anisotropy = 4;
          if (property === "map") texture.colorSpace = THREE.SRGBColorSpace;
          materials.terrain[property] = texture; materials.textures.add(texture);
        } catch (error) { if (signal.aborted) throw error; warnings.push(`${property}: ${error.message}`); }
      }
      materials.terrain.needsUpdate = true;
    }
    for (const entry of manifest.models || []) {
      try {
        const gltf = await loader.loadAsync(new URL(entry.file, base).href);
        gltf.scene.updateMatrixWorld(true);
        if (signal.aborted) { gltf.scene.traverse((o) => { o.geometry?.dispose(); if (o.material) for (const m of [].concat(o.material)) m.dispose(); }); throw new DOMException("Cancelled", "AbortError"); }
        const groups = new Map(), clones = new Map(), originals = new Set();
        gltf.scene.traverse((object) => {
          if (!object.isMesh) return;
          if (object.isSkinnedMesh) throw new Error("Rock assets must use static meshes.");
          const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
          materials.geometries.add(geometry);
          const original = [].concat(object.material), meshMaterials = original.map((m) => {
            originals.add(m);
            if (clones.has(m)) return clones.get(m);
            const material = m.clone(); clones.set(m, material); materials.materials.add(material);
            material.userData.lunarRock = true;
            // Rock and soil are the same material in different states: give both the same reflectance.
            const own = (material.map ? meanReflectance(material.map) : 1) * (material.color.r * 0.2126 + material.color.g * 0.7152 + material.color.b * 0.0722);
            material.userData.lunarRockGain = { value: THREE.MathUtils.clamp(materials.regolithAlbedo / Math.max(0.02, own), 0.3, 4) };
            // No mirror-like term on the Moon: roughness and metalness maps would be read for nothing.
            material.metalness = 0; material.metalnessMap = null;
            material.roughness = 1; material.roughnessMap = null; material.aoMapIntensity = 0.6;
            material.side = THREE.FrontSide;
            for (const value of Object.values(material)) if (value?.isTexture) { value.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); materials.textures.add(value); }
            return material;
          });
          const key = object.userData.lunarVariant || object.parent?.userData.lunarVariant || entry.name;
          if (!groups.has(key)) groups.set(key, { parts: [], farParts: [] });
          const lod = (object.userData.lunarLod || object.parent?.userData.lunarLod) === "far" ? "farParts" : "parts";
          groups.get(key)[lod].push({ geometry, material: meshMaterials.length === 1 ? meshMaterials[0] : meshMaterials });
          object.geometry.dispose();
        });
        originals.forEach((m) => m.dispose());
        for (const [key, group] of groups) {
          if (!group.parts.length) continue;
          const box = new THREE.Box3();
          for (const part of group.parts) { part.geometry.computeBoundingBox(); box.union(part.geometry.boundingBox); }
          const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
          const scale = 2 / Math.max(size.x, size.y, size.z, 0.001);
          for (const part of [...group.parts, ...group.farParts]) {
            part.geometry.translate(-center.x, -box.min.y, -center.z); part.geometry.scale(scale, scale, scale);
            part.geometry.computeBoundingSphere();
          }
          variants.push({ name: `${entry.name} · ${key}`, license: entry.license, ...group });
        }
      } catch (error) { if (signal.aborted) throw error; warnings.push(`${entry.name}: ${error.message}`); }
    }
  } finally { ktx?.dispose(); draco?.dispose(); }
  const surfaceLabel = materials.terrain.userData.lunarLayers ? "4 blended Quixel surface scans" : "procedural surface fallback";
  return { variants, warnings, label: variants.length ? `Quixel Megascans · ${variants.length} rock variants · ${surfaceLabel}` : `Procedural rocks · ${surfaceLabel} · not measured geology`, surfaceTileM: manifest.surface?.tileMeters || 8 };
}
