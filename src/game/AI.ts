import { UnitState, UnitType } from './types';
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
import { TRAIN_COSTS } from './unitProduction';

const AI_BUILD_INTERVAL    = 14.0;
const AI_WORKER_INTERVAL   = 5.0;
const AI_TRAIN_INTERVAL    = 10.0;
const AI_UPGRADE_INTERVAL  = 45.0;

// Wave-attack phases: gather forces then launch coordinated assault
const GATHER_DURATION  = 40.0; // seconds to mass forces before attacking
const ATTACK_DURATION  = 25.0; // seconds of active assault before regrouping

interface AIState {
  buildTimer:   number;
  workerTimer:  number;
  trainTimer:   number;
  upgradeTimer: number;
  phase:        'gathering' | 'attacking' | 'defending';
  phaseTimer:   number;
  defendTimer:  number; // how long we've been in defending phase
  volleyTimer:  number; // countdown to next AI volley fire
}

export class AISystem {
  private aiStates = new Map<number, AIState>();

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
      } else if (baseUnderAttack) {
        // Switch to defending immediately when base takes significant damage
        state.phase = 'defending';
        state.defendTimer = 0;
        this.defendBase(player, game);
      } else if (state.phase === 'gathering') {
        this.rallyTroops(player, game);
        if (state.phaseTimer >= GATHER_DURATION * scale || player.aliveUnits.length >= rallyCap) {
          state.phase = 'attacking';
          state.phaseTimer = 0;
        }
      } else {
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
        const allDead = game.allUnits.filter(u => u.playerId !== player.id && u.isAlive()).length === 0;
        if (state.phaseTimer >= ATTACK_DURATION || allDead) {
          state.phase = 'gathering';
          state.phaseTimer = 0;
        }
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

    // Send 80% of forces; keep 20% near settlement as garrison
    const available = myUnits.filter(
      u => (u.state === UnitState.IDLE || u.state === UnitState.MOVING) && u.garrisonedIn === null && !u.outOfAmmo,
    );
    const toSend = Math.ceil(available.length * 0.8);

    // Human wonder is highest-priority target — destroy before countdown expires
    const humanWonder = game.allBuildings.find(
      b => b.playerId === 0 && (b.type as string) === 'WONDER' && b.isAlive() && b.isComplete(),
    );

    // Find enemy settlement as primary target (after 3+ min of game)
    const humanSettlement = game.allBuildings.find(
      b => b.playerId !== player.id && b.playerId === 0 &&
           (b.type as string) === 'SETTLEMENT' && b.isAlive(),
    );

    // Flanking: compute perpendicular offset from AI base → enemy settlement
    // Second half of the attack force approaches from a 90° angle (+8 tile offset)
    const mySettlement = game.allBuildings.find(b => b.playerId === player.id && b.type === BuildingType.SETTLEMENT);
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

    for (let i = 0; i < Math.min(toSend, available.length); i++) {
      const unit = available[i];

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

      // Pick nearest enemy unit (flank group targets from a side angle)
      const isFlankGroup = i >= flankSplit && (flankDC !== 0 || flankDR !== 0);
      let best = enemies[0];
      let bestD = unit.distanceTo(best);
      for (const e of enemies) {
        const d = unit.distanceTo(e);
        // Flank group slightly prefers enemies on the offset side
        const flankBonus = isFlankGroup ? (e.col * flankDC + e.row * flankDR) * 0.01 : 0;
        if (d - flankBonus < bestD) { bestD = d; best = e; }
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

    const buildingCounts = {
      [BuildingType.BARRACKS]: game.allBuildings.filter(b => b.playerId === player.id && b.type === BuildingType.BARRACKS).length,
      [BuildingType.WATCHTOWER]: game.allBuildings.filter(b => b.playerId === player.id && b.type === BuildingType.WATCHTOWER).length,
      [BuildingType.STOREHOUSE]: game.allBuildings.filter(b => b.playerId === player.id && b.type === BuildingType.STOREHOUSE).length,
    };

    let buildType: BuildingType | null = null;
    if (buildingCounts[BuildingType.BARRACKS] === 0) {
      buildType = BuildingType.BARRACKS;
    } else if (buildingCounts[BuildingType.WATCHTOWER] < buildingCounts[BuildingType.BARRACKS]) {
      buildType = BuildingType.WATCHTOWER;
    } else if (buildingCounts[BuildingType.STOREHOUSE] < 2) {
      buildType = BuildingType.STOREHOUSE;
    }

    if (!buildType) return;

    const def = BUILDING_DEFS[buildType];
    if (player.resources.food < def.cost.food || player.resources.gold < def.cost.gold || player.resources.stone < def.cost.stone) {
      return;
    }

    const settlement = game.allBuildings.find(b => b.playerId === player.id && b.type === BuildingType.SETTLEMENT);
    if (!settlement) return;

    const pos = game.map.findWalkableNear(settlement.col + 3, settlement.row + 3, 5);
    if (!pos) return;

    const building = new Building(buildType, def, player.id, pos[0], pos[1], CIV_COLORS[player.civType], player.civType);
    game.allBuildings.push(building);
    game.newlyPlacedBuildings.push(building);
    player.resources.food -= def.cost.food;
    player.resources.gold -= def.cost.gold;
    player.resources.stone -= def.cost.stone;
  }

  private orderTraining(player: Player, game: Game) {
    const civDef = player.civDef;
    const settlement = game.allBuildings.find(
      b => b.playerId === player.id && b.type === BuildingType.SETTLEMENT && b.isComplete(),
    );
    if (!settlement) return;
    if (settlement.productionQueue.length >= 3) return; // don't over-queue
    if (player.aliveUnits.length >= game.getPopCap(player.id)) return; // pop cap

    // Pick a random unit type from civ's roster that we can afford
    const affordable = civDef.units.filter(u => {
      const cost = TRAIN_COSTS[u.type];
      if (!cost) return false;
      return player.resources.food >= cost.food &&
             player.resources.gold >= cost.gold &&
             player.resources.stone >= (cost.stone ?? 0);
    });
    if (affordable.length === 0) return;

    const pick = affordable[Math.floor(Math.random() * affordable.length)];
    const cost = TRAIN_COSTS[pick.type]!;
    if (settlement.trainUnit(pick.type)) {
      player.resources.food  -= cost.food;
      player.resources.gold  -= cost.gold;
      player.resources.stone -= cost.stone ?? 0;
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
  }

  private commandWorkers(player: Player, game: Game) {
    const myWorkers = game.allWorkers.filter(w => w.playerId === player.id);

    for (const worker of myWorkers) {
      if (worker.task !== WorkerTask.IDLE && worker.task !== WorkerTask.RETURNING) continue;

      let nearestNode = null;
      let nearestDist = Infinity;

      for (const node of game.resourceNodes) {
        if (node.isEmpty()) continue;
        const d = Math.sqrt((worker.col - node.col) ** 2 + (worker.row - node.row) ** 2);
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
}
