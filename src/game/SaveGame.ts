import type { Game } from './Game';
import { CivilizationType, UnitType } from './types';
import { BuildingType } from './buildings';
import { ResourceType } from './ResourceNode';
import { AllianceType } from './Diplomacy';

/** Mid-game save (AC style): the full match state, resumable after a reload.
 *  Transient combat state (paths, attack targets, buffs) intentionally resets —
 *  units come back IDLE at their positions, like loading a classic RTS save. */
export interface SaveData {
  v: 1;
  savedAt: number;
  gameTime: number;
  mapSeed: number;
  difficulty: 'easy' | 'normal' | 'hard';
  humanCiv: CivilizationType;
  players: {
    civ: CivilizationType;
    isHuman: boolean;
    resources: { food: number; gold: number; stone: number; wood: number; coal: number; iron: number };
    upgrades: { metallurgy: boolean; logistics: boolean; fortification: boolean; civTech: boolean };
  }[];
  units: {
    t: UnitType; p: number; c: number; r: number;
    hp: number; mhp: number; atk: number; def: number; spd: number; rng: number; sgt: number; cd: number;
    xp: number; lvl: number; ammo: number; mammo: number; mor: number;
    hero?: string;      // hero name when this unit is a hero
    g?: number;         // garrisoned inside buildings[g]
  }[];
  workers: { p: number; c: number; r: number }[];
  buildings: {
    t: BuildingType; p: number; c: number; r: number;
    hp: number; prog: number; civ: CivilizationType;
  }[];
  nodes: { t: ResourceType; c: number; r: number; amt: number; max: number }[];
  caches: { col: number; row: number; gold: number; food: number; stone: number; claimed: boolean }[];
  relations: { a: number; b: number; rel: AllianceType }[];
  allianceVillages: number[]; // indexes into buildings[]
  fog: string; // human player's explored map, row-major '0'/'1' string
}

const KEY = 'conquista_savegame';

export function serializeGame(game: Game): SaveData {
  const buildings = game.allBuildings.filter(b => b.isAlive());
  const bIndex = new Map<number, number>();
  buildings.forEach((b, i) => bIndex.set(b.id, i));

  const relations: SaveData['relations'] = [];
  for (let a = 0; a < game.players.length; a++) {
    for (let b = a + 1; b < game.players.length; b++) {
      relations.push({ a, b, rel: game.diplomacy.getRelation(a, b) });
    }
  }

  return {
    v: 1,
    savedAt: Date.now(),
    gameTime: game.gameTime,
    mapSeed: game.mapSeed,
    difficulty: game.difficulty,
    humanCiv: game.humanPlayer.civType,
    players: game.players.map(p => ({
      civ: p.civType,
      isHuman: p.isHuman,
      resources: {
        food: p.resources.food, gold: p.resources.gold, stone: p.resources.stone,
        wood: p.resources.wood ?? 0, coal: p.resources.coal ?? 0, iron: p.resources.iron ?? 0,
      },
      upgrades: { ...p.upgrades },
    })),
    units: game.allUnits.filter(u => u.isAlive()).map(u => ({
      t: u.type, p: u.playerId, c: u.col, r: u.row,
      hp: Math.round(u.hp), mhp: u.maxHp, atk: u.attack, def: u.defense, spd: u.speed,
      rng: u.attackRange, sgt: u.sight, cd: u.attackCooldown,
      xp: u.xp, lvl: u.level, ammo: u.ammo, mammo: u.maxAmmo, mor: Math.round(u.morale),
      ...(u.isHero ? { hero: u.heroName } : {}),
      ...(u.garrisonedIn !== null && bIndex.has(u.garrisonedIn) ? { g: bIndex.get(u.garrisonedIn)! } : {}),
    })),
    workers: game.allWorkers.map(w => ({ p: w.playerId, c: Math.round(w.col), r: Math.round(w.row) })),
    buildings: buildings.map(b => ({
      t: b.type, p: b.playerId, c: b.col, r: b.row,
      hp: Math.round(b.hp), prog: b.buildProgress, civ: b.civType,
    })),
    nodes: game.resourceNodes.map(n => ({ t: n.type, c: n.col, r: n.row, amt: Math.round(n.amount), max: n.maxAmount })),
    caches: game.treasureCaches.map(c => ({ ...c })),
    relations,
    allianceVillages: [...game.allianceVillages].map(id => bIndex.get(id)!).filter(i => i !== undefined),
    fog: game.fog.getFog(game.humanPlayerId)?.exportMemory() ?? '',
  };
}

export function storeSave(data: SaveData): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch { return false; }
}

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SaveData;
    if (data.v !== 1 || !Array.isArray(data.players) || !data.players.some(p => p.isHuman)) return null;
    return data;
  } catch { return null; }
}

export function hasSave(): boolean { return loadSave() !== null; }

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
