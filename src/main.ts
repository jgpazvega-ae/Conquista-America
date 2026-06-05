import './styles.css';
import * as THREE from 'three';
import { CivilizationType } from './game/types';
import { SaveSystem } from './game/SaveSystem';
import { AuthScreen } from './ui/AuthScreen';
import { CivSelectScreen } from './ui/CivSelect';
import { NarrativeScreen } from './ui/Narrative';
import { SettingsPanel } from './ui/SettingsPanel';
import { Game } from './game/Game';
import { Renderer } from './engine/Renderer';
import { RTSCamera } from './engine/Camera';
import { InputHandler } from './engine/InputHandler';
import { TouchHandler } from './engine/TouchHandler';
import { HUD } from './ui/HUD';
import { AudioManager } from './engine/AudioManager';
import { ProductionPanel } from './ui/ProductionPanel';
import { TRAIN_COSTS } from './game/unitProduction';
import { BuildingType } from './game/buildings';
import { BUILDING_DEFS } from './game/buildingDefs';
import { TILE_SIZE, CIV_COLORS } from './game/constants';
import { findPath } from './game/Pathfinding';
import { WorkerTask } from './game/Worker';
import type { Difficulty } from './ui/CivSelect';

// ── Historical facts shown during loading ─────────────────────────────────────
const LOADING_FACTS = [
  'Los Aztecas llamaban a su ciudad Tenochtitlán, fundada en 1325 en un islote del lago Texcoco.',
  'El Imperio Inca o Tawantinsuyu se extendía 5,500 km por la costa occidental de Sudamérica.',
  'Los Mayas desarrollaron el único sistema de escritura completamente desarrollado de América precolombina.',
  'Hernán Cortés desembarcó en Veracruz el 22 de abril de 1519 con solo 500 soldados.',
  'Los Aztecas construyeron un acueducto de 4 km para llevar agua dulce a Tenochtitlán.',
  'El ejército Inca podía movilizar 80,000 guerreros gracias al sistema de caminos de 40,000 km.',
  'Francisco Pizarro capturó al Inca Atahualpa en 1532 con solo 168 soldados y un cañón.',
  'Los Mayas de Chichén Itzá construyeron el Templo de Kukulcán alrededor del año 900 d.C.',
  'Los guerreros Águila y Jaguar eran las órdenes militares más elite del Imperio Azteca.',
  'El Machu Picchu fue construido alrededor de 1450 d.C. a 2,430 metros de altura en los Andes.',
];

// ── App state ──────────────────────────────────────────────────────────────────
const saveSystem = new SaveSystem();
const narrative  = new NarrativeScreen();
let activeGame: GameInstance | null = null;

// ── Boot ───────────────────────────────────────────────────────────────────────
async function boot() {
  const authScreen    = new AuthScreen(saveSystem);
  const civSelect     = new CivSelectScreen(saveSystem);

  // If already logged in (remembered session), skip auth
  if (saveSystem.isLoggedIn()) {
    const sess = saveSystem.getSession()!;
    showCivSelect(civSelect, sess.civType);
  } else {
    authScreen.show();
    authScreen.setOnSuccess(() => {
      authScreen.hide();
      const sess = saveSystem.getSession();
      showCivSelect(civSelect, sess?.civType ?? CivilizationType.AZTEC);
    });
  }

  civSelect.setOnStart(async (civ) => {
    const diff = civSelect.getDifficulty();
    civSelect.hide();
    narrative.play(civ, () => { void startGame(civ, diff); });
  });
}

function showCivSelect(screen: CivSelectScreen, preferred: CivilizationType) {
  screen.show(preferred);
}

// ── Game lifecycle ─────────────────────────────────────────────────────────────
async function startGame(civ: CivilizationType, difficulty: Difficulty = 'normal') {
  const appEl = document.getElementById('app')!;
  appEl.classList.remove('hidden');

  if (activeGame) {
    activeGame.destroy();
    activeGame = null;
  }

  activeGame = new GameInstance(civ, saveSystem, difficulty);
  await activeGame.init();
}

// ── GameInstance ───────────────────────────────────────────────────────────────
class GameInstance {
  private civ:        CivilizationType;
  private saveSystem: SaveSystem;
  private difficulty: Difficulty;
  private destroyed   = false;

  private game!:      Game;
  private renderer!:  Renderer;
  private camera!:    RTSCamera;
  private input!:     InputHandler;
  private touch!:     TouchHandler;
  private hud!:       HUD;
  private audio!:     AudioManager;
  private prodPanel!: ProductionPanel;
  private settings!:  SettingsPanel;
  private animId:     number = 0;
  private clock       = new THREE.Clock();
  private gameStartT  = Date.now();
  private killCount   = 0;
  private builtCount  = 0;
  private endHandled  = false;
  private unitGroups    = new Map<number, number[]>();
  private _placingType: BuildingType | null = null;
  private _panelBuilding: import('./game/Building').Building | null = null;
  private _unitLevels           = new Map<number, number>();
  private _lastIdleWarnAt       = 0;
  private _lastSettlementWarnAt = 0;
  private _lastSettlementHp     = -1;
  private _enemyBuildingsDestroyed = 0;
  private _gameSpeed = 1.0;

  constructor(civ: CivilizationType, saveSystem: SaveSystem, difficulty: Difficulty = 'normal') {
    this.civ        = civ;
    this.saveSystem = saveSystem;
    this.difficulty = difficulty;
  }

  async init() {
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;

    // Override human player's civilization
    this.game     = new Game(this.civ);
    this.game.difficulty = this.difficulty;
    this.renderer = new Renderer(canvas);
    this.hud      = new HUD(this.game);
    this.camera   = new RTSCamera(this.renderer.camera);
    this.hud.setCamera(this.camera);
    this.input    = new InputHandler(this.renderer, this.game, this.camera);
    this.touch    = new TouchHandler(this.camera, this.renderer, this.game);
    this.audio     = new AudioManager();
    this.prodPanel = new ProductionPanel();
    this.settings  = new SettingsPanel(this.saveSystem);

    this.input.onSelectionChange = () => {
      this.hud.update(this.input.getSelectedUnits());
      this.audio.playClick();
      this.prodPanel.hide();
    };
    this.touch.onSelectionChange = () => this.hud.update(this.touch ? [] : []);
    this.input.onMoveOrder = () => this.audio.playMove();
    this.hud.onMinimapClick = (wx, wz) => this.camera.panTo(wx, wz);

    this.input.onRallySet = (col, row) => {
      if (this._panelBuilding?.isComplete()) {
        this._panelBuilding.setRally(col, row);
        this.hud.notify('📍 Punto de reunión establecido', 'info');
      }
    };

    this.input.onPatrolSet = () => {
      this.hud.notify('🔄 Patrulla establecida — Shift+clic der.', 'info');
    };

    this.input.onAttackMove = (units, col, row) => {
      const map = this.game.map;
      for (const [i, unit] of units.entries()) {
        const offset = [i % 3 - 1, Math.floor(i / 3)];
        const near   = map.findWalkableNear(col + offset[0], row + offset[1], 3);
        if (!near) continue;
        const path = findPath(map, unit.gridPos(), { col: near[0], row: near[1] }, 400);
        if (path.length > 0) unit.attackMove(path);
      }
      this.audio.playMove();
    };

    this.input.onBuildingClick = (buildingId) => {
      const building = this.game.getBuildingById(buildingId);
      if (!building || !building.isComplete()) return;
      if (building.playerId !== this.game.humanPlayerId) return;
      this._cancelPlacing();
      this._panelBuilding = building;
      this.prodPanel.show(building, this.game.humanPlayer);
      this.prodPanel.onTrain = (unitType) => {
        const cost = TRAIN_COSTS[unitType];
        if (!cost) return;
        const player = this.game.humanPlayer;
        if (player.aliveUnits.length >= this.game.getPopCap(player.id)) {
          this.hud.notify('👥 Límite de población alcanzado — construye un Almacén', 'warning');
          return;
        }
        if (player.resources.food  < cost.food)          return;
        if (player.resources.gold  < cost.gold)          return;
        if (player.resources.stone < (cost.stone ?? 0))  return;
        if (!building.trainUnit(unitType))                return;
        player.resources.food  -= cost.food;
        player.resources.gold  -= cost.gold;
        player.resources.stone -= cost.stone ?? 0;
        this.audio.playBuild();
        this.prodPanel.refresh();
      };
      this.prodPanel.onBuild = (btype) => {
        const def = BUILDING_DEFS[btype];
        this._placingType = btype;
        this.input.setPlacingMode(true);
        // Show ghost preview in civ color
        const civColor = this.game.humanPlayer.civType;
        this.renderer.showGhost(CIV_COLORS[civColor]);
        this.hud.notify(`🏗️ Coloca el ${def.name} — clic derecho para cancelar`, 'info');
      };
    };

    this.input.onTerrainHover = (col, row) => {
      if (this._placingType) this.renderer.updateGhostAt(col, row);
    };

    this.input.onTerrainClick = (col, row) => {
      if (!this._placingType) return;
      const btype = this._placingType;
      this._cancelPlacing();
      this.renderer.hideGhost();
      if (isNaN(col)) return; // right-click cancel
      const ok = this.game.placeBuilding(btype, col, row, this.game.humanPlayerId);
      if (ok) {
        const newB = this.game.allBuildings[this.game.allBuildings.length - 1];
        this.renderer.addBuilding(newB);
        this.builtCount++;
        this.audio.playBuild();
        const def = BUILDING_DEFS[btype];
        this.hud.notify(`✅ ${def.name} en construcción`, 'success');
      } else {
        this.hud.notify('❌ No puedes construir ahí', 'warning');
      }
    };

    this.settings.onVolumeChange = (fx, mu) => {
      this.audio.setEffectsVolume(fx);
      this.audio.setMusicVolume(mu);
    };

    this.bindHUDButtons();
    this.bindMobileButtons();
    this.bindKeyboardShortcuts();

    // Loading sequence
    this.showRandomFact();
    await loadingStep(10, 'Generando el mundo...');

    this.renderer.buildTerrain(this.game.map);
    await loadingStep(40, 'Construyendo civilizaciones...');

    for (const unit of this.game.getAllUnits()) this.renderer.addUnit(unit);
    for (const b    of this.game.allBuildings)  this.renderer.addBuilding(b);
    for (const w    of this.game.allWorkers)     this.renderer.addWorker(w);
    for (const n    of this.game.resourceNodes)  this.renderer.addResourceNode(n);
    await loadingStep(70, 'Desplegando tropas...');

    this.hud.buildMinimap(this.game.map);
    await loadingStep(95, 'Iniciando partida...');

    // Frame the human army: center on the centroid of all starting units
    const army = this.game.humanPlayer.aliveUnits;
    if (army.length > 0) {
      let sx = 0, sz = 0;
      for (const u of army) { sx += u.worldX; sz += u.worldZ; }
      this.camera.panTo(sx / army.length, sz / army.length);
    }

    // Enemy settlement objective marker
    const enemySettlement = this.game.allBuildings.find(
      b => b.playerId !== this.game.humanPlayerId && b.type === BuildingType.SETTLEMENT,
    );
    if (enemySettlement) {
      this.renderer.addObjectiveMarker(
        enemySettlement.col * TILE_SIZE,
        enemySettlement.row * TILE_SIZE,
      );
    }

    await loadingStep(100, '¡Que comience la conquista!');
    await sleep(400);
    this.hud.hideLoading();

    // Auto-hide controls hint
    setTimeout(() => {
      const hint = document.getElementById('controls-hint');
      if (hint) hint.style.opacity = '0';
    }, 12_000);

    this.loop();
  }

  private loop() {
    if (this.destroyed) return;
    this.animId = requestAnimationFrame(() => this.loop());

    const dt = Math.min(this.clock.getDelta(), 0.1) * this._gameSpeed;

    this.game.update(dt);

    // Register any units produced this frame
    for (const unit of this.game.newlySpawnedUnits) {
      this.renderer.addUnit(unit);
      if (unit.playerId === this.game.humanPlayerId) {
        this.audio.playBuild();
        this.hud.notify(`✅ ${unit.def.name} listo para combate`, 'success');
      }
    }

    // Register AI-placed buildings with renderer
    for (const b of this.game.newlyPlacedBuildings) {
      this.renderer.addBuilding(b);
    }

    // Notify when human buildings finish construction
    for (const b of this.game.newlyCompletedBuildings) {
      if (b.playerId === this.game.humanPlayerId) {
        this.audio.playBuild();
        const def = BUILDING_DEFS[b.type];
        this.hud.notify(`🏛️ ${def.name} completado`, 'success');
      }
    }

    // Track destroyed enemy buildings
    for (const b of this.game.newlyDestroyedBuildings) {
      this.audio.playBuildingDestroyed();
      if (b.playerId !== this.game.humanPlayerId) {
        this._enemyBuildingsDestroyed++;
        if (b.type === BuildingType.SETTLEMENT) {
          this.hud.notify('🏚️ ¡Asentamiento enemigo destruido!', 'success');
        } else {
          this.hud.notify('💥 Edificio enemigo destruido', 'success');
        }
      } else {
        if (b.type === BuildingType.SETTLEMENT) {
          this.hud.notify('💀 ¡Tu asentamiento ha sido destruido!', 'warning');
        } else {
          this.hud.notify('🔥 Tu edificio ha sido destruido', 'warning');
        }
      }
    }

    this.prodPanel.renderQueue();

    // Apply fog of war: hide enemy units/buildings outside vision
    const humanFog = this.game.fog.getFog(this.game.humanPlayerId);
    if (humanFog) {
      for (const unit of this.game.getAllUnits()) {
        if (unit.playerId === this.game.humanPlayerId) continue;
        unit.mesh.visible = unit.isAlive() && humanFog.canSeeUnit(unit, this.game.humanPlayerId);
      }
      for (const building of this.game.allBuildings) {
        if (building.playerId === this.game.humanPlayerId) continue;
        building.mesh.visible = building.isAlive() && humanFog.canSeeBuilding(building, this.game.humanPlayerId);
      }
    }

    this.renderer.syncHeights(this.game.allUnits, this.game.allWorkers);
    this.renderer.updateFog(this.game.fog, this.game.humanPlayerId);
    this.camera.update(dt);
    this.renderer.updateEffects(dt);

    // Kill tracking
    const prevAlive = this.game.getAllUnits().filter(u => !u.isAlive() && u.playerId !== this.game.humanPlayerId).length;

    // Visual + audio effects on damage
    if (this.game.damageEvents.length > 0) {
      this.hud.showDamageNumbers(this.game.damageEvents);
      let humanUnderAttack = false;
      for (const evt of this.game.damageEvents) {
        // Minimap combat ping
        this.hud.addCombatPing(evt.worldX / TILE_SIZE, evt.worldZ / TILE_SIZE);
        // Projectile for ranged attacks
        if (evt.attacker && evt.attacker.attackRange > 1.5) {
          const projColor = evt.attacker.attackRange > 3 ? 0xffcc44 : 0xddffcc;
          this.renderer.effects.createProjectile(
            evt.attacker.worldX, evt.attacker.worldZ,
            evt.worldX, evt.worldZ, projColor,
          );
          this.renderer.effects.createMuzzleFlash(evt.attacker.worldX, 0.6, evt.attacker.worldZ);
        }
        this.renderer.effects.createHitEffect(evt.worldX, 0.5, evt.worldZ);
        if (evt.damage > 20) this.renderer.effects.createExplosion(evt.worldX, 0.5, evt.worldZ, evt.damage / 40);
        if (!evt.target.isAlive()) {
          this.audio.playDeath();
          if (evt.target.playerId !== this.game.humanPlayerId) this.killCount++;
        } else {
          this.audio.playHit(evt.damage / 30);
          if (evt.target.playerId === this.game.humanPlayerId) humanUnderAttack = true;
        }
      }
      if (humanUnderAttack && Math.random() < 0.05) {
        this.hud.notify('⚔️ ¡Tus tropas están bajo ataque!', 'warning');
      }
    }

    // Level-up audio detection for human player units
    for (const u of this.game.humanPlayer.aliveUnits) {
      const prev = this._unitLevels.get(u.id) ?? 1;
      if (u.level > prev) {
        this.audio.playLevelUp();
        this.hud.notify(`⭐ ${u.def.name} subió al nivel ${u.level}`, 'success');
      }
      this._unitLevels.set(u.id, u.level);
    }

    // Idle worker warning: notify every 30 s of game time while workers are idle
    const humanWorkers = this.game.allWorkers.filter(w => w.playerId === this.game.humanPlayerId);
    const idleCount = humanWorkers.filter(w => (w.task as string) === 'IDLE').length;
    if (idleCount > 0 && this.game.gameTime - this._lastIdleWarnAt >= 30) {
      this._lastIdleWarnAt = this.game.gameTime;
      this.hud.notify(`⚠️ ${idleCount} trabajador${idleCount > 1 ? 'es' : ''} sin tarea`, 'warning');
    }

    // Settlement under attack warning
    const humanSettlement = this.game.allBuildings.find(
      b => b.playerId === this.game.humanPlayerId && b.type === BuildingType.SETTLEMENT,
    );
    if (humanSettlement) {
      if (this._lastSettlementHp >= 0 && humanSettlement.hp < this._lastSettlementHp &&
          this.game.gameTime - this._lastSettlementWarnAt >= 12) {
        this._lastSettlementWarnAt = this.game.gameTime;
        this.hud.notify('🔥 ¡Tu asentamiento está bajo ataque!', 'warning');
        this.audio.playHit(0.9);
      }
      this._lastSettlementHp = humanSettlement.hp;
    }

    this.hud.update(this.input.getSelectedUnits());
    this.renderer.render();

    // End game detection
    if (this.game.status !== 'PLAYING') {
      this.handleGameEnd();
    }
  }

  private handleGameEnd() {
    if (this.destroyed || this.endHandled) return;
    this.endHandled = true;

    const won = this.game.status === 'VICTORY';
    const seconds = Math.round((Date.now() - this.gameStartT) / 1000);
    this.saveSystem.recordGame(this.civ, won, this.killCount, this.builtCount, seconds);

    setTimeout(() => {
      if (won) {
        this.audio.playVictory();
      } else {
        this.audio.playDefeat();
      }
    }, 400);

    setTimeout(() => {
      this.showEndScreen(won, seconds);
    }, 1600);
  }

  private showEndScreen(won: boolean, seconds: number) {
    const screen = document.getElementById('endgame-screen')!;
    const icon   = document.getElementById('endgame-icon')!;
    const title  = document.getElementById('endgame-title')!;
    const sub    = document.getElementById('endgame-subtitle')!;
    const stats  = document.getElementById('endgame-stats')!;

    icon.textContent = won ? '🏆' : '☠️';
    title.textContent = won ? '¡VICTORIA!' : 'DERROTA';
    title.className = 'endgame-title ' + (won ? 'victory' : 'defeat');
    sub.textContent = won
      ? '¡Has conquistado el continente americano!'
      : 'Tus fuerzas han sido aniquiladas.';

    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    stats.innerHTML = `
      <div class="endgame-stat">
        <div class="endgame-stat-val">${m}:${String(s).padStart(2,'0')}</div>
        <div class="endgame-stat-lbl">Tiempo</div>
      </div>
      <div class="endgame-stat">
        <div class="endgame-stat-val">${this.killCount}</div>
        <div class="endgame-stat-lbl">Bajas enemigas</div>
      </div>
      <div class="endgame-stat">
        <div class="endgame-stat-val">${this._enemyBuildingsDestroyed}</div>
        <div class="endgame-stat-lbl">Edificios destruidos</div>
      </div>
      <div class="endgame-stat">
        <div class="endgame-stat-val">${this.builtCount}</div>
        <div class="endgame-stat-lbl">Edificios construidos</div>
      </div>
    `;

    // Particle burst
    if (won) this.spawnEndParticles();

    screen.classList.remove('hidden');

    document.getElementById('endgame-replay')?.addEventListener('click', () => {
      screen.classList.add('hidden');
      this.destroy();
      showRestartMenu();
    });
    document.getElementById('endgame-menu')?.addEventListener('click', () => {
      screen.classList.add('hidden');
      this.destroy();
      document.getElementById('app')!.classList.add('hidden');
      window.location.reload();
    });
  }

  private spawnEndParticles() {
    const container = document.getElementById('endgame-particles')!;
    const colors = ['#f0c060', '#ffdd44', '#e08020', '#ffe090', '#ffffff'];
    for (let i = 0; i < 60; i++) {
      const p = document.createElement('div');
      p.className = 'endgame-particle';
      p.style.left = `${Math.random() * 100}%`;
      p.style.top  = `${Math.random() * 100}%`;
      p.style.background = colors[Math.floor(Math.random() * colors.length)];
      p.style.setProperty('--px', `${(Math.random() - 0.5) * 300}px`);
      p.style.setProperty('--py', `${(Math.random() - 0.5) * 300}px`);
      p.style.animationDelay = `${Math.random() * 1.5}s`;
      p.style.animationDuration = `${2 + Math.random() * 2}s`;
      container.appendChild(p);
      setTimeout(() => p.remove(), 4000);
    }
  }

  private bindHUDButtons() {
    document.getElementById('settings-btn')?.addEventListener('click', () => {
      this.settings.show();
    });

    this.settings.onLogout = () => {
      this.settings.hide();
      this.destroy();
      document.getElementById('app')!.classList.add('hidden');
      window.location.reload();
    };

    // Controls overlay (? key or close button)
    const overlay = document.getElementById('controls-overlay');
    document.getElementById('controls-close')?.addEventListener('click', () => {
      overlay?.classList.add('hidden');
    });
    overlay?.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.add('hidden');
    });
  }

  private bindMobileButtons() {
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || window.innerWidth < 640;
    const bar = document.getElementById('mobile-actions');
    if (bar) bar.classList.toggle('hidden', !isMobile);

    document.getElementById('mob-stop')?.addEventListener('click', () => {
      for (const u of this.input.getSelectedUnits()) {
        u.state = 'IDLE' as any;
        u.path  = [];
        u.attackTarget = null;
      }
    });

    document.getElementById('mob-attack')?.addEventListener('click', () => {
      const sel = this.input.getSelectedUnits();
      if (sel.length === 0) return;
      const enemies = this.game.getAllUnits().filter(u => u.isAlive() && u.playerId !== this.game.humanPlayerId);
      if (enemies.length === 0) return;
      for (const u of sel) {
        let best = enemies[0];
        let bestD = u.distanceTo(best);
        for (const e of enemies) { const d = u.distanceTo(e); if (d < bestD) { bestD = d; best = e; } }
        u.attackUnit(best);
      }
    });

    document.getElementById('mob-desel')?.addEventListener('click', () => {
      for (const u of this.game.getAllUnits()) u.setSelected(false);
      this.hud.update([]);
    });
  }

  private bindKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      if (this.destroyed) return;
      // Escape: deselect all, close panels
      if (e.code === 'Escape') {
        if (this._placingType) { this._cancelPlacing(); return; }
        this.input.setAttackMoveMode(false);
        for (const u of this.game.getAllUnits()) u.setSelected(false);
        this._panelBuilding = null;
        this.prodPanel.hide();
        this.hud.update([]);
        return;
      }
      // P: toggle pause
      if (e.code === 'KeyP') {
        this.game.paused = !this.game.paused;
        const overlay = document.getElementById('pause-overlay');
        if (overlay) overlay.classList.toggle('hidden', !this.game.paused);
        return;
      }
      // Space: stop all selected units
      if (e.code === 'Space') {
        e.preventDefault();
        for (const u of this.input.getSelectedUnits()) {
          u.state = 'IDLE' as any;
          u.path = [];
          u.attackTarget = null;
        }
        return;
      }
      // F: focus camera on selected units (or all human units)
      if (e.code === 'KeyF') {
        const sel = this.input.getSelectedUnits();
        const army = sel.length > 0 ? sel : this.game.humanPlayer.aliveUnits;
        if (army.length > 0) {
          let sx = 0, sz = 0;
          for (const u of army) { sx += u.worldX; sz += u.worldZ; }
          this.camera.panTo(sx / army.length, sz / army.length);
        }
        return;
      }
      // Ctrl+A: select all human units
      if (e.code === 'KeyA' && e.ctrlKey) {
        e.preventDefault();
        for (const u of this.game.getAllUnits()) {
          u.setSelected(u.isAlive() && u.playerId === this.game.humanPlayerId);
        }
        this.hud.update(this.input.getSelectedUnits());
        return;
      }
      // A (no ctrl): attack-move mode
      if (e.code === 'KeyA' && !e.ctrlKey) {
        const sel = this.input.getSelectedUnits().filter(u => u.playerId === this.game.humanPlayerId);
        if (sel.length > 0) {
          this.input.setAttackMoveMode(true);
          this.hud.notify('⚔️ Attack-move: clic en el destino', 'info');
        }
        return;
      }
      // ?: toggle controls overlay
      if (e.key === '?' || e.code === 'Slash' && e.shiftKey) {
        const overlay = document.getElementById('controls-overlay');
        overlay?.classList.toggle('hidden');
        return;
      }
      // Q: auto-assign idle workers to nearest resource
      if (e.code === 'KeyQ' && !e.ctrlKey && !e.altKey) {
        this.autoAssignWorkers();
        return;
      }
      // + / = : speed up;  - : slow down
      if (e.key === '+' || e.key === '=') {
        this._gameSpeed = Math.min(3.0, parseFloat((this._gameSpeed + 0.5).toFixed(1)));
        this.hud.notify(`⏩ Velocidad ${this._gameSpeed}x`, 'info');
        return;
      }
      if (e.key === '-' || e.key === '_') {
        this._gameSpeed = Math.max(0.5, parseFloat((this._gameSpeed - 0.5).toFixed(1)));
        this.hud.notify(`⏪ Velocidad ${this._gameSpeed}x`, 'info');
        return;
      }
      // B: open build panel for human settlement
      if (e.code === 'KeyB' && !e.ctrlKey && !e.altKey) {
        const settlement = this.game.allBuildings.find(
          b => b.playerId === this.game.humanPlayerId &&
               b.type === BuildingType.SETTLEMENT &&
               b.isComplete(),
        );
        if (settlement) {
          this._panelBuilding = settlement;
          this.prodPanel.show(settlement, this.game.humanPlayer);
        }
        return;
      }
      // Ctrl+1-5: save unit group
      if (e.ctrlKey && /^Digit[1-5]$/.test(e.code)) {
        e.preventDefault();
        const n = parseInt(e.code.replace('Digit', ''));
        const sel = this.input.getSelectedUnits();
        this.unitGroups.set(n, sel.map(u => u.id));
        this.hud.notify(`Grupo ${n} guardado — ${sel.length} unidades`, 'info');
        return;
      }
      // 1-5 (no ctrl): recall unit group + center camera
      if (!e.ctrlKey && !e.altKey && /^Digit[1-5]$/.test(e.code)) {
        const n = parseInt(e.code.replace('Digit', ''));
        const ids = this.unitGroups.get(n);
        if (!ids?.length) return;
        for (const u of this.game.getAllUnits()) u.setSelected(false);
        const recalled: import('./game/Unit').Unit[] = [];
        for (const id of ids) {
          const u = this.game.getUnitById(id);
          if (u?.isAlive()) { u.setSelected(true); recalled.push(u); }
        }
        if (recalled.length > 0) {
          let sx = 0, sz = 0;
          for (const u of recalled) { sx += u.worldX; sz += u.worldZ; }
          this.camera.panTo(sx / recalled.length, sz / recalled.length);
        }
        this.hud.update(this.input.getSelectedUnits());
        return;
      }
    });
  }

  private _cancelPlacing() {
    this._placingType = null;
    this.input.setPlacingMode(false);
    this.renderer.hideGhost();
  }

  private autoAssignWorkers() {
    const map = this.game.map;
    const workers = this.game.allWorkers.filter(
      w => w.playerId === this.game.humanPlayerId && w.task === WorkerTask.IDLE,
    );
    if (workers.length === 0) {
      this.hud.notify('Todos los trabajadores están ocupados', 'info');
      return;
    }
    let assigned = 0;
    for (const worker of workers) {
      let nearestNode = null;
      let nearestDist = Infinity;
      for (const node of this.game.resourceNodes) {
        if (node.isEmpty()) continue;
        const d = Math.sqrt((worker.col - node.col) ** 2 + (worker.row - node.row) ** 2);
        if (d < nearestDist) { nearestDist = d; nearestNode = node; }
      }
      if (!nearestNode) continue;
      const path = findPath(map, { col: worker.col, row: worker.row }, { col: nearestNode.col, row: nearestNode.row }, 200);
      if (path.length > 0) {
        worker.path = path;
        worker.pathIndex = 0;
        worker.task = WorkerTask.MOVING;
        assigned++;
      }
    }
    if (assigned > 0) {
      this.hud.notify(`👷 ${assigned} trabajador${assigned > 1 ? 'es' : ''} enviado${assigned > 1 ? 's' : ''} a recolectar`, 'success');
      this.audio.playMove();
    }
  }

  private showRandomFact() {
    const el = document.getElementById('loading-fact');
    if (el) el.textContent = LOADING_FACTS[Math.floor(Math.random() * LOADING_FACTS.length)];
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.animId);
  }
}

function showRestartMenu() {
  document.getElementById('app')!.classList.add('hidden');
  const civSelect = new CivSelectScreen(saveSystem);
  civSelect.setOnStart(async (civ) => {
    const diff = civSelect.getDifficulty();
    civSelect.hide();
    await startGame(civ, diff);
  });
  const sess = saveSystem.getSession();
  civSelect.show(sess?.civType ?? CivilizationType.AZTEC);
}

async function loadingStep(pct: number, msg: string) {
  const bar = document.getElementById('loading-bar');
  const msgEl = document.getElementById('loading-msg');
  if (bar)   bar.style.width = `${pct}%`;
  if (msgEl) msgEl.textContent = msg;
  await sleep(80);
}

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

// ── Start ──────────────────────────────────────────────────────────────────────
boot().catch(err => {
  console.error(err);
  document.body.innerHTML = `
    <div style="position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#050202;color:#e8d5a0;font-family:sans-serif;padding:24px;text-align:center">
      <div style="font-size:48px;margin-bottom:16px">🌎</div>
      <div style="font-size:22px;font-weight:bold;margin-bottom:8px">Conquista América</div>
      <div style="color:#e74c3c;margin-bottom:16px">Error al iniciar el juego</div>
      <div style="font-size:13px;color:#888;max-width:400px;word-break:break-all">${err?.message ?? 'Error desconocido'}</div>
      <button onclick="location.reload()" style="margin-top:24px;padding:10px 24px;background:#c4820a;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:15px">🔄 Reintentar</button>
    </div>
  `;
});
