import type { Game } from '../game/Game';
import type { Unit } from '../game/Unit';
import type { GameMap } from '../game/Map';
import { TERRAIN_COLORS, CIV_COLORS, CIV_NAMES, CIV_EMOJIS, TILE_SIZE, WONDER_NAMES, WONDER_EMOJIS } from '../game/constants';
import type { DamageEvent } from '../game/CombatSystem';
import { TileVisibility } from '../game/FogOfWar';
import { ResourceType } from '../game/ResourceNode';
import { BuildingType } from '../game/buildings';
import type { Renderer } from '../engine/Renderer';
import { CIV_POWER_DEFS } from '../game/CivPowers';
import { UnitState, TerrainType } from '../game/types';
import { CIVILIZATIONS } from '../game/civilizations';
import { WEATHER_ICONS, WEATHER_NAMES, WEATHER_TIPS } from '../game/WeatherSystem';
import { AllianceType } from '../game/Diplomacy';
import { TECH_DEFS, TechType } from '../game/Tech';
import { BUILDING_DEFS } from '../game/buildingDefs';
import { getUnitDef } from '../game/civilizations';
import { WorkerTask } from '../game/Worker';

function hex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

const TERRAIN_INFO: Partial<Record<TerrainType, { name: string; emoji: string; desc: string }>> = {
  [TerrainType.GRASS]:    { emoji: '🌿', name: 'Pradera',   desc: 'Terreno abierto. Sin bonificación.' },
  [TerrainType.JUNGLE]:   { emoji: '🌴', name: 'Selva',     desc: '🛡️ +4 defensa · ⚔️ +4 ataque (emboscada)' },
  [TerrainType.HIGHLAND]: { emoji: '⛰️', name: 'Altiplano', desc: '🛡️ +3 defensa' },
  [TerrainType.MOUNTAIN]: { emoji: '🏔️', name: 'Montaña',  desc: '🛡️ +5 defensa · ⚠️ paso lento' },
  [TerrainType.DESERT]:   { emoji: '🏜️', name: 'Desierto',  desc: '🛡️ −1 defensa · calor extremo' },
  [TerrainType.BEACH]:    { emoji: '🏖️', name: 'Costa',    desc: 'Terreno arenoso.' },
  [TerrainType.WATER]:    { emoji: '🌊', name: 'Agua',      desc: 'Infranqueable para unidades terrestres.' },
  [TerrainType.SNOW]:     { emoji: '❄️', name: 'Nieve',    desc: 'Alturas heladas — movimiento reducido.' },
};

export class HUD {
  private game: Game;

  private elFood      = document.getElementById('res-food')!;
  private elGold      = document.getElementById('res-gold')!;
  private elStone     = document.getElementById('res-stone')!;
  private elWood      = document.getElementById('res-wood');
  private elFoodRate  = document.getElementById('res-food-rate');
  private elGoldRate  = document.getElementById('res-gold-rate');
  private elStoneRate = document.getElementById('res-stone-rate');
  private elWoodRate  = document.getElementById('res-wood-rate');
  private elStatus  = document.getElementById('game-status')!;
  private elWeather = document.getElementById('weather-badge');
  private elCivBadge = document.getElementById('civ-badge')!;
  private unitPanel  = document.getElementById('unit-panel')!;
  private elPortrait = document.getElementById('unit-portrait')!;
  private elUnitName = document.getElementById('unit-name')!;
  private elUnitCiv  = document.getElementById('unit-civ')!;
  private elHpBar    = document.getElementById('hp-bar')!;
  private elHpText   = document.getElementById('hp-text')!;
  private elUnitStats= document.getElementById('unit-stats')!;
  private elSelCount = document.getElementById('selection-count')!;
  private minimapCanvas = document.getElementById('minimap') as HTMLCanvasElement;
  private minimapCtx:   CanvasRenderingContext2D;

  private minimapBuilt = false;
  private minimapBase: ImageData | null = null;
  private elTimer      = document.getElementById('game-timer');
  private elHeroRespawnChip = document.getElementById('hero-respawn-chip');
  private elHeroRespawnSecs = document.getElementById('hero-respawn-secs');
  private elIdleWorkerChip  = document.getElementById('idle-worker-chip');
  private elIdleWorkerCount = document.getElementById('idle-worker-count');
  private elIdleWorkerPlural = document.getElementById('idle-worker-plural');
  private elPop             = document.getElementById('pop-count');
  private elPopBarFill      = document.getElementById('pop-bar-fill') as HTMLDivElement | null;
  private elTreasuryWrap    = document.getElementById('treasury-wrap') as HTMLElement | null;
  private elTreasuryFill    = document.getElementById('treasury-bar-fill') as HTMLDivElement | null;
  static readonly ECON_GOAL = 800;
  private elScoreboard = document.getElementById('scoreboard')!
  private elEraLabel   = document.getElementById('era-label')

  onMinimapClick: ((worldX: number, worldZ: number) => void) | null = null;
  onPowerActivate: (() => void) | null = null;
  onGroupStop:    (() => void) | null = null;
  onGroupHold:    (() => void) | null = null;
  onGroupRetreat: (() => void) | null = null;
  onUnitHold:      (() => void) | null = null;
  onUnitEntrench:  (() => void) | null = null;
  onUnitVolley:    (() => void) | null = null;
  onUnitWarCry:    (() => void) | null = null;
  onUnitHeroPower: (() => void) | null = null;
  onFormation:     ((type: string | null) => void) | null = null;
  private _combatPings:    { col: number; row: number; ts: number }[] = [];
  private _lastSeenUnits:  Map<number, { col: number; row: number; ts: number }> = new Map();
  private _killFeedEl      = document.getElementById('kill-feed');
  private _killFeedEntries: { el: HTMLElement; ts: number }[] = [];
  private _notifHistory:   Array<{ msg: string; type: string; time: string }> = [];
  private _logOpen         = false;

  private camera: import('../engine/Camera').RTSCamera | null = null;
  setCamera(cam: import('../engine/Camera').RTSCamera) { this.camera = cam; }

  private _bldgHpBars: Map<number, { wrap: HTMLElement; fill: HTMLElement }> = new Map();

  private renderer: Renderer | null = null;
  setRenderer(r: Renderer) { this.renderer = r; }

  constructor(game: Game) {
    this.game = game;
    this.minimapCanvas.width  = 200;
    this.minimapCanvas.height = 200;
    this.minimapCtx = this.minimapCanvas.getContext('2d')!;

    const civ = game.humanPlayer.civType;
    this.elCivBadge.textContent = `${CIV_EMOJIS[civ]} ${CIV_NAMES[civ]}`;
    this.elCivBadge.style.color = hex(CIV_COLORS[civ]);

    // Power button setup
    const powerDef = CIV_POWER_DEFS[civ];
    const powerEmoji = document.getElementById('power-emoji');
    const powerBtn   = document.getElementById('power-btn');
    if (powerEmoji) powerEmoji.textContent = powerDef.emoji;
    if (powerBtn)   powerBtn.title = `${powerDef.name} — ${powerDef.description} (${powerDef.key})`;
    powerBtn?.addEventListener('click', () => this.onPowerActivate?.());

    document.getElementById('grp-stop')?.addEventListener('click',    () => this.onGroupStop?.());
    document.getElementById('grp-hold')?.addEventListener('click',    () => this.onGroupHold?.());
    document.getElementById('grp-retreat')?.addEventListener('click', () => this.onGroupRetreat?.());

    // Unit action bar buttons
    document.getElementById('act-hold')?.addEventListener('click',      () => this.onUnitHold?.());
    document.getElementById('act-entrench')?.addEventListener('click',  () => this.onUnitEntrench?.());
    document.getElementById('act-volley')?.addEventListener('click',    () => this.onUnitVolley?.());
    document.getElementById('act-warcry')?.addEventListener('click',    () => this.onUnitWarCry?.());
    document.getElementById('act-heropower')?.addEventListener('click', () => this.onUnitHeroPower?.());
    // Formation buttons — single unit panel
    document.getElementById('form-loose')?.addEventListener('click',   () => this.onFormation?.('LOOSE'));
    document.getElementById('form-phalanx')?.addEventListener('click', () => this.onFormation?.('PHALANX'));
    document.getElementById('form-wedge')?.addEventListener('click',   () => this.onFormation?.('WEDGE'));
    document.getElementById('form-free')?.addEventListener('click',    () => this.onFormation?.(null));
    // Formation buttons — group action bar
    document.getElementById('grp-form-loose')?.addEventListener('click',   () => this.onFormation?.('LOOSE'));
    document.getElementById('grp-form-phalanx')?.addEventListener('click', () => this.onFormation?.('PHALANX'));
    document.getElementById('grp-form-wedge')?.addEventListener('click',   () => this.onFormation?.('WEDGE'));
    document.getElementById('grp-form-free')?.addEventListener('click',    () => this.onFormation?.(null));

    this.minimapCanvas.addEventListener('click', (e) => {
      if (!this.minimapBuilt) return;
      const rect = this.minimapCanvas.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width;
      const nz = (e.clientY - rect.top)  / rect.height;
      const worldX = nx * game.map.cols * TILE_SIZE;
      const worldZ = nz * game.map.rows * TILE_SIZE;
      this.onMinimapClick?.(worldX, worldZ);
    });
  }

  buildMinimap(map: GameMap) {
    const ctx = this.minimapCtx;
    const W   = this.minimapCanvas.width;
    const H   = this.minimapCanvas.height;
    const tw  = W / map.cols;
    const th  = H / map.rows;

    for (let r = 0; r < map.rows; r++) {
      for (let c = 0; c < map.cols; c++) {
        const tile  = map.getTile(c, r)!;
        const color = TERRAIN_COLORS[tile.terrain] ?? 0x888888;
        ctx.fillStyle = hex(color);
        ctx.fillRect(c * tw, r * th, Math.ceil(tw), Math.ceil(th));
      }
    }

    this.minimapBase  = ctx.getImageData(0, 0, W, H);
    this.minimapBuilt = true;
  }

  update(selectedUnits: Unit[]) {
    const player = this.game.humanPlayer;

    // Resources (floor to integer)
    this.elFood.textContent  = String(Math.floor(player.resources.food));
    this.elGold.textContent  = String(Math.floor(player.resources.gold));
    this.elStone.textContent = String(Math.floor(player.resources.stone));
    if (this.elWood) this.elWood.textContent = String(Math.floor(player.resources.wood ?? 0));

    // Economy rate indicators
    const econStats = this.game.getEconomyStats(player.id);
    if (econStats) {
      this.setRateEl(this.elFoodRate,  econStats.netProduction.food);
      this.setRateEl(this.elGoldRate,  econStats.netProduction.gold);
      this.setRateEl(this.elStoneRate, econStats.netProduction.stone);
      this.setRateEl(this.elWoodRate,  econStats.netProduction.wood ?? 0);
    }

    // Low resource warnings — pulse the resource chip red
    const foodEl = this.elFood.closest('.res');
    foodEl?.classList.toggle('res-low', player.resources.food < 50 && player.resources.food >= 10);
    foodEl?.classList.toggle('res-critical', player.resources.food < 10);
    this.elGold.closest('.res')?.classList.toggle('res-low', player.resources.gold < 30);
    this.elStone.closest('.res')?.classList.toggle('res-low', player.resources.stone < 30);

    // Weather badge + dawn/dusk countdown
    if (this.elWeather) {
      const w = this.game.weather;
      const dayT = this.game.dayT;
      const isNight = this.game.isNight;
      // Seconds until next day↔night transition
      const secsToTransition = isNight
        ? Math.ceil(dayT >= 0.75
          ? (1.15 - dayT) * 480   // night continuing past midnight
          : (0.15 - dayT) * 480)  // night before dawn
        : Math.ceil((0.75 - dayT) * 480); // day before dusk
      const transitionLabel = isNight ? `☀️${secsToTransition}s` : `🌙${secsToTransition}s`;
      this.elWeather.textContent = `${WEATHER_ICONS[w.state]} ${WEATHER_NAMES[w.state]}  ${transitionLabel}`;
      this.elWeather.title = (WEATHER_TIPS[w.state] || WEATHER_NAMES[w.state]) +
        (isNight ? ' · Anochecer activo' : ` · Anochecer en ${secsToTransition}s`);
    }

    // Treasury (economic victory) progress bar: visible once gold > 150
    if (this.elTreasuryWrap && this.elTreasuryFill) {
      const gold = Math.floor(player.resources.gold);
      const show = gold >= 150;
      this.elTreasuryWrap.classList.toggle('hidden', !show);
      if (show) {
        const pct = Math.min(100, (gold / HUD.ECON_GOAL) * 100);
        this.elTreasuryFill.style.width = `${pct}%`;
        this.elTreasuryFill.classList.toggle('treasury-near', pct >= 75);
      }
    }

    // Timer
    const secs = Math.floor(this.game.gameTime);
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    if (this.elTimer) this.elTimer.textContent = `${m}:${String(s).padStart(2, '0')}`;

    // Hero respawn countdown chip (always visible while hero is respawning)
    if (this.elHeroRespawnChip) {
      const heroTimer = this.game.getHeroRespawnTimer(this.game.humanPlayerId);
      const heroAlive = this.game.humanPlayer.aliveUnits.some(u => u.isHero);
      if (!heroAlive && heroTimer !== undefined && heroTimer > 0) {
        this.elHeroRespawnChip.classList.remove('hidden');
        if (this.elHeroRespawnSecs) this.elHeroRespawnSecs.textContent = String(Math.ceil(heroTimer));
      } else {
        this.elHeroRespawnChip.classList.add('hidden');
      }
    }

    // Idle worker chip — nudges the player to put idle villagers to work (Q)
    if (this.elIdleWorkerChip) {
      let idle = 0;
      for (const w of this.game.allWorkers) {
        if (w.playerId === this.game.humanPlayerId && w.task === 'IDLE' && !w.carrying) idle++;
      }
      if (idle > 0) {
        this.elIdleWorkerChip.classList.remove('hidden');
        if (this.elIdleWorkerCount)  this.elIdleWorkerCount.textContent = String(idle);
        if (this.elIdleWorkerPlural) this.elIdleWorkerPlural.textContent = idle > 1 ? 's' : '';
      } else {
        this.elIdleWorkerChip.classList.add('hidden');
      }
    }

    // Population (human alive units)
    if (this.elPop) {
      const pop = player.aliveUnits.length;
      const cap = this.game.getPopCap(player.id);
      this.elPop.textContent = `${pop}/${cap}`;
      this.elPop.style.color = pop >= cap ? '#ff7777' : '';
    }
    if (this.elPopBarFill) {
      const pop = player.aliveUnits.length;
      const cap = this.game.getPopCap(player.id);
      const pct = Math.min(100, (pop / cap) * 100);
      this.elPopBarFill.style.width = `${pct}%`;
      this.elPopBarFill.classList.toggle('pop-near', pct >= 75 && pct < 100);
      this.elPopBarFill.classList.toggle('pop-full',  pct >= 100);
    }

    // Game status
    if (this.game.status === 'VICTORY') {
      this.elStatus.textContent = '🏆 ¡VICTORIA!';
      this.elStatus.style.color = '#f0e060';
    } else if (this.game.status === 'DEFEAT') {
      this.elStatus.textContent = '☠️ DERROTA';
      this.elStatus.style.color = '#ff4444';
    } else {
      const alive = this.game.players.filter(p => p.id !== 0 && !p.isDefeated()).length;
      this.elStatus.textContent = alive > 0 ? `⚔️ Enemigos: ${alive}` : '';
    }

    // Group action bar (2+ units)
    const groupBar = document.getElementById('group-action-bar');
    groupBar?.classList.toggle('hidden', selectedUnits.length <= 1);

    // Sync formation active state in group bar based on most common formation
    if (selectedUnits.length > 1) {
      const ownSel = selectedUnits.filter(u => u.playerId === this.game.humanPlayerId);
      const formCounts: Record<string, number> = { LOOSE: 0, PHALANX: 0, WEDGE: 0, none: 0 };
      for (const u of ownSel) formCounts[u.formation ?? 'none']++;
      const top = (Object.entries(formCounts).sort((a, b) => b[1] - a[1])[0]?.[0]) ?? 'none';
      document.getElementById('grp-form-loose')?.classList.toggle('active',   top === 'LOOSE');
      document.getElementById('grp-form-phalanx')?.classList.toggle('active', top === 'PHALANX');
      document.getElementById('grp-form-wedge')?.classList.toggle('active',   top === 'WEDGE');
      document.getElementById('grp-form-free')?.classList.toggle('active',    top === 'none');
    }

    // Unit panel
    if (selectedUnits.length === 1) {
      this.showUnitInfo(selectedUnits[0]);
      this.elSelCount.classList.add('hidden');
    } else if (selectedUnits.length > 1) {
      this.unitPanel.classList.add('hidden');
      this.elSelCount.classList.remove('hidden');
      const byType = new Map<string, { count: number; emoji: string }>();
      for (const u of selectedUnits) {
        if (!byType.has(u.def.name)) byType.set(u.def.name, { count: 0, emoji: u.def.emoji });
        byType.get(u.def.name)!.count++;
      }
      const parts = [...byType.entries()].map(([, v]) => `${v.emoji}×${v.count}`).join(' ');
      const avgMorale = Math.round(selectedUnits.reduce((s, u) => s + u.morale, 0) / selectedUnits.length);
      const moraleColor = avgMorale < 40 ? '#dd4422' : avgMorale < 65 ? '#ddaa00' : '#22dd44';
      this.elSelCount.innerHTML = `${selectedUnits.length} unidades  ${parts}  <span style="color:${moraleColor}">❤ ${avgMorale}%</span>`;
    } else {
      this.unitPanel.classList.add('hidden');
      this.elSelCount.classList.add('hidden');
    }

    // Kill feed: remove entries older than 8s
    this.pruneKillFeed();

    // Minimap units
    this.updateMinimap();
    this.updateScoreboard();
    this.updateMomentum();
    this.updateDominanceBar();
    this.updateResearchChip();
    this.updateVillageChip();
    this.updateObjectives();
    this.updatePowerButton();
    this.updateBuildingHpBars();
    this.updateHeroPanel();
    this.updateWonderPanel();
    this.updateProductionQueueHUD();
    this.updateDayNightIndicator();
    this.updateEraLabel();
  }

  private updateEraLabel() {
    if (!this.elEraLabel) return;
    const era = this.game.getEra(this.game.humanPlayerId);
    const names: Record<1 | 2 | 3, string> = { 1: 'Era I', 2: 'Era II — Colonial', 3: 'Era III — Imperial' };
    this.elEraLabel.textContent = names[era];
  }

  private _wasNightHUD = false;
  private _nightWarnedHUD = false;

  private updateDayNightIndicator() {
    const el = document.getElementById('day-night-indicator');
    if (!el) return;
    const dayT    = this.game.dayT;
    const isNight = this.game.isNight;
    // Time until next night transition (dayT increasing toward 0.75)
    const secsPerCycle = 480;
    let icon: string;
    let tip:  string;
    if (isNight) {
      // Seconds remaining in night: night ends at dayT=0.15 (wrapping from 0.75)
      const nightEnd = dayT < 0.15 ? (0.15 - dayT) : (1.0 - dayT + 0.15);
      const secs = Math.ceil(nightEnd * secsPerCycle);
      icon = '🌙';
      tip  = `Noche — visión −40% · ${secs}s hasta el amanecer`;
      el.style.color = '#88bbff';
    } else {
      // Seconds remaining until night: night starts at dayT=0.75
      const toNight = dayT < 0.75 ? (0.75 - dayT) : (1.0 - dayT + 0.75);
      const secs = Math.ceil(toNight * secsPerCycle);
      const nearNight = secs <= 30;
      icon = nearNight ? '🌅' : '☀️';
      tip  = nearNight ? `Anocheciendo en ${secs}s — visión −40%` : `Día · ${secs}s hasta la noche`;
      el.style.color = nearNight ? '#ffaa44' : '#ffe080';
    }
    el.textContent = icon;
    el.title = tip;
    this._wasNightHUD = isNight;
  }

  private updatePowerButton() {
    const player  = this.game.humanPlayer;
    const def     = CIV_POWER_DEFS[player.civType];
    const btn     = document.getElementById('power-btn');
    const label   = document.getElementById('power-label');
    const fill    = document.getElementById('power-cooldown-fill');
    if (!btn || !label || !fill) return;

    if (player.powerActive) {
      btn.className = 'power-btn active';
      const pct = (player.powerActiveTimer / def.duration) * 100;
      label.textContent = `${Math.ceil(player.powerActiveTimer)}s`;
      fill.style.transform = `scaleX(${pct / 100})`;
    } else if (player.powerCooldown > 0) {
      btn.className = 'power-btn';
      const pct = 1 - player.powerCooldown / def.cooldown;
      label.textContent = `${Math.ceil(player.powerCooldown)}s`;
      fill.style.transform = `scaleX(${pct})`;
    } else {
      btn.className = 'power-btn ready';
      label.textContent = 'Listo';
      fill.style.transform = 'scaleX(1)';
    }
  }

  private updateObjectives() {
    const listEl = document.getElementById('obj-list');
    if (!listEl) return;
    const objs = this.game.objectives.objectives;
    listEl.innerHTML = objs.map(obj => {
      const pct = Math.min(100, (obj.progress / obj.target) * 100);
      const done = obj.completed;
      return `<div class="obj-row">
        <span class="obj-check">${done ? '✅' : '⬜'}</span>
        <div class="obj-text${done ? ' done' : ''}">
          ${obj.title}
          ${!done ? `<div class="obj-progress"><div class="obj-progress-fill" style="width:${pct}%"></div></div>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  /** Add a line to the kill feed (max 5 visible entries). */
  addKillFeedEntry(text: string) {
    if (!this._killFeedEl) return;
    const el = document.createElement('div');
    el.className = 'kf-entry';
    el.textContent = text;
    this._killFeedEl.prepend(el);
    const entry = { el, ts: Date.now() };
    this._killFeedEntries.unshift(entry);
    // Trim to 5
    while (this._killFeedEntries.length > 5) {
      const old = this._killFeedEntries.pop()!;
      old.el.remove();
    }
    // Start fade after 6s
    setTimeout(() => el.classList.add('fade'), 6000);
  }

  private pruneKillFeed() {
    const now = Date.now();
    this._killFeedEntries = this._killFeedEntries.filter(e => {
      if (now - e.ts > 8000) { e.el.remove(); return false; }
      return true;
    });
  }

  private updateScoreboard() {
    const scores = this.game.players.map(p => ({ id: p.id, score: this.game.getConquestScore(p.id) }));
    const maxScore = Math.max(...scores.map(s => s.score), 1);
    const diploMap = new Map<number, AllianceType>(
      this.game.getDiplomacyRelations(this.game.humanPlayerId).map(r => [r.targetId, r.relation]),
    );
    const html = this.game.players.map(p => {
      const settle = this.game.allBuildings.find(
        b => b.playerId === p.id && b.type === BuildingType.SETTLEMENT,
      );
      const defeated = p.isDefeated();
      const hpPct  = settle?.isAlive() ? (settle.hp / settle.maxHp) * 100 : 0;
      const hpColor = hpPct > 50 ? '#22dd55' : hpPct > 25 ? '#ddaa00' : '#dd2222';
      const pop    = p.aliveUnits.length;
      const kills  = this.game.killsByPlayer.get(p.id) ?? 0;
      const bldgs  = this.game.allBuildings.filter(b => b.playerId === p.id && b.isAlive() && b.isComplete()).length;
      const score  = this.game.getConquestScore(p.id);
      const scorePct = Math.round((score / maxScore) * 100);
      const isLeading = score === maxScore && score > 0;
      const label  = p.isHuman ? '(Tú)' : CIV_NAMES[p.civType].slice(0, 6);
      const rel    = diploMap.get(p.id) ?? AllianceType.ENEMY;
      const diploBadge = p.isHuman ? '' :
        rel === AllianceType.ALLY    ? `<span class="sb-diplo sb-ally"    title="Aliado">🤝</span>` :
        rel === AllianceType.NEUTRAL ? `<span class="sb-diplo sb-neutral" title="Paz">☮️</span>` :
                                       `<span class="sb-diplo sb-enemy"   title="En guerra">⚔️</span>`;
      if (defeated) {
        return `<div class="sb-row sb-defeated">
          <span class="sb-emoji" style="opacity:0.5">${CIV_EMOJIS[p.civType]}</span>
          <span class="sb-name" style="color:#666">${label}</span>
          <span style="color:#666;font-size:10px">☠️ ELIMINADO</span>
          <span class="sb-kills" title="Bajas totales" style="color:#555">⚔️${kills}</span>
        </div>`;
      }
      return `<div class="sb-row">
        <span class="sb-emoji">${CIV_EMOJIS[p.civType]}</span>
        ${diploBadge}
        <span class="sb-name" style="color:${hex(CIV_COLORS[p.civType])}">${label}</span>
        <span class="sb-pop" title="Unidades vivas">👥${pop}</span>
        <span class="sb-kills" title="Bajas enemigas">⚔️${kills}</span>
        <span class="sb-bldgs" title="Edificios construidos">🏛️${bldgs}</span>
        <span class="sb-score" title="Puntuación de conquista (unidades+edificios+bajas+tecnologías)" style="color:${isLeading ? '#ffd700' : '#aaa'}">${isLeading ? '🏆' : '⚡'}${score}</span>
        <div class="sb-hp-wrap"><div class="sb-hp-fill" style="width:${hpPct}%;background:${hpColor}"></div></div>
        <div class="sb-score-wrap"><div class="sb-score-fill" style="width:${scorePct}%;background:${isLeading ? '#cc9900' : '#445'}"></div></div>
      </div>`;
    }).join('');
    this.elScoreboard.innerHTML = html;
  }

  /** Estimate a player's military strength: sum of (attack + defense + hp/10) over alive units. */
  private militaryStrength(playerId: number): number {
    let total = 0;
    for (const u of this.game.players[playerId]?.aliveUnits ?? []) {
      total += u.attack + u.defense + u.hp / 10 + (u.isHero ? 40 : 0) + u.level * 5;
    }
    return total;
  }

  private updateMomentum() {
    const bar = document.getElementById('momentum-bar');
    const fill = document.getElementById('momentum-fill');
    const marker = document.getElementById('momentum-marker');
    const label = document.getElementById('momentum-label');
    if (!bar || !fill || !marker || !label) return;
    if (this.game.status !== 'PLAYING') { bar.classList.add('hidden'); return; }

    const mine = this.militaryStrength(this.game.humanPlayerId);
    // Strongest living enemy
    let enemyMax = 0;
    for (const p of this.game.players) {
      if (p.id === this.game.humanPlayerId || p.isDefeated()) continue;
      enemyMax = Math.max(enemyMax, this.militaryStrength(p.id));
    }
    if (mine === 0 && enemyMax === 0) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');

    // Ratio 0..1 where 0.5 = parity; clamp display
    const ratio = mine / (mine + enemyMax || 1);
    const pct = Math.round(ratio * 100);
    fill.style.width = `${pct}%`;
    // Color: green when ahead, amber near parity, red when behind
    const color = ratio > 0.62 ? '#33cc55' : ratio > 0.42 ? '#ddaa22' : '#dd3333';
    fill.style.background = color;
    marker.style.left = '50%'; // parity reference line

    const advantage = Math.round((ratio - 0.5) * 200); // -100..+100
    if (advantage > 12)      label.textContent = `⚔️ Ventaja +${advantage}%`;
    else if (advantage < -12) label.textContent = `🛡️ Desventaja ${advantage}%`;
    else                      label.textContent = '⚖️ Equilibrio militar';
    label.style.color = color;
  }

  private updateDominanceBar() {
    const el = document.getElementById('dominance-bar');
    if (!el) return;
    if (this.game.status !== 'PLAYING') { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');

    const total = this.game.players.reduce((s, p) => s + this.game.getConquestScore(p.id), 0) || 1;
    const rows = this.game.players.map(p => {
      const score   = this.game.getConquestScore(p.id);
      const pct     = Math.round((score / total) * 100);
      const color   = hex(CIV_COLORS[p.civType]);
      const defeated = p.isDefeated();
      return `<div class="db-row${defeated ? ' db-defeated' : ''}" title="${CIV_NAMES[p.civType]}: ${score}pts · ${pct}%">
        <span class="db-civ">${CIV_EMOJIS[p.civType]}</span>
        <div class="db-track"><div class="db-fill" style="width:${defeated ? 0 : pct}%;background:${color}"></div></div>
        <span class="db-pct" style="color:${defeated ? '#555' : color}">${defeated ? '☠' : pct + '%'}</span>
      </div>`;
    }).join('');

    el.innerHTML = `<div class="db-header">⚔️ DOMINIO</div>${rows}`;
  }

  private updateResearchChip() {
    const el = document.getElementById('research-chip');
    if (!el) return;
    const tech = this.game.humanPlayer.techs.getResearchingTech();
    if (!tech) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const pct      = this.game.humanPlayer.techs.getResearchProgress();
    const def      = TECH_DEFS[tech];
    const secsLeft = Math.ceil((1 - pct) * def.costGold);
    const barW     = Math.round(pct * 100);
    el.innerHTML =
      `<span class="rc-icon">🔬</span>` +
      `<div class="rc-info">` +
        `<span class="rc-name">${def.name}</span>` +
        `<div class="rc-track"><div class="rc-fill" style="width:${barW}%"></div></div>` +
        `<span class="rc-eta">${secsLeft}s restantes</span>` +
      `</div>`;
  }

  private updateVillageChip() {
    const el = document.getElementById('village-chip');
    if (!el) return;
    const count = this.game.allianceVillages.size;
    if (count === 0) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const timer   = this.game.allianceRewardTimer;
    const pct     = Math.round((1 - timer / 90) * 100);
    const label   = count === 1 ? '1 aldea aliada' : `${count} aldeas aliadas`;
    el.innerHTML =
      `<span class="vc-icon">🏡</span>` +
      `<div class="vc-info">` +
        `<span class="vc-name">${label}</span>` +
        `<div class="vc-track"><div class="vc-fill" style="width:${pct}%"></div></div>` +
        `<span class="vc-eta">guerrero en ${Math.ceil(timer)}s</span>` +
      `</div>`;
  }

  private updateHeroPanel() {
    const panel    = document.getElementById('hero-panel');
    const portrait = document.getElementById('hero-panel-portrait');
    const nameEl   = document.getElementById('hero-panel-name');
    const statusEl = document.getElementById('hero-panel-status');
    if (!panel) return;

    const hero = this.game.getAllUnits().find(u => u.playerId === this.game.humanPlayerId && u.isHero);
    if (!hero) { panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');

    if (portrait) portrait.textContent = hero.def.emoji;
    if (nameEl)   nameEl.textContent   = `${hero.heroName} ★`;

    if (statusEl) {
      if (hero.isAlive()) {
        const pct   = (hero.hp / hero.maxHp) * 100;
        const color = pct > 50 ? '#22dd44' : pct > 25 ? '#ddaa00' : '#dd2222';
        statusEl.innerHTML =
          `<div style="width:80px;height:5px;background:#333;border-radius:3px">` +
          `<div style="width:${pct.toFixed(0)}%;height:100%;background:${color};border-radius:3px;transition:width 0.3s"></div></div>` +
          `<span style="font-size:9px;color:#aaa">&nbsp;${hero.hp}/${hero.maxHp}</span>`;
      } else {
        const timer = this.game.getHeroRespawnTimer(hero.playerId);
        statusEl.innerHTML = `☠️ Respawn: <b style="color:#ffaa44">${timer !== undefined ? Math.ceil(timer) : '—'}s</b>`;
      }
    }
  }

  private updateWonderPanel() {
    const panel  = document.getElementById('wonder-panel');
    const fill   = document.getElementById('wonder-bar-fill');
    const timeEl = document.getElementById('wonder-time');
    const nameEl = document.getElementById('wonder-name');
    if (!panel) return;

    const wc = this.game.wonderCountdown;
    if (wc === null || wc <= 0) { panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');

    const civKey = this.game.humanPlayer.civType as string;
    const wonderName = WONDER_NAMES[civKey] ?? 'Gran Maravilla';
    const wonderEmoji = WONDER_EMOJIS[civKey] ?? '🏛️';
    if (nameEl) nameEl.textContent = `${wonderEmoji} ${wonderName}`;

    const m   = Math.floor(wc / 60);
    const s   = Math.ceil(wc % 60);
    const pct = Math.min(100, (wc / 180) * 100);
    if (fill)   fill.style.width = `${pct}%`;
    if (timeEl) timeEl.textContent = `${m}:${String(s).padStart(2, '0')}`;

    // Pulse red when under 30 seconds
    if (fill) {
      fill.style.background = wc < 30 ? '#dd3333' : wc < 60 ? '#ddaa00' : '#22aa66';
    }
  }

  private updateProductionQueueHUD() {
    const el = document.getElementById('prod-queue-hud');
    if (!el) return;
    const buildings = this.game.allBuildings.filter(
      b => b.playerId === this.game.humanPlayerId && b.isComplete() && b.productionQueue.length > 0,
    );
    if (buildings.length === 0) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.innerHTML = buildings.map(b => {
      const item    = b.productionQueue[0];
      const pct     = Math.min(100, (item.elapsed / item.totalTime) * 100);
      const rem     = Math.ceil(item.totalTime - item.elapsed);
      const bEmoji  = BUILDING_DEFS[b.type]?.emoji ?? '🏛️';
      const emoji   = getUnitDef(item.unitType)?.emoji ?? '⚔️';
      const extra = b.productionQueue.length > 1 ? ` +${b.productionQueue.length - 1}` : '';
      return `<div class="pq-item" title="${BUILDING_DEFS[b.type]?.name ?? ''}: entrenando ${getUnitDef(item.unitType)?.name ?? ''}">` +
        `<span class="pq-bld">${bEmoji}</span>` +
        `<span class="pq-icon">${emoji}</span>` +
        `<div class="pq-bar-wrap"><div class="pq-bar-fill" style="width:${pct.toFixed(1)}%"></div></div>` +
        `<span class="pq-time">${rem}s${extra}</span>` +
        `</div>`;
    }).join('');
  }

  private showUnitInfo(unit: Unit) {
    this.unitPanel.classList.remove('hidden');

    this.elPortrait.textContent = unit.def.emoji;
    const civColor = CIV_COLORS[unit.civType];
    this.elPortrait.style.background = `rgba(${(civColor >> 16) & 0xff}, ${(civColor >> 8) & 0xff}, ${civColor & 0xff}, 0.25)`;
    this.elPortrait.style.borderColor = hex(civColor);

    const champSuffix = !unit.isHero && unit.level >= 3 && !unit.veteranName ? ' ★★' : '';
    this.elUnitName.textContent = unit.isHero
      ? `${unit.heroName} ★`
      : unit.veteranName
        ? `${unit.veteranName} ★★`
        : `${unit.def.name}${champSuffix}`;
    this.elUnitCiv.textContent = unit.isHero
      ? `Héroe — ${CIV_NAMES[unit.civType]}`
      : unit.veteranName
        ? `${unit.def.name} — ${CIV_NAMES[unit.civType]}`
        : CIV_NAMES[unit.civType];

    const pct = unit.hp / unit.maxHp;
    this.elHpBar.style.width      = `${pct * 100}%`;
    this.elHpBar.style.background = pct > 0.5 ? '#22dd44' : pct > 0.25 ? '#ddaa00' : '#dd2222';
    this.elHpText.textContent     = `${unit.hp}/${unit.maxHp}`;

    const holdBadge    = unit.state === UnitState.HOLD ? `<span title="Posición de defensa (+2 def)" style="color:#88ccff">🛡️DEF</span>` : '';
    const shieldWallBadge = unit.shieldWall ? `<span title="¡Muro de escudos! — 3+ compañeros en Falange: proyectiles reducidos −40%" style="color:#66aaff;font-weight:700">🛡️MURO</span>` : '';
    const fatigueBadge = unit.fatigued ? `<span title="Fatigado — -10% ataque por combate prolongado. Descansa para recuperar" style="color:#cc8844">😴FATIGADO</span>` : '';
    const woundBadge   = unit.hp < unit.maxHp * 0.25 ? `<span title="Herida grave — -20% ataque, -30% movimiento" style="color:#ff4444">🩸HERIDO</span>` : '';
    const burnBadge    = unit.burning     > 0 ? `<span title="En llamas" style="color:#ff8822">🔥${Math.ceil(unit.burning)}s</span>`       : '';
    const poisonBadge  = unit.poisoned    > 0 ? `<span title="Envenenado — 2 HP/s · retira al Templo propio para curar (−3s cada 3s cerca del Templo)" style="color:#44dd44">☠️${Math.ceil(unit.poisoned)}s</span>` : '';
    const slowedBadge  = unit.slowed      > 0 ? `<span title="Aturdido por pedrada — -40% veloc." style="color:#aaaaff">🌀${Math.ceil(unit.slowed)}s</span>` : '';
    const berserkBadge = unit.berserkTimer > 0 ? `<span title="¡Frenesí! +25% daño" style="color:#ff6600">🔥FRENESÍ ${Math.ceil(unit.berserkTimer)}s</span>` : '';
    const chargeBadge  = unit.chargeReady  ? `<span title="Carga de caballería lista — +60% daño en primer golpe" style="color:#ffe066">⚡CARGA</span>` : '';
    const deployBadge  = unit.type === 'CANNON' && unit.stationaryTimer < 4
      ? `<span title="Desplegando cañón — espera ${(4 - unit.stationaryTimer).toFixed(1)}s antes de disparar" style="color:#ffcc44">⚙️DESPLEGANDO</span>`
      : '';
    const nightBadge   = this.game.isNight ? `<span title="Noche: +15% daño de combate para ambos bandos" style="color:#88aaff">🌙+15%</span>` : '';
    const reloadPct    = unit.attackTimer > 0 && unit.attackCooldown > 0 ? Math.round((unit.attackTimer / unit.attackCooldown) * 100) : 0;
    const reloadBadge  = reloadPct > 0 ? `<span title="Recargando ${unit.attackTimer.toFixed(1)}s" style="color:#ccaa44">🔄${reloadPct}%</span>` : '';
    const formBadge    = unit.inFormation ? `<span title="Filas cerradas — +2 defensa · la moral se recupera un 50% más rápido" style="color:#88ddaa">⚔️FILA</span>` : '';
    const moraleColor = unit.panicked || unit.morale < 25 ? '#dd2222' : unit.morale < 50 ? '#ddaa00' : '#22dd44';
    const moraleIcon  = unit.panicked ? '😱' : unit.morale < 50 ? '😰' : '❤';
    const moraleBadge = `<span title="${unit.panicked ? '¡Moral rota! Huye hasta recuperarse' : `Moral: ${Math.round(unit.morale)}/100 — cae con bajas cercanas y flanqueos`}" style="display:inline-flex;align-items:center;gap:2px;margin-left:1px"><span style="font-size:9px;color:${moraleColor}">${moraleIcon}</span><div style="width:36px;height:4px;background:rgba(255,255,255,0.10);border-radius:2px;display:inline-block;vertical-align:middle"><div style="width:${Math.round(unit.morale)}%;height:100%;background:${moraleColor};border-radius:2px"></div></div></span>`;
    const entrenchedBadge = unit.entrenched
      ? `<span title="Atrincherado — +7 def total (HOLD +2, fortín +5). Pulsa X o mueve para cancelar" style="color:#aaddff">🏕️FORTÍN</span>`
      : '';
    const ammoBadge = unit.outOfAmmo
      ? `<span title="Sin munición — combate cuerpo a cuerpo. Retira a un asentamiento propio para reabastecer" style="color:#ff4444">🏹SIN AMMO</span>`
      : unit.lowAmmo
      ? `<span title="Munición baja — retira a un asentamiento propio para reabastecer" style="color:#ffaa44">🏹${unit.ammo}</span>`
      : unit.ammo >= 0
      ? `<span title="Munición restante (V = descarga sincronizada ×2.5)" style="color:#aaddff">🏹${unit.ammo}/${unit.maxAmmo}</span>`
      : '';
    const warCryBadge = unit.isHero
      ? unit.warCryCooldown > 0
        ? `<span title="Grito de guerra en recarga (Y)" style="color:#888">📯${Math.ceil(unit.warCryCooldown)}s</span>`
        : `<span title="Grito de guerra listo — pulsa Y para activar (+30 moral, +25% atk a aliados en 8 casillas)" style="color:#ffd700">📯LISTO</span>`
      : unit.buffAttackTimer > 0
        ? `<span title="Buff de grito de guerra: +25% atk" style="color:#ffd700">📯${Math.ceil(unit.buffAttackTimer)}s</span>`
        : '';
    const heroPowerBadge = unit.isHero
      ? unit.heroCooldown2 > 0
        ? `<span title="Habilidad del héroe en recarga (H)" style="color:#888">🦅${Math.ceil(unit.heroCooldown2)}s</span>`
        : `<span title="Habilidad especial del héroe lista — pulsa H para activar" style="color:#ff9944">🦅LISTA</span>`
      : '';
    const FORM_LABELS: Record<string, string> = { LOOSE: '💨SUELTA', PHALANX: '🛡️FALANGE', WEDGE: '⚔️CUÑA' };
    const FORM_TIPS:   Record<string, string> = {
      LOOSE:   'Formación suelta — +20% veloc., -10% atk, -15% def · F4 para cancelar',
      PHALANX: 'Falange — -30% veloc., -20% atk, +30% def · F4 para cancelar',
      WEDGE:   'Cuña — +25% atk, +10% def · F4 para cancelar',
    };
    const orderBadge = unit.formation
      ? `<span title="${FORM_TIPS[unit.formation] ?? ''}" style="color:#bbffee">${FORM_LABELS[unit.formation] ?? unit.formation}</span>`
      : '';
    const officerBadge = unit.nearOfficer && !unit.isHero
      ? `<span title="Bajo el mando de un oficial veterano cercano (campeón Nv.3 o héroe) — +2 defensa" style="color:#ffcc66">🎖️OFICIAL</span>`
      : '';
    const pinnedBadge = unit.meleePinned
      ? `<span title="Acorralado en cuerpo a cuerpo — -40% daño a distancia. ¡Retíralo o protégelo con infantería!" style="color:#ff6644">⚠️ACORRALADO</span>`
      : '';
    const supplyBadge = unit._nearSupplyDepot
      ? `<span title="Cerca de un Almacén — munición y HP se recargan el doble de rápido (hasta 50% HP)" style="color:#88ffcc">📦SUMIN.</span>`
      : '';
    const isHealing = unit.hp < unit.maxHp && unit.hp > 0 &&
                      unit._damageCooldown <= 0 && unit.state === UnitState.IDLE;
    const healingBadge = isHealing
      ? `<span title="Recuperando HP — permanece inactivo para acelerar la cura" style="color:#88ff88">💊CURANDO</span>`
      : '';
    this.elUnitStats.innerHTML =
      `<span>⚔️ ${unit.attack}</span>` +
      `<span>🛡️ ${unit.defense}</span>` +
      `<span>💨 ${unit.speed.toFixed(1)}</span>` +
      `<span>🎯 ${unit.attackRange.toFixed(1)}</span>` +
      woundBadge + holdBadge + entrenchedBadge + shieldWallBadge + fatigueBadge + burnBadge + poisonBadge + slowedBadge + berserkBadge + chargeBadge + deployBadge + formBadge + moraleBadge + ammoBadge + orderBadge + officerBadge + pinnedBadge + supplyBadge + healingBadge + warCryBadge + heroPowerBadge + nightBadge + reloadBadge;

    // XP bar (only if unit can still level up)
    const xpEl = document.getElementById('unit-xp-row');
    if (xpEl) {
      const killsLabel = unit.killsTotal > 0
        ? `<span style="color:#ffcc66;font-size:10px;margin-left:6px" title="Bajas confirmadas">⚔️${unit.killsTotal}</span>`
        : '';
      if (unit.level < 3) {
        const needed = unit.level === 1 ? 50 : 150;
        const xpPct  = Math.min(100, (unit.xp / needed) * 100);
        const stars  = unit.level === 1 ? '☆☆' : '★☆';
        xpEl.innerHTML =
          `<span class="xp-label">Nv.${unit.level} ${stars}</span>` +
          `<div class="xp-track"><div class="xp-fill" style="width:${xpPct}%"></div></div>` +
          `<span class="xp-num">${unit.xp}/${needed}</span>` + killsLabel;
        xpEl.classList.remove('hidden');
      } else {
        xpEl.innerHTML = `<span class="xp-label" style="color:#ff9933">${unit.veteranName ? `👑 ${unit.veteranName}` : '★★ Campeón'}</span>` + killsLabel;
        xpEl.classList.remove('hidden');
      }
    }

    // Action bar: context-sensitive buttons for own units
    const actionBar    = document.getElementById('unit-action-bar');
    const actHold      = document.getElementById('act-hold')      as HTMLButtonElement | null;
    const actEntrench  = document.getElementById('act-entrench')  as HTMLButtonElement | null;
    const actVolley    = document.getElementById('act-volley')    as HTMLButtonElement | null;
    const actWarcry    = document.getElementById('act-warcry')    as HTMLButtonElement | null;
    const actHeropower = document.getElementById('act-heropower') as HTMLButtonElement | null;
    const isOwn = unit.playerId === this.game.humanPlayerId;
    const isHeroOwn = isOwn && unit.isHero;

    if (actionBar && actHold && actEntrench && actVolley && actWarcry && actHeropower) {
      // Hold / defend
      if (isOwn) {
        actHold.classList.remove('hidden');
        actHold.classList.toggle('active', unit.state === UnitState.HOLD || unit.entrenched);
        actHold.textContent = (unit.state === UnitState.HOLD || unit.entrenched) ? '🛡️ En Pos.' : '🛡️ Defender';
      } else {
        actHold.classList.add('hidden');
      }
      // Entrench
      if (isOwn) {
        actEntrench.classList.remove('hidden');
        actEntrench.classList.toggle('active', unit.entrenched);
        actEntrench.textContent = unit.entrenched ? '🏕️ En Fortín' : '🏕️ Fortín';
      } else {
        actEntrench.classList.add('hidden');
      }
      // Volley (ranged only)
      if (isOwn && unit.ammo >= 0) {
        actVolley.classList.remove('hidden');
        const noTarget = !unit.attackTarget?.isAlive();
        actVolley.classList.toggle('cooldown', unit.outOfAmmo || noTarget);
        actVolley.textContent = unit.outOfAmmo ? `🔫 Sin ammo` : `🔫 Descarga (${unit.ammo})`;
        actVolley.title = noTarget ? 'Selecciona un objetivo primero' : 'Descarga sincronizada ×2.5 daño (V)';
      } else {
        actVolley.classList.add('hidden');
      }
      // War cry (hero only)
      if (isHeroOwn) {
        actWarcry.classList.remove('hidden');
        const wcd = unit.warCryCooldown;
        actWarcry.classList.toggle('cooldown', wcd > 0);
        actWarcry.textContent = wcd > 0 ? `📯 ${Math.ceil(wcd)}s` : '📯 Grito';
      } else {
        actWarcry.classList.add('hidden');
      }
      // Hero power (hero only)
      if (isHeroOwn) {
        actHeropower.classList.remove('hidden');
        const hcd = unit.heroCooldown2;
        actHeropower.classList.toggle('cooldown', hcd > 0);
        actHeropower.textContent = hcd > 0 ? `🦅 ${Math.ceil(hcd)}s` : '🦅 Poder';
      } else {
        actHeropower.classList.add('hidden');
      }
      // Formation quick-keys inside action bar
      const fLoose   = document.getElementById('form-loose');
      const fPhalanx = document.getElementById('form-phalanx');
      const fWedge   = document.getElementById('form-wedge');
      const fFree    = document.getElementById('form-free');
      if (fLoose && fPhalanx && fWedge && fFree) {
        if (isOwn) {
          [fLoose, fPhalanx, fWedge, fFree].forEach(b => b.classList.remove('hidden'));
          fLoose.classList.toggle('active',   unit.formation === 'LOOSE');
          fPhalanx.classList.toggle('active', unit.formation === 'PHALANX');
          fWedge.classList.toggle('active',   unit.formation === 'WEDGE');
          fFree.classList.toggle('active',    !unit.formation);
        } else {
          [fLoose, fPhalanx, fWedge, fFree].forEach(b => b.classList.add('hidden'));
        }
      }
      // Show bar if player owns this unit
      actionBar.classList.toggle('hidden', !isOwn);
    }
  }

  private updateMinimap() {
    if (!this.minimapBuilt || !this.minimapBase) return;
    const ctx = this.minimapCtx;
    const W   = this.minimapCanvas.width;
    const H   = this.minimapCanvas.height;

    ctx.putImageData(this.minimapBase, 0, 0);

    const map   = this.game.map;
    const tw    = W / map.cols;
    const th    = H / map.rows;
    const unitSize  = Math.max(1.5, Math.min(tw, th) * 1.2);
    const buildSize = Math.max(2.5, Math.min(tw, th) * 1.8);

    // Draw buildings
    for (const building of this.game.allBuildings) {
      if (!building.isAlive()) continue;
      const col = CIV_COLORS[building.playerId >= 0 && building.playerId < this.game.players.length ? this.game.players[building.playerId].civType : 0];
      ctx.fillStyle = hex(col);
      ctx.globalAlpha = building.isComplete() ? 0.8 : 0.4;
      ctx.beginPath();
      ctx.rect(building.col * tw - buildSize / 2, building.row * th - buildSize / 2, buildSize, buildSize);
      ctx.fill();
    }
    ctx.globalAlpha = 1.0;

    const humanFog = this.game.fog.getFog(this.game.humanPlayerId);

    // Draw units (only show enemy units if visible in fog; track last-seen positions)
    for (const player of this.game.players) {
      const col = CIV_COLORS[player.civType];
      ctx.fillStyle = hex(col);
      for (const unit of player.aliveUnits) {
        if (player.id !== this.game.humanPlayerId && humanFog) {
          const canSee = humanFog.canSeeUnit(unit, this.game.humanPlayerId);
          if (canSee) {
            this._lastSeenUnits.set(unit.id, { col: unit.col, row: unit.row, ts: Date.now() });
          } else {
            continue; // don't draw in real position
          }
        }
        ctx.beginPath();
        ctx.arc(unit.col * tw + tw / 2, unit.row * th + th / 2, unitSize / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw last-seen ghost dots for enemy units now in fog (time-decayed opacity)
    const nowMs = Date.now();
    for (const player of this.game.players) {
      if (player.id === this.game.humanPlayerId) continue;
      ctx.fillStyle = hex(CIV_COLORS[player.civType]);
      for (const unit of player.aliveUnits) {
        if (!humanFog || humanFog.canSeeUnit(unit, this.game.humanPlayerId)) continue;
        const last = this._lastSeenUnits.get(unit.id);
        if (!last) continue;
        // Fade from 0.45 (just seen) to 0.05 (90+ seconds ago)
        const ageSec = (nowMs - last.ts) / 1000;
        const alpha = Math.max(0.05, 0.45 - (ageSec / 90) * 0.40);
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(last.col * tw + tw / 2, last.row * th + th / 2, unitSize / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1.0;

    // Patrol path lines: dotted line between patrol waypoints for human units
    {
      const civColor = CIV_COLORS[this.game.humanPlayer.civType];
      ctx.strokeStyle = hex(civColor);
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      for (const unit of this.game.humanPlayer.aliveUnits) {
        if (!unit.patrolA || !unit.patrolB) continue;
        const ax = unit.patrolA.col * tw + tw / 2, az = unit.patrolA.row * th + th / 2;
        const bx = unit.patrolB.col * tw + tw / 2, bz = unit.patrolB.row * th + th / 2;
        ctx.beginPath(); ctx.moveTo(ax, az); ctx.lineTo(bx, bz); ctx.stroke();
        ctx.fillStyle = hex(civColor);
        ctx.beginPath(); ctx.arc(ax, az, 1.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(bx, bz, 1.5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1.0;
    }

    // Draw workers — idle workers pulse brightly to signal underutilized labor
    const idlePulse = 0.5 + 0.5 * Math.sin(Date.now() / 350);
    for (const worker of this.game.allWorkers) {
      const player = this.game.players[worker.playerId];
      const isIdle = worker.task === WorkerTask.IDLE && worker.playerId === this.game.humanPlayerId;
      ctx.fillStyle = isIdle ? '#ffee44' : hex(CIV_COLORS[player.civType]);
      ctx.globalAlpha = isIdle ? 0.4 + 0.6 * idlePulse : 0.6;
      const r = isIdle ? unitSize / 2 : unitSize / 3;
      ctx.beginPath();
      ctx.arc(worker.col * tw + tw / 2, worker.row * th + th / 2, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1.0;

    // Draw undiscovered treasure caches (only in explored/visible fog tiles)
    for (const cache of this.game.treasureCaches) {
      if (cache.claimed) continue;
      const vis = humanFog?.getVisibility(cache.col, cache.row);
      if (vis === TileVisibility.UNEXPLORED) continue;
      const pulse = 0.55 + 0.45 * Math.sin(Date.now() / 400);
      ctx.globalAlpha = pulse;
      ctx.fillStyle = '#ffd700';
      ctx.beginPath();
      ctx.arc(cache.col * tw + tw / 2, cache.row * th + th / 2, Math.max(2, tw * 0.7), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1.0;

    // Draw resource nodes (only visible/fogged tiles)
    const nodeSize = Math.max(1.5, Math.min(tw, th));
    for (const node of this.game.resourceNodes) {
      const vis = humanFog?.getVisibility(node.col, node.row);
      if (vis === TileVisibility.UNEXPLORED) continue;
      if (node.isEmpty()) {
        // Depleted nodes render as dim grey X
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = 'rgba(100,100,100,0.6)';
        ctx.beginPath();
        ctx.arc(node.col * tw + tw / 2, node.row * th + th / 2, nodeSize / 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
        continue;
      }
      // Tint by depletion ratio: full-color at 100%, muted at low %
      const ratio = node.amount / node.maxAmount;
      const nodeColor = node.type === ResourceType.FOOD
        ? `rgba(${Math.round(80 + (1 - ratio) * 120)},${Math.round(220 * ratio + 80)},80,0.75)`
        : node.type === ResourceType.GOLD
        ? `rgba(255,${Math.round(200 * ratio + 55)},40,0.75)`
        : `rgba(${Math.round(180 * ratio + 60)},${Math.round(180 * ratio + 60)},${Math.round(180 * ratio + 60)},0.75)`;
      ctx.fillStyle = nodeColor;
      ctx.beginPath();
      ctx.arc(node.col * tw + tw / 2, node.row * th + th / 2, nodeSize / 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Fog of war overlay on minimap
    if (humanFog) {
      for (let r = 0; r < map.rows; r++) {
        for (let c = 0; c < map.cols; c++) {
          const vis = humanFog.getVisibility(c, r);
          if (vis === TileVisibility.UNEXPLORED) {
            ctx.fillStyle = 'rgba(0,0,0,0.82)';
            ctx.fillRect(c * tw, r * th, Math.ceil(tw), Math.ceil(th));
          } else if (vis === TileVisibility.FOGGED) {
            ctx.fillStyle = 'rgba(0,0,0,0.45)';
            ctx.fillRect(c * tw, r * th, Math.ceil(tw), Math.ceil(th));
          }
        }
      }
    }

    // Combat pings — flash red rings where battles are happening
    const now = Date.now();
    this._combatPings = this._combatPings.filter(p => now - p.ts < 2000);
    for (const ping of this._combatPings) {
      const age = (now - ping.ts) / 2000; // 0..1
      const radius = (1 + age * 3) * Math.max(tw, th);
      ctx.strokeStyle = `rgba(255,60,0,${(1 - age) * 0.85})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(ping.col * tw + tw / 2, ping.row * th + th / 2, radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Settlement HP border pulse: red glow when human settlement is below 50%
    const settle = this.game.allBuildings.find(
      b => b.playerId === this.game.humanPlayerId && b.type === BuildingType.SETTLEMENT && b.isAlive(),
    );
    if (settle && settle.hp < settle.maxHp * 0.5) {
      const pulse = 0.6 + 0.4 * Math.sin(Date.now() / 200);
      ctx.strokeStyle = `rgba(255,30,0,${pulse})`;
      ctx.lineWidth = 4;
      ctx.strokeRect(1, 1, W - 2, H - 2);
    }

    // Rally point flags: small diamond markers for human buildings with rally points set
    {
      const civColor = CIV_COLORS[this.game.humanPlayer.civType];
      ctx.fillStyle = hex(civColor);
      ctx.globalAlpha = 0.75;
      for (const b of this.game.allBuildings) {
        if (b.playerId !== this.game.humanPlayerId || !b.isAlive() || b.rallyCol === null || b.rallyRow === null) continue;
        const rx = b.rallyCol * tw + tw / 2;
        const rz = b.rallyRow * th + th / 2;
        const s = Math.max(2, Math.min(tw, th));
        ctx.beginPath();
        ctx.moveTo(rx,     rz - s);
        ctx.lineTo(rx + s, rz);
        ctx.lineTo(rx,     rz + s);
        ctx.lineTo(rx - s, rz);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1.0;
    }

    // Camera viewport rectangle
    if (this.camera) {
      const pos = this.camera.getPosition();
      const zoom = this.camera.getZoom();
      const nx = (pos.x / (map.cols * TILE_SIZE)) * W;
      const nz = (pos.z / (map.rows * TILE_SIZE)) * H;
      const rectW = (zoom / (map.cols * TILE_SIZE)) * W * 2.5;
      const rectH = (zoom / (map.rows * TILE_SIZE)) * H * 2.0;
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1;
      ctx.strokeRect(nx - rectW / 2, nz - rectH / 2, rectW, rectH);
    }

    // Enemy threat arrow: pulsing red arrow on minimap edge when enemies approach settlement
    const humanSettle = this.game.allBuildings.find(
      b => b.playerId === this.game.humanPlayerId && b.type === BuildingType.SETTLEMENT && b.isAlive(),
    );
    if (humanSettle) {
      const sc = humanSettle.col, sr = humanSettle.row;
      const nearEnemies = this.game.allUnits.filter(u => {
        if (u.playerId === this.game.humanPlayerId || !u.isAlive()) return false;
        const d = Math.sqrt((u.col - sc) ** 2 + (u.row - sr) ** 2);
        return d <= 15;
      });
      if (nearEnemies.length >= 2) {
        const cx = nearEnemies.reduce((s, u) => s + u.col, 0) / nearEnemies.length;
        const cz = nearEnemies.reduce((s, u) => s + u.row, 0) / nearEnemies.length;
        const dx = cx - sc, dz = cz - sr;
        const len = Math.sqrt(dx * dx + dz * dz) || 1;
        const ndx = dx / len, ndz = dz / len;
        // Arrow origin: settlement position on minimap
        const ox = sc * tw + tw / 2, oz = sr * th + th / 2;
        const pulse = 0.55 + 0.45 * Math.sin(Date.now() / 250);
        ctx.save();
        ctx.strokeStyle = `rgba(255,40,40,${pulse})`;
        ctx.fillStyle   = `rgba(255,40,40,${pulse})`;
        ctx.lineWidth = 2;
        // Draw line from settlement toward enemy cluster (max 22px)
        const arrowLen = Math.min(22, len * tw * 0.8);
        const tx = ox + ndx * arrowLen, tz = oz + ndz * arrowLen;
        ctx.beginPath();
        ctx.moveTo(ox, oz);
        ctx.lineTo(tx, tz);
        ctx.stroke();
        // Arrowhead
        const hs = 5;
        const perp = { x: -ndz, z: ndx };
        ctx.beginPath();
        ctx.moveTo(tx, tz);
        ctx.lineTo(tx - ndx * hs + perp.x * hs * 0.5, tz - ndz * hs + perp.z * hs * 0.5);
        ctx.lineTo(tx - ndx * hs - perp.x * hs * 0.5, tz - ndz * hs - perp.z * hs * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
  }

  addCombatPing(col: number, row: number) {
    const now = Date.now();
    const nearby = this._combatPings.find(p => Math.abs(p.col - col) < 4 && Math.abs(p.row - row) < 4 && now - p.ts < 800);
    if (!nearby) this._combatPings.push({ col, row, ts: now });
  }

  showDamageNumbers(events: DamageEvent[]) {
    for (const evt of events) {
      const el = document.createElement('div');
      el.className = evt.critical ? 'damage-number damage-crit' : 'damage-number';
      el.textContent = evt.critical ? `💥${evt.damage}` : `-${evt.damage}`;

      let screenX: number, screenY: number;
      if (this.renderer) {
        const pos = this.renderer.worldToScreen(evt.worldX, 1.2, evt.worldZ);
        screenX = pos.x;
        screenY = pos.y;
      } else {
        screenX = (evt.worldX / (this.game.map.cols * TILE_SIZE)) * window.innerWidth;
        screenY = (evt.worldZ / (this.game.map.rows * TILE_SIZE)) * window.innerHeight;
      }

      el.style.left = `${screenX}px`;
      el.style.top  = `${screenY}px`;
      document.body.appendChild(el);

      setTimeout(() => el.remove(), 1100);
    }
  }

  private updateBuildingHpBars() {
    if (!this.renderer) return;
    const container = document.getElementById('bldg-hpbar-container');
    if (!container) return;

    const humanFog = this.game.fog.getFog(this.game.humanPlayerId);
    const seen = new Set<number>();

    for (const building of this.game.allBuildings) {
      if (!building.isAlive() || building.hp >= building.maxHp) continue;
      const vis = humanFog?.getVisibility(building.col, building.row);
      if (vis === TileVisibility.UNEXPLORED) continue;

      seen.add(building.id);

      let bar = this._bldgHpBars.get(building.id);
      if (!bar) {
        const wrap = document.createElement('div');
        wrap.className = 'bldg-hpbar';
        const fill = document.createElement('div');
        fill.className = 'bldg-hpbar-fill';
        wrap.appendChild(fill);
        container.appendChild(wrap);
        bar = { wrap, fill };
        this._bldgHpBars.set(building.id, bar);
      }

      const pos = this.renderer.worldToScreen(building.col * TILE_SIZE, 1.8, building.row * TILE_SIZE);
      bar.wrap.style.left = `${pos.x}px`;
      bar.wrap.style.top  = `${pos.y - 14}px`;

      const pct = (building.hp / building.maxHp) * 100;
      bar.fill.style.width = `${pct}%`;
      bar.fill.style.background = pct > 60 ? '#44dd66' : pct > 30 ? '#ddaa22' : '#dd3333';
      bar.wrap.style.opacity = vis === TileVisibility.FOGGED ? '0.45' : '1';
    }

    for (const [id, bar] of this._bldgHpBars) {
      if (!seen.has(id)) {
        bar.wrap.remove();
        this._bldgHpBars.delete(id);
      }
    }
  }

  showHoverTooltip(unitId: number | null, buildingId: number | null, screenX: number, screenY: number, tileCol?: number, tileRow?: number, map?: GameMap) {
    const el = document.getElementById('hover-tooltip');
    if (!el) return;

    if (unitId === null && buildingId === null) {
      // Show terrain info when hovering empty ground
      if (tileCol !== undefined && tileRow !== undefined && map) {
        const tile = map.getTile(tileCol, tileRow);
        if (tile) {
          const humanFog = this.game.fog.getFog(this.game.humanPlayerId);
          const vis = humanFog?.getVisibility(tileCol, tileRow) ?? 2;
          if (vis > 0) { // not UNEXPLORED
            const info = TERRAIN_INFO[tile.terrain];
            if (info) {
              el.innerHTML = `<div class="ht-name">${info.emoji} ${info.name}</div><div class="ht-status">${info.desc}</div>`;
              el.classList.remove('hidden');
              const margin = 12;
              let left = screenX + margin, top = screenY + margin;
              if (left + 200 > window.innerWidth)  left = screenX - 200 - margin;
              if (top  + 80  > window.innerHeight) top  = screenY - 80  - margin;
              el.style.left = `${left}px`;
              el.style.top  = `${top}px`;
              return;
            }
          }
        }
      }
      el.classList.add('hidden');
      return;
    }

    let html = '';
    if (unitId !== null) {
      const unit = this.game.allUnits.find(u => u.id === unitId);
      if (!unit || !unit.isAlive()) { el.classList.add('hidden'); return; }
      const pct = (unit.hp / unit.maxHp) * 100;
      const hpColor = pct > 60 ? '#44dd66' : pct > 30 ? '#ddaa22' : '#dd3333';
      const owner = this.game.players[unit.playerId];
      const ownerLabel = owner?.isHuman ? '(Tú)' : CIV_NAMES[unit.civType];
      html = `
        <span class="ht-portrait">${unit.def.emoji}</span>
        <div class="ht-name">${unit.def.name}</div>
        <div class="ht-civ">${ownerLabel} · Nv.${unit.level}</div>
        <div class="ht-hp-wrap"><div class="ht-hp-fill" style="width:${pct}%;background:${hpColor}"></div></div>
        <div class="ht-stats">
          <span>⚔️${unit.attack}</span>
          <span>🛡️${unit.defense}</span>
          <span>💨${unit.speed.toFixed(1)}</span>
          <span>❤️${unit.hp}/${unit.maxHp}</span>
        </div>`;
    } else if (buildingId !== null) {
      const building = this.game.allBuildings.find(b => b.id === buildingId);
      if (!building || !building.isAlive()) { el.classList.add('hidden'); return; }
      const pct = (building.hp / building.maxHp) * 100;
      const hpColor = pct > 60 ? '#44dd66' : pct > 30 ? '#ddaa22' : '#dd3333';
      const owner = this.game.players[building.playerId];
      const ownerLabel = owner?.isHuman ? '(Tú)' : CIV_NAMES[owner?.civType ?? 0];
      let status: string;
      if (!building.isComplete()) {
        const etaSecs = Math.ceil(building.buildTime * (1 - building.buildProgress));
        status = `🔨 ${Math.round(building.buildProgress * 100)}% construido — listo en ${etaSecs}s`;
      } else if (building.productionQueue?.length > 0) {
        const item = building.productionQueue[0];
        const rem  = Math.ceil(item.totalTime - item.elapsed);
        const prPct = Math.min(100, (item.elapsed / item.totalTime) * 100);
        const civDef = owner ? CIVILIZATIONS[owner.civType] : null;
        const uDef   = civDef?.units.find(u => u.type === item.unitType);
        const eName  = uDef?.name ?? item.unitType;
        const eEmoji = uDef?.emoji ?? '⚔️';
        const queue  = building.productionQueue.length > 1 ? ` (+${building.productionQueue.length - 1})` : '';
        status = `${eEmoji} <b>${eName}</b>${queue} — ${rem}s` +
          `<div style="width:100%;height:3px;background:rgba(255,255,255,0.12);border-radius:2px;margin-top:3px">` +
          `<div style="width:${prPct}%;height:100%;background:#22aa66;border-radius:2px"></div></div>`;
      } else {
        status = '✅ Inactivo';
      }
      const captureLine = building.captureProgress > 0
        ? `<div class="ht-status" style="color:#ffaa44">🚩 Captura: ${Math.round(building.captureProgress)}%` +
          `<div style="width:100%;height:3px;background:rgba(255,255,255,0.12);border-radius:2px;margin-top:3px">` +
          `<div style="width:${building.captureProgress}%;height:100%;background:#ffaa44;border-radius:2px"></div></div></div>`
        : '';
      const garrisonLine = building.garrisonCapacity > 0 && building.isComplete()
        ? `<div class="ht-status">🏰 Guarnición: ${building.garrison.length}/${building.garrisonCapacity}${building.garrison.length > 0 ? ' · U para desalojar' : ' · clic der. con tropas'}</div>`
        : '';
      html = `
        <div class="ht-name">${building.def?.name ?? building.type}</div>
        <div class="ht-civ">${ownerLabel}</div>
        <div class="ht-hp-wrap"><div class="ht-hp-fill" style="width:${pct}%;background:${hpColor}"></div></div>
        <div class="ht-stats"><span>❤️${building.hp}/${building.maxHp}</span></div>
        <div class="ht-status">${status}</div>
        ${captureLine}
        ${garrisonLine}`;
    }

    el.innerHTML = html;
    el.classList.remove('hidden');

    // Position near cursor, keep inside viewport
    const margin = 12;
    const tipW = 220, tipH = 120;
    let left = screenX + margin;
    let top  = screenY + margin;
    if (left + tipW > window.innerWidth)  left = screenX - tipW - margin;
    if (top  + tipH > window.innerHeight) top  = screenY - tipH - margin;
    el.style.left = `${left}px`;
    el.style.top  = `${top}px`;
  }

  private setRateEl(el: HTMLElement | null, net: number) {
    if (!el) return;
    const rounded = Math.round(net);
    if (rounded > 0) {
      el.textContent = `+${rounded}`;
      el.className = 'res-rate res-rate-pos';
    } else if (rounded < 0) {
      el.textContent = `${rounded}`;
      el.className = 'res-rate res-rate-neg';
    } else {
      el.textContent = '';
      el.className = 'res-rate';
    }
  }

  hideLoading() {
    const screen = document.getElementById('loading-screen')!;
    screen.classList.add('hidden');
    setTimeout(() => screen.remove(), 900);
  }

  setLoadingProgress(pct: number) {
    const bar = document.getElementById('loading-bar')!;
    bar.style.width = `${pct}%`;
  }

  notify(msg: string, type: 'info' | 'warning' | 'success' = 'info') {
    const container = document.getElementById('toast-container') ?? document.body;
    const el = document.createElement('div');
    el.className = `hud-toast hud-toast-${type}`;
    el.textContent = msg;
    container.appendChild(el);
    requestAnimationFrame(() => el.classList.add('visible'));
    setTimeout(() => {
      el.classList.remove('visible');
      setTimeout(() => el.remove(), 300);
    }, 3000);

    // Store in notification history (newest first, max 20)
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    this._notifHistory.unshift({ msg, type, time });
    if (this._notifHistory.length > 20) this._notifHistory.pop();
    if (this._logOpen) this._renderLog();
  }

  toggleLog() {
    const panel = document.getElementById('notif-log-panel');
    if (!panel) return;
    this._logOpen = !this._logOpen;
    if (this._logOpen) {
      this._renderLog();
      panel.classList.remove('hidden');
    } else {
      panel.classList.add('hidden');
    }
  }

  private _renderLog() {
    const list = document.getElementById('nl-list');
    if (!list) return;
    if (this._notifHistory.length === 0) {
      list.innerHTML = '<div class="nl-empty">Sin eventos recientes</div>';
      return;
    }
    list.innerHTML = this._notifHistory.map(e =>
      `<div class="nl-entry nt-${e.type}">` +
      `<span class="nl-msg">${e.msg}</span>` +
      `<span class="nl-time">${e.time}</span>` +
      `</div>`,
    ).join('');
  }

  flashAutoSave() {
    const el = document.getElementById('autosave-indicator');
    if (!el) return;
    el.classList.remove('hidden', 'autosave-fade');
    // Force reflow so the animation restarts
    void el.offsetWidth;
    el.classList.add('autosave-fade');
    setTimeout(() => el.classList.add('hidden'), 2500);
  }
}
