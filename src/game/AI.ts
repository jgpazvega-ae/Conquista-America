import { UnitState, UnitType, CivilizationType, TerrainType } from './types';
import type { Unit } from './Unit';
import type { Player } from './Player';
import type { Game } from './Game';
import { findPath } from './Pathfinding';
import { BuildingType } from './buildings';
import { BUILDING_DEFS } from './buildingDefs';
import { Building } from './Building';
import type { Worker } from './Worker';
import { WorkerTask } from './Worker';
import { ResourceType } from './ResourceNode';
import { CIV_COLORS } from './constants';
import { TRAIN_COSTS, ELITE_UNITS } from './unitProduction';
import { STRATEGY_BY_CIV } from './AIStrategy';
import { getDamageMultiplier } from './UnitBalancing';
import { TechType } from './Tech';

const AI_BUILD_INTERVAL    = 14.0;
const AI_WORKER_INTERVAL   = 5.0;
const AI_TRAIN_INTERVAL    = 10.0;
const AI_UPGRADE_INTERVAL  = 45.0;

// Wave-attack phases: gather forces then launch coordinated assault
const GATHER_DURATION  = 40.0; // seconds to mass forces before attacking
const ATTACK_DURATION  = 25.0; // seconds of active assault before regrouping

interface AIState {
  buildTimer:    number;
  workerTimer:   number;
  trainTimer:    number;
  upgradeTimer:  number;
  phase:         'gathering' | 'attacking' | 'defending';
  phaseTimer:    number;
  defendTimer:   number; // how long we've been in defending phase
  volleyTimer:   number; // countdown to next AI volley fire
  hardBonusTimer: number; // countdown to next hard-mode resource bonus
  tauntTimer:    number; // countdown to next taunt during attack phase
}

export class AISystem {
  private aiStates = new Map<number, AIState>();
  private _warDeclared = new Set<string>(); // "fromId→toId" pairs already declared
  private _armyFormation = new Map<number, string | null>(); // playerId → current army formation

  /** Apply a formation to all non-hero combat units; only touches units whose formation differs. */
  private applyFormation(player: Player, name: string | null) {
    this._armyFormation.set(player.id, name);
    for (const u of player.aliveUnits) {
      if (!u.isHero && u.formation !== name) u.setFormation(name);
    }
  }

  update(dt: number, game: Game) {
    for (const player of game.players) {
      if (player.isHuman) continue;

      let state = this.aiStates.get(player.id);
      if (!state) {
        state = {
          buildTimer: 0, workerTimer: 0,
          trainTimer: Math.random() * 8,
          upgradeTimer: Math.random() * 20,
          phase: 'gathering', phaseTimer: Math.random() * 15,
          defendTimer: 0,
          volleyTimer: 12 + Math.random() * 8,
          hardBonusTimer: 60,
          tauntTimer: 40 + Math.random() * 30,
        };
        this.aiStates.set(player.id, state);
      }

      state.buildTimer   += dt;
      state.workerTimer  += dt;
      state.trainTimer   += dt;
      state.upgradeTimer += dt;
      state.phaseTimer   += dt;

      // Difficulty: base scale multiplier
      const diffMult = game.difficulty === 'easy' ? 2.2 : game.difficulty === 'hard' ? 0.6 : 1.0;

      // Time-based scaling: intervals shrink with game time
      const elapsed  = game.gameTime;
      const timeMult = Math.max(0.5, 1.0 - elapsed / 600); // down to 50% at 10 min
      const scale    = timeMult * diffMult;
      const rallyCap = game.difficulty === 'easy'
        ? 8
        : 15 + Math.floor(elapsed / 60) * (game.difficulty === 'hard' ? 3 : 2);

      // Check if base is under attack (any owned building damaged below 70% HP)
      const baseUnderAttack = game.allBuildings.some(
        b => b.playerId === player.id && b.isAlive() && b.hp < b.maxHp * 0.7,
      );

      // Phase-based attack logic (thresholds use scale factor)
      if (state.phase === 'defending') {
        state.defendTimer += dt;
        this.defendBase(player, game);
        // Leave defending once buildings are healed and we've been defending at least 10s
        const baseHealed = !game.allBuildings.some(
          b => b.playerId === player.id && b.isAlive() && b.hp < b.maxHp * 0.85,
        );
        if (baseHealed && state.defendTimer >= 10) {
          state.phase = 'gathering';
          state.phaseTimer = 0;
          state.defendTimer = 0;
          // Siege is over: pull the garrison back out to rejoin the army
          for (const b of game.allBuildings) {
            if (b.playerId === player.id && b.garrison.length > 0) game.ejectGarrison(b);
          }
        }
      } else if (player.aliveUnits.length <= 2 && player.aliveUnits.length > 0 &&
                 !game.allBuildings.some(b => b.playerId === player.id && b.type === BuildingType.SETTLEMENT && b.isAlive())) {
        // Ceasefire: no settlement + ≤2 survivors → units stand down (avoid tedious hunt)
        for (const u of player.aliveUnits) {
          if (u.state !== UnitState.MOVING) { u.attackTarget = null; u.attackBuildingTarget = null; }
        }
      } else if (player.aliveUnits.length <= 3 && player.aliveUnits.length > 0) {
        // Desperate last stand: few survivors ignore gathering and charge
        this.waveAttack(player, game);
      } else if (baseUnderAttack) {
        // Switch to defending immediately when base takes significant damage
        state.phase = 'defending';
        state.defendTimer = 0;
        // Defensive stance: hold the line in phalanx (+30% def)
        this.applyFormation(player, 'PHALANX');
        this.defendBase(player, game);
      } else if (state.phase === 'gathering') {
        // Regrouping: loose formation for faster repositioning
        this.applyFormation(player, null);
        this.rallyTroops(player, game);
        // Guerrilla raids: small mobile forces harass workers and resource nodes
        // instead of standing idle while waiting to mass enough for a frontal wave.
        // At night the darkness provides cover — double the raid trigger chance.
        const raidSizeOk = player.aliveUnits.length >= 2 && player.aliveUnits.length <= 5;
        if (raidSizeOk || (game.isNight && player.aliveUnits.length >= 2 && Math.random() < 0.5)) {
          this.guerrillaRaid(player, game);
        }
        // Scout probe: during first GATHER_DURATION/2 of every gather phase, send
        // the fastest idle unit toward the human settlement to gather intel.
        if (state.phaseTimer < GATHER_DURATION / 2 && player.aliveUnits.length >= 4) {
          this.sendScout(player, game);
        }
        // Strategy personality: aggressive civs (high militaryRatio) rush with shorter
        // gather times and smaller armies; economic/defensive civs mass larger forces first
        const milRatio = STRATEGY_BY_CIV[player.civType]?.militaryRatio ?? 0.6;
        const gatherMult = 1.3 - milRatio * 0.7;          // 0.8 (aggressive) .. 1.1 (turtle)
        const rallyMult  = 0.6 + (1 - milRatio) * 0.8;    // ~0.84 (aggressive) .. ~1.2 (turtle)
        if (state.phaseTimer >= GATHER_DURATION * scale * gatherMult ||
            player.aliveUnits.length >= Math.round(rallyCap * rallyMult)) {
          state.phase = 'attacking';
          state.phaseTimer = 0;
          // Offensive stance: charge in wedge (+25% atk)
          this.applyFormation(player, 'WEDGE');
          // First time each AI declares war on the human player
          const key = `${player.id}→${game.humanPlayerId}`;
          if (!this._warDeclared.has(key)) {
            this._warDeclared.add(key);
            game.newWarDeclarations.push({ fromPlayerId: player.id, toPlayerId: game.humanPlayerId });
          }
        }
      } else {
        // Tactical retreat: if army morale collapses mid-attack, fall back to regroup
        const combatUnits = player.aliveUnits.filter(u => !u.isHero);
        if (combatUnits.length > 0) {
          const avgMorale = combatUnits.reduce((s, u) => s + u.morale, 0) / combatUnits.length;
          if (avgMorale < 30) {
            state.phase     = 'gathering';
            state.phaseTimer = 0;
          }
        }
        if (state.phase === 'attacking') {
          // Anti-phalanx adaptation: switch to LOOSE when human deploys PHALANX
          // — ranged units fight freely while cavalry disengages from set spears
          const humanPhalanxCount = game.allUnits.filter(
            u => u.isAlive() && u.playerId === game.humanPlayerId && u.formation === 'PHALANX',
          ).length;
          if (humanPhalanxCount >= 2) {
            this.applyFormation(player, 'LOOSE');
            for (const u of player.aliveUnits) {
              if (u.type === UnitType.CAVALRY && u.attackTarget?.formation === 'PHALANX') {
                u.attackTarget = null;
                u.state = UnitState.HOLD; // hold back — let ranged soften the spear line first
              }
            }
          } else {
            this.applyFormation(player, 'WEDGE');
          }
          this.waveAttack(player, game);
          // AI volley fire: every 12-20s during attack, trigger synchronized burst
          state.volleyTimer -= dt;
          if (state.volleyTimer <= 0) {
            state.volleyTimer = 12 + Math.random() * 8;
            for (const u of player.aliveUnits) {
              if (u.ammo > 0 && u.state === UnitState.ATTACKING && u.attackTarget?.isAlive()) {
                u.volleyReady = true;
              }
            }
          }
          // AI hero war cry: use when hero is attacking and cooldown is ready
          for (const u of player.aliveUnits) {
            if (u.isHero && u.warCryCooldown === 0 && u.state === UnitState.ATTACKING) {
              u.triggerWarCry(player.aliveUnits);
            }
          }
          // AI civilization power: activate at full strength during attack when ready
          if (player.powerCooldown <= 0 && player.aliveUnits.length >= 4 && !player.powerActive) {
            this.activateAIPower(player);
          }
          const allDead = game.allUnits.filter(u => u.playerId !== player.id && u.isAlive()).length === 0;
          if (state.phaseTimer >= ATTACK_DURATION || allDead) {
            state.phase = 'gathering';
            state.phaseTimer = 0;
          }
        }
      }

      // Tick AI civilization power timers
      if (player.powerCooldown > 0) {
        player.powerCooldown = Math.max(0, player.powerCooldown - dt);
      }
      if (player.powerActive && player.powerActiveTimer > 0) {
        player.powerActiveTimer = Math.max(0, player.powerActiveTimer - dt);
        if (player.powerActiveTimer <= 0) {
          player.powerActive = false;
          this.removeAIPower(player);
        }
      }

      // Hard difficulty resource bonus: AI gets periodic supply injections
      if (game.difficulty === 'hard') {
        state.hardBonusTimer -= dt;
        if (state.hardBonusTimer <= 0) {
          state.hardBonusTimer = 60;
          player.resources.food += 15;
          player.resources.gold += 10;
        }
      }

      // Civ-flavored taunts during attack phase (once per ~60-90s, only vs human)
      if (state.phase === 'attacking') {
        state.tauntTimer -= dt;
        if (state.tauntTimer <= 0) {
          state.tauntTimer = 60 + Math.random() * 30;
          const taunts: Record<CivilizationType, string[]> = {
            [CivilizationType.AZTEC]:        ['⚔️ ¡Los guerreros Jaguar no conocen la derrota!', '🐆 ¡Tláloc demanda tu sangre!', '☀️ ¡El sol exige tu sacrificio!'],
            [CivilizationType.MAYA]:         ['🔭 Las estrellas ya profetizaron tu fin.', '🏛️ ¡Chichen Itzá jamás caerá!', '🐍 ¡La serpiente emplumada despertó!'],
            [CivilizationType.INCA]:         ['🦅 ¡Los hijos del Sol marchan!', '🛤️ ¡Todos los caminos llevan a Cuzco!', '🏔️ ¡El Sapa Inca nos guía!'],
            [CivilizationType.CONQUISTADOR]: ['💣 ¡Por el Rey y la Gloria!', '⚔️ ¡Santiago y cierra España!', '🔥 ¡La pólvora decide todo!'],
          };
          const msgs = taunts[player.civType] ?? [];
          if (msgs.length > 0) {
            const msg = msgs[Math.floor(Math.random() * msgs.length)];
            game.newTaunts.push({ playerId: player.id, message: msg });
          }
        }
      } else {
        state.tauntTimer = Math.max(state.tauntTimer, 20); // reset minimum when not attacking
      }

      if (state.buildTimer >= AI_BUILD_INTERVAL * scale && player.resources.stone >= 50) {
        state.buildTimer = 0;
        this.orderConstruction(player, game);
      }

      if (state.workerTimer >= AI_WORKER_INTERVAL) {
        state.workerTimer = 0;
        this.commandWorkers(player, game);
      }

      if (state.trainTimer >= AI_TRAIN_INTERVAL * scale) {
        state.trainTimer = 0;
        this.orderTraining(player, game);
      }

      if (state.upgradeTimer >= AI_UPGRADE_INTERVAL * diffMult) {
        state.upgradeTimer = 0;
        this.applyAIUpgrades(player, game);
        this.orderMarketTrade(player, game);
      }
    }
  }

  /** Gather-phase: move idle units toward the settlement to mass forces. */
  private rallyTroops(player: Player, game: Game) {
    const settlement = game.allBuildings.find(
      b => b.playerId === player.id && (b.type as string) === 'SETTLEMENT' && b.isComplete(),
    );
    if (!settlement) return;
    const cx = settlement.col, cz = settlement.row;

    // One idle melee unit goes to capture the nearest uncaptured/enemy village
    const uncapturedVillage = game.allBuildings
      .filter(b => b.type === BuildingType.VILLAGE && b.isAlive() && b.isComplete() && b.playerId !== player.id)
      .sort((a, b) => {
        const da = (a.col - cx) ** 2 + (a.row - cz) ** 2;
        const db = (b.col - cx) ** 2 + (b.row - cz) ** 2;
        return da - db;
      })[0];
    if (uncapturedVillage) {
      const capturer = player.aliveUnits.find(
        u => u.state === UnitState.IDLE && u.garrisonedIn === null &&
             u.attackRange <= 1.5 && u.captureTarget === null && !u.outOfAmmo,
      );
      if (capturer) {
        capturer.captureTarget = uncapturedVillage;
        const near = game.map.findWalkableNear(uncapturedVillage.col, uncapturedVillage.row, 2);
        if (near) {
          const path = findPath(game.map, capturer.gridPos(), { col: near[0], row: near[1] }, 300);
          if (path.length > 0) { capturer.path = path; capturer.pathIndex = 0; capturer.state = UnitState.MOVING; }
        }
      }
    }

    // Cavalry vanguard raids: after 90 s, send 2 idle cavalry to harass enemy secondary buildings
    if (game.gameTime > 90) {
      const idleCavalry = player.aliveUnits.filter(
        u => u.type === UnitType.CAVALRY && u.state === UnitState.IDLE &&
             u.garrisonedIn === null && !u.outOfAmmo,
      );
      if (idleCavalry.length >= 2) {
        const raidTarget = game.allBuildings
          .filter(b =>
            b.playerId !== player.id && b.playerId >= 0 && b.isAlive() && b.isComplete() &&
            b.type !== BuildingType.SETTLEMENT && b.type !== BuildingType.WONDER &&
            b.type !== BuildingType.VILLAGE,
          )
          .sort((a, b) => a.hp - b.hp)[0]; // most-damaged first (easier target)
        if (raidTarget) {
          for (const raider of idleCavalry.slice(0, 2)) {
            const d = Math.sqrt((raider.col - raidTarget.col) ** 2 + (raider.row - raidTarget.row) ** 2);
            if (d <= raider.attackRange + 1.5) {
              raider.attackBuilding(raidTarget);
            } else {
              const path = findPath(game.map, raider.gridPos(), { col: raidTarget.col, row: raidTarget.row }, 300);
              if (path.length > 0) raider.moveTo(path);
            }
          }
        }
      }
    }

    for (const unit of player.aliveUnits) {
      if (unit.garrisonedIn !== null) continue;
      // Route out-of-ammo ranged units back to settlement to resupply
      if (unit.outOfAmmo && unit.state !== UnitState.MOVING) {
        const near = game.map.findWalkableNear(cx, cz, 3);
        if (near) {
          const path = findPath(game.map, unit.gridPos(), { col: near[0], row: near[1] }, 200);
          if (path.length > 0) unit.moveTo(path);
        }
        continue;
      }
      if (unit.state !== UnitState.IDLE) continue;
      const d = Math.sqrt((unit.col - cx) ** 2 + (unit.row - cz) ** 2);
      if (d > 6) {
        const tc = cx + Math.floor(Math.random() * 5) - 2;
        const tr = cz + Math.floor(Math.random() * 5) - 2;
        const near = game.map.findWalkableNear(tc, tr, 3);
        if (near) {
          const path = findPath(game.map, unit.gridPos(), { col: near[0], row: near[1] }, 200);
          if (path.length > 0) unit.moveTo(path);
        }
      }
    }
  }

  /** Defend-phase: rush all units to protect damaged buildings and engage nearby threats. */
  private defendBase(player: Player, game: Game) {
    // Tuck ranged units into garrisons while under siege (American Conquest style)
    const garrisonable = game.allBuildings.filter(
      b => b.playerId === player.id && b.isAlive() && b.isComplete() &&
           b.garrison.length < b.garrisonCapacity,
    );
    for (const b of garrisonable) {
      let free = b.garrisonCapacity - b.garrison.length;
      for (const u of player.aliveUnits) {
        if (free <= 0) break;
        if (!u.def.isRanged || u.garrisonedIn !== null || u.garrisonTarget || u.panicked) continue;
        const d = Math.sqrt((u.col - b.col) ** 2 + (u.row - b.row) ** 2);
        if (d > 12) continue;
        u.garrisonTarget = b;
        const near = game.map.findWalkableNear(b.col, b.row, 3);
        if (near) {
          const path = findPath(game.map, u.gridPos(), { col: near[0], row: near[1] }, 300);
          if (path.length > 0) { u.path = path; u.pathIndex = 0; u.state = UnitState.MOVING; }
        }
        free--;
      }
    }

    const damagedBuilding = game.allBuildings
      .filter(b => b.playerId === player.id && b.isAlive() && b.hp < b.maxHp * 0.85)
      .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0]; // most-damaged first
    if (!damagedBuilding) return;

    const cx = damagedBuilding.col;
    const cz = damagedBuilding.row;

    // Find threats near the damaged building
    const nearbyEnemies = game.allUnits.filter(u => {
      if (u.playerId === player.id || !u.isAlive()) return false;
      const d = Math.sqrt((u.col - cx) ** 2 + (u.row - cz) ** 2);
      return d < 10;
    });

    for (const unit of player.aliveUnits) {
      if (unit.garrisonedIn !== null || unit.garrisonTarget) continue; // already posted inside
      if (nearbyEnemies.length > 0) {
        // Engage nearest threat to the damaged building
        let best = nearbyEnemies[0];
        let bestD = unit.distanceTo(best);
        for (const e of nearbyEnemies) {
          const d = unit.distanceTo(e);
          if (d < bestD) { bestD = d; best = e; }
        }
        if (unit.distanceTo(best) <= unit.attackRange + 1.0) {
          unit.attackUnit(best);
        } else {
          const path = findPath(game.map, unit.gridPos(), best.gridPos(), 300);
          if (path.length > 0) unit.moveTo(path);
        }
      } else {
        // No visible threats — rally near the damaged building
        const d = Math.sqrt((unit.col - cx) ** 2 + (unit.row - cz) ** 2);
        if (d > 5) {
          const near = game.map.findWalkableNear(cx, cz, 4);
          if (near) {
            const path = findPath(game.map, unit.gridPos(), { col: near[0], row: near[1] }, 300);
            if (path.length > 0) unit.moveTo(path);
          }
        }
      }
    }
  }

  /** Attack-phase: send all available units in a coordinated wave with flanking. */
  private waveAttack(player: Player, game: Game) {
    const myUnits = player.aliveUnits;
    const enemies = game.allUnits.filter(u => u.playerId !== player.id && u.isAlive());
    if (myUnits.length === 0 || enemies.length === 0) return;

    // Route out-of-ammo ranged units back to own settlement to resupply
    const settlement = game.allBuildings.find(b => b.playerId === player.id && b.type === BuildingType.SETTLEMENT);
    if (settlement) {
      for (const u of myUnits) {
        if (u.outOfAmmo && u.garrisonedIn === null && u.state !== UnitState.MOVING) {
          const near = game.map.findWalkableNear(settlement.col, settlement.row, 3);
          if (near) {
            const path = findPath(game.map, u.gridPos(), { col: near[0], row: near[1] }, 200);
            if (path.length > 0) u.moveTo(path);
          }
        }
      }
    }

    // Send 80% of forces; keep 20% near settlement as garrison.
    // Heroes always lead from the front (sorted first in the dispatch list).
    const available = myUnits
      .filter(u => (u.state === UnitState.IDLE || u.state === UnitState.MOVING) && u.garrisonedIn === null && !u.outOfAmmo)
      .sort((a, b) => (b.isHero ? 1 : 0) - (a.isHero ? 1 : 0));
    const toSend = Math.ceil(available.length * 0.8);

    // Nearest active wonder from any enemy — destroy before countdown expires
    const mySettlementPos = game.allBuildings.find(b => b.playerId === player.id && b.type === BuildingType.SETTLEMENT);
    const activeWonder = game.wonderCountdown !== null
      ? game.allBuildings
          .filter(b => b.playerId !== player.id && (b.type as string) === 'WONDER' && b.isAlive() && b.isComplete())
          .sort((a, b) => {
            const da = mySettlementPos ? (a.col - mySettlementPos.col) ** 2 + (a.row - mySettlementPos.row) ** 2 : 0;
            const db = mySettlementPos ? (b.col - mySettlementPos.col) ** 2 + (b.row - mySettlementPos.row) ** 2 : 0;
            return da - db;
          })[0] ?? null
      : null;
    // Backwards-compat alias (used below as humanWonder)
    const humanWonder = activeWonder;

    // Nearest enemy settlement — prioritise whoever is closest to us (true multi-faction warfare)
    const humanSettlement = game.allBuildings
      .filter(b => b.playerId !== player.id && b.playerId >= 0 && (b.type as string) === 'SETTLEMENT' && b.isAlive())
      .sort((a, b) => {
        const da = mySettlementPos ? (a.col - mySettlementPos.col) ** 2 + (a.row - mySettlementPos.row) ** 2 : 0;
        const db = mySettlementPos ? (b.col - mySettlementPos.col) ** 2 + (b.row - mySettlementPos.row) ** 2 : 0;
        return da - db;
      })[0] ?? null;

    // Flanking: compute perpendicular offset from AI base → enemy settlement
    // Second half of the attack force approaches from a 90° angle (+8 tile offset)
    const mySettlement = mySettlementPos;
    let flankDC = 0, flankDR = 0;
    if (humanSettlement && mySettlement) {
      const dx = humanSettlement.col - mySettlement.col;
      const dz = humanSettlement.row - mySettlement.row;
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      // Perpendicular unit vector rotated 90°: (-dz, dx)
      flankDC = Math.round((-dz / len) * 8);
      flankDR = Math.round((dx  / len) * 8);
    }
    const flankSplit = Math.floor(toSend / 2); // first half = direct, second half = flank

    // Precompute nearest enemy building for cannon siege targeting
    const enemyBuildings = game.allBuildings.filter(
      b => b.playerId !== player.id && b.isAlive() && b.isComplete(),
    );
    const settlementTarget = enemyBuildings.find(b => b.type === BuildingType.SETTLEMENT)
      ?? enemyBuildings.find(b => b.type === BuildingType.BARRACKS)
      ?? enemyBuildings[0] ?? null;

    for (let i = 0; i < Math.min(toSend, available.length); i++) {
      const unit = available[i];

      // Cannon siege priority: cannons target the nearest enemy building rather than units
      if (unit.type === UnitType.CANNON && settlementTarget) {
        const d = Math.sqrt((unit.col - settlementTarget.col) ** 2 + (unit.row - settlementTarget.row) ** 2);
        if (d <= unit.attackRange + 1.0) {
          unit.attackBuilding(settlementTarget);
        } else {
          const near = game.map.findWalkableNear(settlementTarget.col, settlementTarget.row, 3);
          if (near) {
            const path = findPath(game.map, unit.gridPos(), { col: near[0], row: near[1] }, 400);
            if (path.length > 0) unit.moveTo(path);
          }
        }
        continue;
      }

      // Wonder is active — all attacking units converge on it
      if (humanWonder && game.wonderCountdown !== null) {
        const d = Math.sqrt((unit.col - humanWonder.col) ** 2 + (unit.row - humanWonder.row) ** 2);
        if (d <= unit.attackRange + 1.0) {
          unit.attackBuilding(humanWonder);
        } else {
          const path = findPath(game.map, unit.gridPos(), { col: humanWonder.col, row: humanWonder.row }, 400);
          if (path.length > 0) unit.moveTo(path);
        }
        continue;
      }

      // After 3 min, 40% of units target the settlement directly
      if (humanSettlement && game.gameTime > 180 && i % 5 < 2) {
        // Flank group approaches from offset position before converging
        const isFlankGroup = i >= flankSplit && (flankDC !== 0 || flankDR !== 0);
        const targetCol = isFlankGroup ? humanSettlement.col + flankDC : humanSettlement.col;
        const targetRow = isFlankGroup ? humanSettlement.row + flankDR : humanSettlement.row;
        const near = game.map.findWalkableNear(targetCol, targetRow, 4) ?? [humanSettlement.col, humanSettlement.row];
        const d = Math.sqrt((unit.col - humanSettlement.col) ** 2 + (unit.row - humanSettlement.row) ** 2);
        if (d <= unit.attackRange + 1.0) {
          unit.attackBuilding(humanSettlement);
        } else {
          const path = findPath(game.map, unit.gridPos(), { col: near[0], row: near[1] }, 400);
          if (path.length > 0) unit.moveTo(path);
        }
        continue;
      }

      // Pick best target: closest enemy, with priority bonuses for heroes/cannon/wounded
      const isFlankGroup = i >= flankSplit && (flankDC !== 0 || flankDR !== 0);
      let best = enemies[0];
      let bestScore = Infinity;
      for (const e of enemies) {
        const d = unit.distanceTo(e);
        const flankBonus = isFlankGroup ? (e.col * flankDC + e.row * flankDR) * 0.01 : 0;
        let priority = 0;
        if (e.isHero)                      priority -= 8; // eliminate the hero
        if (e.type === UnitType.CANNON)    priority -= 5; // silence artillery
        if (e.hp < e.maxHp * 0.5)         priority -= 3; // finish off wounded
        const score = d - flankBonus + priority;
        if (score < bestScore) { bestScore = score; best = e; }
      }

      if (unit.distanceTo(best) <= unit.attackRange + 1.0) {
        unit.attackUnit(best);
      } else {
        const path = findPath(game.map, unit.gridPos(), best.gridPos(), 400);
        if (path.length > 0) unit.moveTo(path);
      }
    }
  }

  private orderConstruction(player: Player, game: Game) {
    const hasSettlement = game.allBuildings.some(b => b.playerId === player.id && b.type === BuildingType.SETTLEMENT);
    if (!hasSettlement) return;

    const strategy = STRATEGY_BY_CIV[player.civType];

    // Count each owned building type
    const ownedBuildings = game.allBuildings.filter(b => b.playerId === player.id);
    const countOf = (t: BuildingType) => ownedBuildings.filter(b => b.type === t).length;

    // Population pressure: raise the storehouse target as the AI fills its cap so its
    // army keeps growing late-game (more storehouses = higher pop cap)
    const popRatio = player.aliveUnits.length / Math.max(1, game.getPopCap(player.id));
    const storehouseTarget = popRatio >= 0.85 ? 5 : popRatio >= 0.65 ? 3 : 2;

    // Expanding under pop pressure takes top priority — without it the AI stalls
    let buildType: BuildingType | null = null;
    if (popRatio >= 0.85 && countOf(BuildingType.STOREHOUSE) < storehouseTarget) {
      buildType = BuildingType.STOREHOUSE;
    }

    // Walk the civ's preferred build order; pick the first type we need more of
    if (!buildType) {
      for (const desired of strategy.buildOrder) {
        if (desired === BuildingType.SETTLEMENT || desired === BuildingType.WONDER || desired === BuildingType.VILLAGE) continue;
        const cap = desired === BuildingType.STOREHOUSE ? storehouseTarget
                 : desired === BuildingType.WATCHTOWER  ? Math.max(1, countOf(BuildingType.BARRACKS))
                 : 1; // one of each other type
        if (countOf(desired) < cap) { buildType = desired; break; }
      }
    }
    // Fallback: always ensure at least 1 barracks and enough storehouses
    if (!buildType && countOf(BuildingType.BARRACKS) === 0)  buildType = BuildingType.BARRACKS;
    if (!buildType && countOf(BuildingType.STOREHOUSE) < storehouseTarget) buildType = BuildingType.STOREHOUSE;
    // Late-game wonder rush: once all other buildings are in place and resources are ample, build a wonder
    if (!buildType && countOf(BuildingType.WONDER) === 0 && game.gameTime > 300) {
      const wonderDef = BUILDING_DEFS[BuildingType.WONDER];
      if (player.resources.food >= wonderDef.cost.food &&
          player.resources.gold >= wonderDef.cost.gold &&
          player.resources.stone >= wonderDef.cost.stone) {
        buildType = BuildingType.WONDER;
      }
    }
    if (!buildType) return;

    const def = BUILDING_DEFS[buildType];
    if (player.resources.food < def.cost.food || player.resources.gold < def.cost.gold || player.resources.stone < def.cost.stone) {
      return;
    }

    const settlement = game.allBuildings.find(b => b.playerId === player.id && b.type === BuildingType.SETTLEMENT);
    if (!settlement) return;

    // Watchtowers go on the frontier toward the human player — maximise coverage
    let buildCol = settlement.col + 3;
    let buildRow = settlement.row + 3;
    if (buildType === BuildingType.WATCHTOWER) {
      const humanSettle = game.allBuildings.find(
        b => b.playerId === game.humanPlayerId && b.type === BuildingType.SETTLEMENT && b.isAlive(),
      );
      if (humanSettle) {
        const dx = humanSettle.col - settlement.col;
        const dy = humanSettle.row - settlement.row;
        const d  = Math.hypot(dx, dy) || 1;
        // Place 8 tiles toward the enemy — inside our perimeter but facing the threat
        buildCol = Math.round(settlement.col + (dx / d) * 8);
        buildRow = Math.round(settlement.row + (dy / d) * 8);
      }
    }
    // Harbor needs to be near water
    let pos: [number, number] | null;
    if (buildType === BuildingType.HARBOR) {
      pos = game.map.findCoastalNear(settlement.col, settlement.row, 12);
    } else {
      pos = game.map.findWalkableNear(buildCol, buildRow, 5);
    }
    if (!pos) return;

    const building = new Building(buildType, def, player.id, pos[0], pos[1], CIV_COLORS[player.civType], player.civType);
    game.allBuildings.push(building);
    game.newlyPlacedBuildings.push(building);
    player.resources.food -= def.cost.food;
    player.resources.gold -= def.cost.gold;
    player.resources.stone -= def.cost.stone;
  }

  private static readonly NAVAL_UNIT_TYPES = new Set<UnitType>([
    UnitType.CANOE, UnitType.WAR_CANOE, UnitType.BRIGANTINE, UnitType.GALLEON,
  ]);
  private static readonly SPIRITUAL_UNIT_TYPES = new Set<UnitType>([
    UnitType.SHAMAN, UnitType.MISSIONARY,
  ]);
  // Alias for shared ELITE_UNITS set (Barracks-only training)
  private static readonly ELITE_UNIT_TYPES = ELITE_UNITS;

  private orderTraining(player: Player, game: Game) {
    const civDef = player.civDef;

    // Also try to train naval units from Harbor
    const harbor = game.allBuildings.find(
      b => b.playerId === player.id && b.type === BuildingType.HARBOR && b.isComplete() &&
           b.productionQueue.length < 2,
    );
    if (harbor && Math.random() < 0.4) {
      const navalUnits = civDef.units.filter(u => AISystem.NAVAL_UNIT_TYPES.has(u.type as UnitType));
      for (const nu of navalUnits) {
        const cost = TRAIN_COSTS[nu.type as UnitType];
        if (!cost) continue;
        if (player.resources.food >= cost.food && player.resources.gold >= cost.gold &&
            (player.resources.wood ?? 0) >= (cost.wood ?? 0)) {
          if (harbor.trainUnit(nu.type as UnitType)) {
            player.resources.food -= cost.food;
            player.resources.gold -= cost.gold;
            player.resources.wood = (player.resources.wood ?? 0) - (cost.wood ?? 0);
            return;
          }
        }
      }
    }

    // Also try to train spiritual units from Temple
    const temple = game.allBuildings.find(
      b => b.playerId === player.id && b.type === BuildingType.TEMPLE && b.isComplete() &&
           b.productionQueue.length < 2,
    );
    if (temple && Math.random() < 0.25) {
      const spiritualUnits = civDef.units.filter(u => AISystem.SPIRITUAL_UNIT_TYPES.has(u.type as UnitType));
      for (const su of spiritualUnits) {
        const cost = TRAIN_COSTS[su.type as UnitType];
        if (!cost) continue;
        if (player.resources.food >= cost.food && player.resources.gold >= cost.gold) {
          if (temple.trainUnit(su.type as UnitType)) {
            player.resources.food -= cost.food;
            player.resources.gold -= cost.gold;
            return;
          }
        }
      }
    }

    // Try to train elite units from Barracks (60% chance per cycle)
    const barracks = game.allBuildings.find(
      b => b.playerId === player.id && b.type === BuildingType.BARRACKS && b.isComplete() &&
           b.productionQueue.length < 2,
    );
    if (barracks && Math.random() < 0.6 && player.aliveUnits.length < game.getPopCap(player.id)) {
      const eliteUnits = civDef.units.filter(u => AISystem.ELITE_UNIT_TYPES.has(u.type as UnitType));
      const strategy = STRATEGY_BY_CIV[player.civType];
      const preferredTypes = new Set(strategy.unitComposition);
      const affordableElites = eliteUnits.filter(u => {
        const cost = TRAIN_COSTS[u.type as UnitType];
        if (!cost) return false;
        return player.resources.food >= cost.food &&
               player.resources.gold >= cost.gold &&
               player.resources.stone >= (cost.stone ?? 0) &&
               player.resources.wood  >= (cost.wood  ?? 0);
      });
      if (affordableElites.length > 0) {
        const pool = affordableElites.flatMap(u => {
          const weight = preferredTypes.has(u.type) ? 3 : 1;
          return Array<typeof u>(weight).fill(u);
        });
        const pick = pool[Math.floor(Math.random() * pool.length)];
        const cost = TRAIN_COSTS[pick.type as UnitType]!;
        if (barracks.trainUnit(pick.type as UnitType)) {
          player.resources.food  -= cost.food;
          player.resources.gold  -= cost.gold;
          player.resources.stone -= cost.stone ?? 0;
          player.resources.wood  -= cost.wood  ?? 0;
          return;
        }
      }
    }

    const settlement = game.allBuildings.find(
      b => b.playerId === player.id && b.type === BuildingType.SETTLEMENT && b.isComplete(),
    );
    if (!settlement) return;
    if (settlement.productionQueue.length >= 3) return; // don't over-queue
    if (player.aliveUnits.length >= game.getPopCap(player.id)) return; // pop cap

    // Build a weighted pool: preferred composition types have 3× weight
    const strategy = STRATEGY_BY_CIV[player.civType];
    const preferredTypes = new Set(strategy.unitComposition);
    const affordable = civDef.units.filter(u => {
      if (AISystem.NAVAL_UNIT_TYPES.has(u.type as UnitType)) return false;    // trained from Harbor only
      if (AISystem.SPIRITUAL_UNIT_TYPES.has(u.type as UnitType)) return false; // trained from Temple only
      if (AISystem.ELITE_UNIT_TYPES.has(u.type as UnitType)) return false;     // trained from Barracks only
      const cost = TRAIN_COSTS[u.type];
      if (!cost) return false;
      return player.resources.food >= cost.food &&
             player.resources.gold >= cost.gold &&
             player.resources.stone >= (cost.stone ?? 0) &&
             player.resources.wood  >= (cost.wood  ?? 0);
    });
    if (affordable.length === 0) return;

    // Counter-composition: identify the human's most common unit type so the AI
    // can favor units that hard-counter it (e.g. spearmen vs a cavalry-heavy army)
    let threatType: UnitType | null = null;
    {
      const counts = new Map<UnitType, number>();
      for (const u of game.humanPlayer.aliveUnits) {
        if (u.isHero) continue;
        counts.set(u.type, (counts.get(u.type) ?? 0) + 1);
      }
      let best = 0;
      for (const [t, c] of counts) {
        if (c > best) { best = c; threatType = t; }
      }
      // Only react if that type is a meaningful share of their army
      if (best < Math.max(3, game.humanPlayer.aliveUnits.length * 0.3)) threatType = null;
    }

    // Weighted selection: preferred units appear 3× more often; counter units get
    // extra weight proportional to how hard they beat the human's dominant unit type
    const pool = affordable.flatMap(u => {
      let weight = preferredTypes.has(u.type) ? 3 : 1;
      if (threatType) {
        const mult = getDamageMultiplier(u.type, threatType);
        if (mult >= 1.4) weight += 3;       // hard counter
        else if (mult >= 1.15) weight += 1; // soft advantage
      }
      return Array<typeof u>(weight).fill(u);
    });
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const cost = TRAIN_COSTS[pick.type]!;
    if (settlement.trainUnit(pick.type)) {
      player.resources.food  -= cost.food;
      player.resources.gold  -= cost.gold;
      player.resources.stone -= cost.stone ?? 0;
      player.resources.wood  -= cost.wood  ?? 0;
    }
  }

  private orderMarketTrade(player: Player, game: Game) {
    const hasMarket = game.allBuildings.some(b => b.playerId === player.id && b.type === BuildingType.MARKET && b.isComplete());
    if (!hasMarket) return;
    // Trade excess food or stone for gold when gold is low
    if (player.resources.gold < 100) {
      if ((player.resources.food ?? 0) > 300) {
        game.executeMarketTrade(player.id, 'food', 50, 30);
      } else if ((player.resources.stone ?? 0) > 300) {
        game.executeMarketTrade(player.id, 'stone', 50, 40);
      } else if ((player.resources.wood ?? 0) > 300) {
        game.executeMarketTrade(player.id, 'wood', 50, 35);
      }
    }
  }

  private applyAIUpgrades(player: Player, game: Game) {
    const order: Array<keyof import('./Player').PlayerUpgrades> = ['metallurgy', 'logistics', 'fortification', 'civTech'];
    for (const upg of order) {
      if (!player.upgrades[upg]) {
        game.applyUpgrade(upg, player.id);
        return; // one at a time
      }
    }
    // Also research available techs via the tech tree
    if (!player.techs.getResearchingTech()) {
      const militaryTechs = [TechType.BRONZE_WORKING, TechType.IRON_WORKING, TechType.SIEGE_ENGINEERING, TechType.CAVALRY_TRAINING];
      const civTechs = [TechType.AZTEC_JAGUAR_ELITE, TechType.INCA_ROAD_SYSTEM, TechType.MAYA_ASTRONOMY, TechType.CONQUISTADOR_GUNPOWDER];
      const econTechs = [TechType.AGRICULTURE, TechType.MINING];
      const allTechs = [...econTechs, ...militaryTechs, ...civTechs];
      for (const tech of allTechs) {
        if (player.techs.canResearch(tech, player.civType)) {
          game.startTechResearch(tech, player.id);
          return;
        }
      }
    }
  }

  private commandWorkers(player: Player, game: Game) {
    const myWorkers = game.allWorkers.filter(w => w.playerId === player.id);

    for (const worker of myWorkers) {
      if (worker.task !== WorkerTask.IDLE && worker.task !== WorkerTask.RETURNING) continue;

      let nearestNode = null;
      let nearestDist = Infinity;

      for (const node of game.resourceNodes) {
        if (node.isEmpty()) continue;
        const rawDist = Math.sqrt((worker.col - node.col) ** 2 + (worker.row - node.row) ** 2);
        // Terrain-aware routing: apply a virtual distance discount for bonus-terrain nodes
        // so that AI workers prefer them even if they are slightly farther away.
        const tile = game.map.getTile(node.col, node.row);
        let terrainMult = 1.0;
        if (node.type === ResourceType.FOOD && tile?.terrain === TerrainType.JUNGLE) {
          const isNative = player.civType === CivilizationType.AZTEC || player.civType === CivilizationType.MAYA;
          terrainMult = isNative ? 0.60 : 0.72; // native civs value jungle food much more
        }
        if (node.type === ResourceType.STONE &&
            (tile?.terrain === TerrainType.HIGHLAND || tile?.terrain === TerrainType.MOUNTAIN)) {
          terrainMult = player.civType === CivilizationType.INCA ? 0.55 : 0.75;
        }
        const d = rawDist * terrainMult;
        if (d < nearestDist) {
          nearestDist = d;
          nearestNode = node;
        }
      }

      if (nearestNode) {
        if (nearestDist <= 1.5) {
          const taskType = nearestNode.type === ResourceType.FOOD ? WorkerTask.GATHERING_FOOD :
                           nearestNode.type === ResourceType.GOLD ? WorkerTask.GATHERING_GOLD :
                           WorkerTask.GATHERING_STONE;
          worker.setTask(taskType, nearestNode.col, nearestNode.row);
        } else {
          const path = findPath(game.map, { col: worker.col, row: worker.row }, { col: nearestNode.col, row: nearestNode.row }, 200);
          if (path.length > 0) {
            worker.path = path;
            worker.pathIndex = 0;
            worker.task = WorkerTask.MOVING;
          }
        }
      }
    }
  }

  /**
   * Scout probe: during the gather phase, send the fastest idle unit toward the
   * human settlement to reveal enemy positions before committing the full army.
   */
  private sendScout(player: Player, game: Game) {
    const humanSettle = game.allBuildings.find(
      b => b.playerId === game.humanPlayerId && b.type === BuildingType.SETTLEMENT && b.isAlive(),
    );
    if (!humanSettle) return;

    // Pick fastest idle non-hero unit as scout (prefer cavalry / fast melee)
    const scout = player.aliveUnits
      .filter(u => !u.isHero && u.state === UnitState.IDLE)
      .sort((a, b) => b.speed - a.speed)[0];
    if (!scout) return;

    // Move to a point 5 tiles short of the human settlement (not suicidally close)
    const dx = humanSettle.col - scout.col;
    const dy = humanSettle.row - scout.row;
    const dist = Math.hypot(dx, dy);
    if (dist < 8) return; // already close enough to see the enemy
    const targetCol = Math.round(humanSettle.col - (dx / dist) * 5);
    const targetRow = Math.round(humanSettle.row - (dy / dist) * 5);
    const near = game.map.findWalkableNear(targetCol, targetRow, 3);
    if (!near) return;
    const path = findPath(game.map, scout.gridPos(), { col: near[0], row: near[1] }, 300);
    if (path.length > 0) scout.moveTo(path);
  }

  /**
   * Guerrilla raids: send fast units to harass enemy workers and resource nodes when
   * the AI force is too small to assault the enemy base head-on.
   */
  private guerrillaRaid(player: Player, game: Game) {
    const fastTypes = new Set([
      UnitType.CAVALRY, UnitType.EAGLE_WARRIOR, UnitType.JAGUAR_KNIGHT, UnitType.CUACHIC,
    ]);
    const raiders = player.aliveUnits.filter(
      u => fastTypes.has(u.type) && !u.isHero &&
           u.state !== UnitState.ATTACKING && u.state !== UnitState.MOVING,
    );
    if (raiders.length === 0) return;

    // Priority 1: enemy workers within sight
    const enemyWorkers = game.allWorkers.filter(w => w.playerId !== player.id);
    // Priority 2: enemy resource nodes (deny the enemy their economy)
    const enemyNodes = game.resourceNodes.filter(n => !n.isEmpty());
    // Priority 3: isolated enemy units (no ally within 5 tiles)
    const enemyUnits = game.allUnits.filter(u =>
      u.playerId !== player.id && u.isAlive() && u.garrisonedIn === null,
    );

    for (const raider of raiders) {
      // Try to find the nearest priority target
      let bestCol = -1, bestRow = -1, bestDist = Infinity;

      for (const w of enemyWorkers) {
        const d = Math.hypot(raider.col - w.col, raider.row - w.row);
        if (d < bestDist && d < raider.sight * 1.5) { bestDist = d; bestCol = Math.round(w.col); bestRow = Math.round(w.row); }
      }
      if (bestCol < 0) {
        for (const n of enemyNodes) {
          const d = Math.hypot(raider.col - n.col, raider.row - n.row);
          if (d < bestDist && d < raider.sight * 2) { bestDist = d; bestCol = n.col; bestRow = n.row; }
        }
      }
      if (bestCol < 0) {
        for (const u of enemyUnits) {
          const alliesNear = game.allUnits.filter(
            a => a.playerId === u.playerId && a.isAlive() && Math.hypot(a.col - u.col, a.row - u.row) <= 5,
          ).length;
          if (alliesNear > 2) continue; // don't raid well-defended positions
          const d = Math.hypot(raider.col - u.col, raider.row - u.row);
          if (d < bestDist && d < raider.sight * 1.5) { bestDist = d; bestCol = Math.round(u.col); bestRow = Math.round(u.row); }
        }
      }

      if (bestCol >= 0) {
        const path = findPath(game.map, raider.gridPos(), { col: bestCol, row: bestRow }, 300);
        if (path.length > 0) raider.moveTo(path);
      }
    }
  }

  /** Activate an AI player's civilization power during an attack wave. */
  private activateAIPower(player: Player) {
    const COOLDOWNS: Record<CivilizationType, number> = {
      [CivilizationType.AZTEC]: 40, [CivilizationType.INCA]: 80,
      [CivilizationType.MAYA]: 60,  [CivilizationType.CONQUISTADOR]: 70,
    };
    const DURATIONS: Record<CivilizationType, number> = {
      [CivilizationType.AZTEC]: 0, [CivilizationType.INCA]: 25,
      [CivilizationType.MAYA]: 0,  [CivilizationType.CONQUISTADOR]: 20,
    };
    player.powerCooldown = COOLDOWNS[player.civType] ?? 60;

    switch (player.civType) {
      case CivilizationType.AZTEC: {
        // Sacrifice the weakest non-hero unit for a resource boost
        const weak = player.aliveUnits.filter(u => !u.isHero).sort((a, b) => a.hp - b.hp)[0];
        if (weak) {
          weak.takeDamage(weak.hp + 9999);
          player.resources.gold = Math.min(2000, player.resources.gold + 60);
        }
        break;
      }
      case CivilizationType.INCA:
        for (const u of player.aliveUnits) {
          u.incaBuff = true; u._preBuffAttack = u.attack; u._preBuffSpeed = u.speed;
          u.attack = Math.round(u.attack * 1.3);
          u.speed  = Math.min(u.speed * 1.3, u.def.stats.speed * 3);
        }
        player.powerActive = true; player.powerActiveTimer = DURATIONS[player.civType];
        break;
      case CivilizationType.MAYA:
        // All Maya units get a morale surge (prophetic revelation)
        for (const u of player.aliveUnits) {
          if (!u.isHero) u.morale = Math.min(100, u.morale + 30);
        }
        break;
      case CivilizationType.CONQUISTADOR:
        for (const u of player.aliveUnits) {
          u.conquBuff = true; u._preBuffAttack = u.attack;
          u.attack = Math.round(u.attack * 1.8);
        }
        player.powerActive = true; player.powerActiveTimer = DURATIONS[player.civType];
        break;
    }
  }

  /** Remove expired buff from AI player units. */
  private removeAIPower(player: Player) {
    for (const u of player.aliveUnits) {
      if (u.incaBuff) {
        if (u._preBuffAttack > 0) u.attack = u.fatigued ? Math.round(u._preBuffAttack * 0.9) : u._preBuffAttack;
        if (u._preBuffSpeed  > 0) u.speed  = u._preBuffSpeed;
        u.incaBuff = false; u._preBuffAttack = 0; u._preBuffSpeed = 0;
      }
      if (u.conquBuff) {
        if (u._preBuffAttack > 0) u.attack = u.fatigued ? Math.round(u._preBuffAttack * 0.9) : u._preBuffAttack;
        u.conquBuff = false; u._preBuffAttack = 0;
      }
    }
  }
}
