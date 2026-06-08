import { UnitState, TerrainType, UnitType } from './types';
import type { Unit } from './Unit';
import type { GameMap } from './Map';
import { findPath } from './Pathfinding';
import { getDamageMultiplier } from './UnitBalancing';

const SPLASH_RADIUS = 1.8;  // tiles — radius of cannon splash
const SPLASH_DAMAGE_RATIO = 0.55; // fraction of base damage dealt to splash targets

function terrainDefenseBonus(terrain: TerrainType | undefined): number {
  switch (terrain) {
    case TerrainType.JUNGLE:    return 4;
    case TerrainType.HIGHLAND:  return 3;
    case TerrainType.MOUNTAIN:  return 5;
    case TerrainType.DESERT:    return -1;
    default:                    return 0;
  }
}

export interface DamageEvent {
  attacker: Unit | null;
  target:   Unit;
  damage:   number;
  worldX:   number;
  worldZ:   number;
  critical?: boolean;
}

export class CombatSystem {
  private events: DamageEvent[] = [];

  update(allUnits: Unit[], map: GameMap) {
    this.events = [];

    // Build a map of target id → number of allied attackers for flanking bonus
    const attackerCount = new Map<number, number>();
    for (const unit of allUnits) {
      if (!unit.isAlive() || unit.state !== UnitState.ATTACKING || !unit.attackTarget?.isAlive()) continue;
      attackerCount.set(unit.attackTarget.id, (attackerCount.get(unit.attackTarget.id) ?? 0) + 1);
    }

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
          const tile = map.getTile(target.col, target.row);
          dmg = Math.max(1, dmg - terrainDefenseBonus(tile?.terrain));
          // Flanking bonus: +25% damage when 2 or more allies attack the same target
          const isFlanking = (attackerCount.get(target.id) ?? 1) >= 2;
          if (isFlanking) dmg = Math.round(dmg * 1.25);
          const actual = target.takeDamage(dmg);
          unit.attackTimer = unit.attackCooldown;
          const isCrit = multiplier >= 1.5 || isFlanking;
          this.events.push({ attacker: unit, target, damage: actual, worldX: target.worldX, worldZ: target.worldZ, critical: isCrit });

          // Cannon splash: deal reduced damage to all units near the primary target
          if (unit.type === UnitType.CANNON) {
            const splashDmg = Math.max(1, Math.round(dmg * SPLASH_DAMAGE_RATIO));
            for (const other of allUnits) {
              if (!other.isAlive() || other === target) continue;
              const d = Math.sqrt((other.col - target.col) ** 2 + (other.row - target.row) ** 2);
              if (d <= SPLASH_RADIUS) {
                const splashActual = other.takeDamage(splashDmg);
                this.events.push({ attacker: unit, target: other, damage: splashActual, worldX: other.worldX, worldZ: other.worldZ, critical: false });
              }
            }
          }
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
