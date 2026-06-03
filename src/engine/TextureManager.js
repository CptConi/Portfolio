import * as THREE from 'three';

// Texture ID map:
//  1  BRICKDRT  — corridor fallback (écrasé par IDs 20-33)
//  2  TEKGRT01  — skills
//  3  SHAWNT01  — projects
//  4  STONE09   — passions
//  5  GRAYCMP1  — skills accent / props
//  6  WARNWL01  — projects accent / props
//  7  PLATEF1   — passions accent / props
//  8  CREEPNL0  — passions déco (props)
// 20-33  GRAYT01-GRAYT14  — corridor murs (variant par cellule)
// 40  FLOOR78   — sol
// 41  CNCRT1    — plafond base
// 42  TLITE5_2  — plafond lumières

const SOURCES = {
  1:  '/textures/BRICKDRT.png',
  2:  '/textures/TEKGRT01.png',
  3:  '/textures/SHAWNT01.png',
  4:  '/textures/STONE09.png',
  5:  '/textures/GRAYCMP1.png',
  6:  '/textures/WARNWL01.png',
  7:  '/textures/PLATEF1.png',
  8:  '/textures/CREEPNL0.png',
  20: '/textures/GRAYT01.png', 21: '/textures/GRAYT02.png',
  22: '/textures/GRAYT03.png', 23: '/textures/GRAYT04.png',
  24: '/textures/GRAYT05.png', 25: '/textures/GRAYT06.png',
  26: '/textures/GRAYT07.png', 27: '/textures/GRAYT08.png',
  28: '/textures/GRAYT09.png', 29: '/textures/GRAYT10.png',
  30: '/textures/GRAYT11.png', 31: '/textures/GRAYT12.png',
  32: '/textures/GRAYT13.png', 33: '/textures/GRAYT14.png',
  40: '/textures/FLOOR78.png',
  41: '/textures/CNCRT1.png',
  42: '/textures/TLITE5_2.png',
  // Props
  50: '/textures/COMPCT01.png',  // control panel tech (skills)
  51: '/textures/LOCKER01.png',  // lockers (skills)
  52: '/textures/SHAWNT02.png',  // sci-fi panel variant (projects)
  53: '/textures/DARKB01.png',   // dark industrial (passions)
  54: '/textures/SILVCOMP.png',  // silver terminal (skills)
  55: '/textures/WOODB01.png',   // wooden crate
  56: '/textures/METALT1.png',   // metal top surface
  57: '/textures/BRNZGRN1.png',  // bronze-green (passions)
  58: '/textures/COMPSP01.png',  // computer panel variant (skills)
  59: '/textures/BOX_MAT1.png',  // crate
  // 2D billboard prop sprites (Freedoom things)
  100: '/sprites/ELECA0.png',   // tall tech pillar
  101: '/sprites/BAR1A0.png',   // barrel
  102: '/sprites/COL1A0.png',   // column
  103: '/sprites/COL5A0.png',   // column variant
  104: '/sprites/CBRAA0.png',   // candelabra
  105: '/sprites/CANDA0.png',   // candle
  106: '/sprites/TLMPA0.png',   // tech floor lamp
  110: '/sprites/FCANA0.png', 111: '/sprites/FCANB0.png', 112: '/sprites/FCANC0.png',  // flaming can (anim)
  120: '/sprites/TLP2A0.png', 121: '/sprites/TLP2B0.png', 122: '/sprites/TLP2C0.png', 123: '/sprites/TLP2D0.png',  // tech lamp (anim)
  // Maintenance / Secret Place
  130: '/sprites/ELECA0.png',   // hanging wires
  131: '/sprites/CBRAA0.png',   // floor cables
};

const loader = new THREE.TextureLoader();

function loadTex(src) {
  return new Promise((resolve, reject) => {
    loader.load(src, tex => {
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.wrapS    = THREE.RepeatWrapping;
      tex.wrapT    = THREE.RepeatWrapping;
      resolve(tex);
    }, undefined, reject);
  });
}

export class TextureManager {
  constructor() { this.textures = {}; }

  async load() {
    await Promise.all(
      Object.entries(SOURCES).map(async ([id, src]) => {
        this.textures[+id] = await loadTex(src);
      })
    );
  }

  // Returns a THREE.Texture clone with repeat set for large planes
  tiled(id, rX, rY) {
    const t = this.textures[id].clone();
    t.needsUpdate = true;
    t.repeat.set(rX, rY);
    return t;
  }

  get(id) { return this.textures[id]; }
}
