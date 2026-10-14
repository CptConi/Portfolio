import * as THREE from 'three';
import { Pix } from '../props/pixels.js';
import { noise } from '../props/dither.js';
import { SUN, GROUND, paintGround } from '../props/sky.js';

// The ground of the exterior world: the lunar plain, the low drifts of regolith at the foot of the hulls (hulls.js bermsOf), and the helpers that
// give every lit material of the exterior the same pixel-art finish (ordered-dithered fog). The plain's painted tile and macro map can be made
// later (buildTerrain({ defer }) then paint(): a flat grey tile until then); Exterior.js does so from the browser's idle time.
//
//   · The plain is ONE quad that follows the camera, snapped to the regolith tile so the tile never swims. It is lit by the one sun
//     like everything else (Lambert, real shadow map), but its normals are not (0, 1, 0): they point AT the sun, so the painted tile
//     (props/sky.js paintGround, whose relief is already shaded) keeps its painted brightness instead of being dimmed by the 15° sun
//     to a quarter, while the shadow map still cuts hard black shapes in it.
//   · A non-repeating "macro" map (128 m square, 256 texels, painted here, deterministic) multiplies the tile: big craters, ejecta, albedo
//     patches, so the 10 m tile does not read as a lattice. It is quantised and dithered in the shader (no smooth gradients).
//   · Near the camera a world-space grain (2 cm cells) breaks the 8 cm texels of the tile, and fades out before it can shimmer.
//   · The lit colour is cut into a few grey steps and ordered-dithered, then the fog melts it into HORIZON in dithered steps.

const D2R = Math.PI / 180;

export const MACRO = { size: 128, res: 256 };   // world metres covered by the macro map, texels per side (0.5 m per texel: the craters are 2 m and more)

// Ordered-dither threshold of this game pixel, shared by every patch below. `uPx` = screen pixels per game pixel.
export const BAYER_GLSL = /* glsl */`
uniform float uPx;
const float EB4[16] = float[16](0.5, 8.5, 2.5, 10.5, 12.5, 4.5, 14.5, 6.5, 3.5, 11.5, 1.5, 9.5, 15.5, 7.5, 13.5, 5.5);
float extBayer() {
  ivec2 q = ivec2(mod(floor(gl_FragCoord.xy / uPx), 4.0));
  return EB4[q.y * 4 + q.x] / 16.0;
}`;

// Replaces three's linear-ish smooth fog by six dithered steps: no gradient, no banding the eye can follow.
const FOG_STEPS = /* glsl */`
#ifdef USE_FOG
  float fogK = smoothstep( fogNear, fogFar, vFogDepth );
  fogK = clamp( floor( fogK * 6.0 + extBayer() ) / 6.0, 0.0, 1.0 );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogK );
#endif`;

// Dithered fog for any MeshLambert / MeshBasic material of the exterior scene (the props dresser gets it as ctx.pixelFog).
export function pixelFog(material, look) {
  if (material.userData.pixelFog) return material;
  material.userData.pixelFog = true;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    shader.uniforms.uPx = look.uPx;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${BAYER_GLSL}`)
      .replace('#include <fog_fragment>', FOG_STEPS);
  };
  const prevKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${prevKey.call(material)}|ext-fog`;
  return material;
}

// ── Deterministic bits ────────────────────────────────────────────────────────────────────────────
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// ── The macro map ─────────────────────────────────────────────────────────────────────────────────
// R = brightness (0.5 = the tile as painted), shaded by the real Sun: slopes that face it are lit, the far inner walls of craters are
// dark. `keep` = rectangles ({ x0, x1, z0, z1 } in metres) the craters must stay clear of (the base and its berms).
export function paintMacro(p, { cx, cz, keep = [] }) {
  const N = p.w, size = MACRO.size, cell = size / N;
  const ox = cx - size / 2, oz = cz - size / 2;
  const H = new Float32Array(N * N), A = new Float32Array(N * N);
  const rand = rng(90210);
  const L = [Math.cos(SUN.az * D2R), Math.sin(SUN.az * D2R)];

  const crater = (wx, wz, r, young) => {
    const depth = r * (r > 4 ? 0.11 : 0.17), rimH = r * 0.075, reach = r * 2.6;
    const x0 = Math.max(0, Math.floor((wx - reach - ox) / cell)), x1 = Math.min(N - 1, Math.ceil((wx + reach - ox) / cell));
    const z0 = Math.max(0, Math.floor((wz - reach - oz) / cell)), z1 = Math.min(N - 1, Math.ceil((wz + reach - oz) / cell));
    for (let iz = z0; iz <= z1; iz++) {
      for (let ix = x0; ix <= x1; ix++) {
        const d = Math.hypot(ox + (ix + 0.5) * cell - wx, oz + (iz + 0.5) * cell - wz) / r;
        let h = 0, a = 0;
        if (d < 1) { const b = 1 - d * d; h = -depth * (b > 0.4 ? 0.4 + (b - 0.4) * 0.8 : b); a = -0.05 * b; }
        h += rimH * Math.exp(-Math.pow((d - 1) / 0.17, 2));
        if (d >= 1) { h += rimH * 0.35 * Math.exp(-(d - 1) / 0.9); if (young) a += 0.2 * Math.exp(-Math.pow((d - 1.3) / 0.9, 2)); }
        H[iz * N + ix] += h; A[iz * N + ix] += a;
      }
    }
  };
  const free = (x, z, r) => keep.every(k => x + r < k.x0 || x - r > k.x1 || z + r < k.z0 || z - r > k.z1);
  const placed = [];
  const place = (n, rMin, rMax, young, spread) => {
    for (let i = 0, tries = 0; i < n && tries < 600; tries++) {
      const r = rMin + (rMax - rMin) * rand();
      const wx = cx + (rand() * 2 - 1) * spread, wz = cz + (rand() * 2 - 1) * spread;
      if (!free(wx, wz, r * 1.6)) continue;
      if (placed.some(q => Math.hypot(q[0] - wx, q[1] - wz) < (q[2] + r) * 0.9)) continue;
      placed.push([wx, wz, r]);
      crater(wx, wz, r, rand() < young);
      i++;
    }
  };
  place(4, 6, 11, 0.4, 56);       // big ones, mostly far away
  place(9, 2.6, 5, 0.4, 50);
  place(18, 1.1, 2.3, 0.3, 36);   // small ones, thickest near the base (the tile brings its own pits)

  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) {
      const i = iz * N + ix, wx = ox + (ix + 0.5) * cell, wz = oz + (iz + 0.5) * cell;
      // slope facing the Sun (central differences, edges clamped)
      const hx = (H[iz * N + Math.min(N - 1, ix + 1)] - H[iz * N + Math.max(0, ix - 1)]) / (2 * cell);
      const hz = (H[Math.min(N - 1, iz + 1) * N + ix] - H[Math.max(0, iz - 1) * N + ix]) / (2 * cell);
      const relief = -(hx * L[0] + hz * L[1]);
      let v = 0.5 + relief * 1.2 + A[i];
      v += (noise(wx / 18, wz / 18, 31) - 0.5) * 0.2 + (noise(wx / 5, wz / 5, 32) - 0.5) * 0.1;
      // fade to the neutral tile at the edge of the map (sampling clamps there)
      const edge = Math.min(ix, iz, N - 1 - ix, N - 1 - iz) * cell;
      v = 0.5 + (v - 0.5) * smooth(0, 10, edge);
      const g = Math.round(clamp(v) * 255);
      p.set(ix, iz, (g << 16) | (g << 8) | g);
    }
  }
}

// ── The ground ────────────────────────────────────────────────────────────────────────────────────
function lambertPatched(look, { map, color, refs, macroOrigin }) {
  const mat = new THREE.MeshLambertMaterial({ map, color });
  mat.onBeforeCompile = shader => {
    shader.uniforms.uPx = look.uPx;
    shader.uniforms.uTileMean = refs.uTileMean;   // (uniform objects of the terrain: the painted tile and macro map are swapped in later)
    shader.uniforms.tMacro = refs.tMacro;
    shader.uniforms.uMacro = { value: new THREE.Vector3(macroOrigin[0], macroOrigin[1], MACRO.size) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWxz;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWxz = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${BAYER_GLSL}\nvarying vec2 vWxz;\nuniform sampler2D tMacro;\nuniform vec3 uMacro;
        uniform float uTileMean;
        float gHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          float mv = texture2D( tMacro, ( vWxz - uMacro.xy ) / uMacro.z ).r;
          mv = floor( mv * 9.0 + extBayer() ) / 9.0;
          float dist = length( vViewPosition );
          float near = 1.0 - smoothstep( 3.0, 10.0, dist );
          float grain = gHash( floor( vWxz * 48.0 ) );
          // the same tile again, 3.7 times finer, as a brightness detail close to the camera (the 8 cm texels of the tile alone are 20 px wide at 2 m)
          float dl = dot( texture2D( map, vMapUv * 3.7 + vec2( 0.37, 0.61 ) ).rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
          float detail = mix( 1.0, clamp( dl / uTileMean, 0.5, 1.7 ), 0.85 * ( 1.0 - smoothstep( 4.0, 14.0, dist ) ) );
          diffuseColor.rgb *= ( 0.35 + 1.3 * mv ) * detail * ( 1.0 + ( grain - 0.5 ) * 0.3 * near );
        }`)
      .replace('#include <fog_fragment>', `
        {
          float lg = max( dot( gl_FragColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-5 );
          gl_FragColor.rgb *= pow( floor( pow( lg, 0.4545 ) * 12.0 + extBayer() ) / 12.0, 2.2 ) / lg;
        }
        ${FOG_STEPS}`);
  };
  mat.customProgramCacheKey = () => 'ext-ground';
  return mat;
}

// Ground tile texture coordinates: the tile is mirrored in x so that the light painted into its relief (upper left) comes from the
// side the real Sun does (+x, +z).
const gu = x => -x / GROUND.meters, gv = z => z / GROUND.meters;

// `defer`: the ground is painted later (paint(), once, from an idle slice): until then the plain is one flat grey tile and a neutral macro map.
export function buildTerrain({ look, sunDir, groundY, center, keep, defer = false }) {
  const _now = () => (typeof performance !== 'undefined' ? performance.now() : 0), timing = {};
  let _t = _now();
  const lap = k => { const n = _now(); timing[k] = +(n - _t).toFixed(1); _t = n; };

  // the painted textures: made now, or by paint()
  const LIN = new Float32Array(256);
  for (let c = 0; c < 256; c++) { const v = c / 255; LIN[c] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  const meanOf = data => {   // mean luminance (linear) of a tile, so that the fine detail layer modulates without shifting the brightness
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += 0.2126 * LIN[data[i]] + 0.7152 * LIN[data[i + 1]] + 0.0722 * LIN[data[i + 2]];
    return sum / (data.length / 4);
  };
  const makeTile = () => {
    const tilePix = new Pix(GROUND.w, GROUND.h);
    paintGround(tilePix);
    lap('paintGround');
    const tex = tilePix.toTexture({ mip: true });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    return { tex, mean: meanOf(tilePix.data) };
  };
  const makeMacro = () => {
    const macroPix = new Pix(MACRO.res, MACRO.res);
    paintMacro(macroPix, { cx: center.x, cz: center.z, keep });
    lap('paintMacro');
    const tex = new THREE.DataTexture(macroPix.data, MACRO.res, MACRO.res, THREE.RGBAFormat);
    tex.colorSpace = THREE.NoColorSpace;
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  };
  const grey = (r, g, b, srgb) => {
    const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1, THREE.RGBAFormat);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    return t;
  };
  let painted = !defer, tileTex, macroTex, tileMean;
  if (defer) {
    tileTex = grey(104, 100, 94, true); tileMean = meanOf(new Uint8Array([104, 100, 94, 255]));
    macroTex = grey(128, 128, 128, false);
  } else {
    ({ tex: tileTex, mean: tileMean } = makeTile());
    macroTex = makeMacro();
    lap('textures');
  }
  const refs = { tMacro: { value: macroTex }, uTileMean: { value: tileMean } };

  const material = lambertPatched(look, { map: tileTex, color: 0xffffff, refs, macroOrigin: [center.x - MACRO.size / 2, center.z - MACRO.size / 2] });

  // The plain: one big quad, normals aimed at the sun (see the header). It is snapped to a whole number of tiles, so its uv (local
  // position / tile) is the world's.
  const S = 128;
  const geo = new THREE.PlaneGeometry(S, S).rotateX(-Math.PI / 2);
  const P = geo.attributes.position, N = geo.attributes.normal, U = geo.attributes.uv;
  for (let i = 0; i < P.count; i++) {
    U.setXY(i, gu(P.getX(i)), gv(P.getZ(i)));
    N.setXYZ(i, sunDir.x, sunDir.y, sunDir.z);
  }
  const plain = new THREE.Mesh(geo, material);
  plain.name = 'exterior:ground';
  plain.frustumCulled = false;
  plain.userData.noCast = true;
  plain.position.y = groundY;

  lap('mesh');
  return {
    plain, material, timing,
    get tileTex() { return tileTex; }, get macroTex() { return macroTex; },
    // paints the real ground and swaps it in (only for a deferred terrain)
    paint() {
      if (painted) return;
      painted = true;
      _t = _now();
      const old = [tileTex, macroTex];
      ({ tex: tileTex, mean: tileMean } = makeTile());
      macroTex = makeMacro();
      material.map = tileTex;
      refs.tMacro.value = macroTex;
      refs.uTileMean.value = tileMean;
      for (const t of old) t.dispose();
      lap('swap');
    },
    follow(x, z) {
      plain.position.x = Math.round(x / GROUND.meters) * GROUND.meters;
      plain.position.z = Math.round(z / GROUND.meters) * GROUND.meters;
    },
    dispose() { geo.dispose(); material.dispose(); tileTex.dispose(); macroTex.dispose(); },
  };
}

// ── Berms (the drifts) ─────────────────────────────────────────────────────────────────────────────
// A berm is a skirt of regolith around a block: its top edge runs along the block's footprint, a little over the plain (hulls.js DRIFT_H), and it slopes down
// to the plain over `e` metres on each side that is not an alley (e = 0: no berm on that side). The sides are mitred, so the skirt is
// watertight. Each entry of `berms` = { x0, x1, z0, z1, topY, e: { n, s, e, w } }, in the exterior's world coordinates.
export function buildBerms({ berms, groundY, material }) {
  const pos = [], nor = [], uv = [], idx = [];
  const tri = (a, b, c) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const base = pos.length / 3;
    for (const q of [a, b, c]) { pos.push(q[0], q[1], q[2]); nor.push(nx, ny, nz); uv.push(gu(q[0]), gv(q[2])); }
    idx.push(base, base + 1, base + 2);
  };
  // `up` = the normal must point up: swap the winding when it does not (saves hand-checking every corner)
  const quad = (a, b, c, d) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const ny = uz * vx - ux * vz;
    if (ny >= 0) { tri(a, b, c); tri(a, c, d); } else { tri(a, c, b); tri(a, d, c); }
  };
  // A triangle whose normal must point along (nx, nz): the end cap of a side that stops where its neighbour has no berm.
  const cap = (a, b, c, nx, nz) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const dot = (uy * vz - uz * vy) * nx + (ux * vy - uy * vx) * nz;
    if (dot >= 0) tri(a, b, c); else tri(a, c, b);
  };
  for (const B of berms) {
    const { x0, x1, z0, z1, topY } = B, y0 = groundY;
    const e = { n: B.e.n ?? 0, s: B.e.s ?? 0, w: B.e.w ?? 0, e: B.e.e ?? 0 };
    const ix0 = x0, ix1 = x1, iz0 = z0, iz1 = z1;                      // inner rectangle (top edge)
    const ox0 = x0 - e.w, ox1 = x1 + e.e, oz0 = z0 - e.n, oz1 = z1 + e.s;   // outer rectangle (on the plain)
    const T = (x, z) => [x, topY, z], G = (x, z) => [x, y0, z];
    if (e.n > 0) {
      quad(G(ox0, oz0), G(ox1, oz0), T(ix1, iz0), T(ix0, iz0));
      if (e.w === 0) cap(G(x0, oz0), T(x0, z0), G(x0, z0), -1, 0);
      if (e.e === 0) cap(G(x1, oz0), T(x1, z0), G(x1, z0), 1, 0);
    }
    if (e.s > 0) {
      quad(G(ox0, oz1), T(ix0, iz1), T(ix1, iz1), G(ox1, oz1));
      if (e.w === 0) cap(G(x0, oz1), T(x0, z1), G(x0, z1), -1, 0);
      if (e.e === 0) cap(G(x1, oz1), T(x1, z1), G(x1, z1), 1, 0);
    }
    if (e.w > 0) {
      quad(G(ox0, oz0), T(ix0, iz0), T(ix0, iz1), G(ox0, oz1));
      if (e.n === 0) cap(G(ox0, z0), T(x0, z0), G(x0, z0), 0, -1);
      if (e.s === 0) cap(G(ox0, z1), T(x0, z1), G(x0, z1), 0, 1);
    }
    if (e.e > 0) {
      quad(G(ox1, oz0), G(ox1, oz1), T(ix1, iz1), T(ix1, iz0));
      if (e.n === 0) cap(G(ox1, z0), T(x1, z0), G(x1, z0), 0, -1);
      if (e.s === 0) cap(G(ox1, z1), T(x1, z1), G(x1, z1), 0, 1);
    }
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, material);
  mesh.name = 'exterior:berms';
  mesh.matrixAutoUpdate = false;
  return mesh;
}
