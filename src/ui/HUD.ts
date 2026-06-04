import type { Game } from '../game/Game';
import type { Unit } from '../game/Unit';
import type { GameMap } from '../game/Map';
import { TERRAIN_COLORS, CIV_COLORS, CIV_NAMES, CIV_EMOJIS, TILE_SIZE } from '../game/constants';
import type { DamageEvent } from '../game/CombatSystem';

function hex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

export class HUD {
  private game: Game;

  private elFood   = document.getElementById('res-food')!;
  private elGold   = document.getElementById('res-gold')!;
  private elStone  = document.getElementById('res-stone')!;
  private elStatus = document.getElementById('game-status')!;
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
  private elTimer = document.getElementById('game-timer');
  private elPop   = document.getElementById('pop-count');

  onMinimapClick: ((worldX: number, worldZ: number) => void) | null = null;

  constructor(game: Game) {
    this.game = game;
    this.minimapCanvas.width  = 180;
    this.minimapCanvas.height = 180;
    this.minimapCtx = this.minimapCanvas.getContext('2d')!;

    const civ = game.humanPlayer.civType;
    this.elCivBadge.textContent = `${CIV_EMOJIS[civ]} ${CIV_NAMES[civ]}`;
    this.elCivBadge.style.color = hex(CIV_COLORS[civ]);

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

    // Timer
    const secs = Math.floor(this.game.gameTime);
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    if (this.elTimer) this.elTimer.textContent = `${m}:${String(s).padStart(2, '0')}`;

    // Population (human alive units)
    if (this.elPop) this.elPop.textContent = String(player.aliveUnits.length);

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

    // Unit panel
    if (selectedUnits.length === 1) {
      this.showUnitInfo(selectedUnits[0]);
      this.elSelCount.classList.add('hidden');
    } else if (selectedUnits.length > 1) {
      this.unitPanel.classList.add('hidden');
      this.elSelCount.classList.remove('hidden');
      this.elSelCount.textContent = `${selectedUnits.length} unidades seleccionadas`;
    } else {
      this.unitPanel.classList.add('hidden');
      this.elSelCount.classList.add('hidden');
    }

    // Minimap units
    this.updateMinimap();
  }

  private showUnitInfo(unit: Unit) {
    this.unitPanel.classList.remove('hidden');

    this.elPortrait.textContent = unit.def.emoji;
    const civColor = CIV_COLORS[unit.civType];
    this.elPortrait.style.background = `rgba(${(civColor >> 16) & 0xff}, ${(civColor >> 8) & 0xff}, ${civColor & 0xff}, 0.25)`;
    this.elPortrait.style.borderColor = hex(civColor);

    this.elUnitName.textContent = unit.def.name;
    this.elUnitCiv.textContent  = CIV_NAMES[unit.civType];

    const pct = unit.hp / unit.maxHp;
    this.elHpBar.style.width      = `${pct * 100}%`;
    this.elHpBar.style.background = pct > 0.5 ? '#22dd44' : pct > 0.25 ? '#ddaa00' : '#dd2222';
    this.elHpText.textContent     = `${unit.hp}/${unit.maxHp}`;

    this.elUnitStats.innerHTML =
      `<span>⚔️ ${unit.attack}</span>` +
      `<span>🛡️ ${unit.defense}</span>` +
      `<span>💨 ${unit.speed.toFixed(1)}</span>` +
      `<span>🎯 ${unit.attackRange.toFixed(1)}</span>`;
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

    // Draw units
    for (const player of this.game.players) {
      const col = CIV_COLORS[player.civType];
      ctx.fillStyle = hex(col);
      for (const unit of player.aliveUnits) {
        ctx.beginPath();
        ctx.arc(unit.col * tw + tw / 2, unit.row * th + th / 2, unitSize / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw workers
    for (const worker of this.game.allWorkers) {
      const player = this.game.players[worker.playerId];
      const col = CIV_COLORS[player.civType];
      ctx.fillStyle = hex(col);
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.arc(worker.col * tw + tw / 2, worker.row * th + th / 2, unitSize / 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1.0;
  }

  showDamageNumbers(events: DamageEvent[]) {
    for (const evt of events) {
      const el = document.createElement('div');
      el.className = 'damage-number';
      el.textContent = `-${evt.damage}`;

      // Convert world position to screen
      const screenX = (evt.worldX / (this.game.map.cols * 2)) * window.innerWidth;
      const screenY = (evt.worldZ / (this.game.map.rows * 2)) * window.innerHeight;

      el.style.left = `${screenX}px`;
      el.style.top  = `${screenY}px`;
      document.body.appendChild(el);

      setTimeout(() => el.remove(), 1200);
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
    const el = document.createElement('div');
    el.className = `hud-toast hud-toast-${type}`;
    el.textContent = msg;
    document.body.appendChild(el);
    // Animate in then out
    requestAnimationFrame(() => el.classList.add('visible'));
    setTimeout(() => {
      el.classList.remove('visible');
      setTimeout(() => el.remove(), 400);
    }, 3200);
  }
}
