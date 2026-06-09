import { CivilizationType, UnitState, UnitType } from './types';
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
import { ObjectiveSystem } from './Objectives';
import { updateCivPowers } from './CivPowers';
import { CIVILIZATIONS } from './civilizations';
import { CIV_COLORS, TILE_SIZE, WONDER_NAMES } from './constants';
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
  getEconomyStats(playerId: number) { return this.economy.getStats(playerId); }
  private diplomacy     = new DiplomacyManager();
  readonly fog: FogOfWarManager;
  readonly objectives: ObjectiveSystem;

  damageEvents: DamageEvent[] = [];
  readonly killsByPlayer = new Map<number, number>(); // playerId → total kills
  newlySpawnedUnits: Unit[] = [];
  newlyPlacedBuildings: Building[] = [];
  newlyCompletedBuildings: Building[] = [];
  newlyDestroyedBuildings: Building[] = [];
  newlyDepletedNodes: ResourceNode[] = [];
  newlyRetreatingUnits: Unit[] = [];
  newlyRegeneratedNodes: import('./ResourceNode').ResourceNode[] = [];
  newlyRespawnedHeroes: Unit[] = [];
  private _heroRespawnTimers = new Map<number, number>(); // playerId → seconds until respawn
  status: GameStatus = 'PLAYING';
  victoryType: 'MILITARY' | 'ECONOMIC' | 'WONDER' = 'MILITARY';
  static readonly ECONOMIC_VICTORY_GOLD = 800;
  static readonly WONDER_VICTORY_DURATION = 180;
  wonderCountdown: number | null = null;
  private _wonderWasAlive = false;
  paused = false;
  humanPlayerId = 0;
  gameTime = 0;
  difficulty: 'easy' | 'normal' | 'hard' = 'normal';
  pendingEventMessages: string[] = [];
  private _eventTimer = 60 + Math.random() * 60;
  private _autoAttackTimer = 0;
  private _bonusTimer = 0;
  stormTimer = 0;            // seconds remaining in tropical storm
  private _approachTimer = 0; // throttle for enemy-approach notifications

  constructor(humanCiv: CivilizationType = CivilizationType.AZTEC) {
    this.map = new GameMap(12345);
    this.spawnPlayers(humanCiv);
    this.generateResourceNodes();
    this.spawnInitialBuildings();
    this.diplomacy.init();
    this.fog = new FogOfWarManager(this.players.length);
    this.objectives = new ObjectiveSystem(this);
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

  private static readonly HERO_DEFS: Record<CivilizationType, { name: string; unitType: UnitType }> = {
    [CivilizationType.AZTEC]:        { name: 'Tlacaelel',      unitType: UnitType.EAGLE_WARRIOR  },
    [CivilizationType.MAYA]:         { name: 'Lady Xoc',       unitType: UnitType.AHAU_WARRIOR   },
    [CivilizationType.INCA]:         { name: 'Pachacuti',      unitType: UnitType.CHAKANA_GUARD  },
    [CivilizationType.CONQUISTADOR]: { name: 'Hernán Cortés',  unitType: UnitType.CAVALRY        },
  };

  private spawnHero(player: Player): Unit | null {
    const heroDef  = Game.HERO_DEFS[player.civType];
    const [baseCol, baseRow] = START_POSITIONS[player.civType];
    const pos = this.map.findWalkableNear(baseCol, baseRow + 2, 6);
    if (!pos) return null;
    const unit = new Unit(heroDef.unitType, player.civType, player.id, pos[0], pos[1], CIV_COLORS[player.civType]);
    unit.markAsHero(heroDef.name);
    player.addUnit(unit);
    this.allUnits.push(unit);
    return unit;
  }

  private spawnUnitsFor(player: Player) {
    // Spawn hero first
    this.spawnHero(player);

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

  getHeroRespawnTimer(playerId: number): number | undefined {
    return this._heroRespawnTimers.get(playerId);
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

    // Precompute settlement positions per player for proximity healing
    const settlementsByPlayer = new Map<number, { col: number; row: number }[]>();
    for (const b of this.allBuildings) {
      if (b.type === BuildingType.SETTLEMENT && b.isAlive() && b.isComplete()) {
        if (!settlementsByPlayer.has(b.playerId)) settlementsByPlayer.set(b.playerId, []);
        settlementsByPlayer.get(b.playerId)!.push({ col: b.col, row: b.row });
      }
    }

    for (const unit of this.allUnits) {
      // Check proximity to own settlement (within 4 tiles) for boosted healing
      const settlements = settlementsByPlayer.get(unit.playerId) ?? [];
      unit._nearSettlement = settlements.some(
        s => Math.abs(unit.col - s.col) <= 4 && Math.abs(unit.row - s.row) <= 4,
      );
      unit.update(dt, this.map);

      // Hero death → start respawn countdown (60s)
      if (unit.isHero && !unit.isAlive() && !this._heroRespawnTimers.has(unit.playerId)) {
        this._heroRespawnTimers.set(unit.playerId, 60);
      }
    }

    // Auto-retreat: units that dropped below 20% HP flee toward nearest friendly building
    for (const unit of this.allUnits) {
      if (!unit.wantsRetreat || !unit.isAlive()) { unit.wantsRetreat = false; continue; }
      unit.wantsRetreat = false;
      unit.attackTarget = null;
      unit.attackBuildingTarget = null;
      this.newlyRetreatingUnits.push(unit);
      const base = this.allBuildings
        .filter(b => b.playerId === unit.playerId && b.isAlive())
        .sort((a, b) => {
          const da = (unit.col - a.col) ** 2 + (unit.row - a.row) ** 2;
          const db = (unit.col - b.col) ** 2 + (unit.row - b.row) ** 2;
          return da - db;
        })[0];
      if (base) {
        const near = this.map.findWalkableNear(base.col, base.row, 3);
        if (near) {
          const path = findPath(this.map, unit.gridPos(), { col: near[0], row: near[1] }, 300);
          if (path.length > 0) unit.moveTo(path);
        }
      }
    }

    this.newlySpawnedUnits = [];
    this.newlyPlacedBuildings = [];
    this.newlyCompletedBuildings = [];
    this.newlyDestroyedBuildings = [];
    this.newlyDepletedNodes = [];
    this.newlyRetreatingUnits = [];
    this.newlyRegeneratedNodes = [];
    this.newlyRespawnedHeroes = [];

    // Hero respawn timers
    for (const [playerId, timer] of this._heroRespawnTimers) {
      const newTimer = timer - dt;
      if (newTimer <= 0) {
        this._heroRespawnTimers.delete(playerId);
        const player = this.players[playerId];
        if (player && !player.isDefeated()) {
          const hero = this.spawnHero(player);
          if (hero) {
            this.newlySpawnedUnits.push(hero);
            this.newlyRespawnedHeroes.push(hero);
          }
        }
      } else {
        this._heroRespawnTimers.set(playerId, newTimer);
      }
    }
    for (const building of this.allBuildings) {
      if (!building.isComplete()) {
        // Idle workers within 2.5 tiles of an unfinished friendly building accelerate construction (+30% each)
        const helpers = this.allWorkers.filter(w =>
          w.playerId === building.playerId &&
          (w.task as string) === 'IDLE' &&
          Math.sqrt((w.col - building.col) ** 2 + (w.row - building.row) ** 2) <= 2.5,
        );
        const speedMult = 1 + helpers.length * 0.3;
        building.updateBuild(dt * speedMult);
        if (building.isComplete()) {
          this.newlyCompletedBuildings.push(building);
        }
      } else {
        building.updateProduction(dt);
        building.updateRepair(dt);
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
      const wasEmpty = node.isEmpty();
      node.updateRegen(dt);
      if (!wasEmpty && node.isEmpty()) this.newlyDepletedNodes.push(node);
      if (node.justRegenerated) this.newlyRegeneratedNodes.push(node);
    }

    this.damageEvents = this.combat.update(this.allUnits, this.map);

    // Track kills per player from this frame's damage events
    for (const evt of this.damageEvents) {
      if (!evt.target.isAlive() && evt.attacker) {
        this.killsByPlayer.set(evt.attacker.playerId, (this.killsByPlayer.get(evt.attacker.playerId) ?? 0) + 1);
      }
    }

    this.updateTowerAttacks(dt);
    this.updateUnitBuildingAttacks(dt);

    this.resourceSys.update(this);

    this.economy.update(dt, this);

    this.applyBuildingBonuses(dt);

    // Sight reduced by 40% at night (day cycle 0.75–1.0 and 0.0–0.15)
    const dayT = (this.gameTime % 480) / 480;
    const isNight = dayT > 0.75 || dayT < 0.15;
    if (this.stormTimer > 0) this.stormTimer -= dt;
    const stormMult = this.stormTimer > 0 ? 0.5 : 1.0;
    this.fog.update(this, (isNight ? 0.6 : 1.0) * stormMult);

    this.aiSystem.update(dt, this);

    this._autoAttackTimer += dt;
    if (this._autoAttackTimer >= 0.3) {
      this._autoAttackTimer = 0;
      this.runAutoAttack();
      this.updatePatrol();
    }

    // Random events
    this.pendingEventMessages = [];
    this._eventTimer -= dt;
    if (this._eventTimer <= 0) {
      this._eventTimer = 60 + Math.random() * 60;
      this.fireRandomEvent();
    }

    // Enemy approach alerts — check every 15s
    this._approachTimer -= dt;
    if (this._approachTimer <= 0) {
      this._approachTimer = 15;
      const settle = this.allBuildings.find(
        b => b.playerId === this.humanPlayerId && b.type === BuildingType.SETTLEMENT && b.isAlive(),
      );
      if (settle) {
        const approaching = this.allUnits.filter(u => {
          if (u.playerId === this.humanPlayerId || !u.isAlive()) return false;
          const d = Math.sqrt((u.col - settle.col) ** 2 + (u.row - settle.row) ** 2);
          return d <= 12;
        });
        if (approaching.length >= 3) {
          this.pendingEventMessages.push(`⚔️ ¡Alerta! ${approaching.length} enemigos aproximándose a tu asentamiento`);
        }
      }
    }

    this.objectives.update(this);
    updateCivPowers(this, dt);

    // Tick wonder countdown
    if (this.wonderCountdown !== null && this.status === 'PLAYING') {
      this.wonderCountdown -= dt;
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
    // Apply player upgrades to new unit
    if (player.upgrades.metallurgy)    unit.attack += 6;
    if (player.upgrades.logistics)     unit.speed  += 0.4;
    if (player.upgrades.fortification) { unit.maxHp += 50; unit.hp += 50; }
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
          attacker: null,
          target: nearest,
          damage: actual,
          worldX: nearest.worldX,
          worldZ: nearest.worldZ,
          sourceWorldX: b.col * TILE_SIZE + TILE_SIZE / 2,
          sourceWorldZ: b.row * TILE_SIZE + TILE_SIZE / 2,
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

  applyUpgrade(upgrade: keyof import('./Player').PlayerUpgrades, playerId: number): boolean {
    const player = this.players[playerId];
    if (!player) return false;
    if (player.upgrades[upgrade]) return false; // already researched

    const costs: Record<string, { food: number; gold: number; stone: number }> = {
      metallurgy:    { food: 0,   gold: 150, stone: 100 },
      logistics:     { food: 100, gold: 100, stone: 0   },
      fortification: { food: 0,   gold: 80,  stone: 150 },
      civTech:       { food: 100, gold: 200, stone: 150 },
    };
    const cost = costs[upgrade];
    if (!cost) return false;
    if (player.resources.food  < cost.food)  return false;
    if (player.resources.gold  < cost.gold)  return false;
    if (player.resources.stone < cost.stone) return false;

    player.resources.food  -= cost.food;
    player.resources.gold  -= cost.gold;
    player.resources.stone -= cost.stone;
    player.upgrades[upgrade] = true;

    // Apply to all existing units immediately
    for (const unit of this.allUnits) {
      if (unit.playerId !== playerId || !unit.isAlive()) continue;
      if (upgrade === 'metallurgy')    unit.attack   = Math.min(unit.attack + 6,   unit.def.stats.attack * 2);
      if (upgrade === 'logistics')     unit.speed    = Math.min(unit.speed  + 0.4, unit.def.stats.speed  * 2);
      if (upgrade === 'fortification') { unit.maxHp += 50; unit.hp = Math.min(unit.hp + 50, unit.maxHp); }
      if (upgrade === 'civTech') {
        switch (player.civType) {
          case CivilizationType.AZTEC:
            unit.attack = Math.min(unit.attack + 10, unit.def.stats.attack * 2);
            unit.maxHp += 30; unit.hp = Math.min(unit.hp + 30, unit.maxHp);
            break;
          case CivilizationType.INCA:
            unit.speed = Math.min(unit.speed + 0.6, unit.def.stats.speed * 2.5);
            break;
          case CivilizationType.MAYA:
            unit.sight = Math.min(unit.sight + 3, 18);
            break;
          case CivilizationType.CONQUISTADOR:
            unit.attack = Math.min(unit.attack + 12, unit.def.stats.attack * 2);
            break;
        }
      }
    }
    return true;
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

  private fireRandomEvent() {
    const cap = 2000;
    const human = this.humanPlayer;
    const enemies = this.players.filter(p => p.id !== this.humanPlayerId);
    const enemyBuildings = this.allBuildings.filter(b => b.playerId !== this.humanPlayerId && b.isAlive() && b.isComplete());

    const events: Array<() => string | null> = [
      // Positive resource events
      () => { human.resources.food  = Math.min(cap, human.resources.food  + 100); return '🌿 ¡Cosecha abundante! +100 🌽 alimentos'; },
      () => { human.resources.gold  = Math.min(cap, human.resources.gold  + 75);  return '⛏️ Veta de oro descubierta: +75 ⚜️ oro'; },
      () => { human.resources.stone = Math.min(cap, human.resources.stone + 80);  return '🪨 Cantera hallada: +80 🪨 piedra'; },
      // Reinforcements
      () => {
        if (human.aliveUnits.length >= this.getPopCap(this.humanPlayerId)) return null;
        const settle = this.allBuildings.find(b => b.playerId === this.humanPlayerId && b.type === BuildingType.SETTLEMENT);
        if (!settle) return null;
        const pos = this.map.findWalkableNear(settle.col, settle.row + 3, 6);
        if (!pos) return null;
        const civDef = CIVILIZATIONS[human.civType];
        const unitDef = civDef.units[0];
        const unit = new Unit(unitDef.type, human.civType, this.humanPlayerId, pos[0], pos[1], CIV_COLORS[human.civType]);
        human.addUnit(unit);
        this.allUnits.push(unit);
        this.newlySpawnedUnits.push(unit);
        return `📣 ¡Refuerzos! Nuevo ${unitDef.name} se ha unido`;
      },
      // Lightning on enemy building
      () => {
        if (enemyBuildings.length === 0) return null;
        const target = enemyBuildings[Math.floor(Math.random() * enemyBuildings.length)];
        target.takeDamage(35);
        if (!target.isAlive()) this.newlyDestroyedBuildings.push(target);
        return '⚡ ¡Rayo divino alcanzó un edificio enemigo! -35 HP';
      },
      // Trade route
      () => {
        if (human.resources.food < 60) return null;
        human.resources.food -= 60;
        human.resources.gold  = Math.min(cap, human.resources.gold + 50);
        return '🛶 Ruta comercial: -60 🌽 → +50 ⚜️ oro';
      },
      // Enemy desertion
      () => {
        if (enemies.length === 0) return null;
        const enemy = enemies[Math.floor(Math.random() * enemies.length)];
        if (enemy.aliveUnits.length === 0) return null;
        const unit = enemy.aliveUnits[Math.floor(Math.random() * enemy.aliveUnits.length)];
        unit.hp = 0;
        unit['die']?.();
        return '🏃 ¡Un guerrero enemigo desertó!';
      },
      // Tropical storm: halve all sight for 30 seconds
      () => {
        if (this.stormTimer > 0) return null;
        this.stormTimer = 30;
        return '🌪️ ¡Tormenta tropical! Visibilidad reducida 30s — ¡cuidado con emboscadas!';
      },
      // Plague: weaken a random enemy unit
      () => {
        if (enemies.length === 0) return null;
        const enemy = enemies[Math.floor(Math.random() * enemies.length)];
        if (enemy.aliveUnits.length === 0) return null;
        const unit = enemy.aliveUnits[Math.floor(Math.random() * enemy.aliveUnits.length)];
        const dmg = Math.floor(unit.maxHp * 0.4);
        unit.hp = Math.max(1, unit.hp - dmg);
        unit.poisoned = Math.max(unit.poisoned, 8);
        return `🦠 ¡Epidemia azotó a las tropas enemigas! Un ${unit.def?.name ?? 'guerrero'} fue debilitado`;
      },
      // Harvest festival: double food production bonus
      () => {
        if (human.resources.food > 1500) return null;
        human.resources.food = Math.min(cap, human.resources.food + 150);
        human.resources.stone = Math.min(cap, human.resources.stone + 50);
        return '🌽 ¡Festival de la cosecha! +150 🌽 alimentos, +50 🪨 piedra';
      },
    ];

    // Shuffle and try events until one succeeds
    const shuffled = events.sort(() => Math.random() - 0.5);
    for (const fn of shuffled) {
      const msg = fn();
      if (msg) { this.pendingEventMessages.push(msg); return; }
    }
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

    // Wonder victory: completed wonder survived the countdown
    const humanWonder = this.allBuildings.find(
      b => b.playerId === this.humanPlayerId && b.type === BuildingType.WONDER && b.isComplete() && b.isAlive(),
    );
    const wonderIsAlive = !!humanWonder;

    if (wonderIsAlive && this.wonderCountdown === null) {
      // Wonder just completed — start the 3-minute countdown
      this.wonderCountdown = Game.WONDER_VICTORY_DURATION;
      const civKey = human.civType as string;
      const name = WONDER_NAMES[civKey] ?? 'Gran Maravilla';
      this.pendingEventMessages.push(`🏛️ ¡${name} terminada! Defiéndela ${Math.round(Game.WONDER_VICTORY_DURATION / 60)} minutos para la VICTORIA`);
    }

    if (!wonderIsAlive && this._wonderWasAlive && this.wonderCountdown !== null) {
      // Wonder was destroyed while countdown was active
      this.wonderCountdown = null;
      this.pendingEventMessages.push('💀 ¡Tu maravilla fue destruida! El contador de victoria se ha cancelado');
    }
    this._wonderWasAlive = wonderIsAlive;

    if (this.wonderCountdown !== null && this.wonderCountdown <= 0 && wonderIsAlive) {
      this.victoryType = 'WONDER';
      this.status = 'VICTORY';
      return;
    }

    // Economic victory: accumulate enough gold while keeping the settlement
    if (human.resources.gold >= Game.ECONOMIC_VICTORY_GOLD) {
      this.victoryType = 'ECONOMIC';
      this.status = 'VICTORY';
      return;
    }

    // Military victory: all enemy settlements destroyed
    if (enemies.every(p => !this.hasSettlement(p.id))) {
      this.victoryType = 'MILITARY';
      this.status = 'VICTORY';
    }
  }
}
