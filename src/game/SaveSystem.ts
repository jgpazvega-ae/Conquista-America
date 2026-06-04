import { CivilizationType } from './types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PlayerProfile {
  username:   string;
  password:   string; // hashed (simple hash for client-side)
  avatar:     string; // emoji
  createdAt:  number;
  lastLogin:  number;
  favoriteCiv: CivilizationType | null;
  stats: PlayerStats;
  achievements: string[];
}

export interface PlayerStats {
  gamesPlayed:  number;
  gamesWon:     number;
  gamesLost:    number;
  totalKills:   number;
  totalDeaths:  number;
  totalBuilt:   number;
  totalTime:    number; // seconds
  civStats:     Partial<Record<CivilizationType, CivStats>>;
}

export interface CivStats {
  gamesPlayed: number;
  wins: number;
  kills: number;
}

export interface GameSession {
  username:    string;
  civType:     CivilizationType;
  loginTime:   number;
  remember:    boolean;
}

// ─── Hashing (simple, client-side only) ───────────────────────────────────────

function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

// ─── SaveSystem ───────────────────────────────────────────────────────────────

const STORAGE_KEYS = {
  profiles:   'conquista_profiles',
  session:    'conquista_session',
};

const AVATARS = ['🦅', '🌄', '🌿', '⚔️', '🏹', '🛡️', '👑', '🐆', '🌎', '💀'];

export class SaveSystem {
  private profiles: Map<string, PlayerProfile> = new Map();
  private session:  GameSession | null = null;

  constructor() {
    this.load();
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  private load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.profiles);
      if (raw) {
        const arr: PlayerProfile[] = JSON.parse(raw);
        arr.forEach(p => this.profiles.set(p.username.toLowerCase(), p));
      }
      const sessRaw = localStorage.getItem(STORAGE_KEYS.session)
                   ?? sessionStorage.getItem(STORAGE_KEYS.session);
      if (sessRaw) {
        const sess: GameSession = JSON.parse(sessRaw);
        const maxAge = sess.remember ? 86400_000 : 7200_000;
        if (Date.now() - sess.loginTime < maxAge) {
          this.session = sess;
        } else {
          localStorage.removeItem(STORAGE_KEYS.session);
          sessionStorage.removeItem(STORAGE_KEYS.session);
        }
      }
    } catch { /* ignore */ }
  }

  private save() {
    const arr = Array.from(this.profiles.values());
    localStorage.setItem(STORAGE_KEYS.profiles, JSON.stringify(arr));
  }

  // ── Auth ───────────────────────────────────────────────────────────────────

  register(username: string, password: string): { ok: boolean; error?: string } {
    const key = username.toLowerCase();
    if (username.length < 3) return { ok: false, error: 'Usuario muy corto (mínimo 3 caracteres)' };
    if (username.length > 20) return { ok: false, error: 'Usuario muy largo (máximo 20 caracteres)' };
    if (!/^[a-zA-Z0-9_\- ]+$/.test(username)) return { ok: false, error: 'Solo letras, números, guiones y espacios' };
    if (password.length < 4) return { ok: false, error: 'Contraseña muy corta (mínimo 4 caracteres)' };
    if (this.profiles.has(key)) return { ok: false, error: 'Ese usuario ya existe' };

    const profile: PlayerProfile = {
      username,
      password: simpleHash(password),
      avatar:   AVATARS[Math.floor(Math.random() * AVATARS.length)],
      createdAt: Date.now(),
      lastLogin: Date.now(),
      favoriteCiv: null,
      stats: {
        gamesPlayed: 0, gamesWon: 0, gamesLost: 0,
        totalKills: 0, totalDeaths: 0, totalBuilt: 0, totalTime: 0,
        civStats: {},
      },
      achievements: [],
    };

    this.profiles.set(key, profile);
    this.save();
    return { ok: true };
  }

  login(username: string, password: string, remember: boolean): { ok: boolean; error?: string } {
    const profile = this.profiles.get(username.toLowerCase());
    if (!profile) return { ok: false, error: 'Usuario no encontrado' };
    if (profile.password !== simpleHash(password)) return { ok: false, error: 'Contraseña incorrecta' };

    profile.lastLogin = Date.now();
    this.save();

    this.session = {
      username: profile.username,
      civType:  profile.favoriteCiv ?? CivilizationType.AZTEC,
      loginTime: Date.now(),
      remember,
    };

    if (remember) {
      localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(this.session));
    } else {
      sessionStorage.setItem(STORAGE_KEYS.session, JSON.stringify(this.session));
    }

    return { ok: true };
  }

  logout() {
    this.session = null;
    localStorage.removeItem(STORAGE_KEYS.session);
    sessionStorage.removeItem(STORAGE_KEYS.session);
  }

  isLoggedIn(): boolean {
    return this.session !== null;
  }

  getSession(): GameSession | null {
    return this.session;
  }

  getProfile(username?: string): PlayerProfile | null {
    const key = (username ?? this.session?.username ?? '').toLowerCase();
    return this.profiles.get(key) ?? null;
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  recordGame(civ: CivilizationType, won: boolean, kills: number, built: number, seconds: number) {
    if (!this.session) return;
    const profile = this.getProfile();
    if (!profile) return;

    profile.stats.gamesPlayed++;
    if (won) profile.stats.gamesWon++; else profile.stats.gamesLost++;
    profile.stats.totalKills += kills;
    profile.stats.totalBuilt += built;
    profile.stats.totalTime  += seconds;
    profile.favoriteCiv = civ;

    const cs = profile.stats.civStats[civ] ?? { gamesPlayed: 0, wins: 0, kills: 0 };
    cs.gamesPlayed++;
    if (won) cs.wins++;
    cs.kills += kills;
    profile.stats.civStats[civ] = cs;

    this.checkAchievements(profile);
    this.save();
  }

  private checkAchievements(profile: PlayerProfile) {
    const { stats, achievements } = profile;
    const add = (id: string) => { if (!achievements.includes(id)) achievements.push(id); };

    if (stats.gamesWon >= 1)   add('first_blood');
    if (stats.gamesWon >= 5)   add('conquistador');
    if (stats.gamesWon >= 20)  add('emperor');
    if (stats.totalKills >= 100) add('warrior');
    if (stats.totalKills >= 500) add('destroyer');
    if (stats.totalBuilt >= 20) add('builder');
    if (stats.gamesPlayed >= 10) add('veteran');
  }

  updateCivPreference(civ: CivilizationType) {
    const profile = this.getProfile();
    if (!profile) return;
    profile.favoriteCiv = civ;
    this.save();
    if (this.session) this.session.civType = civ;
  }
}

export const ACHIEVEMENT_DEFS: Record<string, { name: string; desc: string; emoji: string }> = {
  first_blood:   { name: 'Primera Sangre',      desc: 'Gana tu primera partida',              emoji: '🩸' },
  conquistador:  { name: 'Conquistador',         desc: 'Gana 5 partidas',                      emoji: '⚔️' },
  emperor:       { name: 'Emperador',            desc: 'Gana 20 partidas',                     emoji: '👑' },
  warrior:       { name: 'Guerrero',             desc: 'Elimina 100 unidades enemigas',        emoji: '🗡️' },
  destroyer:     { name: 'Destructor',           desc: 'Elimina 500 unidades enemigas',        emoji: '💀' },
  builder:       { name: 'Constructor',          desc: 'Construye 20 edificios',               emoji: '🏗️' },
  veteran:       { name: 'Veterano',             desc: 'Juega 10 partidas',                    emoji: '🎖️' },
};
