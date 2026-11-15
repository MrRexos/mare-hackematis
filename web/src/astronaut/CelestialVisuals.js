import * as THREE from "three";

// Modelos compartidos por la vista de superficie y los mapas polares 3D.
function glareTexture() {
  const size = 256, canvas = document.createElement("canvas"); canvas.width = canvas.height = size;
  const context = canvas.getContext("2d"), image = context.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = Math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5) / (size / 2);
    const value = r >= 1 ? 0 : (Math.exp(-((r / 0.05) ** 2)) + 0.62 / (1 + (r / 0.045) ** 2) ** 0.85) * (1 - r) ** 2;
    image.data.set([255, 250, 240, Math.min(255, value * 255)], (y * size + x) * 4);
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createSunVisual() {
  const sun = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), new THREE.MeshBasicMaterial({ color: 0xfffaf0, toneMapped: false }));
  sun.frustumCulled = false;
  const map = glareTexture();
  const glare = new THREE.Sprite(new THREE.SpriteMaterial({ map, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true, toneMapped: false }));
  glare.frustumCulled = false; glare.renderOrder = 10;
  return { sun, glare, dispose() { sun.geometry.dispose(); sun.material.dispose(); glare.material.dispose(); map.dispose(); } };
}

/** La textura Blue Marble incluye las nubes; el shader añade la fase y la atmósfera. */
export function createEarthVisual(map) {
  map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  const material = new THREE.MeshBasicMaterial({ map, color: 0xffffff, toneMapped: false });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), material); earth.frustumCulled = false;
  const phaseSun = { value: new THREE.Vector3() };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.earthSunDirection = phaseSun;
    shader.vertexShader = `varying vec3 vEarthNormal; varying vec3 vEarthView;\n${shader.vertexShader}`.replace("#include <begin_vertex>", `#include <begin_vertex>
      vEarthNormal = normalize(mat3(modelMatrix) * normal);
      vEarthView = normalize(cameraPosition - (modelMatrix * vec4(position, 1.0)).xyz);`);
    shader.fragmentShader = `uniform vec3 earthSunDirection; varying vec3 vEarthNormal; varying vec3 vEarthView;\n${shader.fragmentShader}`.replace("#include <opaque_fragment>", `
      vec3 earthN = normalize(vEarthNormal);
      float earthDay = dot(earthN, earthSunDirection), earthRim = pow(1.0 - max(dot(earthN, normalize(vEarthView)), 0.0), 2.4);
      float earthLit = smoothstep(-0.07, 0.2, earthDay);
      outgoingLight = outgoingLight * earthLit * mix(0.5, 1.12, clamp(earthDay, 0.0, 1.0)) + vec3(0.28, 0.5, 1.0) * earthRim * earthLit * 0.55;
      outgoingLight = max(outgoingLight, vec3(0.0015, 0.002, 0.004));
      #include <opaque_fragment>`);
  };
  return { earth, phaseSun, dispose() { earth.geometry.dispose(); material.dispose(); map.dispose(); } };
}
