import { UnitState, TerrainType, UnitType } from './types';
import type { Unit } from './Unit';
import type { GameMap } from './Map';
import { findPath } from './Pathfinding';
import { getDamageMultiplier, FORMATIONS } from './UnitBalancing';
import type { WeatherSystem } from './WeatherSystem';

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

// Terrain attack bonuses: high ground, cover, and exposure
function terrainAttackBonus(terrain: TerrainType | undefined): number {
  switch (terrain) {
    case TerrainType.JUNGLE:   return 4;   // ambush from dense cover
    case TerrainType.HIGHLAND: return 3;   // high-ground advantage
    case TerrainType.MOUNTAIN: return 2;   // firing downhill
    case TerrainType.DESERT:   return -2;  // exposed, blinded by glare
    default:                   return 0;
  }
}

export interface DamageEvent {
  attacker:      Unit | null;
  target:        Unit;
  damage:        number;
  worldX:        number;
  worldZ:        number;
  critical?:     boolean;
  isCharge?:     boolean;
  chargeBlocked?: boolean; // cavalry charge was absorbed by spear phalanx
  sourceWorldX?: number; // set for building-sourced attacks (watchtower)
  sourceWorldZ?: number;
}

export class CombatSystem {
  private events: DamageEvent[] = [];

  update(allUnits: Unit[], map: GameMap, weather?: WeatherSystem, isNight?: boolean) {
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

      // Melee-pin detection: ranged units fighting while an adjacent enemy melee unit is present
      // suffer -40% damage (they can't aim/reload properly while being rushed).
      if (!unit.outOfAmmo && unit.attackRange > 1.5 && unit.type !== UnitType.CANNON) {
        const meleeThreat = allUnits.some(e =>
          e.isAlive() && e.playerId !== unit.playerId && e.attackRange <= 1.5 &&
          e.garrisonedIn === null && unit.distanceTo(e) <= 1.6,
        );
        unit.meleePinned = meleeThreat;
      } else {
        unit.meleePinned = false;
      }

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

        // Out-of-ammo ranged units fight as weak melee
        const effRange = unit.outOfAmmo ? 1.5 : unit.attackRange;
        const dist = unit.distanceTo(target);
        if (dist > effRange + 1.5) {
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

        // Volley fire (V key) bypasses the attack timer for a burst shot
        const isVolley = unit.volleyReady && unit.ammo > 0;
        if (isVolley) unit.volleyReady = false;

        // Cannon deployment: must be stationary ≥ 4s before firing (AC: unlimbering time)
        if (unit.type === UnitType.CANNON && unit.stationaryTimer < 4) {
          unit.attackTimer = Math.max(unit.attackTimer, 1.0); // retry in ≤1s
          continue;
        }

        if (isVolley || unit.attackTimer <= 0) {
          const attackerTile = map.getTile(unit.col, unit.row);
          const baseAtk = unit.outOfAmmo ? Math.max(4, Math.round(unit.def.stats.attack * 0.4)) : unit.attack;
          let dmg = baseAtk + Math.floor(Math.random() * 6) - 3 + terrainAttackBonus(attackerTile?.terrain);
          // Formation attack bonus (LOOSE: -10%, PHALANX: -20%, WEDGE: +25%)
          if (unit.formation && FORMATIONS[unit.formation]) {
            dmg = Math.max(1, Math.round(dmg * (1 + FORMATIONS[unit.formation].bonusAttack)));
          }
          const multiplier = getDamageMultiplier(unit.type, target.type);
          dmg = Math.round(dmg * multiplier);
          // Ranged units can't aim properly with a melee enemy in their face (−40% damage)
          if (!unit.outOfAmmo && unit.attackRange > 1.5 && unit.type !== UnitType.CANNON) {
            const meleeThreat = allUnits.some(e =>
              e.isAlive() && e.playerId !== unit.playerId && e.attackRange <= 1.5 &&
              e.garrisonedIn === null && unit.distanceTo(e) <= 1.6,
            );
            unit.meleePinned = meleeThreat;
            if (meleeThreat) dmg = Math.max(1, Math.round(dmg * 0.6));
          } else {
            unit.meleePinned = false;
          }
          const tile = map.getTile(target.col, target.row);
          dmg = Math.max(1, dmg - terrainDefenseBonus(tile?.terrain));
          // Formation defense (LOOSE: -15% def, PHALANX: +30% def, WEDGE: +10% def)
          if (target.formation && FORMATIONS[target.formation]) {
            dmg = Math.max(1, Math.round(dmg * (1 - FORMATIONS[target.formation].bonusDefense)));
          }
          // Hold position: +2 defense bonus for targets holding their ground
          if (target.state === UnitState.HOLD) dmg = Math.max(1, dmg - 2);
          // Stationary defense: unit holding ground ≥5s gains battle readiness (+1 def)
          if (target.stationaryTimer >= 5) dmg = Math.max(1, dmg - 1);
          // Entrenched: dug into cover (+5 defense on top of HOLD bonus)
          if (target.entrenched) dmg = Math.max(1, dmg - 5);
          // Jungle ambush: melee units gain +20% from cover; stationary 5+s = true ambush (+40%).
          // Cavalry and Cannon lose this advantage — they can't maneuver in thick forest.
          if (unit.attackRange <= 1.5 &&
              unit.type !== UnitType.CAVALRY && unit.type !== UnitType.CANNON) {
            const attackerTile = map?.getTile(Math.round(unit.col), Math.round(unit.row));
            if (attackerTile?.terrain === TerrainType.JUNGLE) {
              const ambushMult = unit.stationaryTimer >= 5 ? 1.4 : 1.2;
              dmg = Math.round(dmg * ambushMult);
            }
          }
          // Close ranks: formation fighters shield each other
          if (target.inFormation) dmg = Math.max(1, dmg - 2);
          // Officer aura: a nearby level-3 champion / hero steadies the line (+2 def)
          if (target.nearOfficer) dmg = Math.max(1, dmg - 2);
          // Routed targets are cut down more easily; cavalry pursuit is especially lethal
          if (target.panicked) {
            dmg = Math.round(dmg * (unit.type === UnitType.CAVALRY ? 1.55 : 1.25));
          }
          // Flanking bonus: +25% damage when 2 or more allies attack the same target
          const isFlanking = (attackerCount.get(target.id) ?? 1) >= 2;
          if (isFlanking) dmg = Math.round(dmg * 1.25);
          // Cannon battery: entrenched cannon in prepared firing position +50% damage
          if (unit.type === UnitType.CANNON && unit.entrenched) dmg = Math.round(dmg * 1.5);
          // Cavalry charge: +60% on first strike after 3s idle + morale shock on target
          let isCharge = false;
          let chargeBlocked = false;
          if (unit.type === UnitType.CAVALRY && unit.chargeReady) {
            unit.chargeReady = false;
            const spearTypes = new Set([UnitType.SPEARMAN, UnitType.QUECHUA, UnitType.ANTIS_WARRIOR, UnitType.CHAKANA_GUARD]);
            if (target.formation === 'PHALANX' && spearTypes.has(target.type)) {
              // Phalanx brace: spear units set against charging cavalry absorb the blow.
              // No charge bonus, no morale shock; defenders gain confidence (+10 morale).
              chargeBlocked = true;
              if (!target.isHero) target.morale = Math.min(100, target.morale + 10);
            } else {
              dmg = Math.round(dmg * 1.6);
              isCharge = true;
              unit.chargeSpeedTimer = 2.0; // 2s speed burst from charge momentum
              if (!target.isHero) target.loseMorale(15); // charge breaks enemy morale
            }
          }
          // Heavy wounds (< 25% HP): attacker fights at reduced effectiveness
          if (unit.hp < unit.maxHp * 0.25) dmg = Math.round(dmg * 0.8);
          // Berserk: +25% damage during 12-second kill-streak buff
          if (unit.berserkTimer > 0) dmg = Math.round(dmg * 1.25);
          // Leadership aura: +5% damage when player has any level-3 unit alive
          if (playersWithLeader.has(unit.playerId)) dmg = Math.round(dmg * 1.05);
          // Civ unit synergy: +10% damage when fighting alongside a complementary unit type
          if (unit.nearSynergy) dmg = Math.round(dmg * 1.10);
          // Hero passive specialization: +15% when hero's signature unit type fights nearby
          if (unit.heroPowerBuff) dmg = Math.round(dmg * 1.15);
          // Inspired fury: +15% damage for 5s after landing a kill at ≥80 morale
          if (unit.inspiredTimer > 0) dmg = Math.round(dmg * 1.15);
          // Ambush striker: JAGUAR_KNIGHT/CUACHIC first attack after ≥5s still — stalk-and-pounce +35%
          if (unit.ambushReady) { dmg = Math.round(dmg * 1.35); unit.ambushReady = false; unit.stationaryTimer = 0; }
          // Champion last stand: level-3 unit at <25% HP fights with desperate fury (+25% dmg)
          if (unit.lastStandTimer > 0) dmg = Math.round(dmg * 1.25);
          // Hero war cry buff: +25% attack for 12s
          if (unit.buffAttackTimer > 0) dmg = Math.round(dmg * 1.25);
          // Volley: synchronized burst for 2.5× damage, longer reload
          if (isVolley) dmg = Math.round(dmg * 2.5);
          // Weather: rain/storm reduces gunpowder & all-ranged effectiveness
          if (weather) dmg = Math.max(1, Math.round(dmg * weather.damageMultiplier(unit.type)));
          // Night: melee thrives in the dark (+15%); gunpowder weapons struggle (-10%).
          // Eagle Warriors are trained for night warfare: +40% instead of the standard +15%.
          if (isNight) {
            const isPowder = unit.type === UnitType.ARQUEBUSIER || unit.type === UnitType.CANNON;
            const nightMult = isPowder ? 0.9 : (unit.type === UnitType.EAGLE_WARRIOR ? 1.40 : 1.15);
            dmg = Math.round(dmg * nightMult);
          }
          // Veteran toughness: level-3 Champions absorb 15% of incoming damage
          if (target.level >= 3) dmg = Math.max(1, Math.round(dmg * 0.85));
          // Melee pin: ranged unit threatened by adjacent enemy melee fires at -40%
          if (unit.meleePinned) dmg = Math.max(1, Math.round(dmg * 0.6));
          // Officer aura: units near a hero or veteran champion take -2 damage
          if (target.nearOfficer) dmg = Math.max(1, dmg - 2);
          // Homeland defender: Nv.3 units fighting on HOLD near their own settlement
          // fight with supreme determination — additional 10% damage absorption
          if (target.level >= 3 && target.state === UnitState.HOLD && target._nearSettlement) {
            dmg = Math.max(1, Math.round(dmg * 0.90));
          }

          const actual = target.takeDamage(dmg);
          // Entrenched ranged: prepared position grants 20% faster reload
          const entrenchedBonus = (unit.entrenched && !unit.outOfAmmo && unit.attackRange > 1.5 &&
            unit.type !== UnitType.CANNON) ? 0.80 : 1.0;
          unit.attackTimer = unit.attackCooldown * (isVolley ? 1.5 : 1.0) * entrenchedBonus;
          // Ammo consumption (volley costs 2 rounds)
          if (unit.ammo > 0) unit.ammo = Math.max(0, unit.ammo - (isVolley ? 2 : 1));

          let isCrit = multiplier >= 1.5 || isFlanking || isCharge || unit.berserkTimer > 0 || isVolley || unit.buffAttackTimer > 0;
          this.events.push({ attacker: unit, target, damage: actual, worldX: target.worldX, worldZ: target.worldZ, critical: isCrit, isCharge, chargeBlocked });

          // Hero front-line inspiration: hero's attack boosts morale of nearby allies (+1 each strike)
          if (unit.isHero && actual > 0) {
            for (const ally of allUnits) {
              if (!ally.isAlive() || ally === unit || ally.playerId !== unit.playerId) continue;
              if (Math.hypot(ally.col - unit.col, ally.row - unit.row) <= 5)
                ally.morale = Math.min(100, ally.morale + 1);
            }
          }

          // Fire arrow: ARCHER/ATLATL/SLINGER have a 15% chance to ignite the target
          if (target.isAlive() && !target.burning &&
              (unit.type === UnitType.ARCHER || unit.type === UnitType.ATLATL || unit.type === UnitType.SLINGER) &&
              Math.random() < 0.15) {
            target.burning = 3;
          }

          // Kill streak tracking: 3 kills in a row without taking damage → 12s berserk
          if (!target.isAlive()) {
            unit.killStreak++;
            if (unit.killStreak >= 3) {
              unit.berserkTimer = 12;
              unit.killStreak   = 0;
            }
            // Inspired fury: high-morale kill triggers a short damage surge
            if (!unit.isHero && unit.morale >= 80) unit.inspiredTimer = 5;
          }

          // Cannon: splash damage + burning + artillery terror (morale shock)
          if (unit.type === UnitType.CANNON) {
            const burnMult = weather ? weather.burnChanceMult : 1.0;
            if (Math.random() < 0.30 * burnMult && target.isAlive()) target.burning = Math.max(target.burning, 4);
            // Direct hit terror: a cannonball is terrifying, even when it doesn't kill
            if (target.isAlive() && !target.isHero) target.loseMorale(8);
            const splashDmg = Math.max(1, Math.round(dmg * SPLASH_DAMAGE_RATIO));
            const CANNON_TERROR_RADIUS = 4.0; // morale-shock zone beyond physical splash
            for (const other of allUnits) {
              if (!other.isAlive() || other === target) continue;
              const d = Math.sqrt((other.col - target.col) ** 2 + (other.row - target.row) ** 2);
              if (d <= SPLASH_RADIUS) {
                const splashActual = other.takeDamage(splashDmg);
                if (Math.random() < 0.15 * burnMult) other.burning = Math.max(other.burning, 3);
                // Shrapnel terror: nearby troops are rattled by the blast
                if (other.isAlive() && !other.isHero) other.loseMorale(5);
                this.events.push({ attacker: unit, target: other, damage: splashActual, worldX: other.worldX, worldZ: other.worldZ, critical: false });
              } else if (d <= CANNON_TERROR_RADIUS && other.playerId !== unit.playerId) {
                // Psychological terror: the thunderclap demoralises troops beyond the kill zone
                if (!other.isHero) other.loseMorale(3);
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
          // Slinger: stone impact staggers the target (-40% speed for 2s; infantry only)
          if (unit.type === UnitType.SLINGER && target.isAlive() && target.attackRange <= 1.5) {
            target.slowed = Math.max(target.slowed, 2);
          }
          // Atlatl: javelin has small splash (0.8-tile radius, 40% damage) — punishes packed formations
          if (unit.type === UnitType.ATLATL && target.isAlive()) {
            const atatlSplash = Math.max(1, Math.round(dmg * 0.40));
            for (const other of allUnits) {
              if (!other.isAlive() || other === target || other.playerId === unit.playerId) continue;
              if (Math.hypot(other.col - target.col, other.row - target.row) <= 0.8) {
                const splashActual = other.takeDamage(atatlSplash);
                this.events.push({ attacker: unit, target: other, damage: splashActual, worldX: other.worldX, worldZ: other.worldZ, critical: false });
              }
            }
          }
          // Critical hit stagger: flanking, charge, berserk, or volley crits add +0.5s to the
          // target's attack timer (brief interrupt — the blow breaks their combat rhythm)
          if (isCrit && target.isAlive() && !target.isHero) {
            target.attackTimer = Math.max(target.attackTimer, target.attackCooldown * 0.5);
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
    // Out-of-ammo ranged: only scan at melee range
    const baseRange = unit.outOfAmmo ? 1.5 : unit.attackRange;
    // ATTACK_MOVE: full sight range; IDLE: 1.2x attack range; HOLD: attack range only (no movement)
    const scanRange = unit.state === UnitState.ATTACK_MOVE
      ? (unit.outOfAmmo ? 2.5 : unit.sight)
      : baseRange * (unit.state === UnitState.HOLD ? 1.0 : 1.2);
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
