import * as THREE from 'three';

// Level-design decor layer — pure additive geometry over the existing scene.
// Gives each room a signature colour, lit thresholds that double as wayfinding
// beacons (visible from the corridor), stencilled signage, and a spotlight pool
// under each console. No engine/height changes required.

// Per-room theme. Rectangles are inclusive map ranges → world spans.
//  floor : [minX, maxX, minZ, maxZ]      coloured floor glow
//  door  : { x|z line, span:[a,b], facing:[fx,fz] }  threshold + header beacon
//  console: [x, z]                        spotlight target
const ROOMS = [
  {
    name: 'QUARTIERS', color: 0xcc44ff,
    floor: [6, 15, 1, 4],
    door:  { axis: 'z', line: 4, span: [10, 12], facing: [0, 1] },
    console: [9.0, 1.45],
  },
  {
    name: 'TROPHÉES', color: 0xff8c00,
    floor: [13, 20, 7, 11],
    door:  { axis: 'x', line: 13, span: [8, 10], facing: [-1, 0] },
    console: [19.55, 9.0],
  },
  {
    name: 'ARMURERIE', color: 0x00ff41,
    floor: [1, 9, 13, 17],
    door:  { axis: 'x', line: 9, span: [14, 16], facing: [1, 0] },
    console: [1.45, 15.0],
  },
];

const hex = c => '#' + c.toString(16).padStart(6, '0');

// Stencilled doorway sign drawn onto a CanvasTexture.
function signTexture(name, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 48;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, 256, 48);
  ctx.strokeStyle = hex(color);
  ctx.lineWidth = 3;
  ctx.strokeRect(3, 3, 250, 42);
  ctx.fillStyle = hex(color);
  ctx.font = '16px "Press Start 2P", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('▸ ' + name + ' ◂', 128, 26);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Flat plane lying on the floor (or ceiling), additive-blended.
function flatGlow(scene, color, cx, cz, w, d, { y = 0.02, opacity = 0.1, down = false } = {}) {
  const geo = new THREE.PlaneGeometry(w, d).rotateX(down ? Math.PI / 2 : -Math.PI / 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  mesh.position.set(cx, y, cz);
  scene.add(mesh);
  return mesh;
}

export function buildDecor(scene) {
  for (const room of ROOMS) {
    const [minX, maxX, minZ, maxZ] = room.floor;
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;

    // Coloured floor glow over the whole room — the room's signature palette.
    flatGlow(scene, room.color, cx, cz, maxX - minX, maxZ - minZ, { opacity: 0.1 });

    // Console spotlight: a brighter pool on the floor + an emissive ceiling panel.
    const [px, pz] = room.console;
    flatGlow(scene, room.color, px, pz, 1.6, 1.6, { y: 0.03, opacity: 0.22 });
    flatGlow(scene, room.color, px, pz, 0.9, 0.9, { y: 0.997, opacity: 0.6, down: true });

    // Threshold band + header beacon at the doorway.
    const d = room.door;
    const [fx, fz] = d.facing;
    const [a, b] = d.span;
    const mid = (a + b) / 2;
    const dx = d.axis === 'x' ? d.line : mid;
    const dz = d.axis === 'z' ? d.line : mid;
    const span = b - a;

    // Floor band across the opening (brighter, reads as a doorstep).
    const bandW = d.axis === 'x' ? 0.3 : span;
    const bandD = d.axis === 'x' ? span : 0.3;
    flatGlow(scene, room.color, dx, dz, bandW, bandD, { y: 0.025, opacity: 0.4 });

    // Glowing header bar at the top of the opening — visible down the corridor.
    const lintel = new THREE.Mesh(
      new THREE.PlaneGeometry(span, 0.12),
      new THREE.MeshBasicMaterial({ color: room.color, transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })
    );
    lintel.position.set(dx + fx * 0.02, 0.97, dz + fz * 0.02);
    lintel.lookAt(dx + fx, 0.97, dz + fz);
    scene.add(lintel);

    // Stencilled name sign just below the header, facing the corridor.
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(0.95, 0.18),
      new THREE.MeshBasicMaterial({ map: signTexture(room.name, room.color),
        transparent: true, side: THREE.DoubleSide })
    );
    sign.position.set(dx + fx * 0.04, 0.8, dz + fz * 0.04);
    sign.lookAt(dx + fx, 0.8, dz + fz);
    scene.add(sign);
  }
}
