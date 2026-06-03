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

const AI_THINK_INTERVAL = 4.0;
const AI_BUILD_INTERVAL = 12.0;
const AI_WORKER_INTERVAL = 5.0;

interface AIState {
  thinkTimer: number;
  buildTimer: number;
  workerTimer: number;
}

export class AISystem {
  private aiStates = new Map<number, AIState>();

  update(dt: number, game: Game) {
    for (const player of game.players) {
      if (player.isHuman) continue;

      let state = this.aiStates.get(player.id);
      if (!state) {
        state = { thinkTimer: 0, buildTimer: 0, workerTimer: 0 };
        this.aiStates.set(player.id, state);
      }

      state.thinkTimer += dt;
      state.buildTimer += dt;
      state.workerTimer += dt;

      if (state.thinkTimer >= AI_THINK_INTERVAL) {
        state.thinkTimer = 0;
        this.orderAttack(player, game);
      }

      if (state.buildTimer >= AI_BUILD_INTERVAL && player.resources.stone >= 50) {
        state.buildTimer = 0;
        this.orderConstruction(player, game);
      }

      if (state.workerTimer >= AI_WORKER_INTERVAL) {
        state.workerTimer = 0;
        this.commandWorkers(player, game);
      }
    }
  }

  private orderAttack(player: Player, game: Game) {
    const myUnits = player.aliveUnits;
    const enemies = game.allUnits.filter(u => u.playerId !== player.id && u.isAlive());

    if (myUnits.length === 0 || enemies.length === 0) return;

    const clusters = this.findEnemyClusters(enemies);

    for (const cluster of clusters) {
      const availableUnits = myUnits.filter(u => u.state === UnitState.IDLE || u.state === UnitState.MOVING);
      if (availableUnits.length === 0) break;

      const unitsToAssign = Math.min(4, availableUnits.length);
      for (let i = 0; i < unitsToAssign; i++) {
        const unit = availableUnits[i];
        const target = cluster.units[Math.floor(Math.random() * cluster.units.length)];

        if (unit.distanceTo(target) <= unit.attackRange + 1.0) {
          unit.attackUnit(target);
        } else {
          const path = findPath(game.map, unit.gridPos(), target.gridPos(), 300);
          if (path.length > 0) unit.moveTo(path);
        }
      }
    }
  }

  private findEnemyClusters(enemies: Unit[]) {
    const clusters: { units: Unit[]; cx: number; cz: number }[] = [];
    const visited = new Set<number>();

    for (const enemy of enemies) {
      if (visited.has(enemy.id)) continue;

      const cluster = { units: [enemy], cx: enemy.col, cz: enemy.row };
      visited.add(enemy.id);

      for (const other of enemies) {
        if (visited.has(other.id)) continue;
        if (enemy.distanceTo(other) <= 6) {
          cluster.units.push(other);
          cluster.cx += other.col;
          cluster.cz += other.row;
          visited.add(other.id);
        }
      }

      cluster.cx /= cluster.units.length;
      cluster.cz /= cluster.units.length;
      clusters.push(cluster);
    }

    return clusters;
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

    const building = new Building(buildType, def, player.id, pos[0], pos[1], 0xcccccc);
    game.allBuildings.push(building);
    player.resources.food -= def.cost.food;
    player.resources.gold -= def.cost.gold;
    player.resources.stone -= def.cost.stone;
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
