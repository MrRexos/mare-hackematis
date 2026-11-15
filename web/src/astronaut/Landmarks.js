import * as THREE from "three";

export { LANDMARKS, landmarkInCell } from "../data/landmarks.js";

function usaFlagTexture() {
  const w = 494, h = 260, canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
  const c = canvas.getContext("2d"), stripe = h / 13, cantonW = w * 0.4, cantonH = stripe * 7;
  for (let k = 0; k < 13; k++) { c.fillStyle = k % 2 ? "#ffffff" : "#b22234"; c.fillRect(0, k * stripe, w, stripe + 1); }
  c.fillStyle = "#3c3b6e"; c.fillRect(0, 0, cantonW, cantonH);
  c.fillStyle = "#ffffff";
  const star = (x, y, r) => { c.beginPath(); for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, q = k % 2 ? r * 0.4 : r; c.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q); } c.closePath(); c.fill(); };
  // Nine rows, alternately six and five stars: fifty.
  for (let row = 0; row < 9; row++) for (let col = 0; col < (row % 2 ? 5 : 6); col++) star((col * 2 + 1 + (row % 2)) * cantonW / 12, (row + 1) * cantonH / 10, stripe * 0.3);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  return texture;
}

/**
 * The flag as the Apollo crews set it up: a pole pushed into the regolith and a horizontal rod
 * along the top to hold the cloth out, since nothing blows on the Moon. The cloth keeps the
 * creases it had when it was unfurled. Returns a group standing at the origin, cloth towards +X.
 */
export function createFlag(kind = "usa") {
  const group = new THREE.Group(), geometries = [], materials = [], textures = [];
  const metal = new THREE.MeshStandardMaterial({ color: 0xd3d5d6, roughness: 0.7, metalness: 0 }); materials.push(metal);
  const pole = new THREE.CylinderGeometry(0.0125, 0.0125, 2.5, 10); pole.translate(0, 1.05, 0); geometries.push(pole);
  const rod = new THREE.CylinderGeometry(0.008, 0.008, 1.36, 8); rod.rotateZ(Math.PI / 2); rod.translate(0.68, 2.28, 0); geometries.push(rod);
  const cloth = new THREE.PlaneGeometry(1.32, 0.72, 22, 10); geometries.push(cloth);
  const p = cloth.attributes.position;
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k), y = p.getY(k), hang = (0.36 - y) / 0.72;        // 0 at the rod, 1 at the free edge
    p.setZ(k, (Math.sin(x * 9.5 + y * 3) * 0.028 + Math.sin(x * 21 - y * 6) * 0.01) * (0.25 + hang));
    p.setX(k, x - Math.sin(y * 7 + 1) * 0.012 * hang);
  }
  cloth.computeVertexNormals(); cloth.translate(0.67, 1.91, 0);
  const map = kind === "usa" ? usaFlagTexture() : null; if (map) textures.push(map);
  // Thin nylon lets light through: a little of its own colour shows even on the side away from the Sun.
  const fabric = new THREE.MeshStandardMaterial({ map, color: 0xd0d0d0, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 0.12, roughness: 1, metalness: 0, side: THREE.DoubleSide }); materials.push(fabric);
  for (const [geometry, material] of [[pole, metal], [rod, metal], [cloth, fabric]]) {
    const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
  }
  return { group, geometries, materials, textures };
}
