import * as THREE from 'three';
import { projects } from '../data/projects.js';
import { techOf } from '../data/tech.js';
import { floorAt, ceilAt } from './Map.js';

// Level-design decor layer — additive geometry over the existing scene.
// Static: per-room palette, lit thresholds, signage.
// Animated: central hub holo-directory + Projects trophy gallery.
// buildDecor() returns { update(t) } so Renderer can spin the holograms.

// Per-room theme. Rectangles are inclusive map ranges → world spans.
const ROOMS = [
  { name: 'QUARTIERS', color: 0xcc44ff, floor: [8, 17, 2, 7],
    door: { axis: 'z', line: 8.5, span: [11, 14], facing: [0, 1] }, console: [12.5, 2.6] },
  { name: 'TROPHÉES', color: 0xff8c00, floor: [17, 23, 9, 16],
    door: { axis: 'x', line: 16.5, span: [11, 14], facing: [-1, 0] }, console: [22.4, 12.5] },
  { name: 'ARMURERIE', color: 0x00ff41, floor: [2, 8, 9, 16],
    door: { axis: 'x', line: 8.5, span: [11, 14], facing: [1, 0] }, console: [2.6, 12.5] },
];

// Trophées gallery plinths — MUST stay in sync with the plinth boxes in Props3D.js.
const PLINTH_COLOR = 0xff8c00;
const PLINTHS = [
  { x: 17.7, z: 9.6,  face: [0, 1]  }, { x: 19.0, z: 9.6,  face: [0, 1]  },
  { x: 20.3, z: 9.6,  face: [0, 1]  }, { x: 21.6, z: 9.6,  face: [0, 1]  },
  { x: 17.7, z: 15.4, face: [0, -1] }, { x: 19.0, z: 15.4, face: [0, -1] },
  { x: 20.3, z: 15.4, face: [0, -1] }, { x: 21.6, z: 15.4, face: [0, -1] },
];

// Load a logo SVG into a CanvasTexture (rasterised, contained with padding).
// Async: the texture starts blank and refreshes once the image decodes.
const _logoCache = {};
function logoTexture(name) {
  if (_logoCache[name]) return _logoCache[name];
  const S = 128, pad = 14;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const img = new Image();
  img.onload = () => {
    const iw = img.naturalWidth, ih = img.naturalHeight;
    if (iw && ih) {
      const sc = Math.min((S - 2 * pad) / iw, (S - 2 * pad) / ih);
      const w = iw * sc, h = ih * sc;
      ctx.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
    } else {
      ctx.drawImage(img, pad, pad, S - 2 * pad, S - 2 * pad);  // SVG w/o intrinsic size
    }
    tex.needsUpdate = true;
  };
  img.src = '/logos/' + name + '.svg';
  return (_logoCache[name] = tex);
}

const hex = c => '#' + c.toString(16).padStart(6, '0');

function textTexture(lines, color, { w = 256, h = 64, font = 16, border = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, w, h);
  if (border) { ctx.strokeStyle = hex(color); ctx.lineWidth = 3; ctx.strokeRect(3, 3, w - 6, h - 6); }
  ctx.fillStyle = hex(color);
  ctx.font = `${font}px "Press Start 2P", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const step = h / (lines.length + 1);
  lines.forEach((l, i) => ctx.fillText(l, w / 2, step * (i + 1)));
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Soft radial-gradient texture (bright centre → transparent edge), cached per colour.
const _radCache = {};
function radialTex(color) {
  if (_radCache[color]) return _radCache[color];
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 32);
  g.addColorStop(0, hex(color));
  g.addColorStop(0.45, hex(color) + '99');
  g.addColorStop(1, hex(color) + '00');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return (_radCache[color] = t);
}

// Soft circular light pool on floor (or ceiling) — radial falloff, not a hard aplat.
function softPool(scene, color, cx, cz, size, { y = 0.03, opacity = 0.4, down = false } = {}) {
  const geo = new THREE.PlaneGeometry(size, size).rotateX(down ? Math.PI / 2 : -Math.PI / 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    map: radialTex(color), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  mesh.position.set(cx, y, cz);
  scene.add(mesh);
}

// Split a project name across (up to) two lines so labels never get truncated.
function wrapName(name) {
  const w = name.split(' ');
  if (w.length === 1) return [name];
  let best = null, score = Infinity;
  for (let k = 1; k < w.length; k++) {
    const l0 = w.slice(0, k).join(' '), l1 = w.slice(k).join(' ');
    const s = Math.max(l0.length, l1.length);
    if (s < score) { score = s; best = [l0, l1]; }
  }
  return best;
}

// Black plane (normal blend) to dim a region's floor or ceiling.
function darkPanel(scene, cx, cz, w, d, y, down, op) {
  const geo = new THREE.PlaneGeometry(w, d).rotateX(down ? Math.PI / 2 : -Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: op, depthWrite: false }));
  m.position.set(cx, y, cz);
  scene.add(m);
}

// Upright black plane (normal blend) to dim a wall face, spanning [fl, cl].
function darkWall(scene, cx, cz, w, facing, fl = 0, cl = 1, op = 0.55) {
  const cy = (fl + cl) / 2;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, cl - fl),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: op, side: THREE.DoubleSide, depthWrite: false }));
  m.position.set(cx + facing[0] * 0.02, cy, cz + facing[1] * 0.02);
  m.lookAt(cx + facing[0], cy, cz + facing[1]);
  scene.add(m);
}

// Faint painted floor guidance line (Half-Life style). One axis-aligned segment;
// semi-transparent + polygonOffset so it reads as paint and never z-fights.
function paintSeg(scene, color, ax, az, bx, bz, w = 0.1) {
  const horiz = Math.abs(bx - ax) >= Math.abs(bz - az);
  const len = Math.hypot(bx - ax, bz - az) + w;   // +w so corners overlap cleanly
  const geo = new THREE.PlaneGeometry(horiz ? len : w, horiz ? w : len).rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.25, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  const mx = (ax + bx) / 2, mz = (az + bz) / 2;
  m.position.set(mx, floorAt(mx, mz) + 0.012, mz);
  scene.add(m);
}

// Painted polyline through a list of [x,z] points.
function paintPath(scene, color, pts) {
  for (let i = 1; i < pts.length; i++)
    paintSeg(scene, color, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
}

// Flat plane on floor (or ceiling), additive-blended.
function flatGlow(scene, color, cx, cz, w, d, { y = 0.02, opacity = 0.1, down = false } = {}) {
  const geo = new THREE.PlaneGeometry(w, d).rotateX(down ? Math.PI / 2 : -Math.PI / 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  mesh.position.set(cx, y, cz);
  scene.add(mesh);
}

// Upright additive glow strip (wall niche / rack light) facing `facing`.
function glowBar(scene, color, x, y, z, w, h, facing) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
  m.position.set(x + facing[0] * 0.02, y, z + facing[1] * 0.02);
  m.lookAt(x + facing[0], y, z + facing[1]);
  scene.add(m);
}

// Upright text panel readable (non-mirrored) from BOTH sides: two front-facing
// planes back-to-back, each oriented toward its own side.
function textPanel(scene, tex, x, y, z, w, h, facing) {
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  for (const s of [1, -1]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x + facing[0] * 0.02 * s, y, z + facing[1] * 0.02 * s);
    m.lookAt(x + facing[0] * s, y, z + facing[1] * s);
    scene.add(m);
  }
}

// Rotating wireframe icosahedron — the "hologram".
function holo(scene, color, x, y, z, r) {
  const line = new THREE.LineSegments(
    new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(r, 0)),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false }));
  line.position.set(x, y, z);
  scene.add(line);
  return line;
}

export function buildDecor(scene) {
  const anim = [];   // { node, ry, rx, y0, amp, spd }

  // ── Per-room palette + thresholds + signage ──────────────────────────────
  for (const room of ROOMS) {
    const [minX, maxX, minZ, maxZ] = room.floor;
    const cxr = (minX + maxX) / 2, czr = (minZ + maxZ) / 2;
    const rf = floorAt(cxr, czr);
    flatGlow(scene, room.color, cxr, czr, maxX - minX, maxZ - minZ, { y: rf + 0.02, opacity: 0.1 });

    const [px, pz] = room.console;
    softPool(scene, room.color, px, pz, 2.0, { y: floorAt(px, pz) + 0.03, opacity: 0.32 });
    softPool(scene, room.color, px, pz, 1.2, { y: ceilAt(px, pz) - 0.015, opacity: 0.45, down: true });

    const d = room.door, [fx, fz] = d.facing, [a, b] = d.span, span = b - a, mid = (a + b) / 2;
    const dx = d.axis === 'x' ? d.line : mid, dz = d.axis === 'z' ? d.line : mid;
    // facing points toward the atrium (player side); room side is the opposite.
    const bandF = floorAt(dx - fx * 0.5, dz - fz * 0.5);
    // Header sits at the top of the opening = the LOWER of the two ceilings.
    const corrC = Math.min(ceilAt(dx + fx * 0.5, dz + fz * 0.5), ceilAt(dx - fx * 0.5, dz - fz * 0.5));
    flatGlow(scene, room.color, dx, dz, d.axis === 'x' ? 0.3 : span, d.axis === 'x' ? span : 0.3, { y: bandF + 0.03, opacity: 0.4 });

    const lintel = new THREE.Mesh(new THREE.PlaneGeometry(span, 0.1),
      new THREE.MeshBasicMaterial({ color: room.color, transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
    lintel.position.set(dx + fx * 0.02, corrC - 0.06, dz + fz * 0.02);
    lintel.lookAt(dx + fx, corrC - 0.06, dz + fz);
    scene.add(lintel);

    textPanel(scene, textTexture(['▸ ' + room.name + ' ◂'], room.color), dx, corrC - 0.2, dz, 0.9, 0.15, [fx, fz]);
  }

  // ── Atrium hub holo-directory (centre of the tall hall, non-colliding) ────
  const HX = 12.5, HZ = 12, HY = 0.95, HCOL = 0x37c0ff;
  softPool(scene, HCOL, HX, HZ, 2.4, { y: 0.02, opacity: 0.32 });
  const hub = holo(scene, HCOL, HX, HY, HZ, 0.42);
  anim.push({ node: hub, ry: 0.6, rx: 0.18, y0: HY, amp: 0.05, spd: 1.4 });
  // Banner faces south toward the spawn — readable in the tall atrium.
  textPanel(scene, textTexture(['NICOLAS RENARD', 'LEAD DEV // PORTFOLIO'], HCOL, { w: 320, h: 72, font: 14 }),
    HX, 1.35, HZ, 1.5, 0.34, [0, 1]);

  // ── Projects trophy gallery ───────────────────────────────────────────────
  PLINTHS.forEach((p, i) => {
    const proj = projects[i];
    const pf = floorAt(p.x, p.z), pc = ceilAt(p.x, p.z);
    softPool(scene, PLINTH_COLOR, p.x, p.z, 1.1, { y: pf + 0.03, opacity: 0.4 });             // floor pool
    softPool(scene, PLINTH_COLOR, p.x, p.z, 0.7, { y: pc - 0.015, opacity: 0.45, down: true }); // ceiling spot (cathedral height)
    const y0 = pf + 0.78;
    const h = holo(scene, PLINTH_COLOR, p.x, y0, p.z, 0.14);
    anim.push({ node: h, ry: 0.9 + i * 0.05, rx: 0.3, y0, amp: 0.03, spd: 1.2 + i * 0.1 });
    if (proj) {
      textPanel(scene, textTexture(wrapName(proj.name), PLINTH_COLOR, { w: 224, h: 64, font: 11, border: false }),
        p.x, pf + 0.56, p.z + p.face[1] * 0.27, 0.52, 0.18, p.face);

      // Floating tech-logo ring above the plinth — 2-4 brand-coloured chips, each
      // backed by a halo in its dominant colour; the whole ring slowly orbits.
      const techs = proj.stack.slice(0, 4).map(techOf);
      const ringY = pf + 1.06, R = techs.length > 1 ? 0.3 : 0;
      const grp = new THREE.Group();
      grp.position.set(p.x, ringY, p.z);
      techs.forEach((tk, k) => {
        const ang = (k / techs.length) * Math.PI * 2;
        const lx = Math.sin(ang) * R, lz = Math.cos(ang) * R;
        const ox = Math.sin(ang), oz = Math.cos(ang);   // outward normal

        const halo = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.46),
          new THREE.MeshBasicMaterial({ map: radialTex(tk.c), transparent: true, opacity: 0.5,
            blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
        halo.position.set(lx - ox * 0.02, 0, lz - oz * 0.02);
        halo.rotation.y = ang;
        grp.add(halo);

        if (tk.f) {
          // Real brand logo on a transparent card, visible from both sides.
          const card = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.32),
            new THREE.MeshBasicMaterial({ map: logoTexture(tk.f), transparent: true,
              side: THREE.DoubleSide, depthWrite: false }));
          card.position.set(lx, 0, lz);
          card.rotation.y = ang;
          grp.add(card);
        } else {
          // Text chip fallback (techs without a fetched logo), readable both sides.
          const font = Math.max(10, Math.min(18, Math.floor(118 / Math.max(2, tk.l.length))));
          const tex = textTexture([tk.l], tk.c, { w: 144, h: 64, font });
          for (const s of [1, -1]) {
            const chip = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.16),
              new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
            chip.position.set(lx + ox * 0.012 * s, 0, lz + oz * 0.012 * s);
            chip.rotation.y = ang + (s < 0 ? Math.PI : 0);
            grp.add(chip);
          }
        }
      });
      scene.add(grp);
      anim.push({ node: grp, ry: 0.45 + i * 0.03, rx: 0, y0: ringY, amp: 0.04, spd: 1.0 + i * 0.08 });
    }
  });

  // ── Room accents — thematic set-dressing lighting ────────────────────────
  // Armurerie: vertical rack-light strips in the wall niches (armory feel).
  const skF = floorAt(4.5, 12);
  for (const x of [3.5, 5.5]) {
    glowBar(scene, 0x00ff41, x, skF + 0.55, 9.08, 0.06, 0.6, [0, 1]);    // north wall
    glowBar(scene, 0x00ff41, x, skF + 0.55, 15.92, 0.06, 0.6, [0, -1]);  // south wall
  }
  // Quartiers: warm hearth glow over the lounge — cozy warmth layered on the purple.
  softPool(scene, 0xff7a33, 12.0, 4.0, 3.4, { y: floorAt(12, 4) + 0.02, opacity: 0.16 });

  // ── Secret room — very dark, lit only by the arcade console at the far wall ─
  const AX = 12.5, AZ = 21.4, SCOL = 0xff2a9d;
  const sf = floorAt(12.5, 20.5), sc = ceilAt(12.5, 20.5);  // arcade floor/ceil
  // Dim the whole room: black overlays over floor, ceiling and the 3 solid walls
  // (north wall has the entrance, left lit).
  darkPanel(scene, 12.5, 20.5, 7, 5, sf + 0.05, false, 0.62);
  darkPanel(scene, 12.5, 20.5, 7, 5, sc - 0.01, true, 0.7);
  darkWall(scene, 12.5, 23.0, 7, [0, -1], sf, sc);    // south wall
  darkWall(scene, 9.0,  20.5, 5, [1, 0],  sf, sc);    // west wall
  darkWall(scene, 16.0, 20.5, 5, [-1, 0], sf, sc);    // east wall
  // Arcade glow (pool reaches slightly toward the player to the north).
  softPool(scene, SCOL, AX, AZ - 0.25, 1.9, { y: sf + 0.07, opacity: 0.42 });
  softPool(scene, 0x37ffe0, AX, AZ - 0.2, 1.1, { y: sc - 0.015, opacity: 0.5, down: true });

  // ── Black-Mesa guidance lines — start at the south wall, split mid-room ──────
  const GREEN = 0x2a9d4a, AMBER = 0xb5701a, VIOLET = 0x7d3aa8;
  paintPath(scene, GREEN,  [[12.3, 15.5], [12.3, 12.5], [9.0, 12.5]]);   // → Armurerie (W door centre z12.5)
  paintPath(scene, VIOLET, [[12.5, 15.5], [12.5, 9.0]]);                 // → Quartiers (N door centre x12.5)
  paintPath(scene, AMBER,  [[12.7, 15.5], [12.7, 12.5], [16.0, 12.5]]);  // → Trophées (E door centre z12.5)

  return {
    update(t) {
      for (const a of anim) {
        a.node.rotation.y = t * a.ry;
        a.node.rotation.x = t * a.rx;
        a.node.position.y = a.y0 + Math.sin(t * a.spd) * a.amp;
      }
    },
  };
}
