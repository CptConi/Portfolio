const TEX_SIZE = 64;

function makeTexture(drawFn) {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_SIZE;
  canvas.height = TEX_SIZE;
  const ctx = canvas.getContext('2d');
  drawFn(ctx);
  return ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE);
}

function setPixel(data, x, y, r, g, b) {
  const i = (y * TEX_SIZE + x) * 4;
  data[i] = r; data[i+1] = g; data[i+2] = b; data[i+3] = 255;
}

// Stone brick wall — corridor
function makeBrickTexture() {
  return makeTexture(ctx => {
    const data = ctx.createImageData(TEX_SIZE, TEX_SIZE);
    for (let y = 0; y < TEX_SIZE; y++) {
      for (let x = 0; x < TEX_SIZE; x++) {
        const row = Math.floor(y / 10);
        const offset = (row % 2) * 20;
        const isMortar = y % 10 <= 1 || ((x + offset) % 20 <= 1);
        let r, g, b;
        if (isMortar) {
          r = 30; g = 28; b = 25;
        } else {
          const shade = ((row + Math.floor((x + offset) / 20)) % 3);
          const base = [70, 60, 55, 80, 65, 58, 65, 55, 50][shade * 3];
          const noise = ((x * 7 + y * 13) % 8) - 4;
          r = base + noise; g = (base - 10) + noise; b = (base - 20) + noise;
        }
        setPixel(data.data, x, y, r, g, b);
      }
    }
    ctx.putImageData(data, 0, 0);
  });
}

// Tech panel wall — skills room (green)
function makeTechTexture() {
  return makeTexture(ctx => {
    const data = ctx.createImageData(TEX_SIZE, TEX_SIZE);
    for (let y = 0; y < TEX_SIZE; y++) {
      for (let x = 0; x < TEX_SIZE; x++) {
        const isGrid = x % 16 === 0 || y % 8 === 0;
        const isGlow = x % 16 === 1 || y % 8 === 1;
        let r, g, b;
        if (isGrid) {
          r = 10; g = 30; b = 10;
        } else if (isGlow) {
          r = 20; g = 80; b = 20;
        } else {
          const panel = Math.floor(x / 16) + Math.floor(y / 8) * 4;
          const dark = panel % 3 === 0;
          r = dark ? 15 : 25; g = dark ? 45 : 60; b = dark ? 15 : 20;
        }
        setPixel(data.data, x, y, r, g, b);
      }
    }
    ctx.putImageData(data, 0, 0);
  });
}

// Industrial metal — projects room (orange/brown)
function makeMetalTexture() {
  return makeTexture(ctx => {
    const data = ctx.createImageData(TEX_SIZE, TEX_SIZE);
    for (let y = 0; y < TEX_SIZE; y++) {
      for (let x = 0; x < TEX_SIZE; x++) {
        const isRivet = (x % 16 === 8 && y % 16 === 8);
        const isSeam = x % 16 === 0 || y % 16 === 0;
        let r, g, b;
        if (isRivet) {
          r = 200; g = 140; b = 40;
        } else if (isSeam) {
          r = 30; g = 20; b = 10;
        } else {
          const noise = ((x * 3 + y * 7) % 10) - 5;
          r = 90 + noise; g = 60 + noise; b = 30 + noise;
        }
        setPixel(data.data, x, y, r, g, b);
      }
    }
    ctx.putImageData(data, 0, 0);
  });
}

// Dark stone with purple tint — passions room
function makePurpleTexture() {
  return makeTexture(ctx => {
    const data = ctx.createImageData(TEX_SIZE, TEX_SIZE);
    for (let y = 0; y < TEX_SIZE; y++) {
      for (let x = 0; x < TEX_SIZE; x++) {
        const row = Math.floor(y / 10);
        const offset = (row % 2) * 20;
        const isMortar = y % 10 <= 1 || ((x + offset) % 20 <= 1);
        let r, g, b;
        if (isMortar) {
          r = 25; g = 10; b = 35;
        } else {
          const noise = ((x * 5 + y * 11) % 10) - 5;
          r = 55 + noise; g = 20 + noise; b = 75 + noise;
        }
        setPixel(data.data, x, y, r, g, b);
      }
    }
    ctx.putImageData(data, 0, 0);
  });
}

export class TextureManager {
  constructor() {
    this.textures = {
      1: makeBrickTexture(),   // corridor wall
      2: makeTechTexture(),    // skills room wall
      3: makeMetalTexture(),   // projects room wall
      4: makePurpleTexture(),  // passions room wall
    };
    this.size = TEX_SIZE;
  }

  // Returns RGBA pixel at (tx, ty) from texture for wall type
  getPixel(wallType, tx, ty) {
    const tex = this.textures[wallType] || this.textures[1];
    const x = Math.min(Math.max(tx, 0), this.size - 1);
    const y = Math.min(Math.max(ty, 0), this.size - 1);
    const i = (y * this.size + x) * 4;
    return [tex.data[i], tex.data[i+1], tex.data[i+2]];
  }
}
