import * as THREE from "three";
import { randomSeed } from "./coordinates.js";
import { microCraterTile } from "./SurfaceRelief.js";

const REGOLITH_REFLECTANCE = 0.82;

// Lunar soil is not a matte (Lambert) surface. It throws light back towards the
// Sun, brightens sharply around the observer's own shadow and keeps its
// brightness under grazing light, which is why the full Moon shows no darker
// rim. Hapke's model reproduces all three; these are the whole-Moon values of
// Helfenstein & Veverka (1987): particle albedo, opposition surge amplitude
// and width, and the two terms of the particle phase function. Their table
// gives the surge as S(0) = 0.71, which is b0 = S(0) / (w · p(0)) = 2.01.
export const HAPKE = { w: 0.21, b0: 2.01, h: 0.07, b: 0.29, c: 0.39 };
// Hapke adds a large-scale roughness term; this stands in for it where the mesh is too coarse to cast those shadows itself.
const ROUGH_SHADE = 0.6;
const hapkeH = (x) => (1 + 2 * x) / (1 + 2 * x * Math.sqrt(1 - HAPKE.w));
function hapkeRaw(mu0, mu, cosPhase) {
  if (mu0 <= 0) return 0;
  const view = Math.max(mu, 0.12), surge = HAPKE.b0 / (1 + Math.sqrt((1 - cosPhase) / (1 + cosPhase + 1e-4)) / HAPKE.h);
  const phase = 1 + HAPKE.b * cosPhase + HAPKE.c * (1.5 * cosPhase * cosPhase - 0.5);
  const step = (lo, hi, v) => { const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo))); return t * t * (3 - 2 * t); };
  return mu0 / (mu0 + view) * ((1 + surge) * phase + hapkeH(mu0) * hapkeH(view) - 1) * (1 - ROUGH_SHADE * (1 - step(0, 0.5, mu0)) * step(0.3, -0.9, cosPhase));
}
// Scaled to match a matte surface in the standard geometry (Sun 30° from the
// vertical, seen from straight above), so material albedos keep their meaning.
const HAPKE_NORM = Math.cos(Math.PI / 6) / hapkeRaw(Math.cos(Math.PI / 6), 1, Math.cos(Math.PI / 6));
/** Brightness relative to a matte surface lit head-on; replaces the cosine of Lambert's law. */
export const lunarReflectance = (mu0, mu, cosPhase) => HAPKE_NORM * hapkeRaw(mu0, mu, cosPhase);

const glsl = (n) => Number(n).toFixed(6);
const LUNAR_BRDF = `
  float lunarH(float x) { return (1.0 + 2.0 * x) / (1.0 + 2.0 * x * ${glsl(Math.sqrt(1 - HAPKE.w))}); }
  float lunarReflectance(vec3 L, vec3 V, vec3 N) {
    float mu0 = dot(N, L);
    if (mu0 <= 0.0) return 0.0;
    float mu = max(dot(N, V), 0.12), cg = clamp(dot(L, V), -1.0, 1.0);
    float surge = ${glsl(HAPKE.b0)} / (1.0 + sqrt((1.0 - cg) / (1.0 + cg + 1e-4)) / ${glsl(HAPKE.h)});
    float phase = 1.0 + ${glsl(HAPKE.b)} * cg + ${glsl(HAPKE.c)} * (1.5 * cg * cg - 0.5);
    float soil = ${glsl(HAPKE_NORM)} * mu0 / (mu0 + mu) * ((1.0 + surge) * phase + lunarH(mu0) * lunarH(mu) - 1.0);
    // Rough ground seen against a low Sun shows mostly the unlit backs of its lumps.
    soil *= 1.0 - ${glsl(ROUGH_SHADE)} * (1.0 - smoothstep(0.0, 0.5, mu0)) * smoothstep(0.3, -0.9, cg);
    #ifdef LUNAR_ROCK
      // Solid rock under a dust coat: halfway between the soil and a matte face.
      return mix(mu0 * (0.62 + 0.38 * (1.0 + surge) * phase / 2.3), soil, 0.5) * 0.88;
    #else
      return soil;
    #endif
  }
`;
// No mirror-like term at all: regolith has none, and at grazing angles the
// standard one adds a sheen towards the Sun that the Moon does not show.
export function lunarLighting() {
  const source = THREE.ShaderChunk.lights_physical_pars_fragment;
  const patched = source.replace(/reflectedLight\.directSpecular \+= irradiance \* BRDF_GGX\([^;]*;\s*reflectedLight\.directDiffuse \+= irradiance \* BRDF_Lambert\( material\.diffuseColor \);/,
    "reflectedLight.directDiffuse += directLight.color * lunarReflectance( directLight.direction, geometryViewDir, geometryNormal ) * BRDF_Lambert( material.diffuseColor );");
  if (patched === source) throw new Error("The lunar photometric model no longer matches this version of three.js.");
  return `${LUNAR_BRDF}\n${patched}`;
}

/** Slopes of the small-crater field packed for the shader: red east, green south, blue hollows. */
export function microCraterTexture(seed) {
  const { heights, n, cell } = microCraterTile(seed), bytes = new Uint8Array(n * n * 4), wrap = (v) => (v + n) % n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const sx = (heights[i * n + wrap(j + 1)] - heights[i * n + wrap(j - 1)]) / (2 * cell), sz = (heights[wrap(i + 1) * n + j] - heights[wrap(i - 1) * n + j]) / (2 * cell);
    bytes.set([127.5 + sx * 212.5, 127.5 + sz * 212.5, 127.5 + heights[i * n + j] * 850, 255].map((v) => Math.max(0, Math.min(255, Math.round(v)))), (i * n + j) * 4);
  }
  return { bytes, n };
}

// Three smoothly blended, decorrelated copies of each dominant scan break the
// metre-wide repeat. Colour and normal share the same transform and explicit
// mip gradients; normals rotate back into the original surface tangent frame.
// The scans' roughness and occlusion maps are not read: without a mirror-like
// term roughness changes nothing, and the Sun leaves no ambient light to occlude.
const STOCHASTIC_SAND = `
  uniform vec2 lunarSurfaceSeed;
  uniform vec4 lunarLayerGain;
  vec2 lunarCellHash(vec2 cell) {
    cell += lunarSurfaceSeed;
    vec3 h = fract(vec3(cell.x, cell.y, cell.x + cell.y) * vec3(0.1031, 0.11369, 0.13787));
    h += dot(h, h.yzx + 19.19);
    return fract(vec2(h.x * h.y, h.y * h.z));
  }
  void lunarReadSand(vec2 uv, float layer, vec2 cell, vec2 dx, vec2 dy, out vec3 color, out vec3 n) {
    vec2 offset = lunarCellHash(cell);
    float angle = mix(floor(offset.x * 4.0) * 1.57079632679, offset.x * 6.28318530718, layer);
    float c = cos(angle), s = sin(angle);
    mat2 rotation = mat2(c, s, -s, c);
    float scanScale = mix(1.0, 0.88 + offset.y * 0.27, layer);
    vec2 sampleUV = rotation * uv * scanScale + offset * 19.0;
    color = textureGrad(lunarColors, vec3(sampleUV, layer), rotation * dx * scanScale, rotation * dy * scanScale).rgb;
    n = textureGrad(lunarNormals, vec3(sampleUV, layer), rotation * dx * scanScale, rotation * dy * scanScale).xyz * 2.0 - 1.0;
    n.xy = transpose(rotation) * n.xy;
  }
  void lunarSand(vec2 uv, vec2 dx, vec2 dy, float layer, out vec3 color, out vec3 n) {
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
    vec3 ca, cb, cd, na, nb, nd;
    lunarReadSand(uv, layer, a, dx, dy, ca, na);
    lunarReadSand(uv, layer, b, dx, dy, cb, nb);
    lunarReadSand(uv, layer, d, dx, dy, cd, nd);
    color = ca * w.x + cb * w.y + cd * w.z;
    n = na * w.x + nb * w.y + nd * w.z;
    n.xy /= mix(sqrt(dot(w, w)), 1.0, layer);
    n = normalize(n);
  }
`;

export function makeSurfaceMaterials(seed = 1) {
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
  const craters = microCraterTexture(seed), micro = new THREE.DataTexture(craters.bytes, craters.n, craters.n, THREE.RGBAFormat);
  micro.wrapS = micro.wrapT = THREE.RepeatWrapping; micro.magFilter = THREE.LinearFilter; micro.minFilter = THREE.LinearMipmapLinearFilter;
  micro.generateMipmaps = true; micro.anisotropy = 8; micro.needsUpdate = true;
  const terrain = new THREE.MeshStandardMaterial({ ...maps, color: 0x9e9b96, roughness: 0.94, metalness: 0, normalScale: new THREE.Vector2(0.55, 0.55), aoMapIntensity: 0.45 });
  terrain.color.multiplyScalar(REGOLITH_REFLECTANCE);
  const rock = new THREE.MeshStandardMaterial({ ...maps, color: 0x8b8b89, roughness: 0.91, metalness: 0, normalScale: new THREE.Vector2(0.8, 0.8), aoMapIntensity: 0.6 });
  terrain.userData.lunarMicro = { value: micro };
  return { terrain, rock, maps, micro, regolithAlbedo: 0.2, materials: new Set([terrain, rock]), textures: new Set([...Object.values(maps), micro]), geometries: new Set() };
}

// Shading only: reflectance, grain and the craters too small for the mesh.
export function setupLunarMaterial(material, csm) {
  csm.setupMaterial(material);
  const shadowCompile = material.onBeforeCompile, rock = !!material.userData.lunarRock, layers = material.userData.lunarLayers;
  material.onBeforeCompile = (shader, renderer) => {
    shadowCompile(shader, renderer);
    shader.vertexShader = `attribute float lunarSkirt; varying vec3 vLunarPosition; varying vec3 vLunarNormal;\n${shader.vertexShader}`
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n      transformed.y -= lunarSkirt;")
      .replace("#include <worldpos_vertex>", `#include <worldpos_vertex>
      vec4 lunarPosition = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        lunarPosition = instanceMatrix * lunarPosition;
      #endif
      vLunarPosition = (modelMatrix * lunarPosition).xyz;
      vLunarNormal = inverseTransformDirection(transformedNormal, viewMatrix);`);
    shader.fragmentShader = `${rock ? "#define LUNAR_ROCK\n" : ""}varying vec3 vLunarPosition; varying vec3 vLunarNormal;\n${shader.fragmentShader}`
      .replace("#include <lights_physical_pars_fragment>", lunarLighting());
    if (material.userData.lunarMicro) shader.uniforms.lunarMicro = material.userData.lunarMicro;
    // Two overlapping copies of the small-crater field at different scales and
    // angles never line up, so no repeat shows. Returns the ground slope they add.
    const microCraters = material.userData.lunarMicro ? `
        mat2 lunarMicroTurn = mat2(0.8, 0.6, -0.6, 0.8);
        vec3 lunarMicroA = texture2D(lunarMicro, vLunarPosition.xz / 24.0).rgb - 0.5;
        vec3 lunarMicroB = texture2D(lunarMicro, lunarMicroTurn * vLunarPosition.xz / 37.0 + 0.37).rgb - 0.5;
        vec2 lunarSlope = (lunarMicroA.rg + transpose(lunarMicroTurn) * lunarMicroB.rg) * 1.2;
        float lunarHollow = lunarMicroA.b + lunarMicroB.b;` : `
        vec2 lunarSlope = vec2(0.0); float lunarHollow = 0.0;`;
    if (layers) {
      Object.assign(shader.uniforms, layers);
      shader.fragmentShader = `
        precision highp sampler2DArray;
        uniform sampler2DArray lunarColors, lunarNormals;
        uniform sampler2D lunarGeology, lunarMicro;
        uniform vec4 lunarTileMeters;
        ${STOCHASTIC_SAND}
        ${shader.fragmentShader}`;
      shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `
        vec2 localUV = (vLunarPosition.xz + 500.0) / 1000.0;
        vec3 field = texture2D(lunarGeology, clamp(localUV, 0.0, 1.0)).rgb;
        float inPatch = step(0.0, localUV.x) * step(localUV.x, 1.0) * step(0.0, localUV.y) * step(localUV.y, 1.0);
        field.r *= inPatch;
        ${microCraters}
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
        vec2 dx0 = dFdx(uv0), dy0 = dFdy(uv0), dx1 = dFdx(uv1), dy1 = dFdy(uv1), dx2 = dFdx(uv2), dy2 = dFdy(uv2), dx3 = dFdx(uv3), dy3 = dFdy(uv3);
        // From eye height, ground a few tens of metres away is so foreshortened
        // that a one-metre scan is a blur of a few texels: one plain read gives
        // the same result as the full blend of four layers.
        float lunarFar = smoothstep(22.0, 36.0, length(vViewPosition));
        vec3 scannedColor = vec3(0.0), scannedNormal = vec3(0.0, 0.0, 1.0);
        if (lunarFar < 1.0) {
          vec3 sandColor, sandNormal, soilColor = vec3(0.0), soilNormal = vec3(0.0, 0.0, 1.0);
          lunarSand(uv0, dx0, dy0, 0.0, sandColor, sandNormal);
          // Away from rock the gravelly soil is a few percent of the mix: skip its six reads.
          if (weights.y > 0.05) lunarSand(uv1, dx1, dy1, 1.0, soilColor, soilNormal);
          else { weights.x += weights.y; weights.y = 0.0; }
          // The coarse scan only matters beside rock; elsewhere it is 3 % of the mix.
          vec3 coarseColor = vec3(0.0), n3 = vec3(0.0, 0.0, 1.0);
          if (weights.w > 0.035) {
            coarseColor = textureGrad(lunarColors, vec3(uv3, 3.0), dx3, dy3).rgb;
            n3 = textureGrad(lunarNormals, vec3(uv3, 3.0), dx3, dy3).xyz * 2.0 - 1.0;
          } else { weights.x += weights.w; weights.w = 0.0; }
          scannedColor = sandColor * weights.x
            + soilColor * weights.y * lunarLayerGain.y
            + textureGrad(lunarColors, vec3(uv2, 2.0), dx2, dy2).rgb * weights.z * lunarLayerGain.z
            + coarseColor * weights.w * lunarLayerGain.w;
          vec3 n1 = soilNormal;
          vec3 n2 = textureGrad(lunarNormals, vec3(uv2, 2.0), dx2, dy2).xyz * 2.0 - 1.0;
          n1.xy = transpose(turn1) * n1.xy; n2.xy = transpose(turn2) * n2.xy; n3.xy = transpose(turn3) * n3.xy;
          scannedNormal = sandNormal * weights.x + n1 * weights.y + n2 * weights.z + n3 * weights.w;
        }
        if (lunarFar > 0.0) {
          scannedColor = mix(scannedColor, textureGrad(lunarColors, vec3(uv0, 0.0), dx0, dy0).rgb, lunarFar);
          scannedNormal = mix(scannedNormal, textureGrad(lunarNormals, vec3(uv0, 0.0), dx0, dy0).xyz * 2.0 - 1.0, lunarFar);
        }
        float luminance = dot(scannedColor, vec3(0.2126, 0.7152, 0.0722));
        // Neutral ash with a restrained warm cast, preserving scanned grain.
        vec3 regolith = mix(vec3(luminance), scannedColor, 0.025) * vec3(1.015, 1.0, 0.978);
        // Hollows hold a little less light.
        diffuseColor.rgb *= regolith * mix(0.97, 1.015, field.g) * (1.0 + clamp(lunarHollow, -0.25, 0.1) * 0.5);
      `).replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
        roughnessFactor = 1.0;
      `).replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
        vec3 n = normalize(scannedNormal);
        vec3 worldN = normalize(vLunarNormal);
        vec3 worldT = normalize(vec3(1.0, 0.0, 0.0) - worldN * worldN.x);
        vec3 worldB = cross(worldN, worldT);
        float grainStrength = mix(mix(0.62, 0.88, field.r), mix(0.16, 0.28, field.r), smoothstep(18.0, 100.0, length(vViewPosition)));
        normal = normalize(mat3(viewMatrix) * (worldT * (n.x * grainStrength - lunarSlope.x) + worldB * (n.y * grainStrength + lunarSlope.y) + worldN * n.z));
      `);
    } else if (!rock && material.userData.lunarMicro) {
      shader.fragmentShader = `uniform sampler2D lunarMicro;\n${shader.fragmentShader}`.replace("#include <color_fragment>", `#include <color_fragment>
        ${microCraters}
        float lunarValue = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        diffuseColor.rgb = mix(vec3(lunarValue), diffuseColor.rgb, 0.035) * vec3(1.015, 1.0, 0.978) * (1.0 + clamp(lunarHollow, -0.25, 0.1) * 0.5);
      `).replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
        vec3 worldN = normalize(inverseTransformDirection(normal, viewMatrix));
        normal = normalize(mat3(viewMatrix) * (worldN + vec3(-lunarSlope.x, 0.0, -lunarSlope.y)));
      `);
    } else {
      shader.uniforms.lunarRockGain = material.userData.lunarRockGain ||= { value: 1 };
      shader.fragmentShader = `uniform float lunarRockGain;\n${shader.fragmentShader}`.replace("#include <color_fragment>", `#include <color_fragment>
        float lunarValue = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        // Same reflectance as the soil the rock lies on; the scan keeps its own grain.
        diffuseColor.rgb = mix(vec3(lunarValue), diffuseColor.rgb, 0.035) * vec3(1.015, 1.0, 0.978) * lunarRockGain;
      `);
    }
  };
  material.customProgramCacheKey = () => `lunar-hapke-csm-${csm.cascades}-${!!layers}-${rock}-${!!material.userData.lunarMicro}`;
  material.needsUpdate = true;
}

// WebGL2 array textures keep all four scans inside two sampler slots.
export async function installSurfaceLayers(entries, base, renderer, materials, geology, signal) {
  if (entries.length !== 4) throw new Error("Four Quixel surface layers are required.");
  const size = 1024, loader = new THREE.ImageLoader(), arrays = {}, luminance = [];
  for (const property of ["color", "normal"]) {
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
  materials.regolithAlbedo = REGOLITH_REFLECTANCE * luminance[0];
  terrain.userData.lunarLayers = { lunarColors: { value: arrays.color }, lunarNormals: { value: arrays.normal }, lunarGeology: { value: mask },
    lunarTileMeters: { value: new THREE.Vector4(...entries.map((entry) => entry.tileMeters || 1)) }, lunarLayerGain: { value: new THREE.Vector4(...gains) },
    lunarSurfaceSeed: { value: new THREE.Vector2((geology.seed >>> 0) % 8191, (geology.seed >>> 8) % 8191) } };
  terrain.needsUpdate = true;
}
