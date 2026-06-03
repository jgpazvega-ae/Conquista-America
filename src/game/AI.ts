import { UnitState } from './types';
import type { Unit } from './Unit';
import type { Player } from './Player';
import type { GameMap } from './Map';
import { findPath } from './Pathfinding';

const AI_THINK_INTERVAL  = 3.5;
const AI_ATTACK_INTERVAL = 6.0;

export class AISystem {
  update(dt: number, player: Player, enemies: Unit[], map: GameMap) {
    if (player.isHuman) return;

    player.aiTimer       += dt;
    player.aiAttackTimer += dt;

    if (player.aiTimer < AI_THINK_INTERVAL) return;
    player.aiTimer = 0;

    const alive = player.aliveUnits;
    if (alive.length === 0) return;

    const liveEnemies = enemies.filter(e => e.isAlive());
    if (liveEnemies.length === 0) return;

    // Group units and send them toward closest enemy cluster
    if (player.aiAttackTimer >= AI_ATTACK_INTERVAL) {
      player.aiAttackTimer = 0;
      this.orderAttack(alive, liveEnemies, map);
    }
  }

  private orderAttack(myUnits: Unit[], enemies: Unit[], map: GameMap) {
    // Find centroid of enemies
    let ex = 0, ez = 0;
    for (const e of enemies) { ex += e.col; ez += e.row; }
    ex = Math.round(ex / enemies.length);
    ez = Math.round(ez / enemies.length);

    for (const unit of myUnits) {
      if (unit.state !== UnitState.IDLE && unit.state !== UnitState.MOVING) continue;

      // Find closest enemy to this unit
      let best: Unit | null = null;
      let bestDist = Infinity;
      for (const e of enemies) {
        const d = unit.distanceTo(e);
        if (d < bestDist) { bestDist = d; best = e; }
      }

      if (!best) continue;

      if (bestDist <= unit.attackRange + 1.0) {
        unit.attackUnit(best);
      } else {
        const goal = { col: best.col, row: best.row };
        const path = findPath(map, unit.gridPos(), goal, 300);
        if (path.length > 0) unit.moveTo(path);
      }
    }
  }
}
