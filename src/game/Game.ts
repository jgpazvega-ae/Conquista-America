import { CivilizationType, UnitState } from './types';
import { GameMap } from './Map';
import { findPath } from './Pathfinding';
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
import { CIV_COLORS, TILE_SIZE } from './constants';
import type { DamageEvent } from './CombatSystem';
import { BuildingType } from './buildings';
import { BUILDING_DEFS } from './buildingDefs';

// Positions aligned to the real-geography map:
// Mexico (top-center), Yucatan (top-right), Peru/Andes (mid-left), Caribbean (mid-right)
const START_POSITIONS: Record<CivilizationType, [number, number]> = {
  [CivilizationType.AZTEC]:        [28,  8],   // Mexican highlands
  [CivilizationType.MAYA]:         [38, 14],   // Yucatan peninsula
  [CivilizationType.INCA]:         [19, 36],   // Peruvian Andes
  [CivilizationType.CONQUISTADOR]: [46, 24],   // Caribbean coast
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
  newlySpawnedUnits: Unit[] = [];
  newlyPlacedBuildings: Building[] = [];
  newlyCompletedBuildings: Building[] = [];
  newlyDestroyedBuildings: Building[] = [];
  status: GameStatus = 'PLAYING';
  paused = false;
  humanPlayerId = 0;
  gameTime = 0;
  difficulty: 'easy' | 'normal' | 'hard' = 'normal';
  private _autoAttackTimer = 0;
  private _bonusTimer = 0;

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

    // Tight battalion formation: grouped by unit type into ranks below the base.
    const COLS = 6;                 // soldiers per rank
    const formStartRow = baseRow + 3;
    const occupied = new Set<string>();
    let placed = 0;

    for (const unitType of civDef.startUnits) {
      const fc = placed % COLS;
      const fr = Math.floor(placed / COLS);
      // centered horizontally, marching downward in ranks
      const targetCol = baseCol + fc - Math.floor(COLS / 2);
      const targetRow = formStartRow + fr;
      let pos = this.map.findWalkableNear(targetCol, targetRow, 4);
      // avoid stacking two units on the same tile
      let guard = 0;
      while (pos && occupied.has(`${pos[0]},${pos[1]}`) && guard < 12) {
        pos = this.map.findWalkableNear(targetCol + (guard % 3) - 1, targetRow + Math.floor(guard / 3), 4);
        guard++;
      }
      if (!pos) continue;
      occupied.add(`${pos[0]},${pos[1]}`);
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
        color,
        civ
      );
      settlement.buildProgress = 1;
      settlement.hp = settlement.maxHp;
      settlement.state = 'COMPLETE' as any;
      settlement.progressBar.visible = false;
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
    if (this.status !== 'PLAYING' || this.paused) return;

    this.gameTime += dt;

    for (const unit of this.allUnits) {
      unit.update(dt, this.map);
    }

    this.newlySpawnedUnits = [];
    this.newlyPlacedBuildings = [];
    this.newlyCompletedBuildings = [];
    this.newlyDestroyedBuildings = [];
    for (const building of this.allBuildings) {
      if (!building.isComplete()) {
        const wasIncomplete = true;
        building.updateBuild(dt);
        if (building.isComplete() && wasIncomplete) {
          this.newlyCompletedBuildings.push(building);
        }
      } else {
        building.updateProduction(dt);
        if (building.finishedUnit !== null) {
          this.spawnProducedUnit(building);
        }
      }
    }

    for (const worker of this.allWorkers) {
      worker.update(dt, this.map);
    }

    for (const node of this.resourceNodes) {
      node.updateVisibility();
    }

    this.damageEvents = this.combat.update(this.allUnits, this.map);

    this.updateTowerAttacks(dt);
    this.updateUnitBuildingAttacks(dt);

    this.resourceSys.update(this);

    this.economy.update(dt, this);

    this.applyBuildingBonuses(dt);

    this.fog.update(this);

    this.aiSystem.update(dt, this);

    this._autoAttackTimer += dt;
    if (this._autoAttackTimer >= 0.3) {
      this._autoAttackTimer = 0;
      this.runAutoAttack();
      this.updatePatrol();
    }

    this.checkEndConditions();
  }

  private spawnProducedUnit(building: Building) {
    const unitType = building.finishedUnit!;
    building.finishedUnit = null;
    const player = this.players[building.playerId];
    if (!player) return;
    if (player.aliveUnits.length >= this.getPopCap(player.id)) return; // pop cap
    const pos = this.map.findWalkableNear(building.col, building.row + 3, 6);
    if (!pos) return;
    const unit = new Unit(unitType, player.civType, player.id, pos[0], pos[1], CIV_COLORS[player.civType]);
    player.addUnit(unit);
    this.allUnits.push(unit);
    this.newlySpawnedUnits.push(unit);

    // March to rally point if set
    if (building.rallyCol !== null && building.rallyRow !== null) {
      const path = findPath(this.map, unit.gridPos(), { col: building.rallyCol, row: building.rallyRow }, 400);
      if (path.length > 0) unit.moveTo(path);
    }
  }

  private runAutoAttack() {
    for (const unit of this.allUnits) {
      if (!unit.isAlive()) continue;
      if (unit.state !== UnitState.IDLE) continue;
      if (unit.attackTarget !== null || unit.attackBuildingTarget !== null) continue;

      let best: Unit | null = null;
      let bestDist = unit.sight;
      for (const enemy of this.allUnits) {
        if (!enemy.isAlive() || enemy.playerId === unit.playerId) continue;
        const d = unit.distanceTo(enemy);
        if (d < bestDist) { bestDist = d; best = enemy; }
      }
      if (best) { unit.attackUnit(best); continue; }

      // No enemies nearby: auto-attack enemy buildings within sight
      let bestBldg: Building | null = null;
      let bestBldgDist = unit.sight * 0.8; // slightly shorter range for buildings
      for (const b of this.allBuildings) {
        if (!b.isAlive() || b.playerId === unit.playerId) continue;
        const d = Math.sqrt((unit.col - b.col) ** 2 + (unit.row - b.row) ** 2);
        if (d < bestBldgDist) { bestBldgDist = d; bestBldg = b; }
      }
      if (bestBldg) unit.attackBuilding(bestBldg);
    }
  }

  private updateTowerAttacks(dt: number) {
    const TOWER_RANGE    = 5.5;
    const TOWER_DAMAGE   = 12;
    const TOWER_COOLDOWN = 2.5;

    for (const b of this.allBuildings) {
      if (!b.isComplete() || !b.isAlive()) continue;
      if (b.type !== BuildingType.WATCHTOWER) continue;

      b.attackTimer -= dt;
      if (b.attackTimer > 0) continue;

      let nearest: Unit | null = null;
      let nearestDist = TOWER_RANGE;
      for (const u of this.allUnits) {
        if (!u.isAlive() || u.playerId === b.playerId) continue;
        const d = Math.sqrt((u.col - b.col) ** 2 + (u.row - b.row) ** 2);
        if (d < nearestDist) { nearestDist = d; nearest = u; }
      }

      if (nearest) {
        const actual = nearest.takeDamage(TOWER_DAMAGE + Math.floor(Math.random() * 4) - 2);
        this.damageEvents.push({
          attacker: null as any,
          target: nearest,
          damage: actual,
          worldX: nearest.worldX,
          worldZ: nearest.worldZ,
        });
        b.attackTimer = TOWER_COOLDOWN;
      }
    }
  }

  private updateUnitBuildingAttacks(dt: number) {
    for (const unit of this.allUnits) {
      if (!unit.isAlive() || !unit.attackBuildingTarget) continue;
      const bldg = unit.attackBuildingTarget;
      if (!bldg.isAlive()) { unit.attackBuildingTarget = null; unit.state = UnitState.IDLE; continue; }

      const dist = Math.sqrt((unit.col - bldg.col) ** 2 + (unit.row - bldg.row) ** 2);
      if (dist > unit.attackRange + 0.5) {
        // Move toward building
        const path = findPath(this.map, unit.gridPos(), { col: bldg.col, row: bldg.row }, 400);
        if (path.length > 0) {
          unit.path      = path;
          unit.pathIndex = 0;
          unit.state     = UnitState.MOVING;
        }
        continue;
      }

      // In range: attack on cooldown
      unit.attackTimer -= dt;
      if (unit.attackTimer > 0) continue;
      unit.attackTimer = unit.attackCooldown;

      const rawDmg = Math.max(1, unit.attack - 5); // buildings have some armor
      bldg.takeDamage(rawDmg);
      if (!bldg.isAlive()) this.newlyDestroyedBuildings.push(bldg);
      this.damageEvents.push({
        attacker: unit,
        target: unit as any,
        damage: rawDmg,
        worldX: bldg.col * TILE_SIZE,
        worldZ: bldg.row * TILE_SIZE,
      });
      unit.triggerAttackAnim();
    }
  }

  private applyBuildingBonuses(dt: number) {
    this._bonusTimer += dt;
    if (this._bonusTimer < 3.0) return;
    this._bonusTimer = 0;

    for (const player of this.players) {
      const hasTemple = this.allBuildings.some(
        b => b.playerId === player.id && b.type === BuildingType.TEMPLE && b.isComplete()
      );
      const hasForge = this.allBuildings.some(
        b => b.playerId === player.id && b.type === BuildingType.FORGE && b.isComplete()
      );

      for (const unit of player.aliveUnits) {
        if (hasTemple && unit.hp < unit.maxHp) {
          unit.hp = Math.min(unit.maxHp, unit.hp + 2);
        }
        if (hasForge) {
          // Mark unit as forge-buffed for combat (attack up to 125% of base)
          const cap = Math.round(unit.def.stats.attack * 1.25);
          if (unit.attack < cap) unit.attack = Math.min(cap, unit.attack + 1);
        }
      }
    }
  }

  getPopCap(playerId: number): number {
    const storehouses = this.allBuildings.filter(
      b => b.playerId === playerId && b.type === BuildingType.STOREHOUSE && b.isComplete(),
    ).length;
    return 25 + storehouses * 5;
  }

  placeBuilding(type: BuildingType, col: number, row: number, playerId: number): boolean {
    const def    = BUILDING_DEFS[type];
    const player = this.players[playerId];
    if (!player) return false;
    if (player.resources.food  < def.cost.food)  return false;
    if (player.resources.gold  < def.cost.gold)  return false;
    if (player.resources.stone < def.cost.stone) return false;
    if (!this.map.isWalkable(col, row)) return false;

    const building = new Building(type, def, playerId, col, row, CIV_COLORS[player.civType], player.civType);
    this.allBuildings.push(building);
    player.resources.food  -= def.cost.food;
    player.resources.gold  -= def.cost.gold;
    player.resources.stone -= def.cost.stone;
    return true;
  }

  private hasSettlement(playerId: number): boolean {
    return this.allBuildings.some(
      b => b.playerId === playerId && b.type === BuildingType.SETTLEMENT && b.isAlive(),
    );
  }

  private updatePatrol() {
    for (const unit of this.allUnits) {
      if (!unit.isAlive() || !unit.patrolA || !unit.patrolB) continue;
      if (unit.state !== UnitState.IDLE) continue;
      const target = unit.patrolFlip ? unit.patrolA : unit.patrolB;
      const atTarget = Math.abs(unit.col - target.col) <= 1 && Math.abs(unit.row - target.row) <= 1;
      if (atTarget) {
        unit.patrolFlip = !unit.patrolFlip;
      } else {
        const path = findPath(this.map, unit.gridPos(), target, 200);
        if (path.length > 0) {
          unit.path      = path;
          unit.pathIndex = 0;
          unit.state     = UnitState.MOVING;
        }
      }
    }
  }

  private checkEndConditions() {
    const human = this.humanPlayer;
    const enemies = this.players.filter(p => p.id !== this.humanPlayerId);

    // Defeat: human settlement destroyed (units may survive but can't retrain)
    if (!this.hasSettlement(this.humanPlayerId)) {
      this.status = 'DEFEAT';
      return;
    }

    // Victory: all enemy settlements destroyed
    if (enemies.every(p => !this.hasSettlement(p.id))) {
      this.status = 'VICTORY';
    }
  }
}
