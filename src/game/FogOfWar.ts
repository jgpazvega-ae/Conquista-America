import { MAP_COLS, MAP_ROWS } from './constants';
import { TerrainType } from './types';
import { BuildingType } from './buildings';
import type { Unit } from './Unit';
import type { Building } from './Building';
import type { Game } from './Game';
import type { GameMap } from './Map';

export enum TileVisibility {
  UNEXPLORED = 0,
  FOGGED = 1,
  VISIBLE = 2,
}

export class FogOfWar {
  private playerVisibility: TileVisibility[][] = [];
  private playerMemory: number[][] = []; // For storing last known terrain

  constructor(playerId: number) {
    for (let r = 0; r < MAP_ROWS; r++) {
      this.playerVisibility[r] = [];
      this.playerMemory[r] = [];
      for (let c = 0; c < MAP_COLS; c++) {
        this.playerVisibility[r][c] = TileVisibility.UNEXPLORED;
        this.playerMemory[r][c] = 0;
      }
    }
  }

  update(game: Game, playerId: number, sightMultiplier = 1.0) {
    // Reset visibility each frame
    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        if (this.playerVisibility[r][c] === TileVisibility.VISIBLE) {
          this.playerVisibility[r][c] = TileVisibility.FOGGED;
        }
      }
    }

    // Units reveal terrain (jungle tiles need extra sight to reveal — stealth mechanic)
    const myUnits = game.allUnits.filter(u => u.playerId === playerId && u.isAlive());
    for (const unit of myUnits) {
      // Eagle Warriors are night hunters — they don't suffer the night sight penalty
      const unitMult = (sightMultiplier < 1.0 && unit.type === 'EAGLE_WARRIOR') ? 1.0 : sightMultiplier;
      this.revealAroundPoint(Math.round(unit.col), Math.round(unit.row), Math.ceil(unit.sight * unitMult), game.map);
    }

    // Buildings reveal terrain (watchtowers get boosted sight; night reduces watchtower vision like units)
    const myBuildings = game.allBuildings.filter(b => b.playerId === playerId && b.isAlive());
    for (const building of myBuildings) {
      let sightRange: number;
      if (building.type === BuildingType.WATCHTOWER && building.isComplete()) {
        sightRange = Math.ceil(7 * sightMultiplier); // night reduces tower sight like unit sight
      } else {
        sightRange = building.isComplete() ? 4 : 2;
      }
      this.revealAroundPoint(building.col, building.row, sightRange, game.map);
    }

    // Store memory of visible tiles
    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        if (this.playerVisibility[r][c] === TileVisibility.VISIBLE) {
          const tile = game.map.getTile(c, r);
          if (tile) {
            this.playerMemory[r][c] = 1; // Mark as explored
          }
        }
      }
    }
  }

  private revealAroundPoint(col: number, row: number, sight: number, map?: GameMap) {
    for (let r = Math.max(0, row - sight); r <= Math.min(MAP_ROWS - 1, row + sight); r++) {
      for (let c = Math.max(0, col - sight); c <= Math.min(MAP_COLS - 1, col + sight); c++) {
        const dx = c - col;
        const dy = r - row;
        // Jungle tiles require the viewer to be within 65% of sight to reveal them (stealth)
        const tile = map?.getTile(c, r);
        const effectiveSight = tile?.terrain === TerrainType.JUNGLE ? sight * 0.65 : sight;
        if (dx * dx + dy * dy <= effectiveSight * effectiveSight) {
          this.playerVisibility[r][c] = TileVisibility.VISIBLE;
        }
      }
    }
  }

  getVisibility(col: number, row: number): TileVisibility {
    if (col < 0 || col >= MAP_COLS || row < 0 || row >= MAP_ROWS) return TileVisibility.UNEXPLORED;
    return this.playerVisibility[row][col];
  }

  isVisible(col: number, row: number): boolean {
    return this.getVisibility(col, row) === TileVisibility.VISIBLE;
  }

  isExplored(col: number, row: number): boolean {
    return this.playerMemory[row]?.[col] > 0;
  }

  explorationPercent(): number {
    let explored = 0;
    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        if (this.playerMemory[r][c] > 0) explored++;
      }
    }
    return Math.round((explored / (MAP_ROWS * MAP_COLS)) * 100);
  }

  canSeeUnit(unit: Unit, playerId: number): boolean {
    if (unit.playerId === playerId) return true;
    return this.isVisible(Math.round(unit.col), Math.round(unit.row));
  }

  canSeeBuilding(building: Building, playerId: number): boolean {
    if (building.playerId === playerId) return true;
    return this.isVisible(building.col, building.row);
  }
}

export class FogOfWarManager {
  private fogMaps = new Map<number, FogOfWar>();

  constructor(playerCount: number) {
    for (let i = 0; i < playerCount; i++) {
      this.fogMaps.set(i, new FogOfWar(i));
    }
  }

  update(game: Game, sightMultiplier = 1.0) {
    for (const [playerId, fog] of this.fogMaps) {
      fog.update(game, playerId, sightMultiplier);
    }
  }

  getFog(playerId: number): FogOfWar | undefined {
    return this.fogMaps.get(playerId);
  }

  explorationPercent(playerId: number): number {
    return this.fogMaps.get(playerId)?.explorationPercent() ?? 0;
  }

  canSeeUnit(unit: Unit, playerId: number): boolean {
    const fog = this.fogMaps.get(playerId);
    return fog ? fog.canSeeUnit(unit, playerId) : true;
  }

  canSeeBuilding(building: Building, playerId: number): boolean {
    const fog = this.fogMaps.get(playerId);
    return fog ? fog.canSeeBuilding(building, playerId) : true;
  }

  isVisible(col: number, row: number, playerId: number): boolean {
    const fog = this.fogMaps.get(playerId);
    return fog ? fog.isVisible(col, row) : true;
  }

  revealAll(playerId: number) {
    const fog = this.fogMaps.get(playerId);
    if (!fog) return;
    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        fog['playerVisibility'][r][c] = TileVisibility.VISIBLE;
        fog['playerMemory'][r][c] = 1;
      }
    }
  }
}
