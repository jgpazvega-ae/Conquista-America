import { UnitState } from './types';
import type { Unit } from './Unit';
import type { GameMap } from './Map';
import { findPath } from './Pathfinding';
import { getDamageMultiplier } from './UnitBalancing';

export interface DamageEvent {
  attacker: Unit | null;
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

      // Process active combat
      if (unit.state === UnitState.ATTACKING && unit.attackTarget) {
        const target = unit.attackTarget;
        if (!target.isAlive()) {
          // Grant XP for the kill
          unit.gainXP(25 + Math.floor(Math.random() * 15));
          unit.state        = UnitState.IDLE;
          unit.attackTarget = null;
          continue;
        }

        const dist = unit.distanceTo(target);
        if (dist > unit.attackRange + 1.5) {
          const path = findPath(map, unit.gridPos(), target.gridPos(), 200);
          if (path.length > 0) {
            unit.state     = UnitState.MOVING;
            unit.path      = path;
            unit.pathIndex = 0;
          }
          continue;
        }

        if (unit.attackTimer <= 0) {
          let dmg = unit.attack + Math.floor(Math.random() * 6) - 3;
          const multiplier = getDamageMultiplier(unit.type, target.type);
          dmg = Math.round(dmg * multiplier);
          const actual = target.takeDamage(dmg);
          unit.attackTimer = unit.attackCooldown;
          this.events.push({ attacker: unit, target, damage: actual, worldX: target.worldX, worldZ: target.worldZ });
        }
      }

      // Auto-aggro for IDLE and ATTACK_MOVE units
      if (unit.state === UnitState.IDLE || unit.state === UnitState.ATTACK_MOVE) {
        this.tryAutoAggro(unit, allUnits, map);
      }
    }

    return this.events;
  }

  private tryAutoAggro(unit: Unit, allUnits: Unit[], map: GameMap) {
    // ATTACK_MOVE has wider scan range; IDLE only reacts to attack range
    const scanRange = unit.state === UnitState.ATTACK_MOVE ? unit.sight : unit.attackRange * 1.2;
    let nearestDist = scanRange;
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
