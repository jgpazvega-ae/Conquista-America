import type { Player } from './Player';
import type { Worker } from './Worker';
import type { Game } from './Game';
import { WorkerTask } from './Worker';
import { TILE_SIZE } from './constants';

export class ResourceSystem {
  update(game: Game) {
    // Process worker resource return
    for (const worker of game.allWorkers) {
      if (!worker.carrying) continue;

      const player = game.players[worker.playerId];
      const settlements = game.allBuildings.filter(b => b.playerId === worker.playerId && b.type === 'SETTLEMENT');

      if (settlements.length === 0) continue;

      // Find nearest settlement
      let nearest = settlements[0];
      let nearestDist = this.distTo(worker, nearest.col, nearest.row);

      for (const s of settlements.slice(1)) {
        const d = this.distTo(worker, s.col, s.row);
        if (d < nearestDist) {
          nearest = s;
          nearestDist = d;
        }
      }

      // If close, deposit resources
      if (nearestDist <= 1.5) {
        const res = worker.dropResources();
        if (res) {
          if (res.type === 'food') player.resources.food += res.amount;
          else if (res.type === 'gold') player.resources.gold += res.amount;
          else player.resources.stone += res.amount;
          worker.task = WorkerTask.IDLE;
        }
      } else if (worker.task !== WorkerTask.MOVING) {
        // Move to settlement
        worker.task = WorkerTask.RETURNING;
        worker.targetCol = nearest.col;
        worker.targetRow = nearest.row;
      }
    }
  }

  private distTo(worker: Worker, col: number, row: number): number {
    const dx = worker.col - col;
    const dz = worker.row - row;
    return Math.sqrt(dx * dx + dz * dz);
  }
}
