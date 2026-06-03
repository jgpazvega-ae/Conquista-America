import { UnitState } from './types';
import type { Unit } from './Unit';
import type { GameMap } from './Map';
import { findPath } from './Pathfinding';

export interface DamageEvent {
  attacker: Unit;
  target:   Unit;
  damage:   number;
  worldX:   number;
  worldZ:   number;
}

export class CombatSystem {
  private events: DamageEvent[] = [];

  update(allUnits: Unit[], map: GameMap) {
    this.events = [];

    for (const unit of allUnits) {
      if (!unit.isAlive()) continue;

      // If attacking, process combat
      if (unit.state === UnitState.ATTACKING && unit.attackTarget) {
        const target = unit.attackTarget;
        if (!target.isAlive()) {
          unit.state        = UnitState.IDLE;
          unit.attackTarget = null;
          continue;
        }

        const dist = unit.distanceTo(target);
        if (dist > unit.attackRange + 1.5) {
          // Too far – move closer
          const path = findPath(map, unit.gridPos(), target.gridPos(), 200);
          if (path.length > 0) {
            unit.state     = UnitState.MOVING;
            unit.path      = path;
            unit.pathIndex = 0;
          }
          continue;
        }

        if (unit.attackTimer <= 0) {
          const dmg = unit.attack + Math.floor(Math.random() * 6) - 3;
          const actual = target.takeDamage(dmg);
          unit.attackTimer = unit.attackCooldown;
          this.events.push({ attacker: unit, target, damage: actual, worldX: target.worldX, worldZ: target.worldZ });
        }
      }

      // Auto-aggro: find nearest enemy if idle
      if (unit.state === UnitState.IDLE) {
        this.tryAutoAggro(unit, allUnits, map);
      }
    }

    return this.events;
  }

  private tryAutoAggro(unit: Unit, allUnits: Unit[], map: GameMap) {
    let nearestDist = unit.attackRange * 1.2;
    let nearest: Unit | null = null;

    for (const other of allUnits) {
      if (!other.isAlive()) continue;
      if (other.playerId === unit.playerId) continue;
      const d = unit.distanceTo(other);
      if (d < nearestDist) {
        nearestDist = d;
        nearest     = other;
      }
    }

    if (nearest) {
      unit.attackUnit(nearest);
    }
  }

  getAndClearEvents(): DamageEvent[] {
    const evts = this.events;
    this.events = [];
    return evts;
  }
}
