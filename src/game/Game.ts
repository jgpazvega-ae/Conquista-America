import { CivilizationType, UnitType } from './types';
import { GameMap } from './Map';
import { Unit } from './Unit';
import { Player } from './Player';
import { CombatSystem } from './CombatSystem';
import { AISystem } from './AI';
import { CIVILIZATIONS, CivDef } from './civilizations';
import { CIV_COLORS } from './constants';
import type { DamageEvent } from './CombatSystem';

// Starting positions for each civilization (col, row)
const START_POSITIONS: Record<CivilizationType, [number, number]> = {
  [CivilizationType.AZTEC]:        [27, 8],   // Mexico
  [CivilizationType.MAYA]:         [24, 19],  // Central America
  [CivilizationType.INCA]:         [15, 44],  // Andes, Peru
  [CivilizationType.CONQUISTADOR]: [42, 38],  // Brazil coast
};

export type GameStatus = 'PLAYING' | 'VICTORY' | 'DEFEAT';

export class Game {
  readonly map: GameMap;
  readonly players: Player[] = [];
  readonly allUnits: Unit[] = [];

  private combat    = new CombatSystem();
  private aiSystem  = new AISystem();

  damageEvents: DamageEvent[] = [];
  status: GameStatus = 'PLAYING';
  humanPlayerId = 0;

  constructor() {
    this.map = new GameMap(12345);
    this.spawnPlayers();
  }

  private spawnPlayers() {
    const civs = [
      CivilizationType.AZTEC,
      CivilizationType.MAYA,
      CivilizationType.INCA,
      CivilizationType.CONQUISTADOR,
    ];

    // Player 0 is human (Aztec by default)
    civs.forEach((civ, idx) => {
      const isHuman = idx === this.humanPlayerId;
      const player  = new Player(idx, civ, isHuman);
      this.players.push(player);
      this.spawnUnitsFor(player);
    });
  }

  private spawnUnitsFor(player: Player) {
    const civDef: CivDef    = CIVILIZATIONS[player.civType];
    const [baseCol, baseRow] = START_POSITIONS[player.civType];
    const color             = CIV_COLORS[player.civType];

    let placed = 0;
    for (const unitType of civDef.startUnits) {
      const pos = this.findSpawnPos(baseCol + (placed % 4) * 2 - 4, baseRow + Math.floor(placed / 4) * 2 - 2);
      if (!pos) continue;
      const unit = new Unit(unitType, player.civType, player.id, pos[0], pos[1], color);
      player.addUnit(unit);
      this.allUnits.push(unit);
      placed++;
    }
  }

  private findSpawnPos(col: number, row: number): [number, number] | null {
    return this.map.findWalkableNear(col, row, 8);
  }

  get humanPlayer(): Player {
    return this.players[this.humanPlayerId];
  }

  getAllUnits(): Unit[] {
    return this.allUnits;
  }

  getUnitById(id: number): Unit | undefined {
    return this.allUnits.find(u => u.id === id);
  }

  update(dt: number) {
    if (this.status !== 'PLAYING') return;

    // Update all units
    for (const unit of this.allUnits) {
      unit.update(dt, this.map);
    }

    // Combat
    this.damageEvents = this.combat.update(this.allUnits, this.map);

    // AI
    for (const player of this.players) {
      if (!player.isHuman) {
        const enemies = this.allUnits.filter(u => u.playerId !== player.id && u.isAlive());
        this.aiSystem.update(dt, player, enemies, this.map);
      }
    }

    // Check win/lose
    this.checkEndConditions();
  }

  private checkEndConditions() {
    const human    = this.humanPlayer;
    const enemies  = this.players.filter(p => p.id !== this.humanPlayerId);

    if (human.isDefeated()) {
      this.status = 'DEFEAT';
      return;
    }

    if (enemies.every(p => p.isDefeated())) {
      this.status = 'VICTORY';
    }
  }
}
