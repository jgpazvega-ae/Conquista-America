import type { Player } from './Player';
import type { Worker } from './Worker';
import type { Game } from './Game';
import { WorkerTask } from './Worker';
import type { ResourceNode } from './ResourceNode';
import { ResourceType } from './ResourceNode';
import { findPath } from './Pathfinding';

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
            if (res.type === 'food')  player.resources.food  += res.amount;
            else if (res.type === 'gold')  player.resources.gold  += res.amount;
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

      // ── Find resource to gather (auto-assign idle workers) ──────────────────
      if (worker.task !== WorkerTask.IDLE) continue;

      const node = this.nearestNode(game.resourceNodes, worker.col, worker.row);
      if (!node) continue;

      const distToNode = this.dist(worker.col, worker.row, node.col, node.row);
      if (distToNode <= 1.5) {
        // Already next to node — start gathering
        const task = node.type === ResourceType.FOOD  ? WorkerTask.GATHERING_FOOD :
                     node.type === ResourceType.GOLD  ? WorkerTask.GATHERING_GOLD :
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
