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

// Ambush: attacking from jungle cover grants a hidden-strike bonus
function terrainAttackBonus(terrain: TerrainType | undefined): number {
  return terrain === TerrainType.JUNGLE ? 4 : 0;
}

export interface DamageEvent {
  attacker:      Unit | null;
  target:        Unit;
  damage:        number;
  worldX:        number;
  worldZ:        number;
  critical?:     boolean;
  sourceWorldX?: number; // set for building-sourced attacks (watchtower)
  sourceWorldZ?: number;
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

    // Build a set of players that have a level-3 unit alive (for leadership aura)
    const playersWithLeader = new Set<number>();
    for (const unit of allUnits) {
      if (unit.isAlive() && unit.level >= 3) playersWithLeader.add(unit.playerId);
    }

    for (const unit of allUnits) {
      if (!unit.isAlive()) continue;
      if (unit.garrisonedIn !== null) continue; // garrisoned troops fight via Game.updateGarrisonFire

      // Process active combat (ATTACKING or HOLD with a target)
      const isHold = unit.state === UnitState.HOLD;
      if ((unit.state === UnitState.ATTACKING || isHold) && unit.attackTarget) {
        const target = unit.attackTarget;
        if (!target.isAlive()) {
          // Grant XP for the kill
          unit.gainXP(25 + Math.floor(Math.random() * 15));
          unit.state        = isHold ? UnitState.HOLD : UnitState.IDLE;
          unit.attackTarget = null;
          continue;
        }

        const dist = unit.distanceTo(target);
        if (dist > unit.attackRange + 1.5) {
          if (isHold) {
            // HOLD units don't chase — drop the target and wait
            unit.attackTarget = null;
            continue;
          }
          const path = findPath(map, unit.gridPos(), target.gridPos(), 200);
          if (path.length > 0) {
            unit.state     = UnitState.MOVING;
            unit.path      = path;
            unit.pathIndex = 0;
          }
          continue;
        }

        if (unit.attackTimer <= 0) {
          const attackerTile = map.getTile(unit.col, unit.row);
          let dmg = unit.attack + Math.floor(Math.random() * 6) - 3 + terrainAttackBonus(attackerTile?.terrain);
          const multiplier = getDamageMultiplier(unit.type, target.type);
          dmg = Math.round(dmg * multiplier);
          const tile = map.getTile(target.col, target.row);
          dmg = Math.max(1, dmg - terrainDefenseBonus(tile?.terrain));
          // Hold position: +2 defense bonus for targets holding their ground
          if (target.state === UnitState.HOLD) dmg = Math.max(1, dmg - 2);
          // Routed targets are cut down more easily
          if (target.panicked) dmg = Math.round(dmg * 1.25);
          // Flanking bonus: +25% damage when 2 or more allies attack the same target
          const isFlanking = (attackerCount.get(target.id) ?? 1) >= 2;
          if (isFlanking) dmg = Math.round(dmg * 1.25);
          // Cavalry charge: +60% on first strike after 3s idle
          let isCharge = false;
          if (unit.type === UnitType.CAVALRY && unit.chargeReady) {
            dmg = Math.round(dmg * 1.6);
            unit.chargeReady = false;
            isCharge = true;
          }
          // Berserk: +25% damage during 12-second kill-streak buff
          if (unit.berserkTimer > 0) dmg = Math.round(dmg * 1.25);
          // Leadership aura: +5% damage when player has any level-3 unit alive
          if (playersWithLeader.has(unit.playerId)) dmg = Math.round(dmg * 1.05);

          const actual = target.takeDamage(dmg);
          unit.attackTimer = unit.attackCooldown;
          let isCrit = multiplier >= 1.5 || isFlanking || isCharge || unit.berserkTimer > 0;
          this.events.push({ attacker: unit, target, damage: actual, worldX: target.worldX, worldZ: target.worldZ, critical: isCrit });

          // Kill streak tracking: 3 kills in a row without taking damage → 12s berserk
          if (!target.isAlive()) {
            unit.killStreak++;
            if (unit.killStreak >= 3) {
              unit.berserkTimer = 12;
              unit.killStreak   = 0;
            }
          }

          // Cannon: splash damage + burning status effect (30% chance on direct hit)
          if (unit.type === UnitType.CANNON) {
            if (Math.random() < 0.30 && target.isAlive()) target.burning = Math.max(target.burning, 4);
            const splashDmg = Math.max(1, Math.round(dmg * SPLASH_DAMAGE_RATIO));
            for (const other of allUnits) {
              if (!other.isAlive() || other === target) continue;
              const d = Math.sqrt((other.col - target.col) ** 2 + (other.row - target.row) ** 2);
              if (d <= SPLASH_RADIUS) {
                const splashActual = other.takeDamage(splashDmg);
                if (Math.random() < 0.15) other.burning = Math.max(other.burning, 3);
                this.events.push({ attacker: unit, target: other, damage: splashActual, worldX: other.worldX, worldZ: other.worldZ, critical: false });
              }
            }
          }
          // Jungle melee: 20% chance to poison target
          if (unit.attackRange < 2) {
            const attackerTile = map.getTile(unit.col, unit.row);
            if (attackerTile?.terrain === TerrainType.JUNGLE && Math.random() < 0.20) {
              target.poisoned = Math.max(target.poisoned, 6);
            }
          }
        }
      }

      // Auto-aggro for IDLE, ATTACK_MOVE, and HOLD units
      if (unit.state === UnitState.IDLE || unit.state === UnitState.ATTACK_MOVE || unit.state === UnitState.HOLD) {
        this.tryAutoAggro(unit, allUnits, map);
      }
    }

    return this.events;
  }

  private tryAutoAggro(unit: Unit, allUnits: Unit[], map: GameMap) {
    if (unit.panicked) return; // routed troops don't fight back
    // ATTACK_MOVE: full sight range; IDLE: 1.2x attack range; HOLD: attack range only (no movement)
    const scanRange = unit.state === UnitState.ATTACK_MOVE
      ? unit.sight
      : unit.attackRange * (unit.state === UnitState.HOLD ? 1.0 : 1.2);
    let bestScore = Infinity;
    let best: Unit | null = null;

    for (const other of allUnits) {
      if (!other.isAlive()) continue;
      if (other.playerId === unit.playerId) continue;
      if (other.garrisonedIn !== null) continue; // can't target troops inside buildings
      const d = unit.distanceTo(other);
      if (d > scanRange) continue;
      const score = this.targetScore(unit, other, d);
      if (score < bestScore) { bestScore = score; best = other; }
    }

    if (best) {
      if (unit.state === UnitState.HOLD) {
        unit.attackTarget = best;
      } else {
        unit.attackUnit(best);
      }
    }
  }

  // Smart target scoring: lower score = higher priority.
  // Biases target selection by attacker unit type.
  private targetScore(unit: Unit, candidate: Unit, dist: number): number {
    const hpPct = candidate.hp / candidate.maxHp;
    let score = dist; // base: prefer closer targets

    switch (unit.type) {
      case UnitType.CAVALRY:
        // Prefer low-HP enemies and ranged units (neutralize them quickly)
        if (hpPct < 0.5) score *= 0.65;
        if (candidate.attackRange > 2.0) score *= 0.75;
        if (candidate.isHero) score *= 0.5;
        break;
      case UnitType.CANNON:
        // Prefer attacking enemies, letting splash hit nearby groups
        if (candidate.state === UnitState.ATTACKING) score *= 0.8;
        if (hpPct < 0.4) score *= 0.85;
        break;
      case UnitType.ARCHER:
      case UnitType.ATLATL:
      case UnitType.SLINGER:
      case UnitType.ARQUEBUSIER:
        // Prefer melee units currently attacking allies (safe to kite them)
        if (candidate.attackRange <= 1.5 && candidate.state === UnitState.ATTACKING) score *= 0.8;
        if (candidate.isHero) score *= 0.7;
        break;
      case UnitType.JAGUAR_KNIGHT:
      case UnitType.EAGLE_WARRIOR:
      case UnitType.CUACHIC:
      case UnitType.CHAKANA_GUARD:
        // Elite melee: prioritize heroes and other elites
        if (candidate.isHero) score *= 0.5;
        if (hpPct < 0.35) score *= 0.75; // finish off wounded
        break;
    }
    return score;
  }

  getAndClearEvents(): DamageEvent[] {
    const evts = this.events;
    this.events = [];
    return evts;
  }
}
