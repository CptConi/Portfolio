import * as THREE from 'three';
import { Pix } from '../props/pixels.js';
import * as SKYMOD from '../props/sky.js';

// The sky dome of the exterior world: a sphere centred on the camera that shows props/sky.js (ONE equirectangular sphere: x = heading
// 0..360°, row 0 = zenith, row 256 = horizon) by view direction. It is drawn first, without depth, so everything else covers it; it
// follows the camera's position only (never its rotation), so the Earth, the Sun and the giant stay put in the sky as you walk.
//
// Reading it: texelFetch (nearest by construction, wrapped by hand, no seam at heading 0 / 360, no NaN straight up or down). A row of
// the map is a shrinking circle toward the poles, so a pixel there spans several texels of it: those few taps are averaged.
// A few isolated stars dip now and then (never near a body of SKYMOD.BODIES), unless prefers-reduced-motion.

const D2R = Math.PI / 180;
const MAX_KEEP = 16;

const VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;   // a unit sphere centred on the camera: the interpolated point on a facet IS the view ray, tessellation or not
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4( position, 1.0 );
  }`;

const FRAG = /* glsl */`
  uniform sampler2D tSky;
  uniform vec2 uSky;            // sky texture size (texels)
  uniform float uTime;
  uniform float uTwinkle;       // 0 when prefers-reduced-motion
  uniform vec4 uKeep[${MAX_KEEP}];   // xyz = unit direction of a body, w = cos of its keep-out cone: no twinkle inside
  uniform int uKeepN;
  varying vec3 vDir;

  const float PI = 3.14159265359;

  float luma( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }
  float hash12( vec2 p ) { return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }

  ivec2 skyTexel( ivec2 p ) {
    int w = int( uSky.x ), h = int( uSky.y );
    return ivec2( ( p.x + w ) % w, clamp( p.y, 0, h - 1 ) );   // p.x >= -1: a % with a negative operand is undefined in GLSL ES
  }
  vec3 skyFetch( ivec2 p ) { return texelFetch( tSky, skyTexel( p ), 0 ).rgb; }

  bool nearBody( vec3 d ) {
    for ( int i = 0; i < ${MAX_KEEP}; i++ ) {
      if ( i >= uKeepN ) break;
      if ( dot( d, uKeep[ i ].xyz ) > uKeep[ i ].w ) return true;
    }
    return false;
  }

  void main() {
    vec3 d = normalize( vDir );
    float pix = max( length( dFdx( d ) ), length( dFdy( d ) ) );   // angle of one screen pixel (rad), before any branch
    float az = dot( d.xz, d.xz ) > 1e-8 ? atan( d.z, d.x ) : 0.0;
    float el = asin( clamp( d.y, -1.0, 1.0 ) );
    float u = az / ( 2.0 * PI );
    float v = clamp( 0.5 + el / PI, 0.5 / uSky.y, 1.0 - 0.5 / uSky.y );   // texture rows grow upward; the rows below the horizon hold HORIZON
    int row = int( floor( v * uSky.y ) );
    float foot = pix / max( cos( el ), 0.02 ) * uSky.x / ( 2.0 * PI );             // texels of the row under one pixel
    vec3 c;
    if ( foot > 1.0 ) {
      int n = int( clamp( ceil( foot ), 2.0, 8.0 ) );
      vec3 sum = vec3( 0.0 );
      for ( int i = 0; i < 8; i++ ) {
        if ( i >= n ) break;
        float o = ( ( float( i ) + 0.5 ) / float( n ) - 0.5 ) * foot;
        sum += skyFetch( ivec2( int( floor( fract( u + o / uSky.x ) * uSky.x ) ), row ) );
      }
      c = sum / float( n );
    } else {
      ivec2 tc = ivec2( int( floor( fract( u ) * uSky.x ) ), row );
      c = skyFetch( tc );
      if ( uTwinkle > 0.5 && el > 0.05 ) {
        float l = luma( c );
        if ( l > 0.15 && !nearBody( d ) ) {
          float nm = 0.0;
          for ( int j = -1; j <= 1; j++ ) for ( int i = -1; i <= 1; i++ ) if ( i != 0 || j != 0 ) nm += luma( skyFetch( tc + ivec2( i, j ) ) );
          if ( nm < 0.45 * l ) {
            float h1 = hash12( vec2( tc ) );
            if ( h1 > 0.4 ) {
              float k = 0.5 + 0.5 * sin( uTime * ( 0.7 + 1.3 * fract( h1 * 7.0 ) ) + h1 * 31.0 );
              c *= 1.0 - 0.55 * step( 0.86, k );
            }
          }
        }
      }
    }
    gl_FragColor = vec4( c, 1.0 );
    #include <colorspace_fragment>
  }`;

// `defer`: the sky is painted later (paint(), once, from an idle slice or from warmUp()): until then the dome's texture is black. The texture is ONE object
// from the start and is filled in place (decor/windows.js keeps a reference to it for its fallback), so nothing has to be swapped. The default paints at once.
export function buildSkyDome({ reducedMotion = false, defer = false } = {}) {
  const { w, h } = SKYMOD.SKY;
  let painted = !defer;
  let texture;
  if (defer) {
    texture = new THREE.DataTexture(new Uint8Array(w * h * 4), w, h, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
  } else {
    const sky = new Pix(w, h);
    SKYMOD.paintSky(sky);
    texture = sky.toTexture();                              // nearest, no mips: the shader reads it with texelFetch
  }
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;

  // Keep-out cones of the twinkle: every documented body (props/sky.js BODIES), or the Earth alone for an older sky.js.
  const bodies = SKYMOD.BODIES ?? [{ az: SKYMOD.EARTH.az, el: SKYMOD.EARTH.el, radius: SKYMOD.EARTH.radius }];
  const keep = [];
  for (const b of bodies) {
    if (keep.length >= MAX_KEEP) break;
    const az = b.az * D2R, el = b.el * D2R, cel = Math.cos(el);
    const cone = Math.min(100, b.radius * 1.8 + 1) * D2R;
    keep.push(new THREE.Vector4(cel * Math.cos(az), Math.sin(el), cel * Math.sin(az), Math.cos(cone)));
  }
  while (keep.length < MAX_KEEP) keep.push(new THREE.Vector4(0, 1, 0, 2));

  const uniforms = {
    tSky: { value: texture },
    uSky: { value: new THREE.Vector2(w, h) },
    uTime: { value: 0 },
    uTwinkle: { value: reducedMotion ? 0 : 1 },
    uKeep: { value: keep },
    uKeepN: { value: Math.min(bodies.length, MAX_KEEP) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG,
    side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false,
  });
  const geometry = new THREE.SphereGeometry(1, 24, 12);
  const dome = new THREE.Mesh(geometry, material);
  dome.name = 'exterior:sky';
  dome.frustumCulled = false;
  dome.renderOrder = -1000;
  dome.userData.noCast = true;

  return {
    dome, uniforms,
    // paints the real sky into the dome's texture (only for a deferred dome; once)
    paint() {
      if (painted) return;
      painted = true;
      const sky = new Pix(w, h);
      SKYMOD.paintSky(sky);
      const stride = w * 4, out = texture.image.data;
      for (let y = 0; y < h; y++) out.set(sky.data.subarray(y * stride, (y + 1) * stride), (h - 1 - y) * stride);   // (as Pix.toTexture: row 0 is the top of the image)
      texture.needsUpdate = true;
    },
    dispose() { geometry.dispose(); material.dispose(); texture.dispose(); },
  };
}
