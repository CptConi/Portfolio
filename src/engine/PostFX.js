// "Feel" layer: one full-screen pass (vignette, chromatic aberration, colour flash)
// slotted before the OutputPass, plus a trauma-based camera shake applied after lookAt.
//
// Public surface, exposed as `renderer.fx`:
//   shake(amount 0..1, ms = 600)   impulse that decays linearly to 0 over `ms`;
//                                  displacement scales with amount², overlapping calls add up
//   flash(cssColor, ms = 300, alpha = 0.3)
//                                  screen tint that peaks at `alpha` and fades out; a weaker flash
//                                  cannot cut a stronger one still fading, an invalid colour is ignored
//   setEnabled(bool)               master switch for the pass (the shake is unaffected)
//   setFocused(bool)               relax vignette/aberration while a console fills the view
//
// prefs.reducedMotion: no shake, no flash, no aberration; only the faint static vignette stays.
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { prefs } from './prefs.js';

const VIGNETTE = 0.36;            // corner darkening (linear multiplier) at rest
const VIGNETTE_SHAKE = 0.1;       // extra pinch at full shake
const ABERRATION = 0.005;         // R/B split at rest, in UV at the screen corner
const ABERRATION_SHAKE = 0.011;   // extra split at full shake

const SHAKE_POS = 0.012;          // metres at trauma 1
const SHAKE_ROT = 0.01;           // radians at trauma 1
const MAX_SHAKES = 4;             // concurrent impulses (door slam + rumble + ...)

const SHAKE_MS = 600;
const FLASH_MS = 300;
const FLASH_ALPHA = 0.3;
const FLASH_ATTACK = 0.12;        // share of the duration spent ramping up
const FLASH_GAP = 0.34;           // s: a flash that is not stronger cannot retrigger sooner (< 3 per second)

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// Per-channel frequencies (rad/s) of the two-sine noise driving the shake:
// x, y, pitch, yaw, roll. Incommensurate so the motion never visibly loops.
const FREQ_A = [39, 47, 33, 41, 29];
const FREQ_B = [67, 59, 71, 53, 61];
const noise = (t, i) => 0.6 * Math.sin(t * FREQ_A[i] + i * 1.7) + 0.4 * Math.sin(t * FREQ_B[i] + i * 3.1);

// The flash is blended in a square-root ("perceptual") space: a mix in the linear
// space this pass runs in would turn a 7 % tint into a clearly visible veil on dark pixels.
const PostFXShader = {
  name: 'PostFXShader',
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: VIGNETTE },
    uAberration: { value: 0 },
    uFlashColor: { value: new THREE.Vector3() },
    uFlash: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uAberration;
    uniform vec3 uFlashColor;
    uniform float uFlash;
    varying vec2 vUv;

    void main() {
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      vec4 c = texture2D(tDiffuse, vUv);
      if (uAberration > 0.0) {
        vec2 off = d * (r2 * 2.0 * uAberration);
        c.r = texture2D(tDiffuse, vUv + off).r;
        c.b = texture2D(tDiffuse, vUv - off).b;
      }
      c.rgb *= 1.0 - uVignette * smoothstep(0.06, 0.42, r2);
      if (uFlash > 0.0) {
        c.rgb = mix(sqrt(max(c.rgb, 0.0)), uFlashColor, uFlash);
        c.rgb *= c.rgb;
      }
      gl_FragColor = c;
    }`,
};

export class PostFX {
  constructor() {
    this.pass = new ShaderPass(PostFXShader);
    this._u = this.pass.uniforms;

    this._shakes = Array.from({ length: MAX_SHAKES }, () => ({ amp: 0, age: 0, dur: 1 }));
    this._trauma = 0;
    this._time = 0;
    this._last = null;

    this._flash = { amp: 0, cur: 0, age: Infinity, dur: 1 };   // cur: envelope shown last frame
    this._flashColor = new THREE.Color();

    this._focus = 0;
    this._focusTarget = 0;
    this._enabled = true;
    this._quality = true;

    this.api = Object.freeze({
      shake: (amount, ms) => this._shake(amount, ms),
      flash: (color, ms, alpha) => this._flashStart(color, ms, alpha),
      setEnabled: on => { this._enabled = !!on; this._syncPass(); },
      setFocused: on => { this._focusTarget = on ? 1 : 0; },
    });
  }

  // Adaptive quality (Renderer.setQuality): the pass is dropped with the bloom.
  setQuality(level) {
    this._quality = level >= 1;
    this._syncPass();
  }

  _syncPass() { this.pass.enabled = this._enabled && this._quality; }

  _shake(amount, ms = SHAKE_MS) {
    if (prefs.reducedMotion || !(amount > 0) || !(ms > 0)) return;
    const amp = Math.min(amount, 1);
    const dur = clamp(ms, 50, 8000) / 1000;
    // Reuse a finished slot, else evict the weakest one if the newcomer is stronger.
    let slot = null, weakest = Infinity;
    for (const s of this._shakes) {
      const left = s.amp > 0 ? s.amp * (1 - s.age / s.dur) : -1;
      if (left < weakest) { weakest = left; slot = s; }
    }
    if (amp <= weakest) return;
    slot.amp = amp; slot.age = 0; slot.dur = dur;
  }

  _flashStart(color, ms = FLASH_MS, alpha = FLASH_ALPHA) {
    if (prefs.reducedMotion || typeof color !== 'string' || !(ms > 0) || !(alpha > 0)) return;
    const f = this._flash;
    const amp = Math.min(alpha, 1);
    // A weaker flash never cuts a stronger one: not during its peak window, nor while its
    // envelope (as last shown by update()) is still above the newcomer's peak.
    if (amp <= f.cur || (f.age < FLASH_GAP && amp <= f.amp)) return;
    // Color.set() only warns and keeps its previous value on an unknown string: poison the
    // channels first so a bad colour is detected and ignored instead of replaying a stale one.
    const c = this._flashColor.setRGB(-1, -1, -1).set(color);
    if (c.r < 0) return;
    this._u.uFlashColor.value.set(Math.sqrt(c.r), Math.sqrt(c.g), Math.sqrt(c.b));
    f.amp = amp; f.cur = 0; f.age = 0; f.dur = clamp(ms, 40, 3000) / 1000;
  }

  // Once per frame, before the camera is placed.
  update(tSec) {
    const dt = this._last === null ? 0 : clamp(tSec - this._last, 0, 0.1);
    this._last = tSec;
    this._time += dt;
    const calm = prefs.reducedMotion;

    let trauma = 0;
    for (const s of this._shakes) {
      if (s.amp <= 0) continue;
      s.age += dt;
      if (calm || s.age >= s.dur) s.amp = 0;
      else trauma += s.amp * (1 - s.age / s.dur);
    }
    this._trauma = Math.min(trauma, 1);
    const shake = this._trauma * this._trauma;

    const f = this._flash;
    f.age += dt;
    let flash = 0;
    if (!calm && f.age < f.dur) {
      const k = f.age / f.dur;
      flash = f.amp * (k < FLASH_ATTACK ? k / FLASH_ATTACK : ((1 - k) / (1 - FLASH_ATTACK)) ** 2);
    }
    f.cur = flash;

    this._focus += (this._focusTarget - this._focus) * (1 - Math.exp(-dt * 6));
    const u = this._u;
    u.uVignette.value = VIGNETTE * (1 - 0.5 * this._focus) + (calm ? 0 : VIGNETTE_SHAKE * shake);
    u.uAberration.value = calm ? 0 : ABERRATION * (1 - 0.6 * this._focus) + ABERRATION_SHAKE * shake;
    u.uFlash.value = flash;
  }

  // Jitter in camera space; must run after lookAt so it also works with a camera override.
  applyToCamera(camera) {
    const s = this._trauma * this._trauma;
    if (s < 1e-5) return;
    const t = this._time;
    camera.translateX(SHAKE_POS * s * noise(t, 0));
    camera.translateY(SHAKE_POS * s * noise(t, 1));
    camera.rotateX(SHAKE_ROT * 0.8 * s * noise(t, 2));
    camera.rotateY(SHAKE_ROT * 0.8 * s * noise(t, 3));
    camera.rotateZ(SHAKE_ROT * s * noise(t, 4));
  }
}
