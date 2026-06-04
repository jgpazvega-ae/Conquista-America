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
import { BuildingType } from './game/buildings';
import { TILE_SIZE } from './game/constants';

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
    civSelect.hide();
    narrative.play(civ, () => { void startGame(civ); });
  });
}

function showCivSelect(screen: CivSelectScreen, preferred: CivilizationType) {
  screen.show(preferred);
}

// ── Game lifecycle ─────────────────────────────────────────────────────────────
async function startGame(civ: CivilizationType) {
  const appEl = document.getElementById('app')!;
  appEl.classList.remove('hidden');

  if (activeGame) {
    activeGame.destroy();
    activeGame = null;
  }

  activeGame = new GameInstance(civ, saveSystem);
  await activeGame.init();
}

// ── GameInstance ───────────────────────────────────────────────────────────────
class GameInstance {
  private civ:        CivilizationType;
  private saveSystem: SaveSystem;
  private destroyed   = false;

  private game!:      Game;
  private renderer!:  Renderer;
  private camera!:    RTSCamera;
  private input!:     InputHandler;
  private touch!:     TouchHandler;
  private hud!:       HUD;
  private audio!:     AudioManager;
  private settings!:  SettingsPanel;
  private animId:     number = 0;
  private clock       = new THREE.Clock();
  private gameStartT  = Date.now();
  private killCount   = 0;
  private builtCount  = 0;
  private endHandled  = false;

  constructor(civ: CivilizationType, saveSystem: SaveSystem) {
    this.civ        = civ;
    this.saveSystem = saveSystem;
  }

  async init() {
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;

    // Override human player's civilization
    this.game     = new Game(this.civ);
    this.renderer = new Renderer(canvas);
    this.hud      = new HUD(this.game);
    this.camera   = new RTSCamera(this.renderer.camera);
    this.input    = new InputHandler(this.renderer, this.game, this.camera);
    this.touch    = new TouchHandler(this.camera, this.renderer, this.game);
    this.audio    = new AudioManager();
    this.settings = new SettingsPanel(this.saveSystem);

    this.input.onSelectionChange = () => {
      this.hud.update(this.input.getSelectedUnits());
      this.audio.playClick();
    };
    this.touch.onSelectionChange = () => this.hud.update(this.touch ? [] : []);
    this.input.onMoveOrder = () => this.audio.playMove();
    this.hud.onMinimapClick = (wx, wz) => this.camera.panTo(wx, wz);

    this.settings.onVolumeChange = (fx, mu) => {
      this.audio.setEffectsVolume(fx);
      this.audio.setMusicVolume(mu);
    };

    this.bindHUDButtons();
    this.bindMobileButtons();

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

    const dt = Math.min(this.clock.getDelta(), 0.1);

    this.game.update(dt);
    this.renderer.syncHeights(this.game.allUnits, this.game.allWorkers);
    this.camera.update(dt);
    this.renderer.updateEffects(dt);

    // Kill tracking
    const prevAlive = this.game.getAllUnits().filter(u => !u.isAlive() && u.playerId !== this.game.humanPlayerId).length;

    // Visual + audio effects on damage
    if (this.game.damageEvents.length > 0) {
      this.hud.showDamageNumbers(this.game.damageEvents);
      for (const evt of this.game.damageEvents) {
        this.renderer.effects.createHitEffect(evt.worldX, 0.5, evt.worldZ);
        if (evt.damage > 20) this.renderer.effects.createExplosion(evt.worldX, 0.5, evt.worldZ, evt.damage / 40);
        if (!evt.target.isAlive()) {
          this.audio.playDeath();
          if (evt.target.playerId !== this.game.humanPlayerId) this.killCount++;
        } else {
          this.audio.playHit(evt.damage / 30);
        }
      }
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
        <div class="endgame-stat-lbl">Bajas</div>
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
    civSelect.hide();
    await startGame(civ);
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
