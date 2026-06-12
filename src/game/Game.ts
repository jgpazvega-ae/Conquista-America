import { CivilizationType, UnitState, UnitType, TerrainType } from './types';
import { GameMap } from './Map';
import { findPath } from './Pathfinding';
import { Unit } from './Unit';
import { Building } from './Building';
import { Worker, WorkerTask } from './Worker';
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
import { WeatherSystem } from './WeatherSystem';
import type { WeatherState } from './WeatherSystem';

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
  readonly weather      = new WeatherSystem();
  weatherChangeEvent: WeatherState | null = null; // set when weather changes this frame
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
  newlyPanickedUnits: Unit[] = [];
  newlyGarrisonedUnits: Unit[] = [];
  newlyCapturedBuildings: { building: Building; fromPlayerId: number; toPlayerId: number }[] = [];
  newWarDeclarations: { fromPlayerId: number; toPlayerId: number }[] = [];
  newTaunts: { playerId: number; message: string }[] = [];
  newlyLeveledUpUnits: Unit[] = [];
  newlyEliminatedPlayers: Player[] = [];
  newlyVisibleEnemyHeroes: Unit[] = [];
  newlyResearchedUpgrades: { playerId: number; upgrade: string }[] = [];
  private _hadSettlement = new Set<number>(); // track which players ever had a settlement
  private _capitalShockDone = new Set<number>(); // building ids that already triggered capital-loss morale shock
  private _visibleEnemyHeroIds = new Set<number>(); // enemy hero ids currently visible to human
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
  private _villageIncomeTimer = 30; // seconds between village income ticks
  private _autobraceTimer = 0;
  private _autobraceNotified = false;
  private _kiteTimer = 0;
  private _supplyLineTimer = 0;
  private _towerAlertTimer = 0; // global cooldown between watchtower alarm notifications
  private _recentHumanDeaths = 0;
  private _deathWindowTimer  = 30;
  private _routFired         = false;
  private _workerFleeTimer   = 0; // throttle worker flee checks
  private _popPressureNotified = false;
  private _lowFoodNotified     = false; // early hunger warning at ≤30 food
  private _ammoRetreatSent     = new Set<number>(); // unit ids already auto-retreated for ammo
  private _cannonSiegeReady    = new Set<number>(); // cannon ids already notified as siege-ready
  private _fireSpreadTimer       = 0;    // throttle fire spread checks (every 1s)
  private _warExhaustionTimer    = 0;    // throttle war exhaustion checks (every 8s)
  private _firstCombatTime       = -1;   // gameTime when first damage event occurred
  private _warExhaustionNotified = false;
  private _garrisonUpkeepTimer   = 0;    // throttle garrison food drain (every 10s)
  private _autoGarrisonSent      = new Set<number>(); // unit ids sent to auto-garrison
  private _rubberBandTimer       = 0;    // throttle rubber-band difficulty check (every 30s)
  private _momentumTimer         = 0;    // throttle battle-momentum check (every 45s)
  private _killsThisCycle        = new Map<number, number>(); // kills per player in current momentum window
  private _lightningTimer        = 0;    // throttle storm lightning strikes (every 5s)
  private _lowNodeWarned         = new Set<number>(); // resource node ids already warned as low
  villageIncomeEvents: { playerId: number; food: number; gold: number }[] = [];

  constructor(humanCiv: CivilizationType = CivilizationType.AZTEC) {
    this.map = new GameMap(12345);
    this.spawnPlayers(humanCiv);
    this.generateResourceNodes();
    this.spawnInitialBuildings();
    this.spawnNeutralVillages();
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
      // Civ-specific starting resource bonuses
      switch (civ) {
        case CivilizationType.AZTEC:         player.resources.food  += 150; break; // chinampas surplus
        case CivilizationType.MAYA:          player.resources.gold  +=  50; break; // trade routes
        case CivilizationType.INCA:          player.resources.stone += 100; break; // Andean quarrying
        case CivilizationType.CONQUISTADOR:  player.resources.gold  += 150; break; // gold seekers
      }
      // Difficulty scaling: human player only (Easy bonus, Hard penalty)
      if (isHuman) {
        const mult = this.difficulty === 'easy' ? 1.5 : this.difficulty === 'hard' ? 0.75 : 1.0;
        if (mult !== 1.0) {
          player.resources.food  = Math.round(player.resources.food  * mult);
          player.resources.gold  = Math.round(player.resources.gold  * mult);
          player.resources.stone = Math.round(player.resources.stone * mult);
        }
      }
      this.players.push(player);
      this.spawnUnitsFor(player);
    });
  }

  /** Apply civ-specific trait bonuses to a newly created unit. */
  private applyCivTraits(unit: Unit, civ: CivilizationType) {
    if (unit.isHero) return; // heroes already have custom stats
    switch (civ) {
      case CivilizationType.AZTEC:        unit.morale = Math.min(100, unit.morale + 10); break; // warrior culture
      case CivilizationType.MAYA:         unit.sight  = Math.min(18,  unit.sight  +  1); break; // astronomical science
      case CivilizationType.INCA:         unit.hp     = Math.min(unit.maxHp, unit.hp + 15); unit.maxHp += 15; break; // highland endurance
      case CivilizationType.CONQUISTADOR: unit.attack = Math.min(Math.round(unit.def.stats.attack * 1.25), unit.attack + 2); break; // steel weapons
    }
  }

  private static readonly HERO_DEFS: Record<CivilizationType, { name: string; unitType: UnitType }> = {
    [CivilizationType.AZTEC]:        { name: 'Tlacaelel',      unitType: UnitType.EAGLE_WARRIOR  },
    [CivilizationType.MAYA]:         { name: 'Lady Xoc',       unitType: UnitType.AHAU_WARRIOR   },
    [CivilizationType.INCA]:         { name: 'Pachacuti',      unitType: UnitType.CHAKANA_GUARD  },
    [CivilizationType.CONQUISTADOR]: { name: 'Hernán Cortés',  unitType: UnitType.CAVALRY        },
  };

  private spawnHero(player: Player): Unit | null {
    const heroDef = Game.HERO_DEFS[player.civType];
    // Prefer current settlement for respawn; fall back to historical start position
    const settlement = this.allBuildings.find(
      b => b.playerId === player.id && b.type === BuildingType.SETTLEMENT && b.isAlive(),
    );
    const [baseCol, baseRow] = settlement
      ? [settlement.col, settlement.row]
      : START_POSITIONS[player.civType];
    const pos = this.map.findWalkableNear(baseCol, baseRow, 4);
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
      this.applyCivTraits(unit, player.civType);
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

  private spawnNeutralVillages() {
    // 4 villages spread across the map, away from starting positions
    const positions: [number, number][] = [
      [33, 22], [15, 18], [50, 30], [28, 44],
    ];
    for (const [col, row] of positions) {
      const pos = this.map.findWalkableNear(col, row, 6);
      if (!pos) continue;
      const def = BUILDING_DEFS[BuildingType.VILLAGE];
      const village = new Building(
        BuildingType.VILLAGE, def,
        -1, // neutral — no player owns it
        pos[0], pos[1],
        0x8a9a60, // mossy grey-green neutral color
        CivilizationType.AZTEC, // unused for village mesh
      );
      village.buildProgress = 1;
      village.hp = village.maxHp;
      (village as any).state = 'COMPLETE';
      village.progressBar.visible = false;
      this.allBuildings.push(village);
    }
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

  get dayT(): number { return (this.gameTime % 480) / 480; }
  get isNight(): boolean { const d = this.dayT; return d > 0.75 || d < 0.15; }

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

  /** Delta time of the last update call — available to subsystems like ResourceSystem. */
  lastDt = 0;

  update(dt: number) {
    if (this.status !== 'PLAYING' || this.paused) return;

    this.lastDt = dt;
    this.gameTime += dt;

    // Precompute settlement, temple, and storehouse positions per player for proximity effects
    const settlementsByPlayer = new Map<number, { col: number; row: number }[]>();
    const templesByPlayer     = new Map<number, { col: number; row: number }[]>();
    const storehousesByPlayer = new Map<number, { col: number; row: number }[]>();
    const unitsByPlayer = new Map<number, Unit[]>();
    for (const u of this.allUnits) {
      if (!unitsByPlayer.has(u.playerId)) unitsByPlayer.set(u.playerId, []);
      unitsByPlayer.get(u.playerId)!.push(u);
    }
    for (const b of this.allBuildings) {
      if (!b.isAlive() || !b.isComplete()) continue;
      if (b.type === BuildingType.SETTLEMENT) {
        if (!settlementsByPlayer.has(b.playerId)) settlementsByPlayer.set(b.playerId, []);
        settlementsByPlayer.get(b.playerId)!.push({ col: b.col, row: b.row });
      }
      if (b.type === BuildingType.TEMPLE) {
        if (!templesByPlayer.has(b.playerId)) templesByPlayer.set(b.playerId, []);
        templesByPlayer.get(b.playerId)!.push({ col: b.col, row: b.row });
      }
      if (b.type === BuildingType.STOREHOUSE) {
        if (!storehousesByPlayer.has(b.playerId)) storehousesByPlayer.set(b.playerId, []);
        storehousesByPlayer.get(b.playerId)!.push({ col: b.col, row: b.row });
      }
    }

    for (const unit of this.allUnits) {
      // Near settlement (4 tiles) OR near temple (5 tiles) → boosted healing & morale regen
      const settlements = settlementsByPlayer.get(unit.playerId) ?? [];
      const temples     = templesByPlayer.get(unit.playerId)     ?? [];
      unit._nearSettlement = settlements.some(
        s => Math.abs(unit.col - s.col) <= 4 && Math.abs(unit.row - s.row) <= 4,
      ) || temples.some(
        t => Math.abs(unit.col - t.col) <= 5 && Math.abs(unit.row - t.row) <= 5,
      );
      // Storehouses act as field supply depots — within 4 tiles replenishes ammo
      const storehouses = storehousesByPlayer.get(unit.playerId) ?? [];
      unit._nearSupplyDepot = storehouses.some(
        s => Math.abs(unit.col - s.col) <= 4 && Math.abs(unit.row - s.row) <= 4,
      );
      // Isolated penalty: no friendly alive unit within 6 tiles → half morale regen
      const allyUnits = unitsByPlayer.get(unit.playerId) ?? [];
      unit._isolated = allyUnits.filter(u => u !== unit && u.isAlive()).every(
        ally => Math.abs(unit.col - ally.col) > 6 || Math.abs(unit.row - ally.row) > 6,
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
    this.newlyPanickedUnits = [];
    this.newlyGarrisonedUnits = [];
    this.newlyLeveledUpUnits = [];
    this.newlyEliminatedPlayers = [];
    this.newlyVisibleEnemyHeroes = [];
    this.newlyResearchedUpgrades = [];
    this.newTaunts = [];

    // Collect units that leveled up this frame (justLeveledUp reset below)
    for (const u of this.allUnits) {
      if (u.justLeveledUp) { this.newlyLeveledUpUnits.push(u); u.justLeveledUp = false; }
    }

    // Track civilization eliminations: fire event first time a player loses their last settlement
    for (const p of this.players) {
      if (p.id === this.humanPlayerId) continue;
      const hasSett = this.hasSettlement(p.id);
      if (hasSett) {
        this._hadSettlement.add(p.id);
      } else if (this._hadSettlement.has(p.id) && !this.newlyEliminatedPlayers.some(e => e.id === p.id)) {
        this._hadSettlement.delete(p.id);
        this.newlyEliminatedPlayers.push(p);
      }
    }

    // Enemy hero detection: notify human when an enemy hero enters their field of view
    {
      const humanFog = this.fog.getFog(this.humanPlayerId);
      if (humanFog) {
        const nowVisible = new Set<number>();
        for (const u of this.allUnits) {
          if (!u.isHero || !u.isAlive() || u.playerId === this.humanPlayerId) continue;
          if (humanFog.canSeeUnit(u, this.humanPlayerId)) {
            nowVisible.add(u.id);
            if (!this._visibleEnemyHeroIds.has(u.id)) {
              this.newlyVisibleEnemyHeroes.push(u);
            }
          }
        }
        this._visibleEnemyHeroIds = nowVisible;
      }
    }

    // Garrison: units ordered into a building enter when they get close
    for (const u of this.allUnits) {
      if (!u.isAlive() || !u.garrisonTarget || u.garrisonedIn !== null) continue;
      const b = u.garrisonTarget;
      if (!b.isAlive() || !b.isComplete() || b.garrison.length >= b.garrisonCapacity) {
        u.garrisonTarget = null;
        continue;
      }
      const d = Math.sqrt((u.col - b.col) ** 2 + (u.row - b.row) ** 2);
      if (d <= 2.2) {
        u.garrisonTarget = null;
        this.garrisonUnit(u, b);
      }
    }

    // Garrison upkeep: drop the dead; collapsed buildings spill survivors into the rubble
    for (const b of this.allBuildings) {
      if (b.garrison.length === 0) continue;
      if (b.isAlive()) {
        b.garrison = b.garrison.filter(u => u.isAlive());
        // Auto-sortie: when building drops to 50% HP under active attack, defenders sally out
        if (b.hp < b.maxHp * 0.5 && b.garrison.length > 0) {
          const attackers = this.allUnits.filter(
            u => u.isAlive() && u.playerId !== b.playerId && u.attackBuildingTarget === b,
          );
          if (attackers.length > 0) {
            const ejected = this.ejectGarrison(b);
            for (const u of ejected) {
              const nearest = attackers.reduce((best, e) =>
                u.distanceTo(e) < u.distanceTo(best) ? e : best,
              );
              u.attackTarget = nearest;
              u.state = UnitState.ATTACKING;
            }
            if (ejected.length > 0 && b.playerId === this.humanPlayerId) {
              this.pendingEventMessages.push(`⚔️ ¡La guarnición sale a defender! ${ejected.length} guerrero${ejected.length > 1 ? 's' : ''} contraatacan`);
            }
          }
        }
      } else {
        const survivors = this.ejectGarrison(b);
        for (const u of survivors) u.takeDamage(25);
      }
    }

    // Auto-garrison: critically wounded non-hero units (<15% HP) that are idle near a
    // friendly garrisonable building seek shelter automatically.
    for (const unit of this.allUnits) {
      if (!unit.isAlive() || unit.isHero || unit.garrisonedIn !== null) continue;
      if (unit.hp / unit.maxHp >= 0.15) { this._autoGarrisonSent.delete(unit.id); continue; }
      if (this._autoGarrisonSent.has(unit.id)) continue;
      if (unit.state === UnitState.ATTACKING || unit.state === UnitState.ATTACK_MOVE) continue;
      const refuge = this.allBuildings
        .filter(b => b.playerId === unit.playerId && b.isAlive() && b.isComplete() &&
                     b.garrison.length < b.garrisonCapacity &&
                     Math.hypot(unit.col - b.col, unit.row - b.row) <= 8)
        .sort((a, b2) => Math.hypot(unit.col - a.col, unit.row - a.row) - Math.hypot(unit.col - b2.col, unit.row - b2.row))[0];
      if (!refuge) continue;
      unit.garrisonTarget = refuge;
      const path = findPath(this.map, unit.gridPos(), { col: refuge.col, row: refuge.row }, 200);
      if (path.length > 0) unit.moveTo(path);
      this._autoGarrisonSent.add(unit.id);
    }

    // Garrison food upkeep: garrisoned units consume food (1 per 10s per unit) — bunkering has a cost
    this._garrisonUpkeepTimer += dt;
    if (this._garrisonUpkeepTimer >= 10) {
      this._garrisonUpkeepTimer = 0;
      for (const b of this.allBuildings) {
        if (!b.isAlive() || b.garrison.length === 0) continue;
        const player = this.players[b.playerId];
        if (player) player.resources.food = Math.max(0, player.resources.food - b.garrison.length);
      }
    }

    this.newlyCapturedBuildings = [];
    this.newWarDeclarations = [];
    this.updateCaptures(dt);
    this.updateFormations(dt);

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
        building.tickFire(dt);
        // Garrison-assisted repair: each garrisoned unit heals building at 3 HP/s
        if (building.garrison.length > 0 && building.hp < building.maxHp) {
          building.repairBy(building.garrison.length * 3 * dt);
        }
        if (building.finishedUnit !== null) {
          this.spawnProducedUnit(building);
        }
      }
    }

    for (const worker of this.allWorkers) {
      worker.update(dt, this.map);
    }

    // Worker flee: workers within 5 tiles of any enemy drop their task and run to nearest friendly settlement
    // Also handles auto-repair: idle workers near a damaged own building move to fix it.
    this._workerFleeTimer -= dt;
    if (this._workerFleeTimer <= 0) {
      this._workerFleeTimer = 2;
      for (const worker of this.allWorkers) {
        if (worker.task === WorkerTask.MOVING && worker.path.length > 0) continue; // already moving

        // Flee takes priority over auto-repair
        const threatened = this.allUnits.some(u =>
          u.isAlive() && u.playerId !== worker.playerId &&
          Math.sqrt((u.col - worker.col) ** 2 + (u.row - worker.row) ** 2) <= 5,
        );
        if (threatened) {
          // Cavalry worker harassment: cavalry within 3 tiles loots food directly from the worker's owner
          const nearCav = this.allUnits.find(u =>
            u.isAlive() && u.playerId !== worker.playerId && u.type === UnitType.CAVALRY &&
            Math.sqrt((u.col - worker.col) ** 2 + (u.row - worker.row) ** 2) <= 3,
          );
          if (nearCav) {
            const victim = this.players[worker.playerId];
            const raider = this.players[nearCav.playerId];
            if (victim && raider) {
              const stolen = Math.min(victim.resources.food, 5 + Math.floor(Math.random() * 6));
              if (stolen > 0) {
                victim.resources.food -= stolen;
                raider.resources.food += stolen;
                if (nearCav.playerId === this.humanPlayerId) {
                  this.pendingEventMessages.push(`🐎 ¡Pillaje! Caballería saquea trabajadores enemigos +${stolen}🌽`);
                } else if (worker.playerId === this.humanPlayerId) {
                  this.pendingEventMessages.push(`⚠️ ¡Caballería enemiga hostiga a tus trabajadores! −${stolen}🌽`);
                }
              }
            }
          }
          const refuge = this.allBuildings
            .filter(b => b.playerId === worker.playerId && b.isAlive() &&
              (b.type === BuildingType.SETTLEMENT || b.type === BuildingType.BARRACKS))
            .sort((a, b) =>
              ((worker.col - a.col) ** 2 + (worker.row - a.row) ** 2) -
              ((worker.col - b.col) ** 2 + (worker.row - b.row) ** 2),
            )[0];
          if (!refuge) continue;
          const near = this.map.findWalkableNear(refuge.col, refuge.row, 3);
          if (!near) continue;
          const path = findPath(this.map, { col: Math.round(worker.col), row: Math.round(worker.row) }, { col: near[0], row: near[1] }, 300);
          if (path.length > 0) {
            worker.path = path;
            worker.pathIndex = 0;
            worker.setTask(WorkerTask.MOVING, near[0], near[1]);
          }
          continue;
        }

        // Auto-repair: idle workers within 6 tiles of a damaged friendly building walk over and fix it
        if (worker.task !== WorkerTask.IDLE) continue;
        let nearestDmgBldg: import('./Building').Building | null = null;
        let nearestDist = Infinity;
        for (const b of this.allBuildings) {
          if (b.playerId !== worker.playerId || !b.isAlive() || !b.isComplete()) continue;
          if (b.hp >= b.maxHp) continue;
          const d = Math.sqrt((worker.col - b.col) ** 2 + (worker.row - b.row) ** 2);
          if (d <= 6 && d < nearestDist) { nearestDist = d; nearestDmgBldg = b; }
        }
        if (!nearestDmgBldg) continue;
        const near = this.map.findWalkableNear(nearestDmgBldg.col, nearestDmgBldg.row, 2);
        if (!near) continue;
        const path = findPath(this.map, { col: Math.round(worker.col), row: Math.round(worker.row) }, { col: near[0], row: near[1] }, 200);
        if (path.length > 0) {
          worker.repairTarget = nearestDmgBldg;
          worker.path         = path;
          worker.pathIndex    = 0;
          worker.task         = WorkerTask.MOVING;
        }
      }
    }

    for (const node of this.resourceNodes) {
      node.updateVisibility();
      const wasEmpty = node.isEmpty();
      node.updateRegen(dt);
      if (!wasEmpty && node.isEmpty()) {
        this.newlyDepletedNodes.push(node);
        this._lowNodeWarned.delete(node.id); // reset warning so it can re-fire after regen
      }
      if (node.justRegenerated) this.newlyRegeneratedNodes.push(node);
      // Low-resource warning: fire once when node drops below 20% while a human worker is on it
      if (!this._lowNodeWarned.has(node.id) && !node.isEmpty() &&
          node.amount / node.maxAmount < 0.2) {
        const gatherTasks = new Set([WorkerTask.GATHERING_FOOD, WorkerTask.GATHERING_GOLD, WorkerTask.GATHERING_STONE]);
        const humanWorking = this.allWorkers.some(
          w => w.playerId === this.humanPlayerId &&
          gatherTasks.has(w.task) &&
          Math.hypot(w.col - node.col, w.row - node.row) <= 2,
        );
        if (humanWorking) {
          this._lowNodeWarned.add(node.id);
          const icon = node.type === ResourceType.FOOD ? '🌽' : node.type === ResourceType.GOLD ? '⚜️' : '🪨';
          this.pendingEventMessages.push(`${icon} ¡Recurso casi agotado! Un trabajador tuyo necesita una nueva fuente pronto`);
        }
      }
    }

    this.weatherChangeEvent = this.weather.update(dt);
    // Wet ground slows movement: rain 0.9×, storm 0.8×, otherwise normal
    Unit.weatherSpeedMult = this.weather.state === 'STORM' ? 0.8 : this.weather.state === 'RAIN' ? 0.9 : 1.0;
    this.damageEvents = this.combat.update(this.allUnits, this.map, this.weather, this.isNight);

    // Track kills per player from this frame's damage events
    for (const evt of this.damageEvents) {
      if (!evt.target.isAlive() && evt.attacker) {
        this.killsByPlayer.set(evt.attacker.playerId, (this.killsByPlayer.get(evt.attacker.playerId) ?? 0) + 1);
        this._killsThisCycle.set(evt.attacker.playerId, (this._killsThisCycle.get(evt.attacker.playerId) ?? 0) + 1);
        // Kill morale boost: victory euphoria (+5 morale, cap 70; night raids cap 80)
        const nightKillBoost = this.isNight ? 10 : 5;
        const nightKillCap   = this.isNight ? 80 : 70;
        if (!evt.attacker.isHero && evt.attacker.morale < nightKillCap) {
          evt.attacker.morale = Math.min(nightKillCap, evt.attacker.morale + nightKillBoost);
        }
        // Hero kill ripple: when a hero lands a killing blow, nearby allies gain morale (American Conquest: champion's presence inspires the line)
        if (evt.attacker.isHero) {
          for (const ally of this.allUnits) {
            if (!ally.isAlive() || ally.playerId !== evt.attacker.playerId || ally === evt.attacker) continue;
            const d = Math.sqrt((ally.col - evt.attacker.col) ** 2 + (ally.row - evt.attacker.row) ** 2);
            if (d <= 6) ally.morale = Math.min(100, ally.morale + 8);
          }
        }
        // AZTEC flower war: each kill earns +5 food for AZTEC players (tribute/captives mechanic)
        const aztecKiller = this.players[evt.attacker.playerId];
        if (!evt.attacker.isHero && aztecKiller?.civType === CivilizationType.AZTEC) {
          aztecKiller.resources.food = Math.min(2000, aztecKiller.resources.food + 5);
        }
        // Army rout tracking: count friendly deaths in the 30s window
        if (evt.target.playerId === this.humanPlayerId) this._recentHumanDeaths++;
      }
    }

    // Morale shock: allies near a fallen comrade lose morale (hero deaths hit harder)
    for (const evt of this.damageEvents) {
      if (evt.target.isAlive()) continue;
      const dead   = evt.target;
      const radius = dead.isHero ? 10 : 6;
      const loss   = dead.isHero ? 25 : 12;
      for (const ally of this.allUnits) {
        if (!ally.isAlive() || ally.playerId !== dead.playerId || ally === dead) continue;
        const d = Math.sqrt((ally.col - dead.col) ** 2 + (ally.row - dead.row) ** 2);
        if (d <= radius) ally.loseMorale(loss);
      }
    }

    // Outnumber stress: being focused by 3+ enemies drains morale faster
    const focusCount = new Map<number, number>(); // unitId → active enemy attacker count
    for (const u of this.allUnits) {
      if (!u.isAlive() || !u.attackTarget?.isAlive() || u.playerId === u.attackTarget.playerId) continue;
      focusCount.set(u.attackTarget.id, (focusCount.get(u.attackTarget.id) ?? 0) + 1);
    }
    for (const [targetId, count] of focusCount) {
      if (count < 3) continue;
      const target = this.allUnits.find(u => u.id === targetId);
      if (!target?.isAlive() || target.isHero) continue;
      const drain = 4 * dt * (count - 2);
      if (drain >= 0.05) target.loseMorale(drain);
    }

    // Storm morale drain: tropical storms demoralize troops (American Conquest mechanic)
    if (this.stormTimer > 0) {
      for (const u of this.allUnits) {
        if (u.isAlive() && !u.isHero) u.loseMorale(0.5 * dt);
      }
      // Storm lightning: every 5s, open-terrain units risk a lightning strike (3% each)
      this._lightningTimer += dt;
      if (this._lightningTimer >= 5) {
        this._lightningTimer = 0;
        const openTerrain = new Set([TerrainType.GRASS, TerrainType.DESERT, TerrainType.BEACH]);
        for (const u of this.allUnits) {
          if (!u.isAlive() || u.garrisonedIn !== null || u.isHero) continue;
          const tile = this.map.getTile(Math.round(u.col), Math.round(u.row));
          if (!tile || !openTerrain.has(tile.terrain)) continue;
          if (Math.random() > 0.03) continue; // 3% chance
          const dmg = 15 + Math.floor(Math.random() * 11); // 15–25 lightning damage
          u.takeDamage(dmg);
          u.burning = Math.max(u.burning, 3);
          // Nearby allies panic from the terrifying strike
          for (const ally of this.allUnits) {
            if (!ally.isAlive() || ally === u || ally.playerId !== u.playerId) continue;
            if (Math.hypot(ally.col - u.col, ally.row - u.row) <= 3) ally.loseMorale(12);
          }
          if (u.playerId === this.humanPlayerId && u.isAlive()) {
            this.pendingEventMessages.push(`⚡ ¡Rayo! Una de tus tropas ha sido alcanzada durante la tormenta`);
          }
        }
      }
    } else {
      this._lightningTimer = 0; // reset when storm ends
    }

    // Hero auto-rally: when the hero's morale drops below 40, they steady their troops within 8 tiles
    {
      const hero = this.humanPlayer.aliveUnits.find(u => u.isHero);
      if (hero && hero.morale < 40 && hero.rallyCooldown <= 0) {
        hero.rallyCooldown = 90;
        let rallied = 0;
        for (const u of this.humanPlayer.aliveUnits) {
          if (u === hero) continue;
          const d = Math.sqrt((u.col - hero.col) ** 2 + (u.row - hero.row) ** 2);
          if (d <= 8) { u.morale = Math.min(80, u.morale + 20); rallied++; }
        }
        if (rallied > 0) {
          this.pendingEventMessages.push(`🛡️ ¡${hero.heroName ?? 'Tu héroe'} arenga a las tropas! ${rallied} unidad${rallied > 1 ? 'es' : ''} recuperan moral`);
        }
      }
    }

    // Pre-starvation hunger warning: alert the human player when food reserves are low
    {
      const hFood = this.humanPlayer.resources.food;
      if (hFood <= 30 && !this._lowFoodNotified && this.humanPlayer.aliveUnits.length > 0) {
        this._lowFoodNotified = true;
        this.pendingEventMessages.push(`🌽 ¡Reservas de comida bajas! (${Math.floor(hFood)}) — Asegura recursos antes de que la moral caiga`);
      } else if (hFood > 60) {
        this._lowFoodNotified = false; // reset once food recovers
      }
    }

    // Starvation: food < 10 → troops are hungry, morale breaks (AC mechanic: supply lines matter)
    for (const p of this.players) {
      if (p.resources.food < 10) {
        for (const u of p.aliveUnits) {
          if (!u.isHero) u.loseMorale(1.5 * dt);
        }
      }
    }

    // Supply line morale: units > 15 tiles from any friendly building slowly lose cohesion
    // (AC mechanic: stretched supply lines demoralise isolated troops in enemy territory)
    this._supplyLineTimer += dt;
    if (this._supplyLineTimer >= 5) {
      this._supplyLineTimer = 0;
      const bldgsByPlayer = new Map<number, { col: number; row: number }[]>();
      for (const b of this.allBuildings) {
        if (!b.isAlive()) continue;
        if (!bldgsByPlayer.has(b.playerId)) bldgsByPlayer.set(b.playerId, []);
        bldgsByPlayer.get(b.playerId)!.push({ col: b.col, row: b.row });
      }
      for (const unit of this.allUnits) {
        if (!unit.isAlive() || unit.isHero || unit.garrisonedIn !== null) continue;
        const bldgs = bldgsByPlayer.get(unit.playerId) ?? [];
        let minDist = Infinity;
        for (const b of bldgs) {
          const d = Math.sqrt((unit.col - b.col) ** 2 + (unit.row - b.row) ** 2);
          if (d < minDist) minDist = d;
        }
        if (minDist > 15) unit.loseMorale(2); // ~0.4 morale/s when isolated far from base
      }

      // Out-of-ammo auto-retreat: human ranged units with no ammo left retreat to resupply
      const humanResupplyBldgs = this.allBuildings.filter(
        b => b.playerId === this.humanPlayerId && b.isAlive() &&
          (b.type === BuildingType.SETTLEMENT || b.type === BuildingType.STOREHOUSE),
      );
      for (const unit of this.humanPlayer.aliveUnits) {
        if (!unit.outOfAmmo || unit.type === UnitType.CANNON) continue;
        if (unit.garrisonedIn !== null || unit.panicked) continue;
        if (unit.state === UnitState.MOVING) { this._ammoRetreatSent.delete(unit.id); continue; }
        if (this._ammoRetreatSent.has(unit.id)) continue;
        let closest: typeof humanResupplyBldgs[0] | null = null;
        let closestDist = Infinity;
        for (const b of humanResupplyBldgs) {
          const d = Math.sqrt((unit.col - b.col) ** 2 + (unit.row - b.row) ** 2);
          if (d < closestDist) { closestDist = d; closest = b; }
        }
        if (!closest) continue;
        const near = this.map.findWalkableNear(closest.col, closest.row, 3);
        if (!near) continue;
        const path = findPath(this.map, unit.gridPos(), { col: near[0], row: near[1] }, 300);
        if (path.length > 0) {
          unit.moveTo(path);
          this._ammoRetreatSent.add(unit.id);
        }
      }
      // Clean up the retreat-sent set for units that have resupplied
      for (const id of this._ammoRetreatSent) {
        const u = this.allUnits.find(u => u.id === id);
        if (!u || !u.isAlive() || !u.outOfAmmo) this._ammoRetreatSent.delete(id);
      }

      // Cannon siege-ready: notify once per cannon when it reaches 4s stationary (unlimbered)
      for (const unit of this.humanPlayer.aliveUnits) {
        if (unit.type !== UnitType.CANNON || !unit.isAlive()) continue;
        const isReady = unit.stationaryTimer >= 4;
        if (isReady && !this._cannonSiegeReady.has(unit.id)) {
          this._cannonSiegeReady.add(unit.id);
          this.pendingEventMessages.push('💣 ¡Cañón en posición de asedio! Listo para disparar con daño máximo');
        }
        if (!isReady) this._cannonSiegeReady.delete(unit.id);
      }
    }

    // Fire spread: burning units have a 25% chance per second to ignite adjacent units.
    // In jungle terrain the fire behaves as wildfire: 2× spread chance, 2-tile radius.
    this._fireSpreadTimer += dt;
    if (this._fireSpreadTimer >= 1) {
      this._fireSpreadTimer = 0;
      const burningUnits = this.allUnits.filter(u => u.isAlive() && u.burning > 0);
      for (const burner of burningUnits) {
        const burnerTile = this.map.getTile(Math.round(burner.col), Math.round(burner.row));
        const inJungle   = burnerTile?.terrain === TerrainType.JUNGLE;
        const spreadChance = inJungle ? 0.50 : 0.25;
        const spreadRadius = inJungle ? 2.0  : 1.5;
        if (Math.random() > spreadChance) continue;
        for (const other of this.allUnits) {
          if (!other.isAlive() || other === burner || other.burning > 0) continue;
          if (Math.hypot(other.col - burner.col, other.row - burner.row) > spreadRadius) continue;
          other.burning = Math.max(other.burning, 3); // 3s burn; doesn't extend existing longer burns
        }
      }
    }

    // War exhaustion: prolonged combat (>4 min since first damage) slowly drains morale.
    // Heroes are immune. Incentivises decisive victory rather than endless attrition.
    if (this._firstCombatTime < 0 && this.damageEvents.length > 0) {
      this._firstCombatTime = this.gameTime;
    }
    if (this._firstCombatTime >= 0 && this.gameTime - this._firstCombatTime > 240) {
      if (!this._warExhaustionNotified) {
        this._warExhaustionNotified = true;
        this.pendingEventMessages.push('⚔️ ¡Agotamiento de guerra! 4+ min de combate — todas las tropas pierden moral lentamente. ¡Decide la batalla ya!');
      }
      this._warExhaustionTimer += dt;
      if (this._warExhaustionTimer >= 8) {
        this._warExhaustionTimer = 0;
        for (const unit of this.allUnits) {
          if (!unit.isAlive() || unit.isHero || unit.garrisonedIn !== null) continue;
          unit.loseMorale(1); // ~0.125 morale/s — gradual but relentless pressure
        }
      }
    }

    // Population pressure: at ≥90% pop cap troops are overcrowded and morale suffers
    {
      const cap   = this.getPopCap(this.humanPlayerId);
      const count = this.humanPlayer.aliveUnits.length;
      const ratio = count / cap;
      if (ratio >= 0.9) {
        for (const u of this.humanPlayer.aliveUnits) {
          if (!u.isHero) u.loseMorale(0.5 * dt);
        }
        if (!this._popPressureNotified) {
          this._popPressureNotified = true;
          this.pendingEventMessages.push(`👥 ¡Tropas abarrotadas! ${count}/${cap} unidades — construye un Almacén para ampliar el límite`);
        }
      } else if (ratio < 0.8) {
        this._popPressureNotified = false;
      }
    }

    // Dynamic difficulty rubber-band: check every 30s and subtly adjust AI strength
    // to keep the game competitive without the player noticing heavy-handed intervention.
    this._rubberBandTimer += dt;
    if (this._rubberBandTimer >= 30 && this.difficulty === 'normal') {
      this._rubberBandTimer = 0;
      const humanCount = this.humanPlayer.aliveUnits.length;
      const aiMaxCount = this.players
        .filter(p => !p.isHuman && !p.isDefeated())
        .reduce((max, p) => Math.max(max, p.aliveUnits.length), 0);
      const ratio = humanCount / Math.max(1, aiMaxCount);
      // Player is crushing it (3:1+ advantage) → give weakest AI a morale boost
      if (ratio >= 3) {
        const weakestAI = this.players
          .filter(p => !p.isHuman && !p.isDefeated())
          .sort((a, b) => a.aliveUnits.length - b.aliveUnits.length)[0];
        if (weakestAI) {
          for (const u of weakestAI.aliveUnits) {
            if (!u.isHero) u.morale = Math.min(100, u.morale + 15);
          }
          weakestAI.resources.food = Math.min(2000, weakestAI.resources.food + 50);
          weakestAI.resources.gold = Math.min(2000, weakestAI.resources.gold + 30);
        }
      }
      // Player is getting overwhelmed (1:3+ disadvantage) → give human a subtle morale boost
      if (ratio <= 0.33 && humanCount > 0) {
        for (const u of this.humanPlayer.aliveUnits) {
          if (!u.isHero && u.morale < 70) u.morale = Math.min(70, u.morale + 10);
        }
      }
    }

    // Battle momentum: every 45s, reward players who won the firefight with a morale boost.
    // 3+ kills → "impulso de batalla" (+8 morale to all alive units).
    this._momentumTimer += dt;
    if (this._momentumTimer >= 45) {
      this._momentumTimer = 0;
      for (const p of this.players) {
        const kills = this._killsThisCycle.get(p.id) ?? 0;
        if (kills >= 3) {
          for (const u of p.aliveUnits) {
            if (!u.isHero) u.morale = Math.min(100, u.morale + 8);
          }
          if (p.id === this.humanPlayerId) {
            this.pendingEventMessages.push(`⚔️ ¡Impulso de batalla! ${kills} bajas enemigas — tus tropas ganan moral (+8)`);
          }
        }
      }
      this._killsThisCycle.clear();
    }

    // Army rout: 5+ human units lost within 30s → mass panic on low-morale survivors
    this._deathWindowTimer -= dt;
    if (this._deathWindowTimer <= 0) {
      this._deathWindowTimer = 30;
      this._recentHumanDeaths = 0;
      this._routFired = false;
    }
    if (this._recentHumanDeaths >= 5 && !this._routFired) {
      this._routFired = true;
      let routCount = 0;
      for (const u of this.humanPlayer.aliveUnits) {
        if (!u.isHero && u.morale < 60 && !u.panicked) {
          u.loseMorale(40);
          routCount++;
        }
      }
      if (routCount > 0) {
        this.pendingEventMessages.push(`💀 ¡DESBANDADA GENERAL! ${routCount} unidad${routCount > 1 ? 'es' : ''} en fuga`);
      }
    }

    // Hero passive morale aura: hero nearby slowly boosts allied morale (+1/s within 6 tiles)
    const heroesByPlayer = new Map<number, Unit>();
    for (const u of this.allUnits) {
      if (u.isHero && u.isAlive()) heroesByPlayer.set(u.playerId, u);
    }
    for (const [, hero] of heroesByPlayer) {
      for (const ally of this.allUnits) {
        if (!ally.isAlive() || ally.isHero || ally.playerId !== hero.playerId || ally.panicked) continue;
        if (ally.distanceTo(hero) <= 6 && ally.morale < 80) {
          ally.morale = Math.min(80, ally.morale + dt * 1.0);
        }
      }
    }

    // Panic check: morale ≤ 25 breaks the unit unless its hero stands nearby
    for (const u of this.allUnits) {
      if (!u.isAlive() || u.isHero || u.panicked || u.morale > 25 || u.garrisonedIn !== null) continue;
      const hero = heroesByPlayer.get(u.playerId);
      if (hero && u.distanceTo(hero) <= 8) {
        u.morale = 35; // the hero steadies the line
        continue;
      }
      u.panicked = true;
      u.attackTarget = null;
      u.attackBuildingTarget = null;
      this.newlyPanickedUnits.push(u);
      // Morale contagion: routing spreads fear to nearby allies (American Conquest core mechanic)
      for (const ally of this.allUnits) {
        if (!ally.isAlive() || ally.playerId !== u.playerId || ally === u || ally.isHero || ally.panicked) continue;
        const d = Math.sqrt((ally.col - u.col) ** 2 + (ally.row - u.row) ** 2);
        if (d <= 5) ally.loseMorale(10); // panic is contagious within 5 tiles
      }
      // Rout: flee toward the nearest friendly building
      const refuge = this.allBuildings
        .filter(b => b.playerId === u.playerId && b.isAlive())
        .sort((a, b) =>
          ((u.col - a.col) ** 2 + (u.row - a.row) ** 2) -
          ((u.col - b.col) ** 2 + (u.row - b.row) ** 2),
        )[0];
      if (refuge) {
        const near = this.map.findWalkableNear(refuge.col, refuge.row, 3);
        if (near) {
          const path = findPath(this.map, u.gridPos(), { col: near[0], row: near[1] }, 300);
          if (path.length > 0) {
            u.path      = path;
            u.pathIndex = 0;
            u.state     = UnitState.MOVING;
          }
        }
      }
    }

    this.updateTowerAttacks(dt);
    this.updateGarrisonFire(dt);
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

    // Ranged kiting: every 0.4s, ranged non-cannon units back away from adjacent enemy
    // melee units. IDLE units kite proactively; ATTACKING units retreat when meleePinned.
    // Applies to human and AI alike (AC fire-and-fall-back behaviour).
    this._kiteTimer += dt;
    if (this._kiteTimer >= 0.4) {
      this._kiteTimer = 0;
      for (const unit of this.allUnits) {
        if (!unit.isAlive() || unit.garrisonedIn !== null || unit.panicked) continue;
        if (unit.attackRange <= 1.5 || unit.type === UnitType.CANNON) continue;
        if (unit.outOfAmmo) continue;
        const isIdleKite      = unit.state === UnitState.IDLE;
        const isAttackingPinned = unit.meleePinned &&
          (unit.state === UnitState.ATTACKING || unit.state === UnitState.ATTACK_MOVE);
        if (!isIdleKite && !isAttackingPinned) continue;
        let nearestDist = Infinity;
        let nearestMelee: Unit | null = null;
        for (const other of this.allUnits) {
          if (!other.isAlive() || other.playerId === unit.playerId || other.garrisonedIn !== null) continue;
          if (other.attackRange > 1.5) continue;
          const d = unit.distanceTo(other);
          if (d < nearestDist) { nearestDist = d; nearestMelee = other; }
        }
        const triggerDist = isAttackingPinned ? 1.8 : 2.5;
        if (!nearestMelee || nearestDist > triggerDist) continue;
        const dc = unit.col - nearestMelee.col;
        const dr = unit.row - nearestMelee.row;
        const len = Math.sqrt(dc * dc + dr * dr) || 1;
        const fleeSteps = isAttackingPinned ? 4 : 3; // pinned units flee a bit farther
        const tCol = Math.round(unit.col + (dc / len) * fleeSteps);
        const tRow = Math.round(unit.row + (dr / len) * fleeSteps);
        const near = this.map.findWalkableNear(tCol, tRow, 2);
        if (near) {
          const path = findPath(this.map, unit.gridPos(), { col: near[0], row: near[1] }, 80);
          if (path.length > 0) unit.moveTo(path);
        }
      }
    }

    // Random events
    this.pendingEventMessages = [];
    this._eventTimer -= dt;
    if (this._eventTimer <= 0) {
      this._eventTimer = 60 + Math.random() * 60;
      this.fireRandomEvent();
    }

    // Capital-loss morale shock: when a settlement falls, its owner's surviving
    // troops are demoralized by the loss of their capital (American Conquest mechanic)
    for (const b of this.newlyDestroyedBuildings) {
      // Collapse debris: any unit within 2 tiles takes rubble damage (attacker and defender alike)
      for (const unit of this.allUnits) {
        if (!unit.isAlive() || unit.garrisonedIn !== null) continue;
        if (Math.hypot(unit.col - b.col, unit.row - b.row) > 2.0) continue;
        const debris = Math.floor(8 + Math.random() * 12); // 8–19 debris damage
        unit.takeDamage(debris);
        if (!unit.isHero) unit.loseMorale(8); // terrifying to be buried under rubble
      }
    }
    for (const b of this.newlyDestroyedBuildings) {
      if (b.type !== BuildingType.SETTLEMENT || this._capitalShockDone.has(b.id)) continue;
      this._capitalShockDone.add(b.id);
      // Only shock if the owner still has another settlement-less stand to make
      const owner = this.players[b.playerId];
      if (!owner) continue;
      let shocked = 0;
      for (const u of owner.aliveUnits) {
        if (u.isHero) continue;
        u.loseMorale(30);
        shocked++;
      }
      if (shocked > 0 && b.playerId === this.humanPlayerId) {
        this.pendingEventMessages.push('💔 ¡Tu asentamiento ha caído! Las tropas pierden la moral');
      }
    }

    // Enemy approach alerts — check every 15s
    this._towerAlertTimer = Math.max(0, this._towerAlertTimer - dt);
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

    // Village income: every 30s, each captured village pays out food+gold to its owner
    this.villageIncomeEvents = [];
    this._villageIncomeTimer -= dt;
    if (this._villageIncomeTimer <= 0) {
      this._villageIncomeTimer = 30;
      const incomeByPlayer = new Map<number, { food: number; gold: number }>();
      for (const b of this.allBuildings) {
        if (b.type !== BuildingType.VILLAGE || b.playerId < 0 || !b.isAlive()) continue;
        const curr = incomeByPlayer.get(b.playerId) ?? { food: 0, gold: 0 };
        curr.food += 10; curr.gold += 6;
        incomeByPlayer.set(b.playerId, curr);
      }
      for (const [pid, income] of incomeByPlayer) {
        const p = this.players[pid];
        if (!p) continue;
        p.resources.food = Math.min(2000, p.resources.food + income.food);
        p.resources.gold = Math.min(2000, p.resources.gold + income.gold);
        this.villageIncomeEvents.push({ playerId: pid, food: income.food, gold: income.gold });
      }
    }

    // Auto-brace: spear units auto-switch to PHALANX when enemy cavalry closes within 6 tiles
    this._autobraceTimer -= dt;
    if (this._autobraceTimer <= 0) {
      this._autobraceTimer = 2.0;
      const spearTypes = new Set([UnitType.SPEARMAN, UnitType.QUECHUA, UnitType.ANTIS_WARRIOR, UnitType.CHAKANA_GUARD]);
      const humanUnits = this.allUnits.filter(u => u.playerId === this.humanPlayerId && u.isAlive() && !u.panicked && u.garrisonedIn === null);
      const enemyCavalry = this.allUnits.filter(u => u.playerId !== this.humanPlayerId && u.isAlive() && u.type === UnitType.CAVALRY);
      let braceCount = 0;
      for (const u of humanUnits) {
        if (!spearTypes.has(u.type)) continue;
        const cavNear = enemyCavalry.some(c => Math.abs(c.col - u.col) <= 6 && Math.abs(c.row - u.row) <= 6);
        if (cavNear && u.formation !== 'PHALANX') {
          u.setFormation('PHALANX');
          braceCount++;
        }
      }
      if (braceCount > 0 && !this._autobraceNotified) {
        this._autobraceNotified = true;
        this.pendingEventMessages.push(`💂 ${braceCount} lancero${braceCount > 1 ? 's' : ''} en posición defensiva — caballería detectada`);
      }
      // Reset flag when no cavalry threat remains
      if (enemyCavalry.length === 0) this._autobraceNotified = false;
    }

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
    // Apply civ traits and player upgrades to new unit
    this.applyCivTraits(unit, player.civType);
    if (player.upgrades.metallurgy)    unit.attack += 6;
    if (player.upgrades.logistics)     unit.speed  += 0.4;
    if (player.upgrades.fortification) { unit.maxHp += 50; unit.hp += 50; }
    // Veteran culture: 5+ level-3 veterans in the army train recruits at level 2
    const eliteCount = player.aliveUnits.filter(u => u.level >= 3 && !u.isHero).length;
    if (eliteCount >= 5) unit.gainXP(50); // threshold for level 1→2 is 50 XP
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
      // HOLD units silently re-acquire nearest in-range enemy after each kill (no movement)
      const isHold = unit.state === UnitState.HOLD;
      if (isHold && unit.attackTarget === null && unit.attackBuildingTarget === null) {
        let best: Unit | null = null;
        let bestDist = unit.attackRange + 1.5;
        for (const e of this.allUnits) {
          if (!e.isAlive() || e.playerId === unit.playerId) continue;
          const d = unit.distanceTo(e);
          if (d < bestDist) { bestDist = d; best = e; }
        }
        if (best) unit.attackTarget = best;
        continue;
      }
      // Patrolling units also auto-attack enemies within sight
      if (unit.state !== UnitState.IDLE && unit.patrolA === null) continue;
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

  private _formationTimer = 0;

  /** Close ranks: a unit with 3+ allies within 3 tiles fights in formation. Throttled to ~1 Hz. */
  // Complementary unit-type pairs that grant a synergy bonus when within 5 tiles of each other.
  // Inspired by American Conquest combined-arms doctrine.
  private static readonly SYNERGY_PAIRS: [UnitType, UnitType][] = [
    [UnitType.EAGLE_WARRIOR,  UnitType.JAGUAR_KNIGHT],  // Aztec elite melee duo
    [UnitType.QUECHUA,        UnitType.ANTIS_WARRIOR],  // Inca highland warriors
    [UnitType.AHAU_WARRIOR,   UnitType.ARCHER],          // Maya hero + archers
    [UnitType.CAVALRY,        UnitType.ARQUEBUSIER],     // Conquistador combined arms
    [UnitType.CUACHIC,        UnitType.ATLATL],          // Aztec elite + javelin support
  ];

  // Hero passive specialization: hero's signature unit types get +15% damage within 6 tiles.
  private static readonly HERO_POWER_MAP: Partial<Record<UnitType, Set<UnitType>>> = {
    [UnitType.EAGLE_WARRIOR]: new Set([UnitType.JAGUAR_KNIGHT, UnitType.CUACHIC, UnitType.ATLATL]),
    [UnitType.AHAU_WARRIOR]:  new Set([UnitType.ARCHER, UnitType.SLINGER]),
    [UnitType.CHAKANA_GUARD]: new Set([UnitType.QUECHUA, UnitType.ANTIS_WARRIOR]),
    [UnitType.CAVALRY]:       new Set([UnitType.ARQUEBUSIER]),
  };

  private updateFormations(dt: number) {
    this._formationTimer += dt;
    if (this._formationTimer < 0.8) return;
    this._formationTimer = 0;

    const active = this.allUnits.filter(u => u.isAlive() && u.garrisonedIn === null);
    for (const u of active) {
      let allies = 0;
      let hasOfficer = false;
      let hasSynergy = false;
      let hasHeroPower = false;
      for (const o of active) {
        if (o === u || o.playerId !== u.playerId) continue;
        const dc = u.col - o.col, dr = u.row - o.row;
        const d2 = dc * dc + dr * dr;
        if (d2 <= 9) allies++;
        if (!hasOfficer && (o.isHero || o.level >= 3) && d2 <= 25) hasOfficer = true;
        // Synergy: check if this unit forms a complementary pair with an ally within 5 tiles
        if (!hasSynergy && d2 <= 25) {
          hasSynergy = Game.SYNERGY_PAIRS.some(
            ([a, b]) => (u.type === a && o.type === b) || (u.type === b && o.type === a),
          );
        }
        // Hero passive: hero within 6 tiles buffs its signature unit types
        if (!hasHeroPower && o.isHero && d2 <= 36) {
          hasHeroPower = (Game.HERO_POWER_MAP[o.type]?.has(u.type)) ?? false;
        }
      }
      u.inFormation   = allies >= 3;
      u.nearOfficer   = hasOfficer;
      u.nearSynergy   = hasSynergy;
      u.heroPowerBuff = hasHeroPower;
    }
  }

  /** Melee units adjacent to an ungarrisoned enemy building raise its capture meter. */
  private updateCaptures(dt: number) {
    const capturers = new Map<Building, Unit[]>();
    for (const u of this.allUnits) {
      if (!u.isAlive() || !u.captureTarget || u.garrisonedIn !== null) continue;
      const b = u.captureTarget;
      if (!b.isAlive() || !b.isComplete() || b.playerId === u.playerId || b.garrison.length > 0) {
        u.captureTarget = null;
        continue;
      }
      const d = Math.sqrt((u.col - b.col) ** 2 + (u.row - b.row) ** 2);
      if (d > 2.2) continue; // still approaching
      if (!capturers.has(b)) capturers.set(b, []);
      capturers.get(b)!.push(u);
    }

    for (const [b, units] of capturers) {
      b.captureProgress = Math.min(100, b.captureProgress + units.length * 8 * dt);
      if (b.captureProgress >= 100) {
        const newOwner = units[0].playerId;
        const oldOwner = b.playerId;
        const civ = this.players[newOwner]?.civType ?? CivilizationType.AZTEC;
        b.transferTo(newOwner, CIV_COLORS[civ]);
        for (const u of units) u.captureTarget = null;
        this.newlyCapturedBuildings.push({ building: b, fromPlayerId: oldOwner, toPlayerId: newOwner });
      }
    }

    // Contested meters drain when no one is actively capturing
    for (const b of this.allBuildings) {
      if (b.captureProgress > 0 && !capturers.has(b)) {
        b.captureProgress = Math.max(0, b.captureProgress - 6 * dt);
      }
    }
  }

  garrisonUnit(u: Unit, b: Building) {
    b.garrison.push(u);
    u.garrisonedIn = b.id;
    u.path = []; u.pathIndex = 0;
    u.attackTarget = null;
    u.attackBuildingTarget = null;
    u.state = UnitState.IDLE;
    u.setSelected(false);
    u.col = b.col; u.row = b.row;
    u.worldX = b.col * TILE_SIZE;
    u.worldZ = b.row * TILE_SIZE;
    u.mesh.visible = false;
    this.newlyGarrisonedUnits.push(u);
  }

  /** Empty a building's garrison onto walkable tiles around it. Returns the units placed. */
  ejectGarrison(b: Building): Unit[] {
    const out: Unit[] = [];
    for (const u of b.garrison) {
      if (!u.isAlive()) continue;
      const near = this.map.findWalkableNear(
        b.col + Math.floor(Math.random() * 3) - 1,
        b.row + Math.floor(Math.random() * 3) - 1,
        4,
      );
      if (near) {
        u.col = near[0]; u.row = near[1];
        u.worldX = near[0] * TILE_SIZE;
        u.worldZ = near[1] * TILE_SIZE;
      }
      u.garrisonedIn = null;
      u.mesh.visible = true;
      out.push(u);
    }
    b.garrison = [];
    return out;
  }

  /** Ranged units inside a garrison shoot at nearby enemies with extended reach. */
  private updateGarrisonFire(dt: number) {
    for (const b of this.allBuildings) {
      if (!b.isAlive() || b.garrison.length === 0) continue;
      for (const u of b.garrison) {
        if (!u.isAlive()) continue;
        u.attackTimer = Math.max(0, u.attackTimer - dt);
        if (!u.def.isRanged || u.attackTimer > 0) continue;
        const range = u.attackRange + 2; // height advantage
        let nearest: Unit | null = null;
        let nearestDist = range;
        for (const e of this.allUnits) {
          if (!e.isAlive() || e.playerId === b.playerId || e.garrisonedIn !== null) continue;
          const d = Math.sqrt((e.col - b.col) ** 2 + (e.row - b.row) ** 2);
          if (d < nearestDist) { nearestDist = d; nearest = e; }
        }
        if (nearest) {
          const actual = nearest.takeDamage(Math.round(u.attack * 0.85));
          u.attackTimer = u.attackCooldown * 1.2;
          // Credit the garrisoned unit as attacker so it gains XP, morale, and kill streaks
          if (!nearest.isAlive()) {
            u.killStreak++;
            if (u.killStreak >= 3) { u.berserkTimer = 12; u.killStreak = 0; }
            u.xp += 10;
            if (!u.isHero && u.morale < 70) u.morale = Math.min(70, u.morale + 5);
            const kills = (this.killsByPlayer.get(u.playerId) ?? 0) + 1;
            this.killsByPlayer.set(u.playerId, kills);
          }
          this.damageEvents.push({
            attacker: u,
            target: nearest,
            damage: actual,
            worldX: nearest.worldX,
            worldZ: nearest.worldZ,
            sourceWorldX: b.col * TILE_SIZE + TILE_SIZE / 2,
            sourceWorldZ: b.row * TILE_SIZE + TILE_SIZE / 2,
          });
        }
      }
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
        if (!u.isAlive() || u.playerId === b.playerId || u.garrisonedIn !== null) continue;
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
        // Watchtower first-alert: notify the human player (global 20s cooldown to avoid spam)
        if (b.playerId === this.humanPlayerId && this._towerAlertTimer <= 0) {
          this._towerAlertTimer = 20;
          const label = nearest.isHero ? '¡HÉROE enemigo' : 'Enemigo';
          this.pendingEventMessages.push(`🗼 ¡Atalaya en alerta! — ${label} detectado en posición`);
        }
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

      // Coordinated assault: 3+ allies battering the same building → +50% damage
      const assaulters = this.allUnits.filter(
        u => u.isAlive() && u.playerId === unit.playerId && u.attackBuildingTarget === bldg,
      ).length;
      const assaultMult = assaulters >= 3 ? 1.5 : 1.0;
      // Cannon siege specialist: 3× damage vs buildings (AC: cannons were wall-breakers)
      const siegeMult = unit.type === UnitType.CANNON ? 3.0 : 1.0;
      // Garrison wall defense: defenders inside reinforce the structure (−15% siege damage)
      const garrisonDefMult = bldg.garrison.length > 0 ? 0.85 : 1.0;
      const rawDmg = Math.max(1, Math.round((unit.attack - 5) * assaultMult * siegeMult * garrisonDefMult)); // buildings have some armor
      bldg.takeDamage(rawDmg);
      if (!bldg.isAlive()) {
        this.newlyDestroyedBuildings.push(bldg);
        // Award XP to the unit that delivers the killing blow to a building
        unit.gainXP(15);
        // Cavalry raid: steal gold directly from the destroyed building's owner
        if (unit.type === UnitType.CAVALRY) {
          const raider = this.players[unit.playerId];
          const victim = this.players.find(p => p.id === bldg.playerId);
          if (raider && victim) {
            const stolen = Math.min(victim.resources.gold, 20 + Math.floor(Math.random() * 20));
            if (stolen > 0) {
              victim.resources.gold  -= stolen;
              raider.resources.gold  += stolen;
              if (unit.playerId === this.humanPlayerId)
                this.pendingEventMessages.push(`🐎 ¡Raída de caballería! +${stolen} ⚜️ saqueados`);
            }
          }
        }
        // General pillage: any unit that destroys a building gains resources from the ruins
        {
          const pillager = this.players[unit.playerId];
          if (pillager && unit.type !== UnitType.CAVALRY) { // cavalry loot handled above
            let foodGain = 0, goldGain = 0;
            switch (bldg.type) {
              case BuildingType.SETTLEMENT: foodGain = 15; goldGain = 8;  break;
              case BuildingType.BARRACKS:   goldGain = 10;                break;
              case BuildingType.TEMPLE:     goldGain = 12;                break;
              case BuildingType.STOREHOUSE: foodGain = 20; goldGain = 10; break;
              case BuildingType.VILLAGE:    foodGain = 8;  goldGain = 4;  break;
              default:                      goldGain = 5;                  break;
            }
            pillager.resources.food = Math.min(2000, pillager.resources.food + foodGain);
            pillager.resources.gold = Math.min(2000, pillager.resources.gold + goldGain);
            if (unit.playerId === this.humanPlayerId && (foodGain > 0 || goldGain > 0)) {
              this.pendingEventMessages.push(
                `🏴 ¡${bldg.def.name} destruido! Saqueo: ${foodGain > 0 ? `+${foodGain}🌽 ` : ''}+${goldGain}⚜️`,
              );
            } else if (bldg.playerId === this.humanPlayerId) {
              this.pendingEventMessages.push(`⚠️ ¡${bldg.def.name} destruido! El enemigo saquea los restos`);
            }
          }
        }
      }
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
      // Collect temple, forge, and watchtower positions for proximity checks
      const temples = this.allBuildings.filter(
        b => b.playerId === player.id && b.type === BuildingType.TEMPLE && b.isComplete()
      );
      const forges = this.allBuildings.filter(
        b => b.playerId === player.id && b.type === BuildingType.FORGE && b.isComplete()
      );
      const towers = this.allBuildings.filter(
        b => b.playerId === player.id && b.type === BuildingType.WATCHTOWER && b.isComplete() && b.isAlive()
      );

      for (const unit of player.aliveUnits) {
        // Temple: global HP regen + proximity morale aura + poison cure when near
        if (temples.length > 0) {
          if (unit.hp < unit.maxHp) unit.hp = Math.min(unit.maxHp, unit.hp + 2);
          const nearTemple = temples.some(
            t => Math.sqrt((unit.col - t.col) ** 2 + (unit.row - t.row) ** 2) <= 6
          );
          if (nearTemple) {
            if (unit.morale < 80 && !unit.panicked) unit.morale = Math.min(80, unit.morale + 5);
            // Temple priests cure poison for units who shelter near the sacred fire
            if (unit.poisoned > 0) unit.poisoned = Math.max(0, unit.poisoned - 3);
          }
        }
        // Forge: sharpens weapons over time (attack up to 125% of base) + morale bonus for fighters
        if (forges.length > 0) {
          const cap = Math.round(unit.def.stats.attack * 1.25);
          if (unit.attack < cap) unit.attack = Math.min(cap, unit.attack + 1);
          const nearForge = forges.some(
            f => Math.sqrt((unit.col - f.col) ** 2 + (unit.row - f.row) ** 2) <= 8
          );
          if (nearForge && unit.morale < 90 && !unit.isHero) {
            unit.morale = Math.min(90, unit.morale + 3); // forge workers inspire nearby troops
          }
        }
        // Watchtower banner: visible fortifications within 10 tiles steady the troops (+2 morale/tick)
        if (towers.length > 0 && !unit.panicked) {
          const nearTower = towers.some(
            t => Math.sqrt((unit.col - t.col) ** 2 + (unit.row - t.row) ** 2) <= 10
          );
          if (nearTower && unit.morale < 85) unit.morale = Math.min(85, unit.morale + 2);
        }
      }
    }
  }

  getPopCap(playerId: number): number {
    const storehouses = this.allBuildings.filter(
      b => b.playerId === playerId && b.type === BuildingType.STOREHOUSE && b.isComplete(),
    ).length;
    const villages = this.allBuildings.filter(
      b => b.playerId === playerId && b.type === BuildingType.VILLAGE && b.isAlive(),
    ).length;
    return 25 + storehouses * 5 + villages * 5;
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
    this.newlyResearchedUpgrades.push({ playerId, upgrade: upgrade as string });

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

  /** Hire a mercenary unit from a captured village (costs 80 gold). */
  hireMercenary(village: import('./Building').Building, playerId: number): boolean {
    const player = this.players[playerId];
    if (!player || player.resources.gold < 80) return false;
    if (player.aliveUnits.length >= this.getPopCap(playerId)) return false;
    const mercTypes = [UnitType.SPEARMAN, UnitType.ARCHER, UnitType.SLINGER, UnitType.QUECHUA];
    const unitType = mercTypes[Math.floor(Math.random() * mercTypes.length)];
    const pos = this.map.findWalkableNear(village.col, village.row + 2, 5);
    if (!pos) return false;
    player.resources.gold -= 80;
    const unit = new Unit(unitType, player.civType, playerId, pos[0], pos[1], CIV_COLORS[player.civType]);
    player.addUnit(unit);
    this.newlySpawnedUnits.push(unit);
    this.pendingEventMessages.push(`⚔️ Mercenario contratado — ${unit.def.name} a tus órdenes`);
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
      // Earthquake: damages all enemy buildings
      () => {
        if (enemyBuildings.length === 0) return null;
        let hit = 0;
        for (const b of enemyBuildings) {
          b.takeDamage(15);
          if (!b.isAlive()) this.newlyDestroyedBuildings.push(b);
          hit++;
        }
        return `🌋 ¡Terremoto! ${hit} edificio${hit > 1 ? 's' : ''} enemigo${hit > 1 ? 's' : ''} dañado${hit > 1 ? 's' : ''}`;
      },
      // Holy festival: human non-hero units gain +20 morale
      () => {
        const boosted = human.aliveUnits.filter(u => !u.isHero && u.morale < 80);
        if (boosted.length === 0) return null;
        for (const u of boosted) u.morale = Math.min(80, u.morale + 20);
        return `🙏 ¡Festival sagrado! ${boosted.length} unidad${boosted.length > 1 ? 'es' : ''} recuper${boosted.length > 1 ? 'an' : 'a'} moral (+20)`;
      },
      // Gold tribute from a captured village
      () => {
        const village = this.allBuildings.find(
          b => b.type === BuildingType.VILLAGE && b.playerId === this.humanPlayerId && b.isAlive(),
        );
        if (!village) return null;
        const tribute = 40 + Math.floor(Math.random() * 30);
        human.resources.gold = Math.min(cap, human.resources.gold + tribute);
        return `🏡 ¡Tributo de aldea! +${tribute} ⚜️ oro`;
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
