import { CivilizationType } from './types';
import type { Game } from './Game';

export interface PowerDef {
  name: string;
  emoji: string;
  description: string;
  cooldown: number;   // seconds
  duration: number;   // seconds (0 = instant)
  key: string;        // keyboard shortcut label
}

export const CIV_POWER_DEFS: Record<CivilizationType, PowerDef> = {
  [CivilizationType.AZTEC]: {
    name: 'Sacrificio',
    emoji: '🩸',
    description: 'Sacrifica una unidad seleccionada para obtener +60 de oro',
    cooldown: 40,
    duration: 0,
    key: 'E',
  },
  [CivilizationType.INCA]: {
    name: 'Unidad',
    emoji: '✨',
    description: 'Todas tus unidades ganan +30% ataque y velocidad por 25s',
    cooldown: 80,
    duration: 25,
    key: 'E',
  },
  [CivilizationType.MAYA]: {
    name: 'Profecía',
    emoji: '👁️',
    description: 'Revela todas las posiciones enemigas por 18s',
    cooldown: 60,
    duration: 18,
    key: 'E',
  },
  [CivilizationType.CONQUISTADOR]: {
    name: 'Conquista',
    emoji: '⚔️',
    description: 'Tus unidades infligen +80% de daño por 20s',
    cooldown: 70,
    duration: 20,
    key: 'E',
  },
  [CivilizationType.MAPUCHE]: {
    name: 'Levantamiento',
    emoji: '🔥',
    description: 'Guerrilla de Arauco: +25% ataque y +35% velocidad por 18s',
    cooldown: 75,
    duration: 18,
    key: 'E',
  },
};

/**
 * Activate the human player's civilization power.
 * Returns a message to show to the player, or null on failure.
 */
export function activateCivPower(game: Game, selectedUnitId?: number): string | null {
  const player = game.humanPlayer;
  const def    = CIV_POWER_DEFS[player.civType];

  if (player.powerCooldown > 0) return null;

  switch (player.civType) {
    case CivilizationType.AZTEC: {
      const unit = selectedUnitId !== undefined ? game.getUnitById(selectedUnitId) : null;
      if (!unit || !unit.isAlive() || unit.playerId !== player.id) return null;
      unit.takeDamage(unit.hp + 9999); // instant kill via public API
      const cap = 2000;
      player.resources.gold = Math.min(cap, player.resources.gold + 60);
      player.powerCooldown = def.cooldown;
      return `🩸 Sacrificio: +60 ⚜️ oro`;
    }

    case CivilizationType.INCA: {
      if (player.aliveUnits.length === 0) return null;
      for (const u of player.aliveUnits) {
        u.incaBuff        = true;
        u._preBuffAttack  = u.attack;
        u._preBuffSpeed   = u.speed;
        u.attack = Math.round(u.attack * 1.3);
        u.speed  = Math.min(u.speed * 1.3, u.def.stats.speed * 3);
      }
      player.powerActive      = true;
      player.powerActiveTimer = def.duration;
      player.powerCooldown    = def.cooldown;
      return `✨ Unidad: todas las unidades +30% ataque y velocidad (${def.duration}s)`;
    }

    case CivilizationType.MAPUCHE: {
      // Levantamiento de Arauco: guerrilla surge — reuses the generic pre-buff/restore machinery
      if (player.aliveUnits.length === 0) return null;
      for (const u of player.aliveUnits) {
        u.incaBuff        = true;
        u._preBuffAttack  = u.attack;
        u._preBuffSpeed   = u.speed;
        u.attack = Math.round(u.attack * 1.25);
        u.speed  = Math.min(u.speed * 1.35, u.def.stats.speed * 3);
      }
      player.powerActive      = true;
      player.powerActiveTimer = def.duration;
      player.powerCooldown    = def.cooldown;
      return `🔥 Levantamiento: +25% ataque y +35% velocidad (${def.duration}s)`;
    }

    case CivilizationType.MAYA: {
      player.powerActive      = true;
      player.powerActiveTimer = def.duration;
      player.powerCooldown    = def.cooldown;
      return `👁️ Profecía: visión total por ${def.duration}s`;
    }

    case CivilizationType.CONQUISTADOR: {
      if (player.aliveUnits.length === 0) return null;
      for (const u of player.aliveUnits) {
        u.conquBuff       = true;
        u._preBuffAttack  = u.attack;
        u.attack = Math.round(u.attack * 1.8);
      }
      player.powerActive      = true;
      player.powerActiveTimer = def.duration;
      player.powerCooldown    = def.cooldown;
      return `⚔️ Conquista: +80% daño por ${def.duration}s`;
    }
  }
}

/**
 * Tick power timers and remove expired buffs.
 */
export function updateCivPowers(game: Game, dt: number) {
  const player = game.humanPlayer;
  const def    = CIV_POWER_DEFS[player.civType];

  if (player.powerCooldown > 0) {
    // Temple blessing: owning a completed Temple reduces civ power cooldown 30% faster
    const hasTemple = game.allBuildings.some(
      b => b.playerId === player.id && (b.type as string) === 'TEMPLE' && b.isComplete() && b.isAlive(),
    );
    player.powerCooldown = Math.max(0, player.powerCooldown - dt * (hasTemple ? 1.3 : 1.0));
  }

  if (player.powerActive && player.powerActiveTimer > 0) {
    player.powerActiveTimer = Math.max(0, player.powerActiveTimer - dt);
    if (player.powerActiveTimer <= 0) {
      player.powerActive = false;
      removePowerBuffs(game, def);
    }
  }
}

function removePowerBuffs(game: Game, _def: PowerDef) {
  const player = game.humanPlayer;
  switch (player.civType) {
    case CivilizationType.INCA:
      for (const u of player.aliveUnits) {
        if (u.incaBuff) {
          // Restore exact pre-buff values (preserves forge, upgrades, civ traits, fatigue state)
          if (u._preBuffAttack > 0) u.attack = u.fatigued ? Math.round(u._preBuffAttack * 0.9) : u._preBuffAttack;
          if (u._preBuffSpeed  > 0) u.speed  = u._preBuffSpeed;
          u.incaBuff = false;
          u._preBuffAttack = 0;
          u._preBuffSpeed  = 0;
        }
      }
      break;
    case CivilizationType.CONQUISTADOR:
      for (const u of player.aliveUnits) {
        if (u.conquBuff) {
          if (u._preBuffAttack > 0) u.attack = u.fatigued ? Math.round(u._preBuffAttack * 0.9) : u._preBuffAttack;
          u.conquBuff = false;
          u._preBuffAttack = 0;
        }
      }
      break;
  }
}
