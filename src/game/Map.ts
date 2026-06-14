import { TerrainType } from './types';
import { MAP_COLS, MAP_ROWS, TERRAIN_WALKABLE } from './constants';

export interface Tile {
  col: number;
  row: number;
  terrain: TerrainType;
  elevation: number;
}

function hash(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.3) * 43758.5453;
  return n - Math.floor(n);
}

function smoothNoise(x: number, y: number, scale: number, seed: number): number {
  const ix = Math.floor(x / scale);
  const iy = Math.floor(y / scale);
  const fx = (x / scale) - ix;
  const fy = (y / scale) - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix,     iy,     seed);
  const b = hash(ix + 1, iy,     seed);
  const c = hash(ix,     iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (d + a - b - c) * ux * uy;
}

function fbm(x: number, y: number, seed: number): number {
  let value = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < 5; i++) {
    value += smoothNoise(x * freq, y * freq, 8, seed + i * 31) * amp;
    amp  *= 0.5;
    freq *= 2.1;
  }
  return value;
}

export class GameMap {
  readonly cols: number = MAP_COLS;
  readonly rows: number = MAP_ROWS;
  private tiles: Tile[][] = [];

  constructor(seed = 42) {
    this.generate(seed);
  }

  private generate(seed: number) {
    for (let r = 0; r < this.rows; r++) {
      this.tiles[r] = [];
      for (let c = 0; c < this.cols; c++) {
        this.tiles[r][c] = this.classifyTile(c, r, seed);
      }
    }
    this.addBeaches();
  }

  // ── Real geography of Latin America ─────────────────────────────────────────
  //
  // ny = 0 (north) → Mexico/Yucatan
  // ny = 1 (south) → Patagonia / Tierra del Fuego
  // nx = 0 (west)  → Pacific Ocean
  // nx = 1 (east)  → Atlantic / Caribbean

  /**
   * Returns [leftCoast, rightCoast] in nx units for a given latitude ny.
   * Encodes the actual silhouette of the Americas.
   */
  private coastlines(ny: number): [number, number] {
    if (ny < 0.01 || ny > 0.97) return [-1, -1];

    // ── MEXICO (ny 0..0.20) ────────────────────────────────────────────────
    if (ny < 0.20) {
      const t = ny / 0.20;
      // Pacific coast (left): slight west bulge around Jalisco
      let L = 0.24 + 0.025 * Math.sin(t * Math.PI);
      // Gulf + Caribbean right coast baseline
      let R = 0.72 - t * 0.02;

      // Gulf of Mexico — deep bay indenting from the RIGHT at ny 0.04..0.16
      if (ny > 0.04 && ny < 0.16) {
        const g = (ny - 0.04) / 0.12;
        R -= Math.sin(g * Math.PI) * 0.14;   // digs ~8 tiles inward at its deepest
      }
      // Yucatan Peninsula — bulges RIGHT at ny 0.13..0.20
      if (ny > 0.13 && ny < 0.20) {
        const y = (ny - 0.13) / 0.07;
        R = Math.max(R, 0.60 + Math.sin(y * Math.PI) * 0.15);
      }
      return [L, Math.max(L + 0.06, R)];
    }

    // ── CENTRAL AMERICA / ISTHMUS (ny 0.20..0.27) ─────────────────────────
    if (ny < 0.27) {
      const t = (ny - 0.20) / 0.07;
      // Narrows dramatically, curves eastward (right)
      const L = 0.41 - t * 0.05;
      const R = 0.58 + t * 0.02;
      return [L, R];
    }

    // ── SOUTH AMERICA (ny 0.27..0.97) ──────────────────────────────────────
    // West coast (Pacific / Andes foothills)
    let L: number;
    if (ny < 0.52) {
      // Colombia → Peru: coast moves westward (left)
      L = 0.35 - (ny - 0.27) / 0.25 * 0.08;       // 0.35 → 0.27
    } else if (ny < 0.82) {
      // Chile: stays near 0.27, slight wiggle
      L = 0.27 + Math.sin((ny - 0.52) / 0.30 * Math.PI * 0.9) * 0.03;
    } else {
      // Patagonia: pinches inward from both sides toward the tip
      const pt = (ny - 0.82) / 0.15;
      L = 0.28 + pt * 0.12;
    }

    // East coast (Caribbean / Atlantic)
    let R: number;
    if (ny < 0.33) {
      // Colombia/Venezuela: rapid widening, Caribbean coast
      R = 0.60 + (ny - 0.27) / 0.06 * 0.17;       // 0.60 → 0.77
    } else if (ny < 0.38) {
      // Venezuela at its widest
      R = 0.77;
    } else if (ny < 0.56) {
      // Brazil Northeast bulge — easternmost point of Americas
      const bt = (ny - 0.38) / 0.18;
      R = 0.77 + Math.sin(bt * Math.PI) * 0.08;    // peaks ~0.85
    } else if (ny < 0.72) {
      // Brazil south coast retreats west
      const bt = (ny - 0.56) / 0.16;
      R = 0.85 - bt * 0.22;                         // 0.85 → 0.63
    } else if (ny < 0.84) {
      // Rio de la Plata / Argentina
      const bt = (ny - 0.72) / 0.12;
      R = 0.63 - bt * 0.13;                         // 0.63 → 0.50
    } else {
      // Patagonia/Tierra del Fuego tip
      const bt = (ny - 0.84) / 0.13;
      R = 0.50 - bt * 0.20;                         // 0.50 → 0.30
    }

    if (R - L < 0.06) R = L + 0.06;
    return [L, R];
  }

  private continentMask(nx: number, ny: number): number {
    if (ny < 0.01 || ny > 0.97) return 0;
    const [L, R] = this.coastlines(ny);
    if (nx < L || nx > R) return 0;
    // Soft transition at coasts for natural edge terrain
    const half = (R - L) / 2;
    const distFrac = Math.abs(nx - (L + half)) / half;
    return Math.max(0, 1 - distFrac * 0.12);
  }

  private classifyTile(c: number, r: number, seed: number): Tile {
    const nx = c / this.cols;
    const ny = r / this.rows;

    const mask = this.continentMask(nx, ny);
    if (mask <= 0) {
      return { col: c, row: r, terrain: TerrainType.WATER, elevation: 0.08 };
    }

    const heightNoise = fbm(c, r, seed);
    const moisture    = fbm(c + 400, r + 400, seed + 7);
    let   elevation   = mask * (0.35 + heightNoise * 0.55);

    // ── Geographic feature elevations ────────────────────────────────────────

    // Andes: mountain spine along WEST coast of South America
    if (ny > 0.27 && ny < 0.93) {
      const [leftCoast] = this.coastlines(ny);
      const andesCenter = leftCoast + 0.055 + 0.010 * Math.sin(ny * Math.PI * 5);
      const d = Math.abs(nx - andesCenter);
      if (d < 0.08) elevation += (0.08 - d) / 0.08 * 1.65;
    }

    // Mexican highlands (mesa central)
    if (ny > 0.03 && ny < 0.18 && nx > 0.28 && nx < 0.68) {
      elevation += 0.28 * smoothNoise(c, r, 6, seed + 99);
    }

    // Sierra Madre ridges (Mexico west and east)
    if (ny > 0.02 && ny < 0.19) {
      const [lMex] = this.coastlines(ny);
      const westMadre = lMex + 0.05;
      const dWM = Math.abs(nx - westMadre);
      if (dWM < 0.04) elevation += (0.04 - dWM) / 0.04 * 0.60;
    }

    // Amazon basin: flatten into a vast lowland jungle
    const inAmazon = ny > 0.32 && ny < 0.60 && nx > 0.34 && nx < 0.77;
    if (inAmazon) {
      const ax = Math.max(0, 1 - Math.abs(nx - 0.55) / 0.22);
      elevation -= ax * 0.28;
    }

    // Brazilian highlands (Cerrado / Planalto)
    if (ny > 0.52 && ny < 0.72 && nx > 0.54 && nx < 0.75) {
      elevation += 0.14 * smoothNoise(c, r, 5, seed + 55);
    }

    // Patagonian plateau (steppe/highland)
    if (ny > 0.78 && ny < 0.92 && mask > 0.2) {
      elevation += 0.12 * smoothNoise(c, r, 4, seed + 77);
    }

    // ── Terrain type ─────────────────────────────────────────────────────────

    const [leftCoast] = this.coastlines(ny);
    // Atacama desert: ultra-arid Pacific coastal strip (Peru/Chile)
    const isAtacama = ny > 0.37 && ny < 0.70 && nx < leftCoast + 0.09 && mask > 0.05;
    // Amazon forced jungle
    const isAmazonCore = inAmazon && nx > 0.38 && nx < 0.73;
    // Dry north Mexico / Baja region
    const isDryMexico  = ny < 0.16 && nx < 0.34 && mask > 0.05;
    // Caribbean tropical (Central America + northern South America coast)
    const isCaribbean  = ny > 0.18 && ny < 0.38 && moisture > 0.40;

    let terrain: TerrainType;
    if      (elevation < 0.18)                         terrain = TerrainType.WATER;
    else if (elevation < 0.28)                         terrain = TerrainType.BEACH;
    else if (elevation > 1.12)                         terrain = TerrainType.SNOW;
    else if (elevation > 0.78)                         terrain = TerrainType.MOUNTAIN;
    else if (elevation > 0.56)                         terrain = TerrainType.HIGHLAND;
    else if (isAtacama || isDryMexico)                 terrain = TerrainType.DESERT;
    else if (isAmazonCore)                             terrain = TerrainType.JUNGLE;
    else if (isCaribbean && moisture > 0.44)           terrain = TerrainType.JUNGLE;
    else if (moisture > 0.52 && ny > 0.22 && ny < 0.75) terrain = TerrainType.JUNGLE;
    else if (moisture < 0.26)                          terrain = TerrainType.DESERT;
    else                                               terrain = TerrainType.GRASS;

    return { col: c, row: r, terrain, elevation };
  }

  private addBeaches() {
    const tmp: TerrainType[][] = this.tiles.map(row => row.map(t => t.terrain));
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const t = tmp[r][c];
        if (t === TerrainType.GRASS || t === TerrainType.JUNGLE || t === TerrainType.DESERT || t === TerrainType.HIGHLAND) {
          for (const [nc, nr] of this.getNeighborCoords(c, r)) {
            if (tmp[nr][nc] === TerrainType.WATER) {
              this.tiles[r][c].terrain = TerrainType.BEACH;
              break;
            }
          }
        }
      }
    }
  }

  getTile(col: number, row: number): Tile | null {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return null;
    return this.tiles[row][col];
  }

  isWalkable(col: number, row: number): boolean {
    const tile = this.getTile(col, row);
    if (!tile) return false;
    return TERRAIN_WALKABLE[tile.terrain] ?? false;
  }

  isNavalWalkable(col: number, row: number): boolean {
    const tile = this.getTile(col, row);
    if (!tile) return false;
    return tile.terrain === 'WATER';
  }

  findNavalNear(col: number, row: number, radius = 10): [number, number] | null {
    if (this.isNavalWalkable(col, row)) return [col, row];
    for (let r = 1; r <= radius; r++) {
      for (let dc = -r; dc <= r; dc++) {
        for (let dr = -r; dr <= r; dr++) {
          if (Math.abs(dc) !== r && Math.abs(dr) !== r) continue;
          const nc = col + dc, nr = row + dr;
          if (this.isNavalWalkable(nc, nr)) return [nc, nr];
        }
      }
    }
    return null;
  }

  getNeighborCoords(col: number, row: number): [number, number][] {
    const dirs: [number, number][] = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
    return dirs
      .map(([dc, dr]) => [col + dc, row + dr] as [number, number])
      .filter(([nc, nr]) => nc >= 0 && nc < this.cols && nr >= 0 && nr < this.rows);
  }

  findWalkableNear(col: number, row: number, radius = 5): [number, number] | null {
    if (this.isWalkable(col, row)) return [col, row];
    for (let r = 1; r <= radius; r++) {
      for (let dc = -r; dc <= r; dc++) {
        for (let dr = -r; dr <= r; dr++) {
          if (Math.abs(dc) !== r && Math.abs(dr) !== r) continue;
          if (this.isWalkable(col + dc, row + dr)) return [col + dc, row + dr];
        }
      }
    }
    return null;
  }
}
