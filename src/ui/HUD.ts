import type { Game } from '../game/Game';
import type { Unit } from '../game/Unit';
import type { GameMap } from '../game/Map';
import { TERRAIN_COLORS, CIV_COLORS, CIV_NAMES, CIV_EMOJIS, TILE_SIZE } from '../game/constants';
import type { DamageEvent } from '../game/CombatSystem';
import { TileVisibility } from '../game/FogOfWar';
import { ResourceType } from '../game/ResourceNode';
import { BuildingType } from '../game/buildings';
import type { Renderer } from '../engine/Renderer';
import { CIV_POWER_DEFS } from '../game/CivPowers';

function hex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

export class HUD {
  private game: Game;

  private elFood      = document.getElementById('res-food')!;
  private elGold      = document.getElementById('res-gold')!;
  private elStone     = document.getElementById('res-stone')!;
  private elFoodRate  = document.getElementById('res-food-rate');
  private elGoldRate  = document.getElementById('res-gold-rate');
  private elStoneRate = document.getElementById('res-stone-rate');
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
  private elTimer      = document.getElementById('game-timer');
  private elPop        = document.getElementById('pop-count');
  private elPopBarFill = document.getElementById('pop-bar-fill') as HTMLDivElement | null;
  private elScoreboard = document.getElementById('scoreboard')!

  onMinimapClick: ((worldX: number, worldZ: number) => void) | null = null;
  onPowerActivate: (() => void) | null = null;
  private _combatPings:    { col: number; row: number; ts: number }[] = [];
  private _lastSeenUnits:  Map<number, { col: number; row: number }> = new Map();

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

    // Economy rate indicators
    const econStats = this.game.getEconomyStats(player.id);
    if (econStats) {
      this.setRateEl(this.elFoodRate,  econStats.netProduction.food);
      this.setRateEl(this.elGoldRate,  econStats.netProduction.gold);
      this.setRateEl(this.elStoneRate, econStats.netProduction.stone);
    }

    // Low resource warnings — pulse the resource chip red
    this.elFood.closest('.res')?.classList.toggle('res-low', player.resources.food < 50);
    this.elGold.closest('.res')?.classList.toggle('res-low', player.resources.gold < 30);
    this.elStone.closest('.res')?.classList.toggle('res-low', player.resources.stone < 30);

    // Timer
    const secs = Math.floor(this.game.gameTime);
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    if (this.elTimer) this.elTimer.textContent = `${m}:${String(s).padStart(2, '0')}`;

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
      this.elSelCount.textContent = `${selectedUnits.length} unidades  ${parts}`;
    } else {
      this.unitPanel.classList.add('hidden');
      this.elSelCount.classList.add('hidden');
    }

    // Minimap units
    this.updateMinimap();
    this.updateScoreboard();
    this.updateObjectives();
    this.updatePowerButton();
    this.updateBuildingHpBars();
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

  private updateScoreboard() {
    const html = this.game.players.map(p => {
      const settle = this.game.allBuildings.find(
        b => b.playerId === p.id && b.type === BuildingType.SETTLEMENT,
      );
      const hpPct = settle?.isAlive() ? (settle.hp / settle.maxHp) * 100 : 0;
      const hpColor = hpPct > 50 ? '#22dd55' : hpPct > 25 ? '#ddaa00' : '#dd2222';
      const pop = p.aliveUnits.length;
      const label = p.isHuman ? '(Tú)' : CIV_NAMES[p.civType].slice(0, 6);
      return `<div class="sb-row">
        <span class="sb-emoji">${CIV_EMOJIS[p.civType]}</span>
        <span class="sb-name" style="color:${hex(CIV_COLORS[p.civType])}">${label}</span>
        <span class="sb-pop">👥${pop}</span>
        <div class="sb-hp-wrap"><div class="sb-hp-fill" style="width:${hpPct}%;background:${hpColor}"></div></div>
      </div>`;
    }).join('');
    this.elScoreboard.innerHTML = html;
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

    // XP bar (only if unit can still level up)
    const xpEl = document.getElementById('unit-xp-row');
    if (xpEl) {
      if (unit.level < 3) {
        const needed = unit.level === 1 ? 50 : 150;
        const xpPct  = Math.min(100, (unit.xp / needed) * 100);
        const stars  = unit.level === 1 ? '☆☆' : '★☆';
        xpEl.innerHTML =
          `<span class="xp-label">Nv.${unit.level} ${stars}</span>` +
          `<div class="xp-track"><div class="xp-fill" style="width:${xpPct}%"></div></div>` +
          `<span class="xp-num">${unit.xp}/${needed}</span>`;
        xpEl.classList.remove('hidden');
      } else {
        xpEl.innerHTML = `<span class="xp-label">★★ Máx.</span>`;
        xpEl.classList.remove('hidden');
      }
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
            this._lastSeenUnits.set(unit.id, { col: unit.col, row: unit.row });
          } else {
            continue; // don't draw in real position
          }
        }
        ctx.beginPath();
        ctx.arc(unit.col * tw + tw / 2, unit.row * th + th / 2, unitSize / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw last-seen ghost dots for enemy units now in fog
    for (const player of this.game.players) {
      if (player.id === this.game.humanPlayerId) continue;
      const col = CIV_COLORS[player.civType];
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = hex(col);
      for (const unit of player.aliveUnits) {
        if (!humanFog || humanFog.canSeeUnit(unit, this.game.humanPlayerId)) continue;
        const last = this._lastSeenUnits.get(unit.id);
        if (!last) continue;
        ctx.beginPath();
        ctx.arc(last.col * tw + tw / 2, last.row * th + th / 2, unitSize / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1.0;
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

  showHoverTooltip(unitId: number | null, buildingId: number | null, screenX: number, screenY: number) {
    const el = document.getElementById('hover-tooltip');
    if (!el) return;

    if (unitId === null && buildingId === null) {
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
      const status = !building.isComplete()
        ? `🔨 ${Math.round(building.buildProgress * 100)}% construido`
        : building.productionQueue?.length > 0
          ? `⚙️ Produciendo (${building.productionQueue.length} en cola)`
          : '✅ Inactivo';
      html = `
        <div class="ht-name">${building.def?.name ?? building.type}</div>
        <div class="ht-civ">${ownerLabel}</div>
        <div class="ht-hp-wrap"><div class="ht-hp-fill" style="width:${pct}%;background:${hpColor}"></div></div>
        <div class="ht-stats"><span>❤️${building.hp}/${building.maxHp}</span></div>
        <div class="ht-status">${status}</div>`;
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
  }
}
