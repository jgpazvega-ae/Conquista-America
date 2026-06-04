import { UnitState } from './types';
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

const AI_BUILD_INTERVAL  = 14.0;
const AI_WORKER_INTERVAL = 5.0;
const AI_TRAIN_INTERVAL  = 10.0;

// Wave-attack phases: gather forces then launch coordinated assault
const GATHER_DURATION  = 40.0; // seconds to mass forces before attacking
const ATTACK_DURATION  = 25.0; // seconds of active assault before regrouping

interface AIState {
  buildTimer:  number;
  workerTimer: number;
  trainTimer:  number;
  phase:       'gathering' | 'attacking';
  phaseTimer:  number;
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
          phase: 'gathering', phaseTimer: Math.random() * 15,
        };
        this.aiStates.set(player.id, state);
      }

      state.buildTimer  += dt;
      state.workerTimer += dt;
      state.trainTimer  += dt;
      state.phaseTimer  += dt;

      // Phase-based attack logic
      if (state.phase === 'gathering') {
        this.rallyTroops(player, game);
        if (state.phaseTimer >= GATHER_DURATION || player.aliveUnits.length >= 15) {
          state.phase = 'attacking';
          state.phaseTimer = 0;
        }
      } else {
        this.waveAttack(player, game);
        const allDead = game.allUnits.filter(u => u.playerId !== player.id && u.isAlive()).length === 0;
        if (state.phaseTimer >= ATTACK_DURATION || allDead) {
          state.phase = 'gathering';
          state.phaseTimer = 0;
        }
      }

      if (state.buildTimer >= AI_BUILD_INTERVAL && player.resources.stone >= 50) {
        state.buildTimer = 0;
        this.orderConstruction(player, game);
      }

      if (state.workerTimer >= AI_WORKER_INTERVAL) {
        state.workerTimer = 0;
        this.commandWorkers(player, game);
      }

      if (state.trainTimer >= AI_TRAIN_INTERVAL) {
        state.trainTimer = 0;
        this.orderTraining(player, game);
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

    for (const unit of player.aliveUnits) {
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

  /** Attack-phase: send all available units in a coordinated wave. */
  private waveAttack(player: Player, game: Game) {
    const myUnits = player.aliveUnits;
    const enemies = game.allUnits.filter(u => u.playerId !== player.id && u.isAlive());
    if (myUnits.length === 0 || enemies.length === 0) return;

    // Send 80% of forces; keep 20% near settlement as garrison
    const available = myUnits.filter(u => u.state === UnitState.IDLE || u.state === UnitState.MOVING);
    const toSend = Math.ceil(available.length * 0.8);

    for (let i = 0; i < Math.min(toSend, available.length); i++) {
      const unit = available[i];
      // Pick nearest enemy
      let best = enemies[0];
      let bestD = unit.distanceTo(best);
      for (const e of enemies) { const d = unit.distanceTo(e); if (d < bestD) { bestD = d; best = e; } }

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
