#!/usr/bin/env node
/**
 * extract-wad-textures.js
 *
 * Extracts graphic lumps from a Doom WAD file and exports them as PNG.
 * Supports: Doom Picture Format, embedded PNG (ZDoom/GZDoom), raw flats.
 *
 * Usage:
 *   node scripts/extract-wad-textures.js <file.wad> [output-dir]
 *
 * No npm dependencies — Node.js built-ins only (fs, path, zlib).
 */

import fs   from 'fs';
import path from 'path';
import zlib from 'zlib';

// ── WAD header + directory ────────────────────────────────────────────────────

function parseWAD(buf) {
  const magic = buf.toString('ascii', 0, 4);
  if (magic !== 'IWAD' && magic !== 'PWAD')
    throw new Error(`Not a WAD file (magic: "${magic}")`);

  const numLumps  = buf.readInt32LE(4);
  const dirOffset = buf.readInt32LE(8);
  const lumps = [];

  for (let i = 0; i < numLumps; i++) {
    const base   = dirOffset + i * 16;
    const offset = buf.readInt32LE(base);
    const size   = buf.readInt32LE(base + 4);
    let   name   = '';
    for (let j = 0; j < 8; j++) {
      const c = buf[base + 8 + j];
      if (!c) break;
      name += String.fromCharCode(c);
    }
    lumps.push({ name, offset, size });
  }
  return lumps;
}

// ── Palette (PLAYPAL lump — first of 14 palettes) ────────────────────────────

function extractPalette(buf, lumps) {
  const lump = lumps.find(l => l.name === 'PLAYPAL');
  if (!lump) return null;
  return Array.from({ length: 256 }, (_, i) => {
    const o = lump.offset + i * 3;
    return [buf[o], buf[o + 1], buf[o + 2]];
  });
}

// ── Doom Picture Format decoder ───────────────────────────────────────────────
// Column-based RLE with palette indices. Black pixels stay transparent.

function decodePicture(data, palette) {
  if (data.length < 8) return null;

  const width  = data.readUInt16LE(0);
  const height = data.readUInt16LE(2);
  if (width < 1 || height < 1 || width > 4096 || height > 4096) return null;
  if (data.length < 8 + width * 4) return null;

  // Verify first column offset looks sane before committing
  const firstCol = data.readUInt32LE(8);
  if (firstCol >= data.length || firstCol < 8 + width * 4) return null;

  const pixels = Buffer.alloc(width * height * 4, 0); // RGBA, default transparent

  for (let col = 0; col < width; col++) {
    const colOffset = data.readUInt32LE(8 + col * 4);
    if (colOffset >= data.length) return null;

    let pos = colOffset;
    while (pos < data.length) {
      const rowStart = data[pos++];
      if (rowStart === 0xFF) break;
      if (pos >= data.length) break;
      const count = data[pos++];
      pos++; // top dummy byte
      for (let i = 0; i < count; i++) {
        if (pos >= data.length) break;
        const idx = data[pos++];
        const row = rowStart + i;
        if (row >= height) continue;
        const p = (row * width + col) * 4;
        const [r, g, b] = palette[idx] ?? [0, 0, 0];
        pixels[p] = r; pixels[p + 1] = g; pixels[p + 2] = b; pixels[p + 3] = 255;
      }
      pos++; // bottom dummy byte
    }
  }

  return { width, height, pixels };
}

// ── Flat decoder (raw paletted bitmap — 64×64 or 128×128) ────────────────────

function decodeFlat(data, palette) {
  const size = data.length === 64 * 64 ? 64 : data.length === 128 * 128 ? 128 : null;
  if (!size) return null;
  const pixels = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const [r, g, b] = palette[data[i]] ?? [0, 0, 0];
    pixels[i * 4] = r; pixels[i * 4 + 1] = g; pixels[i * 4 + 2] = b; pixels[i * 4 + 3] = 255;
  }
  return { width: size, height: size, pixels };
}

// ── PNG writer (zero deps — RFC 2083 via Node's built-in zlib) ───────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.allocUnsafe(4); len.writeUInt32BE(data.length);
  const crc = Buffer.allocUnsafe(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function writePNG(width, height, pixels, filepath) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width,  0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA, no interlace

  // Filter type 0 (None) prepended to each scanline
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  fs.writeFileSync(filepath, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]));
}

// ── Lump classification ───────────────────────────────────────────────────────

const NON_GRAPHIC = new Set([
  'THINGS','LINEDEFS','SIDEDEFS','VERTEXES','SEGS','SSECTORS','NODES',
  'SECTORS','REJECT','BLOCKMAP','BEHAVIOR','SCRIPTS','DIALOGUE',
  'PLAYPAL','COLORMAP','ENDOOM','DMXGUS','GENMIDI','SNDINFO','MAPINFO',
  'TEXTURE1','TEXTURE2','PNAMES','ANIMATED','SWITCHES','DECALDEF',
  'LOADACS','LANGUAGE','FONTDEFS','SBARINFO',
]);

function classifyLumps(lumps) {
  const out = [];
  let inFlats = false;

  for (const lump of lumps) {
    // Namespace markers (zero-size)
    if (/^[A-Z0-9_]+_(START|END)$/.test(lump.name)) {
      inFlats = /^F/.test(lump.name); // F_START, FF_START, etc.
      continue;
    }
    if (lump.size === 0)                         continue;
    if (NON_GRAPHIC.has(lump.name))              continue;
    if (/^(E\dM\d|MAP\d\d)$/.test(lump.name))   continue; // map markers

    out.push({ ...lump, isFlat: inFlats });
  }
  return out;
}

// ── Main ─────────────────────────────────────────────────────────────────────

const [,, wadPath, outDir = 'wad-textures'] = process.argv;

if (!wadPath) {
  console.error('Usage: node scripts/extract-wad-textures.js <file.wad> [output-dir]');
  process.exit(1);
}

if (!fs.existsSync(wadPath)) {
  console.error(`File not found: ${wadPath}`);
  process.exit(1);
}

const buf = fs.readFileSync(wadPath);
let lumps;
try { lumps = parseWAD(buf); } catch (e) { console.error(e.message); process.exit(1); }

let palette = extractPalette(buf, lumps);
if (!palette) {
  console.warn('⚠  No PLAYPAL lump — greyscale fallback');
  palette = Array.from({ length: 256 }, (_, i) => [i, i, i]);
}

fs.mkdirSync(outDir, { recursive: true });
console.log(`WAD: ${path.basename(wadPath)}  (${lumps.length} lumps)\nOutput: ${outDir}/\n`);

let ok = 0, skip = 0;

for (const lump of classifyLumps(lumps)) {
  const data    = buf.subarray(lump.offset, lump.offset + lump.size);
  const outPath = path.join(outDir, lump.name + '.png');
  let   img     = null;

  // Embedded PNG (ZDoom / GZDoom texture namespace)
  if (data[0] === 0x89 && data[1] === 0x50) {
    fs.writeFileSync(outPath, data);
    console.log(`  [PNG embedded]  ${lump.name}`);
    ok++;
    continue;
  }

  // Flat (raw paletted — inside F_ namespace or matches flat size)
  if (lump.isFlat || data.length === 4096 || data.length === 16384)
    img = decodeFlat(data, palette);

  // Doom Picture Format (patches, sprites, wall graphics)
  if (!img) img = decodePicture(data, palette);

  // Flat fallback if picture decode failed
  if (!img) img = decodeFlat(data, palette);

  if (img) {
    writePNG(img.width, img.height, img.pixels, outPath);
    console.log(`  [ok]  ${lump.name.padEnd(12)}  ${img.width}×${img.height}`);
    ok++;
  } else {
    skip++;
  }
}

console.log(`\n${ok} exported, ${skip} skipped  →  ${outDir}/`);
