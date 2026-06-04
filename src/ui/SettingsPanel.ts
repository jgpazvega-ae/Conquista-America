import type { SaveSystem } from '../game/SaveSystem';
import { ACHIEVEMENT_DEFS } from '../game/SaveSystem';
import { CIV_NAMES, CIV_EMOJIS } from '../game/constants';

export interface GameSettings {
  effectsVolume: number;
  musicVolume:   number;
  showFPS:       boolean;
  showGrid:      boolean;
  edgeScroll:    boolean;
  language:      'es' | 'en';
}

const DEFAULT_SETTINGS: GameSettings = {
  effectsVolume: 0.7,
  musicVolume:   0.4,
  showFPS:       false,
  showGrid:      false,
  edgeScroll:    true,
  language:      'es',
};

export class SettingsPanel {
  private el: HTMLElement;
  private saveSystem: SaveSystem;
  settings: GameSettings;
  onClose: (() => void) | null = null;
  onLogout: (() => void) | null = null;
  onVolumeChange: ((effects: number, music: number) => void) | null = null;

  constructor(saveSystem: SaveSystem) {
    this.saveSystem = saveSystem;
    this.el = document.getElementById('settings-panel')!;
    this.settings = this.loadSettings();
    this.bind();
    this.renderProfile();
  }

  private loadSettings(): GameSettings {
    try {
      const raw = localStorage.getItem('conquista_settings');
      if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch { /* ignore */ }
    return { ...DEFAULT_SETTINGS };
  }

  saveSettings() {
    localStorage.setItem('conquista_settings', JSON.stringify(this.settings));
  }

  private bind() {
    this.el.querySelector('#settings-close')?.addEventListener('click', () => {
      this.saveSettings();
      this.hide();
      this.onClose?.();
    });

    this.el.querySelector('#logout-btn')?.addEventListener('click', () => {
      this.saveSystem.logout();
      this.onLogout?.();
    });

    // Settings controls
    const bindRange = (id: string, key: keyof GameSettings) => {
      const el = this.el.querySelector(`#${id}`) as HTMLInputElement;
      if (!el) return;
      el.value = String((this.settings as any)[key]);
      el.addEventListener('input', () => {
        (this.settings as any)[key] = parseFloat(el.value);
        const display = this.el.querySelector(`#${id}-val`);
        if (display) display.textContent = `${Math.round(parseFloat(el.value) * 100)}%`;
        this.onVolumeChange?.(this.settings.effectsVolume, this.settings.musicVolume);
      });
    };

    const bindCheck = (id: string, key: keyof GameSettings) => {
      const el = this.el.querySelector(`#${id}`) as HTMLInputElement;
      if (!el) return;
      el.checked = Boolean((this.settings as any)[key]);
      el.addEventListener('change', () => { (this.settings as any)[key] = el.checked; });
    };

    bindRange('effects-vol', 'effectsVolume');
    bindRange('music-vol',   'musicVolume');
    bindCheck('show-fps',    'showFPS');
    bindCheck('edge-scroll', 'edgeScroll');
  }

  private renderProfile() {
    const profile = this.saveSystem.getProfile();
    if (!profile) return;

    const el = this.el.querySelector('#profile-section');
    if (!el) return;

    const stats = profile.stats;
    const winRate = stats.gamesPlayed > 0
      ? Math.round((stats.gamesWon / stats.gamesPlayed) * 100) : 0;
    const hours = Math.floor(stats.totalTime / 3600);
    const minutes = Math.floor((stats.totalTime % 3600) / 60);
    const favCiv = profile.favoriteCiv;

    el.innerHTML = `
      <div class="profile-header">
        <div class="profile-avatar">${profile.avatar}</div>
        <div class="profile-info">
          <div class="profile-name">${profile.username}</div>
          <div class="profile-joined">Jugador desde ${new Date(profile.createdAt).toLocaleDateString('es')}</div>
        </div>
      </div>
      <div class="stats-grid">
        <div class="stat-block"><div class="stat-val">${stats.gamesPlayed}</div><div class="stat-lbl">Partidas</div></div>
        <div class="stat-block"><div class="stat-val">${stats.gamesWon}</div><div class="stat-lbl">Victorias</div></div>
        <div class="stat-block"><div class="stat-val">${winRate}%</div><div class="stat-lbl">Tasa de Éxito</div></div>
        <div class="stat-block"><div class="stat-val">${stats.totalKills}</div><div class="stat-lbl">Bajas</div></div>
        <div class="stat-block"><div class="stat-val">${hours}h ${minutes}m</div><div class="stat-lbl">Jugado</div></div>
        <div class="stat-block"><div class="stat-val">${favCiv ? CIV_EMOJIS[favCiv] : '—'}</div><div class="stat-lbl">Fav. Civ</div></div>
      </div>
      <div class="achievements-section">
        <div class="achievements-title">🏆 Logros</div>
        <div class="achievements-grid">
          ${Object.entries(ACHIEVEMENT_DEFS).map(([id, def]) => `
            <div class="achievement ${profile.achievements.includes(id) ? 'unlocked' : 'locked'}" title="${def.desc}">
              <div class="ach-emoji">${def.emoji}</div>
              <div class="ach-name">${def.name}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  show() {
    this.renderProfile();
    this.el.classList.remove('hidden');
  }

  hide() { this.el.classList.add('hidden'); }
}
