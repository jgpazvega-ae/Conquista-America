import type { Player } from './Player';
import type { Worker } from './Worker';
import type { Game } from './Game';
import { WorkerTask } from './Worker';
import type { ResourceNode } from './ResourceNode';
import { ResourceType } from './ResourceNode';
import { findPath } from './Pathfinding';
import { TerrainType, CivilizationType } from './types';

export class ResourceSystem {
  update(game: Game) {
    for (const worker of game.allWorkers) {
      const player = game.players[worker.playerId];
      if (!player) continue;

      // Workers can deposit at any completed settlement OR storehouse (reduces travel time)
      const settlements = game.allBuildings.filter(
        b => b.playerId === worker.playerId && b.isComplete() &&
             ((b.type as string) === 'SETTLEMENT' || (b.type as string) === 'STOREHOUSE'),
      );
      if (settlements.length === 0) continue;

      const nearestSettlement = this.nearest(settlements, worker.col, worker.row);

      // ── Deposit carried resources ───────────────────────────────────────────
      if (worker.carrying) {
        const distToBase = this.dist(worker.col, worker.row, nearestSettlement.col, nearestSettlement.row);
        if (distToBase <= 1.5) {
          const res = worker.dropResources();
          if (res) {
            if (res.type === 'food')       player.resources.food  += res.amount;
            else if (res.type === 'gold')  player.resources.gold  += res.amount;
            else if (res.type === 'wood')  player.resources.wood  += res.amount;
            else                           player.resources.stone += res.amount;
          }
          worker.task = WorkerTask.IDLE;
        } else if (worker.task !== WorkerTask.MOVING && worker.task !== WorkerTask.RETURNING) {
          // Head back to settlement
          const path = findPath(game.map, { col: worker.col, row: worker.row }, { col: nearestSettlement.col, row: nearestSettlement.row }, 300);
          if (path.length > 0) {
            worker.path      = path;
            worker.pathIndex = 0;
            worker.task      = WorkerTask.MOVING;
          }
        }
        continue;
      }

      // ── Storehouse proximity bonus: +20% gather speed within 5 tiles ─────────
      const isGathering = worker.task === WorkerTask.GATHERING_FOOD ||
                          worker.task === WorkerTask.GATHERING_GOLD ||
                          worker.task === WorkerTask.GATHERING_STONE ||
                          worker.task === WorkerTask.GATHERING_WOOD;
      if (isGathering) {
        const nearStorehouse = game.allBuildings.some(
          b => b.playerId === worker.playerId &&
               (b.type as string) === 'STOREHOUSE' && b.isComplete() &&
               Math.sqrt((worker.col - b.col) ** 2 + (worker.row - b.row) ** 2) <= 5,
        );
        if (nearStorehouse) worker.taskProgress += game.lastDt * 0.2;
        // Drought withers crops: food gathering is 30% slower during a drought
        if (game.weather.state === 'DROUGHT' && worker.task === WorkerTask.GATHERING_FOOD) {
          worker.taskProgress -= game.lastDt * 0.3;
        }
        // Terrain gather bonus: jungle-tile food is richer; highland stone seams are abundant.
        // Native civs (Aztec/Maya) know their jungles — extra +10% on top.
        const workerTile = game.map.getTile(Math.floor(worker.col), Math.floor(worker.row));
        const playerCiv  = (game.players[worker.playerId] as Player | undefined)?.civType;
        if (worker.task === WorkerTask.GATHERING_FOOD && workerTile?.terrain === TerrainType.JUNGLE) {
          const nativeBonus = (playerCiv === CivilizationType.AZTEC || playerCiv === CivilizationType.MAYA) ? 0.10 : 0;
          worker.taskProgress += game.lastDt * (0.30 + nativeBonus);
        }
        if (worker.task === WorkerTask.GATHERING_STONE &&
            (workerTile?.terrain === TerrainType.HIGHLAND || workerTile?.terrain === TerrainType.MOUNTAIN)) {
          const incaBonus = playerCiv === CivilizationType.INCA ? 0.15 : 0;
          worker.taskProgress += game.lastDt * (0.25 + incaBonus);
        }
        // Wood is harvested from jungle/forest tiles — native civs +15% efficiency
        if (worker.task === WorkerTask.GATHERING_WOOD && workerTile?.terrain === TerrainType.JUNGLE) {
          const nativeBonus = (playerCiv === CivilizationType.AZTEC || playerCiv === CivilizationType.MAYA || playerCiv === CivilizationType.INCA) ? 0.15 : 0;
          worker.taskProgress += game.lastDt * (0.20 + nativeBonus);
        }
      }

      // ── Find resource to gather (auto-assign idle workers) ──────────────────
      if (worker.task !== WorkerTask.IDLE) continue;

      const node = this.nearestNode(game.resourceNodes, worker.col, worker.row);
      if (!node) continue;

      const distToNode = this.dist(worker.col, worker.row, node.col, node.row);
      if (distToNode <= 1.5) {
        // Already next to node — start gathering
        const task = node.type === ResourceType.FOOD  ? WorkerTask.GATHERING_FOOD :
                     node.type === ResourceType.GOLD  ? WorkerTask.GATHERING_GOLD :
                     node.type === ResourceType.WOOD  ? WorkerTask.GATHERING_WOOD :
                                                        WorkerTask.GATHERING_STONE;
        worker.setTask(task, node.col, node.row);
      } else {
        // Walk to node
        const path = findPath(game.map, { col: worker.col, row: worker.row }, { col: node.col, row: node.row }, 300);
        if (path.length > 0) {
          worker.path      = path;
          worker.pathIndex = 0;
          worker.task      = WorkerTask.MOVING;
        }
      }
    }
  }

  private nearest<T extends { col: number; row: number }>(list: T[], col: number, row: number): T {
    let best = list[0];
    let bestD = this.dist(col, row, best.col, best.row);
    for (const item of list) {
      const d = this.dist(col, row, item.col, item.row);
      if (d < bestD) { bestD = d; best = item; }
    }
    return best;
  }

  private nearestNode(nodes: ResourceNode[], col: number, row: number): ResourceNode | null {
    let best: ResourceNode | null = null;
    let bestD = Infinity;
    for (const n of nodes) {
      if (n.isEmpty()) continue;
      const d = this.dist(col, row, n.col, n.row);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  private dist(c1: number, r1: number, c2: number, r2: number): number {
    return Math.sqrt((c1 - c2) ** 2 + (r1 - r2) ** 2);
  }
}
