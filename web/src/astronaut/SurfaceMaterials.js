import * as THREE from "three";
import { randomSeed } from "./coordinates.js";

const REGOLITH_REFLECTANCE = 0.82;

// Three smoothly blended, decorrelated copies of each dominant scan break the
// metre-wide repeat. All PBR maps share the same transform and explicit mip
// gradients; normals rotate back into the original surface tangent frame.
const STOCHASTIC_SAND = `
  uniform vec2 lunarSurfaceSeed;
  uniform vec4 lunarLayerGain;
  vec2 lunarCellHash(vec2 cell) {
    cell += lunarSurfaceSeed;
    vec3 h = fract(vec3(cell.x, cell.y, cell.x + cell.y) * vec3(0.1031, 0.11369, 0.13787));
    h += dot(h, h.yzx + 19.19);
    return fract(vec2(h.x * h.y, h.y * h.z));
  }
  void lunarReadSand(vec2 uv, float layer, vec2 cell, vec2 dx, vec2 dy, out vec3 color, out vec3 n, out vec3 orm) {
    vec2 offset = lunarCellHash(cell);
    float angle = mix(floor(offset.x * 4.0) * 1.57079632679, offset.x * 6.28318530718, layer);
    float c = cos(angle), s = sin(angle);
    mat2 rotation = mat2(c, s, -s, c);
    float scanScale = mix(1.0, 0.88 + offset.y * 0.27, layer);
    vec2 sampleUV = rotation * uv * scanScale + offset * 19.0;
    color = textureGrad(lunarColors, vec3(sampleUV, layer), rotation * dx * scanScale, rotation * dy * scanScale).rgb;
    n = textureGrad(lunarNormals, vec3(sampleUV, layer), rotation * dx * scanScale, rotation * dy * scanScale).xyz * 2.0 - 1.0;
    n.xy = transpose(rotation) * n.xy;
    orm = textureGrad(lunarOrm, vec3(sampleUV, layer), rotation * dx * scanScale, rotation * dy * scanScale).rgb;
  }
  void lunarSand(vec2 uv, float layer, out vec3 color, out vec3 n, out vec3 orm) {
    vec2 dx = dFdx(uv), dy = dFdy(uv);
    vec2 grid = vec2(uv.x - uv.y * 0.57735026919, uv.y * 1.15470053838) / mix(1.8, 0.72, layer);
    vec2 cell = floor(grid), f = fract(grid), a, b, d;
    vec3 w;
    if (f.x + f.y < 1.0) {
      a = cell; b = cell + vec2(1.0, 0.0); d = cell + vec2(0.0, 1.0);
      w = vec3(1.0 - f.x - f.y, f.x, f.y);
    } else {
      a = cell + vec2(1.0); b = cell + vec2(0.0, 1.0); d = cell + vec2(1.0, 0.0);
      w = vec3(f.x + f.y - 1.0, 1.0 - f.x, 1.0 - f.y);
    }
    w *= w; w *= mix(w, vec3(1.0), layer); w /= dot(w, vec3(1.0));
    vec3 ca, cb, cd, na, nb, nd, oa, ob, od;
    lunarReadSand(uv, layer, a, dx, dy, ca, na, oa);
    lunarReadSand(uv, layer, b, dx, dy, cb, nb, ob);
    lunarReadSand(uv, layer, d, dx, dy, cd, nd, od);
    color = ca * w.x + cb * w.y + cd * w.z;
    n = na * w.x + nb * w.y + nd * w.z;
    n.xy /= mix(sqrt(dot(w, w)), 1.0, layer);
    n = normalize(n);
    orm = oa * w.x + ob * w.y + od * w.z;
  }
`;

export function makeSurfaceMaterials() {
  const size = 512, random = randomSeed(0x1a7f3), height = new Float32Array(size * size);
  const color = new Uint8Array(size * size * 4), normal = new Uint8Array(color.length), roughness = new Uint8Array(color.length), ao = new Uint8Array(color.length);
  for (let i = 0; i < height.length; i++) height[i] = random();
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const p = y * size + x, k = p * 4;
    const grain = height[p], coarse = height[(Math.floor(y / 16) * 16 * size + Math.floor(x / 16) * 16) % height.length];
    const pebble = grain > 0.975 ? -32 : 0;
    const value = 137 + grain * 40 + coarse * 15 + pebble;
    color.set([value * 1.02, value, value * 0.97, 255], k);
    const dx = (height[y * size + (x + 1) % size] - height[y * size + (x + size - 1) % size]) * 0.32;
    const dy = (height[((y + 1) % size) * size + x] - height[((y + size - 1) % size) * size + x]) * 0.32;
    const n = new THREE.Vector3(-dx, -dy, 1).normalize();
    normal.set([(n.x * 0.5 + 0.5) * 255, (n.y * 0.5 + 0.5) * 255, (n.z * 0.5 + 0.5) * 255, 255], k);
    const r = 210 + grain * 40; roughness.set([r, r, r, 255], k);
    const a = grain > 0.97 ? 190 : 245; ao.set([a, a, a, 255], k);
  }
  const texture = (values, srgb = false) => {
    const map = new THREE.DataTexture(values, size, size, THREE.RGBAFormat);
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true; map.anisotropy = 4;
    if (srgb) map.colorSpace = THREE.SRGBColorSpace;
    map.needsUpdate = true;
    return map;
  };
  const maps = { map: texture(color, true), normalMap: texture(normal), roughnessMap: texture(roughness), aoMap: texture(ao) };
  const terrain = new THREE.MeshStandardMaterial({ ...maps, color: 0x9e9b96, roughness: 0.94, metalness: 0, normalScale: new THREE.Vector2(0.55, 0.55), aoMapIntensity: 0.45 });
  terrain.color.multiplyScalar(REGOLITH_REFLECTANCE);
  const rock = new THREE.MeshStandardMaterial({ ...maps, color: 0x8b8b89, roughness: 0.91, metalness: 0, normalScale: new THREE.Vector2(0.8, 0.8), aoMapIntensity: 0.6 });
  return { terrain, rock, maps, materials: new Set([terrain, rock]), textures: new Set(Object.values(maps)), geometries: new Set() };
}

// This changes surface reflectance only. It never displaces measured vertices.
export function setupLunarMaterial(material, csm) {
  csm.setupMaterial(material);
  const shadowCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    shadowCompile(shader, renderer);
    shader.vertexShader = `varying vec3 vLunarPosition; varying vec3 vLunarNormal;\n${shader.vertexShader}`.replace("#include <worldpos_vertex>", `#include <worldpos_vertex>
      vec4 lunarPosition = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        lunarPosition = instanceMatrix * lunarPosition;
      #endif
      vLunarPosition = (modelMatrix * lunarPosition).xyz;
      vLunarNormal = inverseTransformDirection(transformedNormal, viewMatrix);`);
    shader.fragmentShader = `varying vec3 vLunarPosition; varying vec3 vLunarNormal;\n${shader.fragmentShader}`;
    if (material.userData.lunarLayers) {
      Object.assign(shader.uniforms, material.userData.lunarLayers);
      shader.fragmentShader = `
        precision highp sampler2DArray;
        uniform sampler2DArray lunarColors, lunarNormals, lunarOrm;
        uniform sampler2D lunarGeology;
        uniform vec4 lunarTileMeters;
        ${STOCHASTIC_SAND}
        ${shader.fragmentShader}`;
      shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `
        vec2 localUV = (vLunarPosition.xz + 500.0) / 1000.0;
        vec3 field = texture2D(lunarGeology, clamp(localUV, 0.0, 1.0)).rgb;
        float inPatch = step(0.0, localUV.x) * step(localUV.x, 1.0) * step(0.0, localUV.y) * step(localUV.y, 1.0);
        field.r *= inPatch;
        // Keep visible gravel detail, with sand woven through it at the peaks.
        float soilWeight = 0.025 + field.r * 0.62;
        float dustWeight = (0.04 + (1.0 - field.g) * 0.10) * (1.0 - field.r * 0.65);
        float coarseWeight = 0.025 + field.r * 0.035;
        vec4 weights = vec4(1.0 - soilWeight - dustWeight - coarseWeight, soilWeight, dustWeight, coarseWeight);
        vec2 worldUV = vLunarPosition.xz * vec2(1.0, -1.0);
        vec2 uv0 = worldUV / lunarTileMeters.x;
        mat2 turn1 = mat2(0.8, 0.6, -0.6, 0.8);
        mat2 turn2 = mat2(0.6, -0.8, 0.8, 0.6);
        mat2 turn3 = mat2(0.0, 1.0, -1.0, 0.0);
        vec2 warp = (field.bg - 0.5) * 0.32;
        vec2 uv1 = turn1 * worldUV / lunarTileMeters.y + vec2(0.31, 0.17) + warp;
        vec2 uv2 = turn2 * worldUV / lunarTileMeters.z + vec2(0.73, 0.48) - warp;
        vec2 uv3 = turn3 * worldUV / lunarTileMeters.w + vec2(0.19, 0.62) + warp;
        vec3 sandColor, sandNormal, sandOrm, soilColor, soilNormal, soilOrm;
        lunarSand(uv0, 0.0, sandColor, sandNormal, sandOrm);
        lunarSand(uv1, 1.0, soilColor, soilNormal, soilOrm);
        vec3 scannedColor = sandColor * weights.x
          + soilColor * weights.y * lunarLayerGain.y
          + texture(lunarColors, vec3(uv2, 2.0)).rgb * weights.z * lunarLayerGain.z
          + texture(lunarColors, vec3(uv3, 3.0)).rgb * weights.w * lunarLayerGain.w;
        vec3 surfaceOrm = sandOrm * weights.x
          + soilOrm * weights.y
          + texture(lunarOrm, vec3(uv2, 2.0)).rgb * weights.z
          + texture(lunarOrm, vec3(uv3, 3.0)).rgb * weights.w;
        vec3 n1 = soilNormal;
        vec3 n2 = texture(lunarNormals, vec3(uv2, 2.0)).xyz * 2.0 - 1.0;
        vec3 n3 = texture(lunarNormals, vec3(uv3, 3.0)).xyz * 2.0 - 1.0;
        n1.xy = transpose(turn1) * n1.xy; n2.xy = transpose(turn2) * n2.xy; n3.xy = transpose(turn3) * n3.xy;
        vec3 scannedNormal = sandNormal * weights.x + n1 * weights.y + n2 * weights.z + n3 * weights.w;
        float luminance = dot(scannedColor, vec3(0.2126, 0.7152, 0.0722));
        // Neutral ash with a restrained warm cast, preserving scanned grain.
        vec3 regolith = mix(vec3(luminance), scannedColor, 0.025) * vec3(1.015, 1.0, 0.978);
        diffuseColor.rgb *= regolith * mix(0.97, 1.015, field.g);
      `).replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
        roughnessFactor = clamp(surfaceOrm.g, 0.88, 1.0);
      `).replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
        vec3 n = normalize(scannedNormal);
        vec3 worldN = normalize(vLunarNormal);
        vec3 worldT = normalize(vec3(1.0, 0.0, 0.0) - worldN * worldN.x);
        vec3 worldB = cross(worldN, worldT);
        float grainStrength = mix(mix(0.62, 0.88, field.r), mix(0.16, 0.28, field.r), smoothstep(18.0, 100.0, length(vViewPosition)));
        normal = normalize(mat3(viewMatrix) * (worldT * n.x * grainStrength + worldB * n.y * grainStrength + worldN * n.z));
      `).replace("#include <aomap_fragment>", `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= mix(1.0, surfaceOrm.r, mix(0.5, 0.65, field.r));
      `);
    } else {
      shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
        float lunarValue = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        ${material.userData.lunarRock ? "lunarValue = min(lunarValue, 0.32) * 0.85;" : ""}
        diffuseColor.rgb = mix(vec3(lunarValue), diffuseColor.rgb, 0.035) * vec3(1.015, 1.0, 0.978);
      `);
    }
  };
  material.customProgramCacheKey = () => `lunar-pbr-dispersed-soil-csm-${csm.cascades}-${!!material.userData.lunarLayers}-${!!material.userData.lunarRock}`;
  material.needsUpdate = true;
}

// WebGL2 array textures keep all four scans inside three sampler slots, also
// with four solar cascades + the helmet shadow. No measured vertex is altered.
export async function installSurfaceLayers(entries, base, renderer, materials, geology, signal) {
  if (entries.length !== 4) throw new Error("Four Quixel surface layers are required.");
  const size = 1024, loader = new THREE.ImageLoader(), arrays = {}, luminance = [];
  for (const property of ["color", "normal", "orm"]) {
    const images = await Promise.all(entries.map((entry) => loader.loadAsync(new URL(entry[property], base).href)));
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = size;
    const context = canvas.getContext("2d", { willReadFrequently: true }), bytes = new Uint8Array(size * size * 4 * 4);
    for (let layer = 0; layer < 4; layer++) {
      context.drawImage(images[layer], 0, 0, size, size);
      const pixels = context.getImageData(0, 0, size, size).data;
      bytes.set(pixels, layer * size * size * 4);
      if (property === "color") {
        const linear = (byte) => { const value = byte / 255; return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; };
        let total = 0, samples = 0;
        for (let y = 8; y < size; y += 16) for (let x = 8; x < size; x += 16) {
          const k = (y * size + x) * 4;
          total += linear(pixels[k]) * 0.2126 + linear(pixels[k + 1]) * 0.7152 + linear(pixels[k + 2]) * 0.0722; samples++;
        }
        luminance[layer] = total / samples;
      }
    }
    const texture = new THREE.DataArrayTexture(bytes, size, size, 4);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true; texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    if (property === "color") texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true; arrays[property] = texture; materials.textures.add(texture);
  }
  const resolution = 512, bytes = new Uint8Array(resolution * resolution * 4);
  for (let z = 0; z < resolution; z++) for (let x = 0; x < resolution; x++) {
    const worldX = x / (resolution - 1) * 1000 - 500, worldZ = z / (resolution - 1) * 1000 - 500;
    const sample = geology.sample(worldX, worldZ);
    bytes.set([geology.surfaceRockiness(worldX, worldZ, sample) * 255, sample.broad * 255, sample.broken * 255, 255], (z * resolution + x) * 4);
  }
  const mask = new THREE.DataTexture(bytes, resolution, resolution, THREE.RGBAFormat);
  mask.magFilter = mask.minFilter = THREE.LinearFilter; mask.needsUpdate = true; materials.textures.add(mask);
  const terrain = materials.terrain;
  for (const property of ["map", "normalMap", "roughnessMap", "aoMap"]) terrain[property] = null;
  terrain.color.setRGB(REGOLITH_REFLECTANCE, REGOLITH_REFLECTANCE, REGOLITH_REFLECTANCE); terrain.roughness = 0.96;
  const gains = luminance.map((value) => THREE.MathUtils.clamp(luminance[0] / Math.max(0.001, value), 0.75, 1.5));
  terrain.userData.lunarLayers = { lunarColors: { value: arrays.color }, lunarNormals: { value: arrays.normal }, lunarOrm: { value: arrays.orm }, lunarGeology: { value: mask },
    lunarTileMeters: { value: new THREE.Vector4(...entries.map((entry) => entry.tileMeters || 1)) }, lunarLayerGain: { value: new THREE.Vector4(...gains) },
    lunarSurfaceSeed: { value: new THREE.Vector2((geology.seed >>> 0) % 8191, (geology.seed >>> 8) % 8191) } };
  terrain.needsUpdate = true;
}
