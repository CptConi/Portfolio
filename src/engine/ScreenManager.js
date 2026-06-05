import * as THREE from 'three';
import { SCREENS, SCREEN_CY, FOCUS_RANGE, FOCUS_DIST, ARCADE } from './Screens.js';
import { floorAt } from './Map.js';
import { TerminalScreen } from '../ui/TerminalScreen.js';
import { ArcadeGame } from '../ui/ArcadeGame.js';
import { contact } from '../data/contact.js';

const DATA_MAP = { contact };
const FOCUS_TIME = 0.4;            // seconds for the camera glide
const SCREEN_LZ  = 0.205;          // screen centre offset (local Z, toward the player)
const SCREEN_TILT = -0.347;        // screen plane lean-back to match the slanted panel
const smooth = u => u * u * (3 - 2 * u);
const lerp   = (a, b, u) => a + (b - a) * u;

const LIGHT_COLORS = [0x00ff41, 0xff8c00, 0xff2200, 0x37c0ff, 0xffee33];

// Per-face brightness from existing (flat) extrude normals — fakes shading
// under the unlit MeshBasic materials so the monolith reads as 3D.
function shadeByNormal(geo) {
  const nor = geo.attributes.normal, n = geo.attributes.position.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const b = Math.min(1, 0.58 + 0.26 * Math.max(0, nor.getY(i)) + 0.18 * Math.max(0, nor.getZ(i)));
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

// Build the shared monolithic mainframe body + tilted screen + blinking LEDs.
// `screenTex` is whatever drives the screen (a terminal or the arcade game).
// Returns { lights, pose } — the focus camera pose looks along the screen normal.
function buildMainframe(scene, tex, def, screenTex) {
  const group = new THREE.Group();
  const [fx, fz] = def.facing;
  const fOff = floorAt(def.x, def.z);       // console sits on the (possibly sunken) room floor
  group.position.set(def.x, fOff, def.z);
  group.rotation.y = Math.atan2(fx, fz);   // local +Z front → facing

  const shape = new THREE.Shape();
  shape.moveTo( 0.28, 0.00);
  shape.lineTo( 0.28, 0.42);
  shape.lineTo( 0.12, 0.86);
  shape.lineTo(-0.28, 0.86);
  shape.lineTo(-0.28, 0.00);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, { depth: 1.0, bevelEnabled: false });
  geo.rotateY(-Math.PI / 2);
  geo.translate(0.5, 0, 0);
  shadeByNormal(geo);
  const bodyColor = def.id === 'arcade' ? 0x888b90 : 0xc2c8d0;
  group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    map: tex.get(56), color: bodyColor, vertexColors: true })));

  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.38),
    new THREE.MeshBasicMaterial({ map: screenTex }));
  screen.position.set(0, SCREEN_CY, SCREEN_LZ);
  screen.rotation.x = SCREEN_TILT;
  group.add(screen);

  const lights = [];
  const LED_ROWS = 3, LED_COLS = 8;
  const ledGeo = new THREE.PlaneGeometry(0.025, 0.025);
  for (let r = 0; r < LED_ROWS; r++) {
    for (let c = 0; c < LED_COLS; c++) {
      const color = LIGHT_COLORS[(r * LED_COLS + c + def.id.length) % LIGHT_COLORS.length];
      const lx = -0.38 + c * 0.108;
      const ly = 0.22 + r * 0.045;
      // Background / Off state
      const off = new THREE.Mesh(ledGeo, new THREE.MeshBasicMaterial({ color: 0x1a1a1a }));
      off.position.set(lx, ly, 0.284);
      group.add(off);
      // Light / On state
      const led = new THREE.Mesh(ledGeo, new THREE.MeshBasicMaterial({ color }));
      led.position.set(lx, ly, 0.285);
      group.add(led);
      lights.push({ mesh: led, period: 0.15 + Math.random() * 0.9, phase: Math.random(), chaos: Math.random() > 0.7 });
    }
  }
  scene.add(group);

  const sx = def.x + SCREEN_LZ * fx, sz = def.z + SCREEN_LZ * fz;
  const cy = SCREEN_CY + fOff;              // screen centre in world space
  const nFwd = Math.cos(SCREEN_TILT), nUp = -Math.sin(SCREEN_TILT);
  const pose = {
    pos:    { x: sx + fx * FOCUS_DIST * nFwd, y: cy + FOCUS_DIST * nUp, z: sz + fz * FOCUS_DIST * nFwd },
    target: { x: sx, y: cy, z: sz },
  };
  return { lights, pose };
}

function animateLeds(lights, t) {
  for (const l of lights) {
    let v = Math.sin((t / l.period + l.phase) * Math.PI * 2);
    if (l.chaos && Math.random() > 0.98) v = 2.0; // erratic spike
    l.mesh.visible = v > 0.35;
  }
}

// ── Focusable: a mainframe console showing paged data on a tilted screen ────
class Console {
  constructor(def, scene, tex) {
    this.def      = def;
    this.kind     = 'console';
    this.cx = def.x; this.cz = def.z;
    this.prompt = 'ACCÉDER — ' + def.title;
    this.terminal = new TerminalScreen(def);
    this._pn = false; this._pp = false;
    const { lights, pose } = buildMainframe(scene, tex, def, this.terminal.texture);
    this.lights = lights; this.pose = pose;
  }

  animate(t) { animateLeds(this.lights, t); }
  onEnter() {}
  onPassive(t) { this.terminal.draw({ focused: false, t }); }
  onFocusedFrame(input, dt, t, esc) {
    // Page navigation: Left/Right arrows OR Q/D (strafe keys)
    const next = input.rotRight || input.strafeRight;
    const prev = input.rotLeft  || input.strafeLeft;
    if (next && !this._pn) this.terminal.next();
    if (prev && !this._pp) this.terminal.prev();
    this._pn = next; this._pp = prev;

    // Scrolling: Up/Down arrows OR W/S (forward/backward keys)
    const scrollUp = input.forward;
    const scrollDown = input.backward;
    if (scrollUp) this.terminal.scrollUp();
    if (scrollDown) this.terminal.scrollDown();

    // Handle link opening for contact terminal
    if (this.def.type === 'contact' && input.interact && !this._pi) {
      const entry = DATA_MAP.contact[this.terminal.page];
      if (entry && entry.url) window.open(entry.url, '_blank');
    }
    this._pi = input.interact;

    this.terminal.draw({ focused: true, t });
    return input.consumeInteract() || esc;   // E or ESC exits a console
  }
}

// ── Focusable: the secret-room arcade — same mainframe shape, runs a game ───
class Arcade {
  constructor(scene, tex) {
    this.game = new ArcadeGame();
    this.kind = 'arcade';
    this.cx = ARCADE.x; this.cz = ARCADE.z;
    this.prompt = 'JOUER — BUG HUNTER';
    const { lights, pose } = buildMainframe(scene, tex, ARCADE, this.game.texture);
    this.lights = lights; this.pose = pose;
  }

  animate(t) { animateLeds(this.lights, t); }
  onEnter() { this.game.reset(); }
  onPassive(t) { this.game.drawAttract(t); }
  onFocusedFrame(input, dt, t, esc) {
    this.game.update(input, dt, t);
    return esc;                               // arcade exits on ESC only (E/Space = fire)
  }
}

export class ScreenManager {
  constructor(scene, tex, canvas) {
    this._items = [
      ...SCREENS.map(def => new Console(def, scene, tex)),
      new Arcade(scene, tex),
    ];

    this._state  = 'idle';   // 'idle' | 'in' | 'focused' | 'out'
    this._active = null;
    this._u      = 0;
    this._from   = null;
    this._escape = false;

    document.addEventListener('keydown', e => { if (e.code === 'Escape') this._escape = true; });

    // Click/Touch handling on focused terminal
    const handleHit = (clientX, clientY, isClick = true) => {
      if (this._state !== 'focused' || !this._active || this._active.kind !== 'console') return;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = (clientX - rect.left) / rect.width;
      const y = (clientY - rect.top) / rect.height;
      
      const cx = (x - 0.5) / 0.65 + 0.5;
      const cy = (y - 0.5) / 0.72 + 0.55; 
      
      if (cx >= 0 && cx <= 1 && cy >= 0 && cy <= 1) {
        this._active.terminal.handleInput(cx * 480, cy * 304, isClick);
      } else if (!isClick) {
        this._active.terminal.handleInput(-1, -1, false); // Clear hover
      }
    };

    canvas.addEventListener('mousedown', e => handleHit(e.clientX, e.clientY, true));
    canvas.addEventListener('mousemove', e => handleHit(e.clientX, e.clientY, false));
    canvas.addEventListener('touchstart', e => {
      if (e.touches.length > 0) handleHit(e.touches[0].clientX, e.touches[0].clientY, true);
    });
  }

  get focused() { return this._state !== 'idle'; }

  // 'console' | 'arcade' | null — what the player is currently focused on.
  get activeKind() { return this.focused && this._active ? this._active.kind : null; }

  _candidate(player) {
    const fwdX = Math.cos(player.angle), fwdZ = Math.sin(player.angle);
    let best = null, bestD = FOCUS_RANGE;
    for (const it of this._items) {
      const dx = it.cx - player.x, dz = it.cz - player.y;
      const d = Math.hypot(dx, dz);
      if (d > bestD) continue;
      if ((fwdX * dx + fwdZ * dz) / (d || 1) < 0.35) continue;
      best = it; bestD = d;
    }
    return best;
  }

  // Returns { cameraOverride, prompt, blockMovement }
  update(player, input, dt, tSec) {
    for (const it of this._items) it.animate(tSec);
    const eatEsc = () => { const v = this._escape || input.escape; this._escape = false; input.escape = false; return v; };

    if (this._state === 'idle') {
      eatEsc();
      const cand = this._candidate(player);
      if (cand && input.consumeInteract()) {
        this._active = cand;
        cand.onEnter();
        this._from = {
          pos:    { x: player.x, y: player.eyeY, z: player.y },
          target: { x: player.x + Math.cos(player.angle), y: player.eyeY, z: player.y + Math.sin(player.angle) },
        };
        this._u = 0; this._state = 'in';
        return { cameraOverride: this._from, prompt: '', blockMovement: true };
      }
      for (const it of this._items) it.onPassive(tSec);
      return { cameraOverride: null, prompt: cand ? `[ E ] ${cand.prompt}` : '', blockMovement: false };
    }

    if (this._state === 'in' || this._state === 'out') {
      this._u = Math.min(1, this._u + dt / FOCUS_TIME);
      const goingIn = this._state === 'in';
      const cam = this._blend(this._from, this._active.pose, goingIn ? smooth(this._u) : smooth(1 - this._u));
      this._active.onPassive(tSec);
      if (this._u >= 1) this._state = goingIn ? 'focused' : 'idle';
      return { cameraOverride: cam, prompt: '', blockMovement: true };
    }

    // focused
    const exit = this._active.onFocusedFrame(input, dt, tSec, eatEsc());
    if (exit) { this._u = 0; this._state = 'out'; }
    return { cameraOverride: this._active.pose, prompt: '', blockMovement: true };
  }

  _blend(a, b, u) {
    return {
      pos:    { x: lerp(a.pos.x, b.pos.x, u),       y: lerp(a.pos.y, b.pos.y, u),       z: lerp(a.pos.z, b.pos.z, u) },
      target: { x: lerp(a.target.x, b.target.x, u), y: lerp(a.target.y, b.target.y, u), z: lerp(a.target.z, b.target.z, u) },
    };
  }
}
