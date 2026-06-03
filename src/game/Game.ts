import { CivilizationType } from './types';
import { GameMap } from './Map';
import { Unit } from './Unit';
import { Building } from './Building';
import { Worker } from './Worker';
import { ResourceNode, ResourceType } from './ResourceNode';
import { Player } from './Player';
import { CombatSystem } from './CombatSystem';
import { AISystem } from './AI';
import { ResourceSystem } from './ResourceSystem';
import { EconomyManager } from './EconomyManager';
import { DiplomacyManager } from './Diplomacy';
import { FogOfWarManager } from './FogOfWar';
import { CIVILIZATIONS } from './civilizations';
import { CIV_COLORS } from './constants';
import type { DamageEvent } from './CombatSystem';
import { BuildingType } from './buildings';
import { BUILDING_DEFS } from './buildingDefs';

const START_POSITIONS: Record<CivilizationType, [number, number]> = {
  [CivilizationType.AZTEC]:        [27, 8],
  [CivilizationType.MAYA]:         [24, 19],
  [CivilizationType.INCA]:         [15, 44],
  [CivilizationType.CONQUISTADOR]: [42, 38],
};

export type GameStatus = 'PLAYING' | 'VICTORY' | 'DEFEAT';

export class Game {
  readonly map: GameMap;
  readonly players: Player[] = [];
  readonly allUnits: Unit[] = [];
  readonly allBuildings: Building[] = [];
  readonly allWorkers: Worker[] = [];
  readonly resourceNodes: ResourceNode[] = [];

  private combat        = new CombatSystem();
  private aiSystem      = new AISystem();
  private resourceSys   = new ResourceSystem();
  private economy       = new EconomyManager();
  private diplomacy     = new DiplomacyManager();
  readonly fog: FogOfWarManager;

  damageEvents: DamageEvent[] = [];
  status: GameStatus = 'PLAYING';
  humanPlayerId = 0;
  gameTime = 0;

  constructor(humanCiv: CivilizationType = CivilizationType.AZTEC) {
    this.map = new GameMap(12345);
    this.spawnPlayers(humanCiv);
    this.generateResourceNodes();
    this.spawnInitialBuildings();
    this.diplomacy.init();
    this.fog = new FogOfWarManager(this.players.length);
  }

  private spawnPlayers(humanCiv: CivilizationType) {
    // Put the human civ first (player 0), rest as AI
    const allCivs = [
      CivilizationType.AZTEC,
      CivilizationType.MAYA,
      CivilizationType.INCA,
      CivilizationType.CONQUISTADOR,
    ];
    const civs = [humanCiv, ...allCivs.filter(c => c !== humanCiv)];

    civs.forEach((civ, idx) => {
      const isHuman = idx === this.humanPlayerId;
      const player = new Player(idx, civ, isHuman);
      this.players.push(player);
      this.spawnUnitsFor(player);
    });
  }

  private spawnUnitsFor(player: Player) {
    const civDef = CIVILIZATIONS[player.civType];
    const [baseCol, baseRow] = START_POSITIONS[player.civType];
    const color = CIV_COLORS[player.civType];

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

  private spawnInitialBuildings() {
    const civs = [
      CivilizationType.AZTEC,
      CivilizationType.MAYA,
      CivilizationType.INCA,
      CivilizationType.CONQUISTADOR,
    ];

    civs.forEach((civ, idx) => {
      const [baseCol, baseRow] = START_POSITIONS[civ];
      const color = CIV_COLORS[civ];

      const settlement = new Building(
        BuildingType.SETTLEMENT,
        BUILDING_DEFS[BuildingType.SETTLEMENT],
        idx,
        baseCol,
        baseRow,
        color
      );
      settlement.buildProgress = 1;
      settlement.hp = settlement.maxHp;
      settlement.state = 'COMPLETE' as any;
      this.allBuildings.push(settlement);

      for (let w = 0; w < 3; w++) {
        const pos = this.findSpawnPos(baseCol + w - 1, baseRow + 2);
        if (pos) {
          const worker = new Worker(idx, pos[0], pos[1], color);
          this.allWorkers.push(worker);
        }
      }
    });
  }

  private generateResourceNodes() {
    for (let r = 5; r < this.map.rows - 5; r += 8) {
      for (let c = 5; c < this.map.cols - 5; c += 8) {
        const tile = this.map.getTile(c, r);
        if (!tile || !this.map.isWalkable(c, r)) continue;

        const rand = Math.random();
        const type = rand < 0.4 ? ResourceType.FOOD : rand < 0.7 ? ResourceType.GOLD : ResourceType.STONE;
        const amount = 200 + Math.floor(Math.random() * 200);

        this.resourceNodes.push(new ResourceNode(type, c, r, amount));
      }
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

  getBuildingById(id: number): Building | undefined {
    return this.allBuildings.find(b => b.id === id);
  }

  update(dt: number) {
    if (this.status !== 'PLAYING') return;

    this.gameTime += dt;

    for (const unit of this.allUnits) {
      unit.update(dt, this.map);
    }

    for (const building of this.allBuildings) {
      if (!building.isComplete()) building.updateBuild(dt);
    }

    for (const worker of this.allWorkers) {
      worker.update(dt, this.map);
    }

    for (const node of this.resourceNodes) {
      node.updateVisibility();
    }

    this.damageEvents = this.combat.update(this.allUnits, this.map);

    this.resourceSys.update(this);

    this.economy.update(dt, this);

    this.fog.update(this);

    this.aiSystem.update(dt, this);

    this.checkEndConditions();
  }

  private checkEndConditions() {
    const human = this.humanPlayer;
    const enemies = this.players.filter(p => p.id !== this.humanPlayerId);

    if (human.isDefeated()) {
      this.status = 'DEFEAT';
      return;
    }

    if (enemies.every(p => p.isDefeated())) {
      this.status = 'VICTORY';
    }
  }
}
