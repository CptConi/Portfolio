import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PROD_PANEL, PROD_KEY } from './layout.js';
import { prefs } from './prefs.js';
import { radialTex } from './decor/helpers.js';

// The two props of the PROD secret, built procedurally (no assets):
//   • the PROD panel — a hazard-striped plate on the east side face of the Digital
//     Factory console, with a red mushroom button under a hinged glass cover whose
//     gold lock takes the key;
//   • the key hanging on its hook (shadow board + paper tag) on the Quartiers wall.
// Everything is unlit MeshBasic with shading baked into vertex colours, like the
// consoles, so it stays legible at 640×360. No lights are added.
//
// This class only animates; the game logic (who may do what, when) lives in
// features/secret.js, which calls takeKey / unlockCover / pressButton and update.
// Draw calls: panel 11 (when in view), hook 5.

const FONT = '"Press Start 2P", monospace';
const TAU = Math.PI * 2;

// Panel plate (local axes: +z out of the console face, +y up, +x toward the wall).
// The group origin is the centre of the red button.
const PLATE_W = 0.34, PLATE_H = 0.43;
const LID_W = 0.19, LID_H = 0.17, LID_D = 0.08;
const HINGE = { y: 0.09, z: 0.01 };           // top edge of the glass cover
const LID_OPEN = 1.75;                         // ~100°: the cover ends up leaning past horizontal
const LOCK_Y = -0.158;                         // gold lock, on the cover's lower front edge
const LOCK_Z = LID_D + 0.006;                  // lock centre (it is 0.012 thick)
const BOW_Z = LOCK_Z + 0.0066;                 // where the key bow sits when fully inserted
const BTN_Z = 0.015, BTN_TRAVEL = 0.017;
const ALARM_S = 3.2;                           // red flicker duration after the press
const ALARM_FADE = 0.8;
const FLICKER_RAD = 13.5;                      // rad/s of the flicker: 13.5 / 2π ≈ 2.15 on/off cycles per second

const easeInOut = u => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const easeOutBack = u => { const c1 = 1.1, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); };

// ── Textures ────────────────────────────────────────────────────────────────

// Magnification stays chunky (pixel art), minification is mipmapped so the stripes
// and glyphs do not shimmer from afar; anisotropy keeps the side-on view readable.
function canvasTex(w, h, paint) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  paint(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.anisotropy = 4;
  return tex;
}

// Yellow/black hazard border around a dark steel face, rivets, a warning triangle
// and the socket of the standby LED. 400 px per metre.
function paintPlate(ctx, w, h) {
  const B = 12, S = 12;
  ctx.fillStyle = '#f2c200';
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
  ctx.fillStyle = '#141414';
  for (let x = -h; x < w + h; x += S * 2) {
    ctx.beginPath();
    ctx.moveTo(x, h); ctx.lineTo(x + S, h); ctx.lineTo(x + S + h, 0); ctx.lineTo(x + h, 0);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();

  ctx.fillStyle = '#2a2e35';
  ctx.fillRect(B, B, w - 2 * B, h - 2 * B);
  ctx.fillStyle = '#4b525c';                                   // bevel: lit top / left
  ctx.fillRect(B, B, w - 2 * B, 1); ctx.fillRect(B, B, 1, h - 2 * B);
  ctx.fillStyle = '#14171b';                                   // shaded bottom / right
  ctx.fillRect(B, h - B - 1, w - 2 * B, 1); ctx.fillRect(w - B - 1, B, 1, h - 2 * B);
  ctx.fillStyle = '#9aa0a8';                                   // rivets
  for (const [x, y] of [[B + 4, B + 4], [w - B - 7, B + 4], [B + 4, h - B - 7], [w - B - 7, h - B - 7]]) ctx.fillRect(x, y, 3, 3);

  const tx = w / 2, ty = 28;                                   // warning triangle above the cover
  ctx.fillStyle = '#f2c200';
  ctx.beginPath(); ctx.moveTo(tx, ty - 9); ctx.lineTo(tx + 10, ty + 8); ctx.lineTo(tx - 10, ty + 8); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#141414';
  ctx.fillRect(tx - 1, ty - 3, 2, 7); ctx.fillRect(tx - 1, ty + 5, 2, 2);

  ctx.fillStyle = '#0e1013';                                   // LED socket (right of the triangle)
  ctx.beginPath(); ctx.arc(w / 2 + 46, ty, 6, 0, TAU); ctx.fill();
}

// Engraved micro label, two lines so the glyphs can be big (3× the font's 8 px grid).
function paintLabel(ctx, w, h) {
  ctx.fillStyle = '#16090a';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#c81e1e';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
  ctx.font = `24px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('ACCÉDER À', w / 2, 26);
  ctx.fillStyle = '#ff4d4d';
  ctx.fillText('LA PROD', w / 2, 58);
}

// Key positions in board pixels (400 px/m, key-centre origin at (40, 0.125 m from the top)).
const bx = x => 40 + x * 400, by = y => (0.125 - y) * 400;

// A shadow board: the key's silhouette is painted on it, so the outline stays once
// the key has been taken.
function paintBoard(ctx, w, h) {
  ctx.fillStyle = '#241f1b';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#3a322a';
  ctx.lineWidth = 1;
  ctx.strokeRect(2.5, 2.5, w - 5, h - 5);
  ctx.fillStyle = '#6b625a';
  for (const [x, y] of [[5, 5], [w - 7, 5], [5, h - 7], [w - 7, h - 7]]) ctx.fillRect(x, y, 2, 2);
  ctx.font = `8px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#9c7a2e';
  ctx.fillText('CLÉS', w / 2, 12);

  ctx.fillStyle = '#0e0c0a';
  ctx.strokeStyle = '#6a5a2c';
  const shape = fn => { ctx.beginPath(); fn(); ctx.fill(); ctx.stroke(); };
  shape(() => ctx.arc(bx(0), by(0.055), 8.7, 0, TAU));
  shape(() => ctx.rect(bx(0) - 2.2, by(0.033), 4.4, (0.095) * 400));
  shape(() => ctx.rect(bx(0.0055), by(-0.047), 8.8, 4.8));
  shape(() => ctx.rect(bx(0.0055), by(-0.031), 6.4, 4));
  ctx.fillStyle = '#241f1b';
  ctx.beginPath(); ctx.arc(bx(0), by(0.055), 4.2, 0, TAU); ctx.fill(); ctx.stroke();
}

// Paper tag with its string and a few scribbled lines (the text itself is in the toast).
function paintTag(ctx, w, h) {
  ctx.strokeStyle = '#d8d8d8';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(1, 1); ctx.lineTo(34, 21); ctx.stroke();
  ctx.fillStyle = '#e6d9b0';
  ctx.fillRect(12, 16, 44, 62);
  ctx.fillStyle = '#7a6a3a';
  ctx.beginPath(); ctx.arc(34, 22, 3, 0, TAU); ctx.fill();
  ctx.fillStyle = '#c0261c';                                   // the line that was underlined twice
  ctx.fillRect(18, 34, 32, 3);
  ctx.fillStyle = '#4a4438';
  ctx.fillRect(18, 44, 28, 2); ctx.fillRect(18, 52, 32, 2); ctx.fillRect(18, 60, 20, 2); ctx.fillRect(18, 68, 26, 2);
}

// ── Geometry ────────────────────────────────────────────────────────────────

// Bake a soft directional shade into vertex colours (flat unlit parts then read as volume).
const LIGHT = new THREE.Vector3(-0.35, 0.6, 0.72).normalize();
const _col = new THREE.Color();
function shade(geo, hex) {
  _col.set(hex);
  const nor = geo.attributes.normal, n = nor.count, out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const b = 0.55 + 0.45 * Math.max(0, nor.getX(i) * LIGHT.x + nor.getY(i) * LIGHT.y + nor.getZ(i) * LIGHT.z);
    out[i * 3] = _col.r * b; out[i * 3 + 1] = _col.g * b; out[i * 3 + 2] = _col.b * b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(out, 3));
  return geo;
}

// Cylinder whose axis is z (the way things stick out of a wall).
const rod = (r, len, seg = 16) => new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2);

const unlit = (opts = {}) => new THREE.MeshBasicMaterial(opts);
const glowMat = (hex) => unlit({
  map: radialTex(hex), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
});

export class SecretDevice {
  constructor(scene) {
    this._scene = scene;
    this._own = [];            // geometries / materials / textures to free on dispose
    this._steps = null;        // running tween sequence
    this._alarm = -1;          // seconds since the press, -1 = idle
    this._spent = false;
    this._keyOnHook = true;
    this._onSpent = null;

    this._buildPanel();
    this._buildHook();
  }

  _keep(o) { this._own.push(o); return o; }

  // ── Panel ─────────────────────────────────────────────────────────────────
  _buildPanel() {
    const own = o => this._keep(o);
    const g = new THREE.Group();
    g.position.set(PROD_PANEL.x, PROD_PANEL.y, PROD_PANEL.z);
    g.rotation.y = Math.atan2(PROD_PANEL.facing[0], PROD_PANEL.facing[1]);   // local +z → out of the face
    this._panel = g;

    const plate = new THREE.Mesh(own(new THREE.PlaneGeometry(PLATE_W, PLATE_H)),
      own(unlit({ map: own(canvasTex(136, 172, paintPlate)) })));
    plate.position.z = 0.003;
    g.add(plate);

    const label = new THREE.Mesh(own(new THREE.PlaneGeometry(0.26, 0.08)),
      own(unlit({ map: own(canvasTex(256, 80, paintLabel)) })));
    label.position.set(0, -0.14, 0.0055);
    g.add(label);

    // Static metal: bezel, chrome ring, hinge rod and its two brackets.
    const metal = own(mergeGeometries([
      shade(rod(0.074, 0.012, 20).translate(0, 0, 0.009), 0x2b2e34),
      shade(new THREE.RingGeometry(0.057, 0.066, 24).translate(0, 0, 0.0155), 0xc8ccd4),
      shade(new THREE.CylinderGeometry(0.007, 0.007, 0.2, 8).rotateZ(Math.PI / 2).translate(0, HINGE.y, HINGE.z), 0x9aa0a8),
      shade(new THREE.BoxGeometry(0.014, 0.024, 0.014).translate(-0.1, HINGE.y, HINGE.z), 0x4b4f56),
      shade(new THREE.BoxGeometry(0.014, 0.024, 0.014).translate(0.1, HINGE.y, HINGE.z), 0x4b4f56),
    ]));
    g.add(new THREE.Mesh(metal, own(unlit({ vertexColors: true }))));

    // Red mushroom button (lathe profile, axis turned toward +z).
    const profile = [[0, 0], [0.046, 0], [0.047, 0.01], [0.05, 0.016], [0.047, 0.024], [0.038, 0.031], [0.022, 0.036], [0, 0.038]]
      .map(([r, y]) => new THREE.Vector2(r, y));
    const btnGeo = own(shade(new THREE.LatheGeometry(profile, 20).rotateX(Math.PI / 2), 0xffffff));
    this._btnMat = own(unlit({ vertexColors: true, color: 0xcf1a1a }));
    this._btn = new THREE.Mesh(btnGeo, this._btnMat);
    this._btn.position.z = BTN_Z;
    g.add(this._btn);

    // Standby LED (blinks while the cover is closed, flickers with the alarm).
    this._ledMat = own(unlit({ color: 0x501010 }));
    const led = new THREE.Mesh(own(new THREE.PlaneGeometry(0.02, 0.02)), this._ledMat);
    led.position.set(0.115, 0.145, 0.0065);
    g.add(led);

    // Glass cover, hinged on its top edge: it hangs in front of the button and swings
    // up and out. Everything that belongs to it is a child of the pivot.
    const lid = new THREE.Group();
    lid.position.set(0, HINGE.y, HINGE.z);
    this._lid = lid;
    const glassGeo = own(new THREE.BoxGeometry(LID_W, LID_H, LID_D).translate(0, -LID_H / 2, LID_D / 2));
    lid.add(new THREE.Mesh(glassGeo, own(unlit({
      color: 0xaee4ff, transparent: true, opacity: 0.2, depthWrite: false }))));
    lid.add(new THREE.LineSegments(own(new THREE.EdgesGeometry(glassGeo)), own(new THREE.LineBasicMaterial({ color: 0xd6f2ff }))));

    const lockGeo = own(mergeGeometries([
      shade(rod(0.019, 0.012).translate(0, LOCK_Y, LOCK_Z), 0xe0ae22),
      shade(new THREE.RingGeometry(0.012, 0.016, 16).translate(0, LOCK_Y, BOW_Z - 0.0004), 0xa87a12),
      shade(new THREE.CircleGeometry(0.0042, 10).translate(0, LOCK_Y + 0.0005, BOW_Z), 0x120c02),   // keyhole
      shade(new THREE.PlaneGeometry(0.0028, 0.01).translate(0, LOCK_Y - 0.0045, BOW_Z), 0x120c02),
    ]));
    lid.add(new THREE.Mesh(lockGeo, own(unlit({ vertexColors: true }))));

    // The key turning in that lock: ring bow off-centre so the quarter turn reads.
    const bowGeo = own(mergeGeometries([
      shade(new THREE.BoxGeometry(0.02, 0.006, 0.006).translate(0.012, 0, 0.003), 0xffd23a),
      shade(new THREE.TorusGeometry(0.011, 0.0035, 6, 14).translate(0.03, 0, 0.003), 0xffd23a),
      shade(rod(0.003, 0.014, 8).translate(0, 0, -0.005), 0xffd23a),
    ]));
    this._bow = new THREE.Mesh(bowGeo, own(unlit({ vertexColors: true })));
    this._bow.position.set(0, LOCK_Y, BOW_Z);
    this._bow.visible = false;
    lid.add(this._bow);
    g.add(lid);

    // Alarm: a red additive halo over the face + a pool of light on the floor. No PointLight.
    this._halo = new THREE.Mesh(own(new THREE.PlaneGeometry(0.85, 0.85)), own(glowMat(0xff1c1c)));
    this._halo.position.set(0, 0.04, 0.1);
    this._halo.visible = false;
    g.add(this._halo);

    const fx = PROD_PANEL.facing[0], fz = PROD_PANEL.facing[1];
    this._pool = new THREE.Mesh(own(new THREE.PlaneGeometry(1.3, 1.3).rotateX(-Math.PI / 2)), own(glowMat(0xff2020)));
    this._pool.position.set(PROD_PANEL.x + fx * 0.55, 0.02, PROD_PANEL.z + fz * 0.55 + 0.2);
    this._pool.visible = false;

    this._btnBase = new THREE.Color(0xcf1a1a);
    this._btnHot = new THREE.Color(0xff5a4a);
    this._btnSpent = new THREE.Color(0x5e0e0e);
    this._ledOn = new THREE.Color(0xff3030);
    this._ledOff = new THREE.Color(0x501010);

    this._scene.add(g, this._pool);
  }

  // ── Key on its hook (Quartiers north wall) ───────────────────────────────
  _buildHook() {
    const own = o => this._keep(o);
    const h = new THREE.Group();
    h.position.set(PROD_KEY.x, PROD_KEY.y, PROD_KEY.z);
    h.rotation.y = Math.atan2(PROD_KEY.facing[0], PROD_KEY.facing[1]);
    this._hook = h;
    const PIN_Y = 0.067;           // inner top of the key ring

    const board = new THREE.Mesh(own(new THREE.PlaneGeometry(0.2, 0.26)),
      own(unlit({ map: own(canvasTex(80, 104, paintBoard)) })));
    board.position.set(0, -0.005, -0.032);
    h.add(board);

    const pinGeo = own(mergeGeometries([
      shade(rod(0.004, 0.046, 8).translate(0, PIN_Y, -0.009), 0xb8892f),
      shade(rod(0.0075, 0.004, 10).translate(0, PIN_Y, 0.014), 0xd6a53a),
    ]));
    h.add(new THREE.Mesh(pinGeo, own(unlit({ vertexColors: true }))));

    // Everything that hangs from the pin swings together; `inner` re-centres it on the key.
    this._swing = new THREE.Group();
    this._swing.position.set(0, PIN_Y, 0);
    const inner = new THREE.Group();
    inner.position.set(0, -PIN_Y, 0);
    this._swing.add(inner);
    h.add(this._swing);

    const keyGeo = own(mergeGeometries([
      shade(new THREE.TorusGeometry(0.017, 0.0048, 6, 16).translate(0, 0.055, 0), 0xffc83a),
      shade(new THREE.BoxGeometry(0.016, 0.008, 0.008).translate(0, 0.034, 0), 0xffc83a),
      shade(new THREE.BoxGeometry(0.011, 0.095, 0.007).translate(0, -0.0145, 0), 0xffc83a),
      shade(new THREE.BoxGeometry(0.022, 0.012, 0.007).translate(0.0165, -0.053, 0), 0xffc83a),
      shade(new THREE.BoxGeometry(0.016, 0.01, 0.007).translate(0.0135, -0.036, 0), 0xffc83a),
    ]));
    inner.add(new THREE.Mesh(keyGeo, own(unlit({ vertexColors: true }))));

    // Paper tag, pivoting from the ring's lower right corner.
    this._tag = new THREE.Group();
    this._tag.position.set(0.016, 0.04, 0.008);
    const tag = new THREE.Mesh(own(new THREE.PlaneGeometry(0.07, 0.1).translate(0.035, -0.05, 0)),
      own(unlit({ map: own(canvasTex(56, 80, paintTag)), transparent: true, alphaTest: 0.4 })));
    this._tag.add(tag);
    inner.add(this._tag);

    // A glint that catches the eye every few seconds.
    this._glint = new THREE.Mesh(own(new THREE.PlaneGeometry(0.075, 0.075)), own(glowMat(0xffe9a0)));
    this._glint.position.set(-0.014, 0.066, 0.012);
    this._glint.visible = false;
    inner.add(this._glint);

    this._scene.add(h);
  }

  // ── Actions (called by the feature) ──────────────────────────────────────

  // The key leaves the hook; the shadow board keeps its outline.
  takeKey() {
    this._keyOnHook = false;
    this._swing.visible = false;
  }

  // Key slides into the lock, turns a quarter, then the cover swings up.
  // onClick fires the moment the lock releases, onDone once the cover has settled.
  unlockCover({ onClick, onDone } = {}) {
    const calm = prefs.reducedMotion;
    const bow = this._bow;
    this._run([
      { dur: calm ? 0.01 : 0.18, fn: u => { bow.visible = true; bow.position.z = BOW_Z + 0.03 * (1 - u); } },
      { dur: calm ? 0.15 : 0.35, fn: u => { bow.rotation.z = easeInOut(u) * Math.PI / 2; }, end: onClick },
      { dur: calm ? 0.3 : 0.6, fn: u => { this._lid.rotation.x = -LID_OPEN * (calm ? easeInOut(u) : easeOutBack(u)); } },
    ], onDone);
  }

  // The button goes in, then the panel runs its alarm and ends up "spent".
  pressButton(onSpent) {
    const calm = prefs.reducedMotion;
    this._onSpent = onSpent;
    this._run([
      { dur: calm ? 0.08 : 0.12, fn: u => { this._btn.position.z = BTN_Z - BTN_TRAVEL * u; } },
    ], () => { this._alarm = 0; });
  }

  _run(steps, done) {
    this._steps = steps; this._stepI = 0; this._stepT = 0; this._done = done;
  }

  _tick(dt) {
    const steps = this._steps;
    if (!steps) return;
    const s = steps[this._stepI];
    this._stepT += dt;
    const u = Math.min(1, this._stepT / s.dur);
    s.fn(u);
    if (u < 1) return;
    s.end?.();
    this._stepT = 0;
    if (++this._stepI >= steps.length) {
      const done = this._done;
      this._steps = null; this._done = null;
      done?.();
    }
  }

  _setAlarm(k) {
    const on = k > 0.01;
    this._halo.visible = this._pool.visible = on;
    this._halo.material.opacity = 0.9 * k;
    this._pool.material.opacity = 0.75 * k;
    this._btnMat.color.copy(this._btnBase).lerp(this._btnHot, k);
    this._ledMat.color.copy(k > 0.5 ? this._ledOn : this._ledOff);
  }

  // Per frame: tweens, alarm, and the idle life of both props.
  update(dt, t) {
    const calm = prefs.reducedMotion;
    this._tick(dt);

    if (this._alarm >= 0) {
      const dur = calm ? ALARM_S * 0.5 : ALARM_S;
      this._alarm += dt;
      const a = this._alarm;
      const env = Math.min(1, Math.max(0, (dur - a) / ALARM_FADE));
      // Short-circuit flicker: on/off bursts with a jittery top; a calm swell for reduced motion.
      // Kept at ~2.1 Hz with a soft "off" level, under the 3 flashes/s photosensitivity limit.
      const k = calm ? 0.7 * env : (Math.sin(a * FLICKER_RAD) > -0.25 ? 1 : 0.4) * (0.85 + 0.15 * Math.random()) * env;
      this._setAlarm(k);
      if (a >= dur) {
        this._alarm = -1;
        this._spent = true;
        this._setAlarm(0);
        this._btnMat.color.copy(this._btnSpent);
        this._onSpent?.();
      }
    } else if (!this._spent) {
      // Standby: the LED ticks once every 1.6 s (steady when motion is reduced).
      this._ledMat.color.copy(calm || (t % 1.6) < 0.18 ? this._ledOn : this._ledOff);
    }

    if (this._keyOnHook) {
      this._swing.rotation.z = calm ? 0 : 0.05 * Math.sin(t * 1.7);
      this._tag.rotation.z = -0.12 + (calm ? 0 : 0.09 * Math.sin(t * 1.7 + 1.1));
      const ph = (t % 3.4) / 0.4;                                  // a 0.4 s glint every 3.4 s
      const o = calm ? 0.35 : (ph < 1 ? Math.sin(ph * Math.PI) * 0.95 : 0);
      this._glint.visible = o > 0.01;
      this._glint.material.opacity = o;
    }
  }

  dispose() {
    this._scene.remove(this._panel, this._pool, this._hook);
    for (const o of this._own) o.dispose();
    this._own.length = 0;
  }
}
