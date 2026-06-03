import { TerrainType } from './types';
import { MAP_COLS, MAP_ROWS, TERRAIN_WALKABLE } from './constants';

export interface Tile {
  col: number;
  row: number;
  terrain: TerrainType;
  elevation: number;
}

function hash(x: number, y: number, seed: number): number {
  let n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.3) * 43758.5453;
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
  let value = 0;
  let amp = 0.5;
  let freq = 1;
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
    // Generate a Latin America-shaped map
    for (let r = 0; r < this.rows; r++) {
      this.tiles[r] = [];
      for (let c = 0; c < this.cols; c++) {
        const tile = this.classifyTile(c, r, seed);
        this.tiles[r][c] = tile;
      }
    }
    // Post-process: ensure coastal beaches
    this.addBeaches();
  }

  private classifyTile(c: number, r: number, seed: number): Tile {
    // Normalised coords [0..1]
    const nx = c / this.cols;
    const ny = r / this.rows;

    // Continent mask – rough Latin America silhouette
    const continentMask = this.continentMask(nx, ny);
    const heightNoise = fbm(c, r, seed);
    const moisture    = fbm(c + 400, r + 400, seed + 7);

    let elevation = continentMask * (0.4 + heightNoise * 0.6);

    // Andes – western mountain chain (low col, mid-south rows)
    if (ny > 0.3 && ny < 0.92) {
      const andesX = 0.08 + 0.04 * Math.sin(ny * Math.PI * 3);
      const dist = Math.abs(nx - andesX);
      if (dist < 0.07) {
        elevation += (0.07 - dist) / 0.07 * 1.4;
      }
    }

    // Mexico highlands
    if (ny < 0.22 && nx > 0.25 && nx < 0.75) {
      elevation += 0.3 * smoothNoise(c, r, 6, seed + 99);
    }

    let terrain: TerrainType;
    if (elevation < 0.18) {
      terrain = TerrainType.WATER;
    } else if (elevation < 0.28) {
      terrain = TerrainType.BEACH;
    } else if (elevation > 1.1) {
      terrain = TerrainType.SNOW;
    } else if (elevation > 0.75) {
      terrain = TerrainType.MOUNTAIN;
    } else if (elevation > 0.55) {
      terrain = TerrainType.HIGHLAND;
    } else if (moisture > 0.52 && ny > 0.25 && ny < 0.72) {
      terrain = TerrainType.JUNGLE;
    } else if (moisture < 0.3 && (ny < 0.2 || (nx > 0.6 && ny < 0.35))) {
      terrain = TerrainType.DESERT;
    } else {
      terrain = TerrainType.GRASS;
    }

    return { col: c, row: r, terrain, elevation };
  }

  private continentMask(nx: number, ny: number): number {
    // Rough shape of Latin America
    // Mexico (top center), isthmus (narrows), South America (widens then narrows at tip)
    if (ny < 0.02 || ny > 0.98 || nx < 0.01 || nx > 0.99) return 0;

    let halfWidth: number;
    if (ny < 0.18) {
      // Mexico – centered slightly right, relatively wide
      halfWidth = 0.22 - Math.abs(nx - 0.52) * 0.8;
    } else if (ny < 0.28) {
      // Central America – narrow isthmus
      const t = (ny - 0.18) / 0.10;
      halfWidth = (0.14 - t * 0.06) - Math.abs(nx - 0.50) * 1.2;
    } else if (ny < 0.85) {
      // South America – broad in north, tapers south
      const t = (ny - 0.28) / 0.57;
      const centerX = 0.46 + t * 0.02;
      const width   = 0.30 - t * 0.10;
      halfWidth = width - Math.abs(nx - centerX) * 1.1;
    } else {
      // Patagonian tip
      const t = (ny - 0.85) / 0.13;
      halfWidth = 0.10 * (1 - t) - Math.abs(nx - 0.44) * 1.5;
    }

    return Math.max(0, Math.min(1, halfWidth * 3.5 + 0.5));
  }

  private addBeaches() {
    const tmp: TerrainType[][] = this.tiles.map(row => row.map(t => t.terrain));
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (tmp[r][c] === TerrainType.GRASS || tmp[r][c] === TerrainType.JUNGLE || tmp[r][c] === TerrainType.DESERT) {
          const neighbors = this.getNeighborCoords(c, r);
          for (const [nc, nr] of neighbors) {
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

  getNeighborCoords(col: number, row: number): [number, number][] {
    const dirs: [number, number][] = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
    return dirs.map(([dc, dr]) => [col + dc, row + dr] as [number, number])
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
