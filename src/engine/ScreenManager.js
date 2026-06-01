import * as THREE from 'three';
import { SCREENS, SCREEN_CY, FOCUS_RANGE, FOCUS_DIST } from './Screens.js';
import { TerminalScreen } from '../ui/TerminalScreen.js';

const FOCUS_TIME = 0.4;            // seconds for the camera glide
const EYE_Y      = 0.5;            // player eye height (matches Renderer)
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

// One interactive console: cabinet + keyboard + monitor + screen terminal.
class Screen {
  constructor(def, scene, tex) {
    this.def      = def;
    this.terminal = new TerminalScreen(def);
    this.lights   = [];

    const group = new THREE.Group();
    const [fx, fz] = def.facing;
    group.position.set(def.x, 0, def.z);
    group.rotation.y = Math.atan2(fx, fz);   // local +Z front → facing

    // ── Single monolithic body — extruded side profile (mainframe terminal) ──
    // Side profile in (depth Z, height Y): vertical lower front + slanted screen
    // panel on top, full box at the back. One mesh, not an assembly of boxes.
    const shape = new THREE.Shape();
    shape.moveTo( 0.28, 0.00);   // front-bottom
    shape.lineTo( 0.28, 0.42);   // front rises vertically
    shape.lineTo( 0.12, 0.86);   // slanted screen panel (back-and-up)
    shape.lineTo(-0.28, 0.86);   // top-back
    shape.lineTo(-0.28, 0.00);   // back-bottom
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, { depth: 1.0, bevelEnabled: false });
    geo.rotateY(-Math.PI / 2);   // shape depth → world Z, extrude → world X (width)
    geo.translate(0.5, 0, 0);    // centre the width on x = 0
    shadeByNormal(geo);

    const body = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: tex.get(56), color: 0xc2c8d0, vertexColors: true,
    }));
    group.add(body);

    // Screen (CanvasTexture) inset in the slanted panel, leaning back to match it.
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.6, 0.38),
      new THREE.MeshBasicMaterial({ map: this.terminal.texture })
    );
    screen.position.set(0, SCREEN_CY, SCREEN_LZ);
    screen.rotation.x = SCREEN_TILT;
    group.add(screen);

    // Blinking light row on the vertical lower front panel.
    for (let i = 0; i < 8; i++) {
      const c = LIGHT_COLORS[(i * 3 + def.id.length) % LIGHT_COLORS.length];
      const led = new THREE.Mesh(
        new THREE.PlaneGeometry(0.045, 0.045),
        new THREE.MeshBasicMaterial({ color: c })
      );
      led.position.set(-0.36 + i * 0.103, 0.22, 0.285);
      group.add(led);
      this.lights.push({ mesh: led, period: 0.4 + (i % 4) * 0.25, phase: (i * 0.37) % 1 });
    }

    scene.add(group);

    // Camera pose when focused: looking along the screen's normal so the tilted
    // panel appears rectangular (not trapezoidal). Screen leans back by SCREEN_TILT,
    // so its normal points forward (cos) and up (-sin) → park camera high + forward.
    const sx = def.x + SCREEN_LZ * fx, sz = def.z + SCREEN_LZ * fz;
    const nFwd = Math.cos(SCREEN_TILT);   // horizontal component of the normal
    const nUp  = -Math.sin(SCREEN_TILT);  // vertical component (looks down at panel)
    this.focusPose = {
      pos:    { x: sx + fx * FOCUS_DIST * nFwd, y: SCREEN_CY + FOCUS_DIST * nUp, z: sz + fz * FOCUS_DIST * nFwd },
      target: { x: sx, y: SCREEN_CY, z: sz },
    };
  }

  animateLights(tSec) {
    for (const l of this.lights)
      l.mesh.visible = Math.sin((tSec / l.period + l.phase) * Math.PI * 2) > -0.2;
  }
}

export class ScreenManager {
  constructor(scene, tex) {
    this._screens = SCREENS.map(def => new Screen(def, scene, tex));

    this._state   = 'idle';   // 'idle' | 'in' | 'focused' | 'out'
    this._active  = null;
    this._u       = 0;        // focus glide progress 0..1
    this._from    = null;     // camera pose at glide start
    this._prevNav = { next: false, prev: false };
    this._escape  = false;

    document.addEventListener('keydown', e => {
      if (e.code === 'Escape') this._escape = true;
    });
  }

  get focused() { return this._state !== 'idle'; }

  // Nearest console the player is close to and roughly facing. null otherwise.
  _candidate(player) {
    const fwdX = Math.cos(player.angle), fwdZ = Math.sin(player.angle);
    let best = null, bestD = FOCUS_RANGE;
    for (const s of this._screens) {
      const dx = s.def.x - player.x, dz = s.def.z - player.y;
      const d = Math.hypot(dx, dz);
      if (d > bestD) continue;
      if ((fwdX * dx + fwdZ * dz) / (d || 1) < 0.35) continue;  // must look at it
      best = s; bestD = d;
    }
    return best;
  }

  // Returns { cameraOverride, prompt, blockMovement }
  update(player, input, dt, tSec) {
    for (const s of this._screens) s.animateLights(tSec);

    const eatEsc = () => { const v = this._escape; this._escape = false; return v; };

    if (this._state === 'idle') {
      eatEsc();
      const cand = this._candidate(player);
      if (cand && input.consumeInteract()) {
        this._active = cand;
        this._from = {
          pos:    { x: player.x, y: EYE_Y, z: player.y },
          target: { x: player.x + Math.cos(player.angle), y: EYE_Y, z: player.y + Math.sin(player.angle) },
        };
        this._u = 0;
        this._state = 'in';
        return { cameraOverride: this._from, prompt: '', blockMovement: true };
      }
      this._drawAll(false, tSec);
      return {
        cameraOverride: null,
        prompt: cand ? `[ E ] ACCÉDER — ${cand.def.title}` : '',
        blockMovement: false,
      };
    }

    if (this._state === 'in' || this._state === 'out') {
      this._u = Math.min(1, this._u + dt / FOCUS_TIME);
      const goingIn = this._state === 'in';
      const u = goingIn ? smooth(this._u) : smooth(1 - this._u);
      const cam = this._blend(this._from, this._active.focusPose, u);
      this._active.terminal.draw({ focused: goingIn, t: tSec });
      if (this._u >= 1) this._state = goingIn ? 'focused' : 'idle';
      return { cameraOverride: cam, prompt: '', blockMovement: true };
    }

    // focused
    const exit = input.consumeInteract() || eatEsc();
    if (exit) { this._u = 0; this._state = 'out'; }
    else {
      const next = input.backward || input.rotRight;
      const prev = input.forward  || input.rotLeft;
      if (next && !this._prevNav.next) this._active.terminal.next();
      if (prev && !this._prevNav.prev) this._active.terminal.prev();
      this._prevNav = { next, prev };
    }
    this._active.terminal.draw({ focused: true, t: tSec });
    return { cameraOverride: this._active.focusPose, prompt: '', blockMovement: true };
  }

  _blend(a, b, u) {
    return {
      pos:    { x: lerp(a.pos.x, b.pos.x, u),       y: lerp(a.pos.y, b.pos.y, u),       z: lerp(a.pos.z, b.pos.z, u) },
      target: { x: lerp(a.target.x, b.target.x, u), y: lerp(a.target.y, b.target.y, u), z: lerp(a.target.z, b.target.z, u) },
    };
  }

  _drawAll(focused, tSec) {
    for (const s of this._screens) s.terminal.draw({ focused, t: tSec });
  }
}
