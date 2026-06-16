import './styles.css';
import * as THREE from 'three';
import { CivilizationType, UnitState, UnitType } from './game/types';
import { Unit } from './game/Unit';
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
import { ResourceType } from './game/ResourceNode';
import { findPath } from './game/Pathfinding';
import { WorkerTask } from './game/Worker';
import type { Difficulty } from './ui/CivSelect';
import { TECH_DEFS, TechType } from './game/Tech';
import { activateCivPower, CIV_POWER_DEFS } from './game/CivPowers';
import { AllianceType } from './game/Diplomacy';
import { CIVILIZATIONS } from './game/civilizations';

// ── Veteran names by civilization ─────────────────────────────────────────────
const CIV_VETERAN_NAMES: Record<CivilizationType, string[]> = {
  [CivilizationType.AZTEC]: [
    'Tlacaelel', 'Ahuizotl', 'Chimalli', 'Itzcoatl', 'Yolotl',
    'Tezca', 'Cuauhtimoc', 'Cipactli', 'Matlal', 'Xochitl',
    'Acolmiztli', 'Nezahualco', 'Eztli', 'Namacuix', 'Xiuhtecuhtli',
  ],
  [CivilizationType.MAYA]: [
    'K\'awiil', 'Siyaj Chan', 'Itzamnaaj', 'Chaahk', 'Pakal',
    'Balam', 'Hunac', 'Ek Chuah', 'Bolon', 'Camazotz',
    'Zipacna', 'Hunahpu', 'Ixbalanque', 'Kukulcán', 'Itzamkana',
  ],
  [CivilizationType.INCA]: [
    'Pachacútec', 'Quilaco', 'Tupac Rimaq', 'Sinchi Roca', 'Huáscar',
    'Yamqui', 'Ayar Manqo', 'Kusi Yupanqui', 'Rumi Ñawi', 'Puma Inca',
    'Qori Wayra', 'Atoc', 'Challco', 'Capac Yupanqui', 'Colla Tupac',
  ],
  [CivilizationType.CONQUISTADOR]: [
    'El Vencedor', 'El Fiero', 'El Invicto', 'Brazo de Hierro', 'El Valiente',
    'El Feroz', 'La Lanza', 'Mano Dura', 'El Audaz', 'El Implacable',
    'El Bravo', 'El Temible', 'El Fuerte', 'El Guerrero', 'El Infatigable',
  ],
};

// ── Choice event type ──────────────────────────────────────────────────────────
type ChoiceEventDef = {
  emoji: string;
  title: string;
  description: string;
  condition?: () => boolean;
  options: Array<{ label: string; detail: string; apply: () => void }>;
};

// ── Kill gold rewards ──────────────────────────────────────────────────────────
function killGoldReward(type: UnitType, isHero: boolean): number {
  if (isHero) return 30;
  const table: Partial<Record<UnitType, number>> = {
    [UnitType.CANNON]: 15,       [UnitType.CAVALRY]: 12,
    [UnitType.CUACHIC]: 10,      [UnitType.CHAKANA_GUARD]: 10,
    [UnitType.JAGUAR_KNIGHT]: 8, [UnitType.AHAU_WARRIOR]: 8,
    [UnitType.ATLATL]: 6,        [UnitType.SLINGER]: 6,
    [UnitType.ARCHER]: 6,        [UnitType.ARQUEBUSIER]: 7,
  };
  return table[type] ?? 5;
}

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
    const diff   = civSelect.getDifficulty();
    const numAI  = civSelect.getNumAI();
    civSelect.hide();
    narrative.play(civ, () => { startGame(civ, diff, numAI).catch(showFatalError); });
  });
}

function showCivSelect(screen: CivSelectScreen, preferred: CivilizationType) {
  screen.show(preferred);
}

// ── Error screen ──────────────────────────────────────────────────────────────
function showFatalError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[Conquista] Fatal init error:', err);
  // Hide loading overlay if still visible
  document.getElementById('loading-screen')?.classList.add('hidden');
  // Show a user-readable overlay instead of a black screen
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#0a0502;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;color:#e8d5a0;font-family:system-ui;padding:32px;text-align:center';
  overlay.innerHTML =
    `<div style="font-size:3rem">⚠️</div>` +
    `<div style="font-size:1.4rem;font-weight:700">Error al iniciar el juego</div>` +
    `<div style="font-size:0.9rem;color:#aa8866;max-width:480px">${msg}</div>` +
    `<div style="font-size:0.8rem;color:#666">Intenta recargar la página (F5). Si el problema persiste, tu navegador puede no soportar WebGL.</div>` +
    `<button onclick="location.reload()" style="margin-top:8px;padding:10px 28px;background:#c4780a;color:#fff;border:none;border-radius:8px;font-size:1rem;cursor:pointer">🔄 Recargar</button>`;
  document.body.appendChild(overlay);
}

// ── Game lifecycle ─────────────────────────────────────────────────────────────
async function startGame(civ: CivilizationType, difficulty: Difficulty = 'normal', numAI = 3) {
  // WebGL availability check — fail fast with a clear message
  const testCanvas = document.createElement('canvas');
  const gl = testCanvas.getContext('webgl2') ?? testCanvas.getContext('webgl');
  if (!gl) {
    throw new Error('WebGL no está disponible en este navegador o dispositivo. Intenta con Chrome, Firefox o Edge actualizados.');
  }

  const appEl = document.getElementById('app')!;
  appEl.classList.remove('hidden');

  if (activeGame) {
    activeGame.destroy();
    activeGame = null;
  }

  activeGame = new GameInstance(civ, saveSystem, difficulty, numAI);
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
  private _camBookmarks = new Map<number, { x: number; z: number }>(); // Shift+Ctrl+1-5 saves, Shift+1-5 recalls
  private _tradeCooldown = 0; // seconds until next manual trade
  private _placingType: BuildingType | null = null;
  private _panelBuilding: import('./game/Building').Building | null = null;
  private _unitLevels           = new Map<number, number>();
  private _lastIdleWarnAt       = 0;
  private _lastSettlementWarnAt = 0;
  private _lastSettlementHp     = -1;
  private _enemyBuildingsDestroyed = 0;
  private _gameSpeed = 1.0;
  private _fpsFrames = 0;
  private _fpsAccum  = 0;
  private _fpsDisplay = 0;
  private _idleUnitIdx = 0; // cycles through idle units on 'I' press
  private _unitsTrainedCount = 0;
  private _nextEventTime  = 120; // first random event after 2 min
  private _autoSaveTimer  = 180; // auto-checkpoint every 3 min of game time
  private _dustTimers = new Map<number, number>(); // unit.id → time since last dust puff
  private _totalResourcesSpent = 0; // food+gold+stone combined
  private _treasuryWarned75 = false; // notified player at 75% of economic victory
  private _buildingSmokeTimers = new Map<number, number>(); // building.id → seconds since last puff
  private _starvWarnTimer     = 0; // throttle starvation notifications (30s cooldown)
  private _ambushWarnTimer    = 0; // throttle jungle ambush notifications (30s cooldown)
  private _nightAttackTimer   = 0; // throttle night-attack notifications (60s cooldown)
  private _stoneCritWarnTimer  = 0; // throttle low-stone warnings (60s cooldown)
  private _goldCritWarnTimer   = 0; // throttle low-gold warnings (60s cooldown)
  private _chargeResistTimer   = 0; // throttle phalanx charge-resist notification (20s cooldown)
  private _idleArmyTimer       = 0; // time all human military units have been idle
  private _idleArmyCooldown    = 0; // prevents repeated reminders (120s between alerts)
  private _lowMoraleCooldown   = 0; // throttle army-wide low-morale warnings (45s)
  private _statusParticleTimers = new Map<number, number>(); // unit.id → time since last status particle
  private _wasNight = false;
  private _wasStorm = false;
  private _berserkUnits = new Set<number>(); // unit ids currently in berserk
  private _hintsShown = new Set<string>(); // one-time contextual tutorial hints
  private _advantageTimer   = 0;  // seconds player has held >65% military advantage
  private _advantageCooldown = 0; // prevents repeated "press the attack" alerts (90s)
  private _enemyDisarrayCooldown = 0; // prevents repeated enemy-disarray alerts (60s)
  private _flankWarnTimer       = 0; // throttle flanking warning notification (45s cooldown)
  private _grandBattleCooldown  = 0; // throttle "¡Gran Batalla!" notification (60s cooldown)
  private _powerReadyFired      = false; // true once power-ready alert fired this cycle
  private _spottedEnemyIds      = new Set<number>(); // unit IDs already seen once (first-sight tracking)
  private _enemyArmySpottedAt   = -999; // gameTime when last "enemy army spotted" fired
  private _cheatBuffer           = ''; // accumulates typed chars for cheat-code detection
  private _nextChoiceEventTime   = 240; // first interactive choice event at 4 min game-time
  private _choiceEventActive     = false;
  private _groupBarTimer         = 0;   // throttle live group-bar updates (0.5s interval)
  private _battleWindowKills     = 0;   // enemy kills in the current 30s analysis window
  private _battleWindowLosses    = 0;   // allied losses in the current 30s analysis window
  private _battleWindowTimer     = 0;   // > 0 while an analysis window is open
  private _battleReportCooldown  = 0;   // prevents consecutive reports (90s cooldown)
  private _mapPings: { worldX: number; worldZ: number; el: HTMLDivElement; expires: number }[] = [];
  private _killMilestonesReached = new Set<string>(); // `${unitId}-${milestone}` to fire once
  private _rapidKillTs:  number[] = []; // timestamps of recent enemy kills (for multi-kill detection)
  private _mkAnnouncerTimer = 0;        // countdown to remove multikill-announcer element
  private _baseAlertCooldown = 0; // seconds until next enemy-near-base notification
  private _lastStandFired    = false;   // true once Last Stand buff has been granted this match
  private _enemyBounties     = new Map<number, number>(); // enemyUnitId → kills against human player
  private _followOrders      = new Map<number, number>(); // followerUnitId → targetUnitId
  private _popCapWarnCooldown = 0; // seconds until next pop-cap warning

  /** Show a tutorial hint at most once per match. */
  private hintOnce(key: string, msg: string) {
    if (this._hintsShown.has(key)) return;
    this._hintsShown.add(key);
    this.hud.notify(msg, 'info');
  }

  private numAI: number;

  constructor(civ: CivilizationType, saveSystem: SaveSystem, difficulty: Difficulty = 'normal', numAI = 3) {
    this.civ        = civ;
    this.saveSystem = saveSystem;
    this.difficulty = difficulty;
    this.numAI      = numAI;
  }

  async init() {
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;

    // Override human player's civilization
    this.game = new Game(this.civ, { difficulty: this.difficulty, numAI: this.numAI });
    this.renderer = new Renderer(canvas);
    this.hud      = new HUD(this.game);
    this.camera   = new RTSCamera(this.renderer.camera);
    this.hud.setCamera(this.camera);
    this.hud.setRenderer(this.renderer);
    this.input    = new InputHandler(this.renderer, this.game, this.camera);
    this.touch    = new TouchHandler(this.camera, this.renderer, this.game);
    this.audio     = new AudioManager();
    this.prodPanel = new ProductionPanel();
    this.settings  = new SettingsPanel(this.saveSystem);

    this.input.onSelectionChange = () => {
      const sel = this.input.getSelectedUnits();
      this.hud.update(sel);
      this.audio.playClick();
      this.prodPanel.hide();
      // Path dots for single selected moving unit
      this.renderer.clearUnitPath();
      if (sel.length === 1 && sel[0].state === UnitState.MOVING && sel[0].path.length > sel[0].pathIndex) {
        this.renderer.showUnitPath(sel[0].path, sel[0].pathIndex);
      }
      // Attack range ring for single selected unit
      this.renderer.clearRangeRing();
      if (sel.length === 1) {
        const u = sel[0];
        const rangeWorld = u.attackRange * TILE_SIZE;
        const color = u.attackRange > 1.5 ? 0x88ccff : 0xffcc44; // blue for ranged, gold for melee
        this.renderer.showRangeRing(u.worldX, u.worldZ, rangeWorld, color);
      }
      // Patrol path for single patrolling unit
      this.renderer.clearPatrolPath();
      if (sel.length === 1 && sel[0].patrolA && sel[0].patrolB) {
        const u = sel[0];
        this.renderer.showPatrolPath(
          u.patrolA!.col * TILE_SIZE, u.patrolA!.row * TILE_SIZE,
          u.patrolB!.col * TILE_SIZE, u.patrolB!.row * TILE_SIZE,
        );
      }
    };
    this.touch.onSelectionChange = () => this.hud.update(this.touch ? [] : []);
    this.input.onMoveOrder = () => {
      // Cancel follow orders for all selected units that got a new move command
      for (const u of this.input.getSelectedUnits()) this._followOrders.delete(u.id);
      this.audio.playMove();
      // Re-draw path dots shortly after move order (path is computed async)
      setTimeout(() => {
        const sel = this.input.getSelectedUnits();
        this.renderer.clearUnitPath();
        if (sel.length === 1 && sel[0].path.length > 0) {
          this.renderer.showUnitPath(sel[0].path, sel[0].pathIndex);
        }
      }, 80);
    };
    this.hud.onMinimapClick = (wx, wz) => this.camera.panTo(wx, wz);
    this.hud.onMinimapRightClick = (wx: number, wz: number) => {
      const myUnits = this.input.getSelectedUnits().filter((u: import('./game/Unit').Unit) => u.playerId === this.game.humanPlayerId && u.isAlive());
      if (myUnits.length === 0) { this.camera.panTo(wx, wz); return; }
      const tCol = Math.round(wx / TILE_SIZE);
      const tRow = Math.round(wz / TILE_SIZE);
      const near = this.game.map.findWalkableNear(tCol, tRow, 4);
      if (!near) return;
      const cx = myUnits.reduce((s: number, u: import('./game/Unit').Unit) => s + u.col, 0) / myUnits.length;
      const cz = myUnits.reduce((s: number, u: import('./game/Unit').Unit) => s + u.row, 0) / myUnits.length;
      let moved = 0;
      myUnits.forEach((unit: import('./game/Unit').Unit, idx: number) => {
        const spread = myUnits.length > 1 ? [Math.round(unit.col - cx), Math.round(unit.row - cz)] : [0, 0];
        const destCol = Math.max(0, Math.min(this.game.map.cols - 1, near[0] + spread[0]));
        const destRow = Math.max(0, Math.min(this.game.map.rows - 1, near[1] + spread[1]));
        const dest = this.game.map.findWalkableNear(destCol, destRow, 3) ?? near;
        const path = findPath(this.game.map, unit.gridPos(), { col: dest[0], row: dest[1] }, 400);
        if (path.length > 0) { unit.moveTo(path); moved++; }
      });
      if (moved > 0) {
        this.audio.playMove();
        this.camera.panTo(wx, wz);
      }
    };

    this.input.onRallySet = (col, row) => {
      if (this._panelBuilding?.isComplete()) {
        this._panelBuilding.setRally(col, row);
        this.renderer.setRallyMarker(col, row);
        this.hud.notify('📍 Punto de reunión establecido', 'info');
      }
    };

    this.input.onPatrolSet = () => {
      this.hud.notify('🔄 Patrulla establecida — Shift+clic der.', 'info');
    };

    this.input.onGarrisonOrder = (count) => {
      this.hud.notify(`🏰 ${count} unidad${count > 1 ? 'es' : ''} hacia la guarnición — pulsa U para desalojar`, 'info');
      this.audio.playMove();
    };

    this.input.onCaptureOrder = (count) => {
      this.hud.notify(`🚩 ${count} unidad${count > 1 ? 'es' : ''} a la captura — mantenlas junto al edificio`, 'info');
      this.audio.playMove();
    };

    this.input.onFollowUnit = (followers, target) => {
      for (const u of followers) this._followOrders.set(u.id, target.id);
      const n = followers.length;
      this.hud.notify(`🔗 ${n} unidad${n !== 1 ? 'es' : ''} siguiendo a ${target.def.name} — clic der. en terreno para cancelar`, 'info');
      this.audio.playMove();
    };

    this.hud.onPowerActivate = () => this.triggerCivPower();

    this.hud.onGroupStop = () => {
      for (const u of this.input.getSelectedUnits()) {
        u.state = UnitState.IDLE;
        u.path  = [];
        u.attackTarget = null;
      }
    };

    this.hud.onGroupHold = () => {
      const sel = this.input.getSelectedUnits().filter(u => u.playerId === this.game.humanPlayerId);
      if (sel.length === 0) return;
      const allHold = sel.every(u => u.state === UnitState.HOLD);
      for (const u of sel) {
        u.path = [];
        u.attackTarget = null;
        u.state = allHold ? UnitState.IDLE : UnitState.HOLD;
      }
      this.hud.notify(allHold ? '🏃 Posición liberada' : '🛡️ Posición de defensa activada', 'info');
    };

    this.hud.onGroupRetreat = () => {
      const home = this.game.allBuildings.find(
        b => b.playerId === this.game.humanPlayerId && b.isAlive() && b.isComplete() && b.type === BuildingType.SETTLEMENT,
      );
      if (!home) return;
      let n = 0;
      for (const u of this.input.getSelectedUnits().filter(u => u.playerId === this.game.humanPlayerId && u.isAlive())) {
        u.attackTarget = null;
        const near = this.game.map.findWalkableNear(home.col, home.row, 5);
        if (!near) continue;
        const path = findPath(this.game.map, u.gridPos(), { col: near[0], row: near[1] }, 300);
        if (path.length > 0) { u.moveTo(path); n++; }
      }
      if (n > 0) {
        this.hud.notify(`🏃 ${n} unidad${n > 1 ? 'es' : ''} en retirada`, 'info');
        this.audio.playMove();
      }
    };

    // Unit action-bar callbacks (mirror keyboard shortcuts)
    this.hud.onUnitHold = () => {
      const sel = this.input.getSelectedUnits().filter(u => u.playerId === this.game.humanPlayerId);
      if (sel.length === 0) return;
      const allHold = sel.every(u => u.state === UnitState.HOLD);
      for (const u of sel) { u.path = []; u.attackTarget = null; u.state = allHold ? UnitState.IDLE : UnitState.HOLD; }
      this.hud.notify(allHold ? '🏃 Posición liberada' : '🛡️ ¡Posición de defensa! (+2 defensa)', 'info');
    };
    this.hud.onUnitEntrench = () => {
      const sel = this.input.getSelectedUnits().filter(u => u.playerId === this.game.humanPlayerId && u.isAlive());
      if (sel.length === 0) return;
      const willEntrench = !sel.every(u => u.entrenched);
      for (const u of sel) { if (willEntrench && u.entrenched) continue; u.entrench(); }
      this.hud.notify(willEntrench ? `🏕️ ${sel.length} unidad${sel.length > 1 ? 'es' : ''} atrincherada${sel.length > 1 ? 's' : ''} — +7 def total` : '🏕️ Posición abandonada', 'info');
    };
    this.hud.onUnitVolley = () => {
      const ranged = this.input.getSelectedUnits().filter(u => u.ammo > 0 && u.attackTarget?.isAlive());
      if (ranged.length > 0) {
        for (const u of ranged) u.volleyReady = true;
        this.hud.notify(`🔫 ¡DESCARGA! ${ranged.length} unidad${ranged.length > 1 ? 'es' : ''} — daño ×2.5`, 'warning');
        this.audio.playShot();
      } else {
        this.hud.notify('🔫 Selecciona un objetivo enemigo primero para la descarga', 'info');
      }
    };
    this.hud.onUnitWarCry = () => {
      const hero = this.input.getSelectedUnits().find(u => u.isHero && u.isAlive())
                ?? this.game.humanPlayer.aliveUnits.find(u => u.isHero && u.isAlive());
      if (!hero) return;
      if (hero.warCryCooldown > 0) {
        this.hud.notify(`📯 Recarga: ${Math.ceil(hero.warCryCooldown)}s`, 'info');
      } else {
        const count = hero.triggerWarCry(this.game.humanPlayer.aliveUnits);
        if (count > 0) {
          this.hud.notify(`📯 ¡GRITO DE GUERRA! ${count} unidad${count > 1 ? 'es' : ''} +25% atk 12s`, 'success');
          this.audio.playLevelUp();
        }
      }
    };
    this.hud.onUnitHeroPower = () => {
      const hero = this.input.getSelectedUnits().find(u => u.isHero && u.isAlive())
                ?? this.game.humanPlayer.aliveUnits.find(u => u.isHero && u.isAlive());
      if (!hero) return;
      if (hero.heroCooldown2 > 0) {
        this.hud.notify(`🦅 Habilidad del héroe — recarga: ${Math.ceil(hero.heroCooldown2)}s`, 'info');
        return;
      }
      // Simulate pressing H — reuse existing H-key handler by dispatching a synthetic event
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyH', bubbles: true }));
    };
    this.hud.onFormation = (type) => {
      const sel = this.input.getSelectedUnits().filter(u => u.isAlive());
      if (sel.length === 0) return;
      for (const u of sel) u.setFormation(type as any);
      const labels: Record<string, string> = {
        LOOSE: '💨 Formación suelta — veloz, frágil',
        PHALANX: '🛡️ Falange — máxima defensa',
        WEDGE: '⚔️ Cuña — máximo ataque',
      };
      this.hud.notify(type ? labels[type] ?? '' : 'Formación libre', 'info');
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
      // Formation march: advance at the pace of the slowest member
      if (units.length > 1) {
        const minSpeed = Math.min(...units.map(u => u.speed));
        for (const u of units) {
          if (u.state === UnitState.ATTACK_MOVE) u.formationSpeedCap = minSpeed;
        }
      }
      this.audio.playMove();
    };

    this.input.onBuildingClick = (buildingId) => {
      const building = this.game.getBuildingById(buildingId);
      if (!building || !building.isComplete()) return;

      // Neutral village: offer alliance
      if (building.type === BuildingType.VILLAGE && building.playerId < 0) {
        if (this.game.allianceVillages.has(building.id)) {
          this.hud.notify('🤝 Ya tienes alianza con esta aldea — recibirás guerreros cada 90s', 'info');
        } else {
          this._showVillageAlliancePrompt(building.id);
        }
        return;
      }

      if (building.playerId !== this.game.humanPlayerId) return;
      this._cancelPlacing();
      this._panelBuilding = building;
      // Show attack range ring for watchtowers
      this.renderer.clearRangeRing();
      if (building.type === BuildingType.WATCHTOWER) {
        const wx = building.col * TILE_SIZE;
        const wz = building.row * TILE_SIZE;
        this.renderer.showRangeRing(wx, wz, 5.5 * TILE_SIZE, 0xff4444);
      }
      this.prodPanel.playerEra = this.game.getEra(this.game.humanPlayerId);
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
        if (player.resources.wood  < (cost.wood  ?? 0))  return;
        if (!building.trainUnit(unitType))                return;
        player.resources.food  -= cost.food;
        player.resources.gold  -= cost.gold;
        player.resources.stone -= cost.stone ?? 0;
        player.resources.wood  -= cost.wood  ?? 0;
        this._totalResourcesSpent += cost.food + cost.gold + (cost.stone ?? 0) + (cost.wood ?? 0);
        this.audio.playBuild();
        this.prodPanel.refresh();
      };
      this.prodPanel.onUpgrade = (key) => {
        const ok = this.game.applyUpgrade(key, this.game.humanPlayerId);
        if (ok) {
          const civTechNames: Record<CivilizationType, string> = {
            [CivilizationType.AZTEC]:        '🐆 Élite Jaguar',
            [CivilizationType.INCA]:         '🛤️ Caminos del Inca',
            [CivilizationType.MAYA]:         '🔭 Observatorio Maya',
            [CivilizationType.CONQUISTADOR]: '💣 Pólvora Avanzada',
          };
          const names: Record<string, string> = {
            metallurgy:    'Metalurgia',
            logistics:     'Logística',
            fortification: 'Fortificación',
            civTech:       civTechNames[this.game.humanPlayer.civType],
          };
          const benefits: Record<string, string> = {
            metallurgy:    '+6⚔️ ataque a todas las unidades',
            logistics:     '+0.4💨 velocidad a todas las unidades',
            fortification: '+50❤️ HP máximo a todas las unidades',
            civTech:       'élite desbloqueada — mejora de civilización única',
          };
          this.hud.notify(`🔬 ${names[key]} investigada — ${benefits[key] ?? 'beneficio aplicado'}`, 'success');
          this.audio.playResearchComplete();
          this.prodPanel.refresh();
        }
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
      this.prodPanel.onCancelProduction = () => {
        const b = this._panelBuilding;
        if (!b) return;
        const item = b.cancelCurrentProduction();
        if (!item) return;
        const cost = TRAIN_COSTS[item.unitType];
        if (cost) {
          const refFood  = Math.floor(cost.food  * 0.75);
          const refGold  = Math.floor(cost.gold  * 0.75);
          const refStone = Math.floor((cost.stone ?? 0) * 0.75);
          const p = this.game.humanPlayer;
          p.resources.food  = Math.min(2000, p.resources.food  + refFood);
          p.resources.gold  = Math.min(2000, p.resources.gold  + refGold);
          p.resources.stone = Math.min(2000, p.resources.stone + refStone);
          const parts = [refFood ? `+${refFood}🌽` : '', refGold ? `+${refGold}⚜️` : '', refStone ? `+${refStone}🪨` : ''].filter(Boolean).join(' ');
          this.hud.notify(`✕ Producción cancelada — reembolso: ${parts}`, 'info');
        }
        this.prodPanel.refresh();
      };
      this.prodPanel.onDemolish = () => {
        const b = this._panelBuilding;
        if (!b || !b.isAlive()) return;
        const def = BUILDING_DEFS[b.type as BuildingType];
        const refFood = Math.floor((def?.cost.food ?? 0) * 0.25);
        const refGold = Math.floor((def?.cost.gold ?? 0) * 0.25);
        b.takeDamage(b.maxHp * 2); // guaranteed kill
        this.game.humanPlayer.resources.food = Math.min(2000, this.game.humanPlayer.resources.food + refFood);
        this.game.humanPlayer.resources.gold = Math.min(2000, this.game.humanPlayer.resources.gold + refGold);
        this.prodPanel.hide();
        this._panelBuilding = null;
        this.hud.notify(`🔥 Edificio demolido — recuperados ${refFood}🌽 ${refGold}⚜️`, 'warning');
        this.audio.playBuild();
      };
      this.prodPanel.onScorchedEarth = () => {
        const b = this._panelBuilding;
        if (!b) return;
        const ok = this.game.scorchedEarth(b.id, this.game.humanPlayerId);
        if (ok) {
          this.hud.notify('🔥 Tierra quemada — edificio gravemente dañado para negar al enemigo', 'warning');
          this.prodPanel.hide();
          this._panelBuilding = null;
        }
      };

      this.prodPanel.onHireMercenary = () => {
        const b = this._panelBuilding;
        if (!b) return;
        if (this.game.humanPlayer.resources.gold < 80) {
          this.hud.notify('⚜️ Necesitas 80 de oro para contratar un mercenario', 'warning');
          return;
        }
        const ok = this.game.hireMercenary(b, this.game.humanPlayerId);
        if (ok) {
          this.prodPanel.refresh();
          this.audio.playBuild();
        } else {
          this.hud.notify('👥 Límite de población alcanzado o sin recursos', 'warning');
        }
      };
      this.prodPanel.onResearchTech = (tech) => {
        const ok = this.game.startTechResearch(tech, this.game.humanPlayerId);
        if (ok) {
          this.prodPanel.refresh();
          this.audio.playBuild();
          const def = TECH_DEFS[tech];
          this.hud.notify(`🔬 Investigando: ${def?.name ?? tech}`, 'info');
        } else {
          this.hud.notify('⚜️ Sin recursos suficientes o ya investigado', 'warning');
        }
      };

      this.prodPanel.onMarketTrade = (resource, sellAmt, goldGain) => {
        const ok = this.game.executeMarketTrade(this.game.humanPlayerId, resource, sellAmt, goldGain);
        if (ok) {
          this.prodPanel.refresh();
          const emoji = resource === 'food' ? '🌽' : resource === 'wood' ? '🪵' : '🪨';
          this.hud.notify(`🏪 Intercambio: -${sellAmt}${emoji} +${goldGain}⚜️`, 'info');
        } else {
          this.hud.notify('🏪 Recursos insuficientes para el intercambio', 'warning');
        }
      };

      this.prodPanel.onMarketBuy = (resource, goldCost, buyAmt) => {
        const ok = this.game.executeMarketBuy(this.game.humanPlayerId, resource, goldCost, buyAmt);
        if (ok) {
          this.prodPanel.refresh();
          const emoji = resource === 'food' ? '🌽' : resource === 'wood' ? '🪵' : '🪨';
          this.hud.notify(`🏪 Compra: -${goldCost}⚜️ +${buyAmt}${emoji}`, 'info');
        } else {
          this.hud.notify('🏪 Oro insuficiente para la compra', 'warning');
        }
      };

      this.prodPanel.onTrainWorker = () => {
        const WORKER_COST = { food: 80, gold: 30 };
        const player = this.game.humanPlayer;
        if (player.resources.food < WORKER_COST.food || player.resources.gold < WORKER_COST.gold) {
          this.hud.notify('👷 Recursos insuficientes para entrenar trabajador', 'warning');
          return;
        }
        if (building.trainWorker(18)) {
          player.resources.food -= WORKER_COST.food;
          player.resources.gold -= WORKER_COST.gold;
          this.audio.playBuild();
          this.prodPanel.refresh();
        }
      };
    };

    this.input.onTerrainHover = (col, row) => {
      if (this._placingType) {
        const valid = this.game.map.isWalkable(col, row);
        this.renderer.updateGhostAt(col, row, valid);
      }
    };

    this.input.onHover = (unitId, buildingId, x, y, tileCol, tileRow) => {
      this.hud.showHoverTooltip(unitId, buildingId, x, y, tileCol, tileRow, this.game.map);
    };
    this.input.onMapPing = (worldX, worldZ) => this.createMapPing(worldX, worldZ);

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
    this._bindAIDiploButtons();
    this._bindVillageAllianceButtons();
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

    const rawDt = Math.min(this.clock.getDelta(), 0.1);
    const dt = rawDt * this._gameSpeed;

    this.updateFpsCounter(rawDt);
    if (this._tradeCooldown > 0) this._tradeCooldown = Math.max(0, this._tradeCooldown - rawDt);
    if (this._starvWarnTimer    > 0) this._starvWarnTimer    = Math.max(0, this._starvWarnTimer    - rawDt);
    if (this._ambushWarnTimer   > 0) this._ambushWarnTimer   = Math.max(0, this._ambushWarnTimer   - rawDt);
    if (this._nightAttackTimer  > 0) this._nightAttackTimer  = Math.max(0, this._nightAttackTimer  - rawDt);
    if (this._stoneCritWarnTimer  > 0) this._stoneCritWarnTimer  = Math.max(0, this._stoneCritWarnTimer  - rawDt);
    if (this._goldCritWarnTimer   > 0) this._goldCritWarnTimer   = Math.max(0, this._goldCritWarnTimer   - rawDt);
    if (this._chargeResistTimer   > 0) this._chargeResistTimer   = Math.max(0, this._chargeResistTimer   - rawDt);
    if (this._idleArmyCooldown    > 0) this._idleArmyCooldown    = Math.max(0, this._idleArmyCooldown    - rawDt);
    if (this._lowMoraleCooldown   > 0) this._lowMoraleCooldown   = Math.max(0, this._lowMoraleCooldown   - rawDt);
    if (this._advantageCooldown    > 0) this._advantageCooldown    = Math.max(0, this._advantageCooldown    - rawDt);
    if (this._enemyDisarrayCooldown > 0) this._enemyDisarrayCooldown = Math.max(0, this._enemyDisarrayCooldown - rawDt);
    if (this._flankWarnTimer       > 0) this._flankWarnTimer       = Math.max(0, this._flankWarnTimer       - rawDt);
    if (this._grandBattleCooldown  > 0) this._grandBattleCooldown  = Math.max(0, this._grandBattleCooldown  - rawDt);
    if (this._baseAlertCooldown    > 0) this._baseAlertCooldown    = Math.max(0, this._baseAlertCooldown    - rawDt);
    if (this._popCapWarnCooldown   > 0) this._popCapWarnCooldown   = Math.max(0, this._popCapWarnCooldown   - rawDt);
    if (this._mkAnnouncerTimer     > 0) {
      this._mkAnnouncerTimer = Math.max(0, this._mkAnnouncerTimer - rawDt);
      if (this._mkAnnouncerTimer === 0) {
        const el = document.getElementById('multikill-announcer');
        if (el) {
          el.classList.add('mk-exit');
          setTimeout(() => el.classList.add('hidden'), 500);
        }
      }
    }
    this.game.update(dt);

    // Register any units produced this frame
    for (const unit of this.game.newlySpawnedUnits) {
      this.renderer.addUnit(unit);
      if (unit.playerId === this.game.humanPlayerId) {
        this.audio.playTrainingComplete();
        this._unitsTrainedCount++;
        this.hud.notify(`✅ ${unit.def.name} listo para combate`, 'success');
      }
    }

    // Resource node depletion alerts
    for (const node of this.game.newlyDepletedNodes) {
      const fog = this.game.fog.getFog(this.game.humanPlayerId);
      const vis = fog ? fog.getVisibility(node.col, node.row) : 1;
      if (vis === 0 /* UNEXPLORED */) continue;
      // Only alert if the player's own workers are gathering here — avoids spam for
      // distant/enemy nodes the player doesn't care about
      const myWorkersHere = this.game.allWorkers.some(w =>
        w.playerId === this.game.humanPlayerId &&
        Math.abs(w.col - node.col) <= 2 && Math.abs(w.row - node.row) <= 2,
      );
      if (myWorkersHere) {
        this.audio.playResourceDepleted();
        const typeLabel = node.type === ResourceType.FOOD ? 'Alimentos' : node.type === ResourceType.GOLD ? 'Oro' : 'Piedra';
        this.hud.notify(`⚠️ Yacimiento de ${typeLabel} agotado — reasigna tus trabajadores (Q)`, 'warning');
      }
    }

    // Notify when a resource node regenerates and is visible
    for (const node of this.game.newlyRegeneratedNodes) {
      const fog = this.game.fog.getFog(this.game.humanPlayerId);
      const vis = fog ? fog.getVisibility(node.col, node.row) : 1;
      if (vis === 2 /* VISIBLE */) {
        const typeLabel = node.type === ResourceType.FOOD ? 'Alimentos' : node.type === ResourceType.GOLD ? 'Oro' : 'Piedra';
        this.hud.notify(`🌱 Yacimiento de ${typeLabel} regenerado`, 'success');
      }
    }

    // Register AI-placed buildings with renderer
    for (const b of this.game.newlyPlacedBuildings) {
      this.renderer.addBuilding(b);
      // Warn player when an AI starts building a wonder
      if (b.playerId !== this.game.humanPlayerId && b.type === BuildingType.WONDER) {
        this.hud.notify('⚠️ ¡El enemigo empieza a construir una Gran Maravilla! ¡Destrúyela antes de que termine!', 'warning');
        this.camera.shake(0.3, 0.5);
      }
    }

    // Notify when human buildings finish construction
    for (const b of this.game.newlyCompletedBuildings) {
      if (b.playerId === this.game.humanPlayerId) {
        this.audio.playBuild();
        const def = BUILDING_DEFS[b.type];
        const wx = b.col * TILE_SIZE;
        const wz = b.row * TILE_SIZE;
        if (b.type === BuildingType.WONDER) {
          // Wonder completion: grand celebration
          this.hud.notify(`🏛️ ¡${def.name} completada! ¡Defiéndela 3 minutos!`, 'success');
          this.camera.panTo(wx, wz);
          this.camera.shake(0.6, 0.8);
          this.renderer.effects.createExplosion(wx, 0.6, wz, 2.0);
          this.renderer.effects.createDustCloud(wx, wz);
          this.renderer.effects.createLevelUpBurst(wx, 1.5, wz);
          this.audio.playVictory();
        } else {
          this.hud.notify(`🏛️ ${def.name} completado`, 'success');
          this.renderer.effects.createExplosion(wx, 0.6, wz, 0.7);
          this.renderer.effects.createDustCloud(wx, wz);
        }
      } else {
        // Enemy wonder completed — dramatic warning
        if (b.type === BuildingType.WONDER) {
          const def = BUILDING_DEFS[b.type];
          this.hud.notify(`⚠️ ¡El enemigo completó ${def.name}! ¡Destrúyela antes de 3 minutos o perderás!`, 'warning');
          this.camera.shake(0.6, 1.0);
          this.renderer.effects.createExplosion(b.col * TILE_SIZE, 0.6, b.row * TILE_SIZE, 1.5);
          this.audio.playVictory();
        }
      }
    }

    // Track destroyed enemy buildings
    for (const b of this.game.newlyDestroyedBuildings) {
      this.audio.playBuildingDestroyed();
      this.camera.shake(b.type === BuildingType.SETTLEMENT ? 0.55 : 0.30, 0.45);
      if (b.playerId !== this.game.humanPlayerId) {
        this._enemyBuildingsDestroyed++;
        // Loot: award 20% of building cost to human player
        const def = BUILDING_DEFS[b.type];
        const lootFood  = Math.round(def.cost.food  * 0.2);
        const lootGold  = Math.round(def.cost.gold  * 0.2);
        const lootStone = Math.round(def.cost.stone * 0.2);
        const p = this.game.humanPlayer;
        p.resources.food  = Math.min(2000, p.resources.food  + lootFood);
        p.resources.gold  = Math.min(2000, p.resources.gold  + lootGold);
        p.resources.stone = Math.min(2000, p.resources.stone + lootStone);
        const lootParts: string[] = [];
        if (lootFood  > 0) lootParts.push(`+${lootFood}🌽`);
        if (lootGold  > 0) lootParts.push(`+${lootGold}⚜️`);
        if (lootStone > 0) lootParts.push(`+${lootStone}🪨`);
        if (b.type === BuildingType.SETTLEMENT) {
          this.hud.notify(`🏚️ ¡Asentamiento enemigo destruido! Botín: ${lootParts.join(' ')}`, 'success');
        } else {
          this.hud.notify(`💥 Edificio destruido${lootParts.length ? ` · Botín: ${lootParts.join(' ')}` : ''}`, 'success');
        }
      } else {
        if (b.type === BuildingType.WONDER) {
          this.hud.notify('💀 ¡Tu Gran Maravilla fue destruida! La victoria se escapa...', 'warning');
          this.camera.shake(0.8, 1.0);
          this.renderer.effects.createExplosion(b.col * TILE_SIZE, 0.6, b.row * TILE_SIZE, 2.0);
        } else if (b.type === BuildingType.SETTLEMENT) {
          this.hud.notify('💀 ¡Tu asentamiento ha sido destruido!', 'warning');
        } else {
          this.hud.notify('🔥 Tu edificio ha sido destruido', 'warning');
        }
      }
    }

    this.prodPanel.renderQueue();

    // Apply fog of war: hide enemy units/buildings outside vision
    const humanFog   = this.game.fog.getFog(this.game.humanPlayerId);
    const mayaReveal = this.game.humanPlayer.civType === CivilizationType.MAYA &&
                       this.game.humanPlayer.powerActive;
    if (humanFog) {
      for (const unit of this.game.getAllUnits()) {
        if (unit.playerId === this.game.humanPlayerId) continue;
        unit.mesh.visible = unit.isAlive() && (mayaReveal || humanFog.canSeeUnit(unit, this.game.humanPlayerId));
      }
      for (const building of this.game.allBuildings) {
        if (building.playerId === this.game.humanPlayerId) continue;
        building.mesh.visible = building.isAlive() && (mayaReveal || humanFog.canSeeBuilding(building, this.game.humanPlayerId));
      }
    }

    this.renderer.syncHeights(this.game.allUnits, this.game.allWorkers);
    this.renderer.updateFog(this.game.fog, this.game.humanPlayerId);
    this.camera.update(dt);
    this.renderer.updateEffects(dt);

    // Day/night cycle: one full cycle every 480 game-seconds
    const DAY_CYCLE = 480;
    const dayT = (this.game.gameTime % DAY_CYCLE) / DAY_CYCLE;
    this.renderer.setDayNight(dayT);
    // Rain during the night half of the cycle (t 0.75–1.0 and 0.0–0.25)
    const isNight = dayT > 0.75 || dayT < 0.15;
    if (isNight && !this.renderer.isRaining) this.renderer.startRain();
    else if (!isNight && this.renderer.isRaining) this.renderer.stopRain();
    // Notify player when day/night phase transitions
    if (isNight !== this._wasNight) {
      this._wasNight = isNight;
      const humanCiv = this.game.humanPlayer.civType;
      const isNative = humanCiv === CivilizationType.AZTEC || humanCiv === CivilizationType.MAYA || humanCiv === CivilizationType.INCA;
      if (isNight) {
        this.hud.notify('🌙 Anochece — visión -40% · cuerpo a cuerpo +15% · pólvora -10%', 'info');
        if (isNative) this.hintOnce('nightMelee', '💡 ¡La noche favorece a tus guerreros! El daño cuerpo a cuerpo sube 15% y la pólvora enemiga pierde 10%. ¡Ataca de noche!');
        else this.hintOnce('nightCombat', '💡 De noche: la visión cae un 40%. Tus armas de pólvora pierden 10% de daño — despliega cuerpo a cuerpo en la oscuridad.');
      } else {
        this.hud.notify('☀️ Amanece — visión restaurada · pólvora recupera potencia', 'info');
        this.hintOnce('highGround', '💡 El terreno importa en combate: las tierras altas y montañas dan bonificación de ataque. El desierto expone a tus arqueros.');
      }
    }
    // Storm start/end notifications
    const isStorm = this.game.stormTimer > 0;
    if (isStorm !== this._wasStorm) {
      this._wasStorm = isStorm;
      if (isStorm) {
        this.hud.notify('🌪️ ¡Tormenta tropical! Visibilidad reducida 30s', 'warning');
      } else {
        this.hud.notify('🌤️ La tormenta pasó — visibilidad restaurada', 'info');
      }
    }

    // Random events every 2–4 minutes of game time
    if (this.game.gameTime >= this._nextEventTime) {
      this._nextEventTime = this.game.gameTime + 120 + Math.random() * 120;
      this.triggerRandomEvent();
    }

    // Interactive choice events every 4–6 minutes of game time
    if (!this._choiceEventActive && this.game.gameTime >= this._nextChoiceEventTime && this.game.status === 'PLAYING') {
      this._nextChoiceEventTime = this.game.gameTime + 240 + Math.random() * 120;
      this.triggerChoiceEvent();
    }

    // Control group bar live update (unit deaths reduce count)
    this._groupBarTimer -= dt;
    if (this._groupBarTimer <= 0) {
      this._groupBarTimer = 0.5;
      this.updateCtrlGroupsBar();
    }

    // Map ping positions (world → screen each frame)
    if (this._mapPings.length > 0) this.tickMapPings();

    // Battle report cooldown & window tracking
    if (this._battleReportCooldown > 0) this._battleReportCooldown -= dt;
    if (this._battleWindowTimer > 0) {
      this._battleWindowTimer -= dt;
      if (this._battleWindowTimer <= 0) {
        if (this._battleWindowKills >= 4 && this._battleReportCooldown <= 0) {
          this.showBattleReport(this._battleWindowKills, this._battleWindowLosses);
          this._battleReportCooldown = 90;
        }
        this._battleWindowKills  = 0;
        this._battleWindowLosses = 0;
      }
    }

    // Follow orders: keep followers near their target unit
    for (const [followerId, targetId] of this._followOrders) {
      const follower = this.game.getUnitById(followerId);
      const target   = this.game.getUnitById(targetId);
      if (!follower?.isAlive() || !target?.isAlive()) { this._followOrders.delete(followerId); continue; }
      if (follower.state === UnitState.ATTACKING || follower.state === UnitState.ATTACK_MOVE) continue;
      const dist = Math.hypot(follower.col - target.col, follower.row - target.row);
      if (dist > 3.5 && follower.state !== UnitState.MOVING) {
        const near = this.game.map.findWalkableNear(target.col, target.row, 2);
        if (near) {
          const path = findPath(this.game.map, follower.gridPos(), { col: near[0], row: near[1] }, 300);
          if (path.length > 0) follower.moveTo(path);
        }
      }
    }

    // Last Stand: one-time emergency buff when only ≤5 military units remain
    if (!this._lastStandFired && this.game.status === 'PLAYING') {
      const mil = this.game.humanPlayer.aliveUnits.filter(u => !u.isHero && u.garrisonedIn === null);
      if (mil.length > 0 && mil.length <= 5) {
        this._lastStandFired = true;
        for (const u of mil) u.attack = Math.round(u.attack * 1.35);
        this.showMultiKillAnnouncer('¡ÚLTIMA RESISTENCIA!', '¡Tus tropas luchan con desesperación! +35% ATK', '#ff2244');
        this.camera.shake(0.5, 0.8);
        this.hud.notify('☠️ ¡ÚLTIMA RESISTENCIA! Tus pocas tropas restantes reciben +35% de ataque — ¡no te rindas!', 'warning');
      }
    }

    // Auto-checkpoint every 3 minutes: save current stats to profile
    if (this.game.gameTime >= this._autoSaveTimer) {
      this._autoSaveTimer += 180;
      const p = this.game.humanPlayer;
      this.saveSystem.saveCheckpoint({
        civ: this.civ, gameTime: Math.floor(this.game.gameTime),
        kills: this.killCount, food: Math.floor(p.resources.food),
        gold: Math.floor(p.resources.gold), stone: Math.floor(p.resources.stone),
      });
      this.hud.flashAutoSave();
    }

    // Persistent smoke/fire for damaged buildings
    for (const b of this.game.allBuildings) {
      if (!b.isAlive() || !b.isComplete()) continue;
      const ratio = b.hp / b.maxHp;
      if (ratio >= 0.5) { this._buildingSmokeTimers.delete(b.id); continue; }
      // Check visibility
      const vis = humanFog ? humanFog.getVisibility(b.col, b.row) : 1;
      if (vis === 0 /* UNEXPLORED */) continue;
      const prev = this._buildingSmokeTimers.get(b.id) ?? 0;
      const interval = ratio < 0.25 ? 0.35 : 0.90; // fire interval vs smoke
      if (prev + dt >= interval) {
        this._buildingSmokeTimers.set(b.id, 0);
        const wx = b.col * TILE_SIZE + TILE_SIZE / 2;
        const wz = b.row * TILE_SIZE + TILE_SIZE / 2;
        const y  = 1.2;
        if (ratio < 0.25) {
          this.renderer.effects.createExplosion(wx + (Math.random()-0.5)*1.5, y, wz + (Math.random()-0.5)*1.5, 0.25);
        } else {
          this.renderer.effects.createDustCloud(wx + (Math.random()-0.5)*1.5, wz + (Math.random()-0.5)*1.5);
        }
      } else {
        this._buildingSmokeTimers.set(b.id, prev + dt);
      }
    }

    // Dust trails for moving units (throttled per unit)
    for (const u of this.game.getAllUnits()) {
      if (u.state !== UnitState.MOVING && u.state !== UnitState.ATTACK_MOVE) {
        this._dustTimers.delete(u.id);
        continue;
      }
      const prev = this._dustTimers.get(u.id) ?? 0;
      if (prev + dt >= 0.28) {
        this._dustTimers.set(u.id, 0);
        // Only emit dust on non-water terrain; skip if fogged
        const fog = humanFog;
        const vis = fog ? fog.getVisibility(u.col, u.row) : 1;
        if (vis !== 0 /* not UNEXPLORED */) {
          this.renderer.effects.createDustCloud(u.worldX, u.worldZ);
        }
      } else {
        this._dustTimers.set(u.id, prev + dt);
      }
    }

    // Status effect particles: burning (orange flames) and poisoned (green gas)
    for (const u of this.game.getAllUnits()) {
      const hasBurn = u.burning > 0;
      const hasPoison = u.poisoned > 0;
      // First-time poison hint: suggest retreating to temple for cure
      if (hasPoison && u.playerId === this.game.humanPlayerId) {
        this.hintOnce('poison', '☠️ ¡Unidad envenenada! Retírala al Templo propio — los sacerdotes curan el veneno (−3s cada 3s cerca del Templo).');
      }
      if (!u.isAlive() || (!hasBurn && !hasPoison)) {
        this._statusParticleTimers.delete(u.id);
        continue;
      }
      const vis = humanFog ? humanFog.getVisibility(u.col, u.row) : 1;
      if (vis === 0 /* UNEXPLORED */) continue;
      const prev = this._statusParticleTimers.get(u.id) ?? 0;
      if (prev + dt >= 0.3) {
        this._statusParticleTimers.set(u.id, 0);
        if (hasBurn)   this.renderer.effects.createBurningEffect(u.worldX, 0.6, u.worldZ);
        if (hasPoison) this.renderer.effects.createPoisonEffect(u.worldX, 0.4, u.worldZ);
      } else {
        this._statusParticleTimers.set(u.id, prev + dt);
      }
    }

    // Kill tracking
    const prevAlive = this.game.getAllUnits().filter(u => !u.isAlive() && u.playerId !== this.game.humanPlayerId).length;

    // Visual + audio effects on damage
    if (this.game.damageEvents.length > 0) {
      this.hud.showDamageNumbers(this.game.damageEvents);
      let humanUnderAttack = false;
      for (const evt of this.game.damageEvents) {
        // Minimap combat ping
        this.hud.addCombatPing(evt.worldX / TILE_SIZE, evt.worldZ / TILE_SIZE);
        // Projectile for ranged unit attacks
        if (evt.attacker && evt.attacker.attackRange > 1.5) {
          const projColor = evt.attacker.attackRange > 3 ? 0xffcc44 : 0xddffcc;
          this.renderer.effects.createProjectile(
            evt.attacker.worldX, evt.attacker.worldZ,
            evt.worldX, evt.worldZ, projColor,
          );
          this.renderer.effects.createMuzzleFlash(evt.attacker.worldX, 0.6, evt.attacker.worldZ);
        }
        // Projectile for building-sourced attacks (watchtower)
        if (!evt.attacker && evt.sourceWorldX !== undefined) {
          this.renderer.effects.createProjectile(evt.sourceWorldX, evt.sourceWorldZ!, evt.worldX, evt.worldZ, 0xff8833);
          this.renderer.effects.createMuzzleFlash(evt.sourceWorldX, 1.8, evt.sourceWorldZ!);
          this.audio.playHit(0.5);
        }
        this.renderer.effects.createHitEffect(evt.worldX, 0.5, evt.worldZ);
        if (evt.critical) {
          // Flanking / type-advantage critical: always show explosion burst
          this.renderer.effects.createExplosion(evt.worldX, 0.5, evt.worldZ, Math.max(0.5, evt.damage / 35));
        } else if (evt.damage > 20) {
          this.renderer.effects.createExplosion(evt.worldX, 0.5, evt.worldZ, evt.damage / 40);
        }
        if (!evt.target.isAlive()) {
          this.audio.playDeath();
          if (evt.target.playerId !== this.game.humanPlayerId) {
            this.killCount++;
            // Total kill-count milestones
            const _kmThresholds: [number, string, string, string][] = [
              [200, '¡CONQUISTADOR LEGENDARIO!', '200 bajas en batalla',    '#ffd700'],
              [100, '¡CIEN BAJAS!',              'Maestro de la guerra',    '#ff8800'],
              [ 50, '¡CINCUENTA BAJAS!',         'La batalla es tuya',      '#ff5500'],
              [ 25, '¡VEINTICINCO BAJAS!',       'Guerrero implacable',     '#ffcc00'],
              [ 10, '¡DIEZ BAJAS!',              'La conquista avanza',     '#aaffaa'],
            ];
            for (const [m, title, sub, color] of _kmThresholds) {
              if (this.killCount === m) {
                this.showMultiKillAnnouncer(title, sub, color);
                break;
              }
            }
          }
          // Battle analysis window tracking
          if (evt.attacker?.playerId === this.game.humanPlayerId && evt.target.playerId !== this.game.humanPlayerId) {
            if (this._battleWindowTimer <= 0) this._battleWindowTimer = 30;
            this._battleWindowKills++;
            // Rapid multi-kill announcer: track kills within a 5s window
            const nowMs = Date.now();
            this._rapidKillTs.push(nowMs);
            this._rapidKillTs = this._rapidKillTs.filter(t => nowMs - t < 5000);
            const rk = this._rapidKillTs.length;
            if (rk >= 2) {
              const [title, sub, color] =
                rk >= 6 ? ['¡IMPARABLE!',       '¡DOMINIO TOTAL!',           '#ff2200'] :
                rk >= 5 ? ['¡MASACRE!',          'Cinco bajas rápidas',        '#ff5500'] :
                rk >= 4 ? ['¡CUÁDRUPLE BAJA!',   'Cuatro en el fragor',        '#ff8800'] :
                rk >= 3 ? ['¡TRIPLE ELIMINACIÓN!','Tres unidades abatidas',     '#ffcc00'] :
                          ['¡DOBLE BAJA!',        'Dos golpes mortales',        '#aaffaa'];
              this.showMultiKillAnnouncer(title, sub, color);
            }
          } else if (evt.target.playerId === this.game.humanPlayerId && this._battleWindowTimer > 0) {
            this._battleWindowLosses++;
          }
          // Bounty system: track enemy units that kill your troops; reward eliminating them
          if (evt.attacker && evt.attacker.playerId !== this.game.humanPlayerId &&
              evt.target.playerId === this.game.humanPlayerId) {
            const prev = this._enemyBounties.get(evt.attacker.id) ?? 0;
            const next = prev + 1;
            this._enemyBounties.set(evt.attacker.id, next);
            if (next === 3 || next === 5 || next === 10) {
              const n = evt.attacker.def.name;
              const emoji = next >= 10 ? '💀' : next >= 5 ? '☠️' : '⚠️';
              this.hud.notify(`${emoji} ${n} enemigo ha matado ${next} de tus unidades — ¡OBJETIVO DE RECOMPENSA! Elimínalo`, 'warning');
            }
          }
          if (evt.attacker?.playerId === this.game.humanPlayerId &&
              evt.target.playerId !== this.game.humanPlayerId) {
            const bountyKills = this._enemyBounties.get(evt.target.id) ?? 0;
            if (bountyKills >= 3) {
              const bonus = Math.min(300, bountyKills * 25);
              this.game.humanPlayer.resources.gold = Math.min(2000, this.game.humanPlayer.resources.gold + bonus);
              this.showMultiKillAnnouncer('¡OBJETIVO ELIMINADO!', `${evt.target.def.name} — +${bonus}⚜️ recompensa`, '#ffd700');
              this._enemyBounties.delete(evt.target.id);
            }
          }
          // Death burst: scale with unit level / hero status
          const deathScale = evt.target.isHero ? 1.5 : evt.target.level >= 3 ? 1.1 : evt.target.level >= 2 ? 0.75 : 0.45;
          this.renderer.effects.createExplosion(evt.worldX, 0.5, evt.worldZ, deathScale);
          this.renderer.effects.createDustCloud(evt.worldX, evt.worldZ);
          // Kill gold: human player earns gold for each enemy kill
          if (evt.attacker?.playerId === this.game.humanPlayerId && evt.target.playerId !== this.game.humanPlayerId) {
            const kg = killGoldReward(evt.target.type, evt.target.isHero);
            this.game.humanPlayer.resources.gold = Math.min(2000, this.game.humanPlayer.resources.gold + kg);
            if (evt.target.isHero) {
              this.hud.notify(`⚔️ ¡Héroe enemigo abatido! +${kg}⚜️`, 'success');
            }
          }
          // Kill feed entry for significant kills
          if (evt.target.isHero) {
            const side = evt.target.playerId === this.game.humanPlayerId ? '☠️' : '⚔️';
            this.hud.addKillFeedEntry(`${side} ${evt.target.heroName ?? evt.target.def.name} ha caído`);
          } else if (evt.target.level >= 2) {
            const nameLabel = evt.target.veteranName ?? evt.target.def.name;
            const stars = evt.target.level >= 3 ? '★★' : '★';
            this.hud.addKillFeedEntry(`⚔️ ${nameLabel} ${stars} eliminado`);
          }
          // Combat combo kill feed entries (human attacker only)
          if (evt.attacker && evt.attacker.playerId === this.game.humanPlayerId) {
            if (evt.attacker.type === UnitType.CAVALRY && evt.target.panicked) {
              this.hud.addKillFeedEntry('⚡ ¡PERSECUCIÓN! Caballería acabó con tropa en fuga');
            } else if (evt.target.slowed > 0 &&
                       (evt.attacker.type === UnitType.ARCHER || evt.attacker.type === UnitType.ATLATL ||
                        evt.attacker.type === UnitType.ARQUEBUSIER)) {
              this.hud.addKillFeedEntry('🌀 ¡COMBO! Ranged remata a tropa aturdida por la honda');
            }
          }
          // Kill milestone celebrations (human attacker, non-hero units)
          if (evt.attacker && evt.attacker.playerId === this.game.humanPlayerId && !evt.attacker.isHero) {
            const kt = evt.attacker.killsTotal;
            for (const milestone of [5, 10, 20, 30, 50]) {
              if (kt >= milestone) {
                const mkey = `${evt.attacker.id}-${milestone}`;
                if (!this._killMilestonesReached.has(mkey)) {
                  this._killMilestonesReached.add(mkey);
                  const mname = evt.attacker.veteranName ?? evt.attacker.def.name;
                  const micon = milestone >= 20 ? '🔱' : milestone >= 10 ? '⚡' : '🌟';
                  const mtitle = milestone >= 30 ? 'LEYENDA DE BATALLA' : milestone >= 20 ? 'Campeón implacable' : milestone >= 10 ? 'Asesino veterano' : 'Primera hazaña';
                  this.hud.notify(`${micon} ${mname}: ¡${kt} bajas! ${mtitle}`, 'success');
                  this.renderer.effects.createLevelUpBurst(evt.attacker.worldX, 1.0, evt.attacker.worldZ);
                  if (milestone >= 10) this.hud.addKillFeedEntry(`${micon} ${mname} — ¡${kt} BAJAS!`);
                }
              }
            }
          }
          // Honorable defeat: human unit with 5+ kills dies
          if (evt.target.playerId === this.game.humanPlayerId && evt.target.killsTotal >= 5 && !evt.target.isHero) {
            const dname = evt.target.veteranName ?? evt.target.def.name;
            this.hud.addKillFeedEntry(`🕊️ ${dname} ha caído — ${evt.target.killsTotal} bajas en batalla`);
            if (evt.target.killsTotal >= 10) {
              this.hud.notify(`🕊️ ¡${dname} ha caído! Recordado como leyenda — ${evt.target.killsTotal} bajas`, 'warning');
            }
          }
          // Hero death notification + dramatic slow-motion
          if (evt.target.isHero && evt.target.playerId === this.game.humanPlayerId) {
            this.hud.notify(`☠️ ${evt.target.heroName} ha caído — regresará en 60s`, 'warning');
            this.camera.shake(0.4, 0.6);
            // Brief slow-motion: 0.25× for 0.6s, then restore
            const prevSpeed = this._gameSpeed;
            this._gameSpeed = 0.25;
            setTimeout(() => { this._gameSpeed = prevSpeed; }, 600);
          }
        } else {
          this.audio.playHit(evt.damage / 30);
          if (evt.target.playerId === this.game.humanPlayerId) {
            humanUnderAttack = true;
            this.hud.showOffScreenAttack(evt.worldX, evt.worldZ);
          }
        }
      }
      if (humanUnderAttack && Math.random() < 0.05) {
        this.hud.notify('⚔️ ¡Tus tropas están bajo ataque!', 'warning');
      }

      // Phalanx charge-resist: human spear phalanx absorbed a cavalry charge
      if (this._chargeResistTimer <= 0) {
        for (const evt of this.game.damageEvents) {
          if (!evt.chargeBlocked || !evt.attacker) continue;
          if (evt.target.playerId === this.game.humanPlayerId) {
            this._chargeResistTimer = 20;
            this.hud.notify('🛡️ ¡La falange resistió la carga de caballería! +10 moral', 'success');
            break;
          }
        }
      }

      // Jungle ambush notification: enemy attacks a human unit from jungle cover
      if (this._ambushWarnTimer <= 0) {
        const dayT2 = (this.game.gameTime % 480) / 480;
        const isNight2 = dayT2 > 0.75 || dayT2 < 0.15;
        for (const evt of this.game.damageEvents) {
          if (!evt.attacker || evt.target.playerId !== this.game.humanPlayerId) continue;
          const aTile = this.game.map.getTile(Math.round(evt.attacker.col), Math.round(evt.attacker.row));
          if ((aTile?.terrain as string) === 'JUNGLE') {
            this._ambushWarnTimer = 30;
            this.hud.notify('🌿 ¡EMBOSCADA! Ataque desde la jungla', 'warning');
            this.camera.shake(0.3, 0.5);
            break;
          }
          // Night attack: enemy hits human unit at night without prior alert
          if (isNight2 && this._nightAttackTimer <= 0) {
            this._nightAttackTimer = 60;
            this.hud.notify('🌙 ¡ATAQUE NOCTURNO! Visibilidad reducida — ¡en guardia!', 'warning');
            this.camera.shake(0.25, 0.4);
            break;
          }
        }
      }
    }

    // Flanking warning: notify when 2+ enemies attack the same human unit simultaneously
    if (this._flankWarnTimer <= 0 && this.game.status === 'PLAYING') {
      const enemyAttackers = new Map<number, number>(); // human unit id → enemy attacker count
      for (const u of this.game.allUnits) {
        if (!u.isAlive() || u.playerId === this.game.humanPlayerId || !u.attackTarget?.isAlive()) continue;
        if (u.attackTarget.playerId === this.game.humanPlayerId) {
          enemyAttackers.set(u.attackTarget.id, (enemyAttackers.get(u.attackTarget.id) ?? 0) + 1);
        }
      }
      const flanked = [...enemyAttackers.values()].some(c => c >= 2);
      if (flanked) {
        this._flankWarnTimer = 45;
        this.hud.notify('⚠️ ¡Flanqueo! El enemigo rodea a tus tropas — Forma una Falange (F2) o retira', 'warning');
      }
    }

    // Grand battle notification: when 8+ units fight simultaneously, signal the clash
    if (this._grandBattleCooldown <= 0 && this.game.status === 'PLAYING') {
      const fighting = this.game.allUnits.filter(u => u.isAlive() && u.state === UnitState.ATTACKING).length;
      if (fighting >= 8) {
        this._grandBattleCooldown = 60;
        this.hud.notify('⚔️ ¡GRAN BATALLA! Los ejércitos chocan en plena batalla', 'warning');
        this.camera.shake(0.3, 0.5);
      }
    }

    // Civilization power ready alert: notify once when cooldown hits zero
    {
      const player = this.game.humanPlayer;
      if (player.powerCooldown <= 0 && !player.powerActive) {
        if (!this._powerReadyFired) {
          this._powerReadyFired = true;
          const def = CIV_POWER_DEFS[player.civType];
          this.hud.notify(`${def.emoji} ¡PODER LISTO! Pulsa Q para activar: ${def.name}`, 'success');
        }
      } else {
        this._powerReadyFired = false; // reset so alert fires again next cycle
      }
    }

    // Level-up audio detection for human player units; berserk entry detection
    for (const u of this.game.humanPlayer.aliveUnits) {
      const prev = this._unitLevels.get(u.id) ?? 1;
      if (u.level > prev) {
        this.audio.playLevelUp();
        this.hud.notify(`⭐ ${u.def.name} subió al nivel ${u.level}`, 'success');
        this.renderer.effects.createLevelUpBurst(u.worldX, 1.0, u.worldZ);
      }
      this._unitLevels.set(u.id, u.level);

      // Berserk: detect activation (berserkTimer just became positive)
      const wasBerserk = this._berserkUnits.has(u.id);
      if (u.berserkTimer > 0 && !wasBerserk) {
        this._berserkUnits.add(u.id);
        const bName = u.veteranName ?? u.def.name;
        this.hud.notify(`🔥 ¡${bName} entró en frenesí! +25% daño por 12s`, 'warning');
        this.hud.addKillFeedEntry(`🔥 ${bName} — ¡FRENESÍ! (3 bajas consecutivas)`);
        this.renderer.effects.createExplosion(u.worldX, 0.8, u.worldZ, 0.6);
      } else if (u.berserkTimer <= 0 && wasBerserk) {
        this._berserkUnits.delete(u.id);
      }
    }

    // Veteran level-up notifications for human units
    for (const u of this.game.newlyLeveledUpUnits) {
      if (u.playerId !== this.game.humanPlayerId) continue;
      this.audio.playLevelUp();
      this.renderer.effects.createLevelUpBurst(u.worldX, 1.0, u.worldZ);
      if (u.level >= 3 && !u.isHero && !u.veteranName) {
        // Assign a historically-themed name from the civ pool (avoid duplicates)
        const pool = CIV_VETERAN_NAMES[this.civ];
        const used = new Set(this.game.allUnits.map(v => v.veteranName).filter(Boolean));
        const avail = pool.filter(n => !used.has(n));
        u.veteranName = avail.length > 0
          ? avail[Math.floor(Math.random() * avail.length)]
          : pool[Math.floor(Math.random() * pool.length)];
        this.hud.notify(`👑 ¡${u.def.name} se convierte en "${u.veteranName}"! Campeón legendario`, 'success');
        this.hud.addKillFeedEntry(`👑 ${u.veteranName} — ¡CAMPEÓN LEGENDARIO!`);
      } else {
        const star = u.level >= 3 ? '🟠' : '⭐';
        this.hud.notify(`${star} ¡${u.def.name} ha ascendido a veterano rango ${u.level}!`, 'success');
      }
    }

    // Hero respawn notifications
    for (const hero of this.game.newlyRespawnedHeroes) {
      if (hero.playerId === this.game.humanPlayerId) {
        this.hud.notify(`⚔️ ${hero.heroName} ha regresado a la batalla`, 'success');
        this.audio.playLevelUp();
        this.renderer.effects.createLevelUpBurst(hero.worldX, 1.0, hero.worldZ);
      }
    }

    // Building captures
    for (const cap of this.game.newlyCapturedBuildings) {
      const name = BUILDING_DEFS[cap.building.type]?.name ?? 'Edificio';
      const isVillage = cap.building.type === BuildingType.VILLAGE;
      this.hud.addKillFeedEntry(`🚩 ${name} capturado`);
      if (cap.toPlayerId === this.game.humanPlayerId) {
        if (isVillage) {
          this.hud.notify(`🏡 ¡Aldea capturada! +10🌽 +6⚜️ cada 30s mientras la controles`, 'success');
          this.hintOnce('village', '💡 Las aldeas neutrales generan recursos pasivos (+10🌽 +6⚜️/30s). El enemigo puede reconquistarlas — ¡guarnece o defiende las que tengas!');
        } else {
          this.hud.notify(`🚩 ¡${name} enemigo capturado!`, 'success');
        }
        this.audio.playVictory();
        this.renderer.effects.createLevelUpBurst(cap.building.col * TILE_SIZE, 1.5, cap.building.row * TILE_SIZE);
      } else if (cap.fromPlayerId === this.game.humanPlayerId) {
        this.hud.notify(`⚠️ ¡El enemigo ha capturado tu ${isVillage ? 'aldea' : name}!`, 'warning');
        this.camera.shake(0.4, 0.5);
      }
    }

    // Diplomatic war declarations (American Conquest: dramatic first-attack announcement)
    for (const decl of this.game.newWarDeclarations) {
      if (decl.toPlayerId === this.game.humanPlayerId) {
        const civNames: Record<string, string> = {
          AZTEC: 'Los Aztecas', MAYA: 'Los Mayas', INCA: 'Los Incas', CONQUISTADOR: 'Los Conquistadores',
        };
        const aggressor = this.game.players[decl.fromPlayerId];
        const civName = civNames[aggressor?.civType ?? ''] ?? 'El enemigo';
        this.hud.notify(`⚔️ ¡${civName} te han declarado la guerra!`, 'warning');
        this.camera.shake(0.5, 0.8);
        this.audio.playDeath(); // dramatic signal
      }
    }

    // AI civilization taunts during attack phase
    for (const taunt of this.game.newTaunts) {
      if (taunt.playerId !== this.game.humanPlayerId) {
        this.hud.notify(taunt.message, 'warning');
      }
    }

    // Civilization elimination announcements (American Conquest: dramatic defeat message)
    const civNames: Record<string, string> = {
      AZTEC: 'Los Aztecas', MAYA: 'Los Mayas', INCA: 'Los Incas', CONQUISTADOR: 'Los Conquistadores',
    };
    for (const p of this.game.newlyEliminatedPlayers) {
      const name = civNames[p.civType] ?? 'El enemigo';
      this.hud.notify(`⚰️ ¡${name} han sido eliminados de la batalla!`, 'success');
      this.camera.shake(0.6, 1.0);
      this.audio.playVictory();
    }

    // Enemy tech research notifications
    const upgradeNames: Record<string, string> = {
      metallurgy:    '⚔️ Metalurgia (+6 atk a todas sus unidades)',
      logistics:     '👟 Logística (+0.4 veloc. a todas sus unidades)',
      fortification: '🛡️ Fortificación (+50 HP máx. a todas sus unidades)',
      civTech:       '⭐ Tecnología élite (mejora especial de su civilización)',
    };
    for (const r of this.game.newlyResearchedUpgrades) {
      if (r.playerId === this.game.humanPlayerId) continue;
      const label = upgradeNames[r.upgrade] ?? r.upgrade;
      this.hud.notify(`🔬 ¡El enemigo investigó ${label}! Acelera tu propia investigación en la Fragua.`, 'warning');
    }

    // Enemy hero spotted: high-priority alert
    for (const hero of this.game.newlyVisibleEnemyHeroes) {
      this.hud.notify(`👁️ ¡HÉROE ENEMIGO AVISTADO! — ${hero.heroName ?? hero.type}`, 'warning');
      this.camera.shake(0.4, 0.7);
    }

    // Enemy army first-sight: when 3+ enemy units become visible for the first time together
    {
      const humanFog = this.game.fog.getFog(this.game.humanPlayerId);
      if (humanFog && this.game.status === 'PLAYING' &&
          this.game.gameTime - this._enemyArmySpottedAt >= 120) {
        let newlySpotted = 0;
        for (const u of this.game.allUnits) {
          if (u.playerId === this.game.humanPlayerId || !u.isAlive() || this._spottedEnemyIds.has(u.id)) continue;
          if (humanFog.canSeeUnit(u, this.game.humanPlayerId)) {
            this._spottedEnemyIds.add(u.id);
            newlySpotted++;
          }
        }
        if (newlySpotted >= 3) {
          this._enemyArmySpottedAt = this.game.gameTime;
          this.hud.notify(`👁️ ¡EJÉRCITO ENEMIGO AVISTADO! ${newlySpotted} tropas detectadas`, 'warning');
          this.camera.shake(0.25, 0.4);
        } else if (newlySpotted === 0) {
          // Also track units individually even outside army detection
          // (covered above per unit) — no extra action needed
        }
      }
    }

    // Enemy-near-base alert: warn when a visible enemy comes within 12 tiles of the human settlement
    if (this.game.status === 'PLAYING' && this._baseAlertCooldown <= 0) {
      const settle = this.game.allBuildings.find(
        b => b.playerId === this.game.humanPlayerId && b.type === BuildingType.SETTLEMENT && b.isAlive(),
      );
      if (settle) {
        const humanFog = this.game.fog.getFog(this.game.humanPlayerId);
        const threat = this.game.allUnits.find(u =>
          u.playerId !== this.game.humanPlayerId && u.isAlive() && u.garrisonedIn === null &&
          Math.abs(u.col - settle.col) <= 12 && Math.abs(u.row - settle.row) <= 12 &&
          (!humanFog || humanFog.canSeeUnit(u, this.game.humanPlayerId)),
        );
        if (threat) {
          this._baseAlertCooldown = 45;
          this.hud.notify('🚨 ¡ENEMIGO CERCA DE LA BASE! Unidades enemigas a menos de 12 casillas del asentamiento', 'warning');
          this.hud.addCombatPing(settle.col, settle.row);
          this.camera.shake(0.3, 0.5);
        }
      }
    }

    // Starvation warning: throttled to avoid spam
    if (this.game.humanPlayer.resources.food < 10 && this._starvWarnTimer <= 0) {
      this.hud.notify('🍂 ¡HAMBRE! Las tropas pierden moral — construye un Almacén o entrena menos unidades', 'warning');
      this._starvWarnTimer = 30;
    }
    // Stone scarcity: construction will stall
    if (this.game.humanPlayer.resources.stone < 20 && this._stoneCritWarnTimer <= 0) {
      this.hud.notify('🪨 ¡PIEDRA AGOTADA! La construcción se detendrá — envía trabajadores a una cantera', 'warning');
      this._stoneCritWarnTimer = 60;
    }
    // Gold scarcity: can't hire or upgrade
    if (this.game.humanPlayer.resources.gold < 20 && this._goldCritWarnTimer <= 0) {
      this.hud.notify('⚜️ ¡ORO CRÍTICO! Captura aldeas o espera ingresos para contratar tropas', 'warning');
      this._goldCritWarnTimer = 60;
    }
    // Population cap warning
    if (this.game.status === 'PLAYING' && this._popCapWarnCooldown <= 0) {
      const pop = this.game.humanPlayer.aliveUnits.length;
      const cap = this.game.getPopCap(this.game.humanPlayerId);
      if (pop >= cap) {
        this.hud.notify('👥 ¡LÍMITE DE POBLACIÓN alcanzado! Construye Casas (+12 pop) o Almacenes (+5 pop)', 'warning');
        this._popCapWarnCooldown = 60;
        this.hintOnce('popCap', '💡 Límite de población: construye Casas para ampliarlo (+12 cada una). Almacenes y Aldeas también suman.');
      } else if (pop >= cap - 3 && pop > 0) {
        this.hud.notify(`👥 Casi al límite de población (${pop}/${cap}) — construye más Casas`, 'info');
        this._popCapWarnCooldown = 90;
      }
    }

    // Idle army reminder: nudge player if all military units have been idle for 60s
    if (this.game.status === 'PLAYING') {
      const military = this.game.humanPlayer.aliveUnits.filter(u => u.garrisonedIn === null);
      const allIdle  = military.length > 0 && military.every(u => u.state === UnitState.IDLE || u.state === UnitState.HOLD);
      if (allIdle) {
        this._idleArmyTimer += rawDt;
        if (this._idleArmyTimer >= 60 && this._idleArmyCooldown <= 0) {
          this.hud.notify('💤 Tus tropas llevan mucho tiempo inactivas — ¿explorar, expandir o atacar?', 'info');
          this._idleArmyCooldown = 120;
          this._idleArmyTimer    = 0;
        }
      } else {
        this._idleArmyTimer = 0;
      }

      // Army-wide low-morale warning: alert when a sizable force is wavering so the
      // player can rally (hero war cry Y, regroup C, temple, retreat R) before a rout
      if (this._lowMoraleCooldown <= 0) {
        const combat = military.filter(u => !u.isHero);
        if (combat.length >= 4) {
          const shaky = combat.filter(u => u.panicked || u.morale < 35).length;
          if (shaky >= combat.length * 0.4) {
            this.hud.notify('📉 ¡La moral de tu ejército se desmorona! Usa el grito de guerra (Y), reagrupa con el héroe (C) o retírate (R)', 'warning');
            this.audio.playRetreat();
            this._lowMoraleCooldown = 45;
          }
        }
      }
    }

    // Objective completion notifications
    for (const objType of this.game.objectives.newlyCompleted) {
      const obj = this.game.objectives.objectives.find(o => o.type === objType);
      if (obj) {
        const r = obj.reward;
        if (r) {
          const p = this.game.humanPlayer;
          if (r.food)  p.resources.food  = Math.min(2000, p.resources.food  + r.food);
          if (r.gold)  p.resources.gold  = Math.min(2000, p.resources.gold  + r.gold);
          if (r.stone) p.resources.stone = Math.min(2000, p.resources.stone + r.stone);
          if (r.wood)  p.resources.wood  = Math.min(2000, (p.resources.wood ?? 0) + r.wood);
          const rewardStr = [
            r.food  ? `+${r.food}🌽`  : '',
            r.gold  ? `+${r.gold}⚜️`  : '',
            r.stone ? `+${r.stone}🪨` : '',
            r.wood  ? `+${r.wood}🪵`  : '',
          ].filter(Boolean).join(' ');
          this.hud.notify(`🏆 ${obj.title} — ${rewardStr}`, 'success');
        } else {
          this.hud.notify(`🏆 ¡Objetivo completado! ${obj.title}`, 'success');
        }
        this.audio.playLevelUp();
      }
    }

    // Village income notifications for the human player
    for (const inc of this.game.villageIncomeEvents) {
      if (inc.playerId === this.game.humanPlayerId) {
        this.hud.notify(`🏡 Ingresos de aldea: +${inc.food}🌽 +${inc.gold}⚜️`, 'success');
      }
    }

    // Garrison entries
    const humanGarrisons = this.game.newlyGarrisonedUnits.filter(u => u.playerId === this.game.humanPlayerId);
    if (humanGarrisons.length > 0) {
      this.hud.notify(`🏰 ${humanGarrisons.length} unidad${humanGarrisons.length > 1 ? 'es' : ''} en guarnición`, 'success');
      this.audio.playBuild();
      this.hintOnce('garrison', '💡 Las unidades a distancia disparan desde dentro con +2 de alcance. Un edificio guarnecido no puede ser capturado.');
    }

    // Morale breaks: warn when own troops rout; celebrate when the enemy flees
    const humanPanics = this.game.newlyPanickedUnits.filter(u => u.playerId === this.game.humanPlayerId);
    if (humanPanics.length > 0) {
      this.audio.playRetreat();
      this.hud.notify(
        humanPanics.length > 1
          ? `😱 ¡${humanPanics.length} unidades huyen despavoridas! Moral rota`
          : '😱 ¡Una unidad huye despavorida! Moral rota',
        'warning',
      );
      this.hintOnce('morale', '💡 La moral cae con las bajas cercanas. Mantén a tus tropas agrupadas (⚔️FILA) o junto al héroe para sostener la línea.');
    }
    const enemyPanics = this.game.newlyPanickedUnits.length - humanPanics.length;
    if (enemyPanics >= 3) {
      this.hud.notify(`🏳️ ¡El enemigo se desbanda! ${enemyPanics} unidades en fuga`, 'success');
    }

    // Retreat sound: play once per frame if any human unit retreated this frame
    const humanRetreats = this.game.newlyRetreatingUnits.filter(u => u.playerId === this.game.humanPlayerId);
    if (humanRetreats.length > 0) {
      this.audio.playRetreat();
      this.hud.notify(`🏃 ${humanRetreats.length > 1 ? `${humanRetreats.length} unidades retroceden` : 'Unidad retrocediendo'}`, 'warning');
    }

    // Economic victory approach warning (at 75% of 800 gold target)
    const goldNow = this.game.humanPlayer.resources.gold;
    if (!this._treasuryWarned75 && goldNow >= 600) {
      this._treasuryWarned75 = true;
      this.hud.notify('💰 ¡75% hacia la victoria económica! Acumula 800 ⚜️ oro', 'info');
    }

    // Idle worker warning: notify every 30 s of game time while workers are idle
    const humanWorkers = this.game.allWorkers.filter(w => w.playerId === this.game.humanPlayerId);
    const idleCount = humanWorkers.filter(w => (w.task as string) === 'IDLE').length;
    if (idleCount > 0 && this.game.gameTime - this._lastIdleWarnAt >= 30) {
      this._lastIdleWarnAt = this.game.gameTime;
      const res = this.game.humanPlayer.resources;
      const suggestion = res.food < 50 ? '— recoge 🌽 comida urgente (Q)'
        : res.gold < 30 ? '— recoge ⚜️ oro (Q)'
        : res.stone < 30 ? '— recoge 🪨 piedra (Q)'
        : '(Q para asignar al recurso más escaso)';
      this.hud.notify(`⚠️ ${idleCount} trabajador${idleCount > 1 ? 'es' : ''} sin tarea ${suggestion}`, 'warning');
    }

    // "Press the attack" prompt: when player holds a strong military advantage for 30s,
    // nudge them to capitalize before the enemy can recover or be reinforced
    if (this.game.status === 'PLAYING' && this.game.gameTime > 120 && this._advantageCooldown <= 0) {
      const myPop = this.game.humanPlayer.aliveUnits.length;
      let enemyMax = 0;
      for (const p of this.game.players) {
        if (p.id === this.game.humanPlayerId || p.isDefeated()) continue;
        enemyMax = Math.max(enemyMax, p.aliveUnits.length);
      }
      const total = myPop + enemyMax;
      const ratio = total > 0 ? myPop / total : 0.5;
      if (ratio >= 0.65 && myPop >= 5) {
        this._advantageTimer += rawDt;
        if (this._advantageTimer >= 30) {
          this._advantageTimer = 0;
          this._advantageCooldown = 90;
          this.hud.notify('⚔️ ¡VENTAJA MILITAR! Presiona el ataque ahora antes de que el enemigo refuerce', 'success');
          this.hintOnce('pressAttack', '💡 Con más tropas que el enemigo, ataca sus edificios clave. Destruye su Asentamiento para la victoria militar.');
        }
      } else {
        this._advantageTimer = 0;
      }
    }

    // Enemy army in disarray: alert when a major enemy faction's morale collapses (<35% avg)
    // so the player knows to seize the window before they regroup
    if (this.game.status === 'PLAYING' && this._enemyDisarrayCooldown <= 0) {
      for (const p of this.game.players) {
        if (p.id === this.game.humanPlayerId || p.isDefeated()) continue;
        const fighters = p.aliveUnits.filter(u => !u.isHero);
        if (fighters.length < 3) continue;
        const avgMorale = fighters.reduce((s, u) => s + u.morale, 0) / fighters.length;
        if (avgMorale < 35) {
          this._enemyDisarrayCooldown = 60;
          this.hud.notify('🏳️ ¡El ejército enemigo está en desorden! Presiona el ataque', 'success');
          break;
        }
      }
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
      // Red danger vignette when settlement is critically damaged
      const vigEl = document.getElementById('settle-danger-vignette');
      if (vigEl) vigEl.classList.toggle('hidden', humanSettlement.hp >= humanSettlement.maxHp * 0.25);
    } else {
      document.getElementById('settle-danger-vignette')?.classList.add('hidden');
    }

    // Weather forecast: warn 30s before a significant weather change
    if (this.game.weather.forecastFired) {
      this.game.weather.forecastFired = false; // consume
      const next = this.game.weather.nextState;
      const forecastIcons: Record<string, string> = { CLEAR: '☀️', RAIN: '🌧️', STORM: '⛈️', DROUGHT: '🏜️' };
      const forecastWarns: Record<string, string> = {
        RAIN:    '30s — Lluvia inminente: arcabuceros y cañones perderán potencia. ¡Ataca ahora!',
        STORM:   '30s — ¡TORMENTA en camino! Toda artillería quedará inutilizada. ¡Avanza!',
        DROUGHT: '30s — Sequía en camino: riesgo de incendio ×2. Dispersa tus tropas.',
        CLEAR:   '30s — El tiempo va a despejar.',
      };
      if (next !== 'CLEAR' || this.game.weather.state !== 'CLEAR') {
        this.hud.notify(`${forecastIcons[next]} PREVISIÓN ${forecastWarns[next]}`, next === 'STORM' ? 'warning' : 'info');
      }
    }

    // Weather change notification
    if (this.game.weatherChangeEvent) {
      const icons: Record<string, string> = { CLEAR: '☀️', RAIN: '🌧️', STORM: '⛈️', DROUGHT: '🏜️' };
      const tips: Record<string, string> = {
        CLEAR:   'El tiempo despeja. Sin modificadores.',
        RAIN:    'Lluvia — arcabuceros y cañones al 50% de daño. Incendios apagados.',
        STORM:   'Tormenta — todas las unidades a distancia al 60% de daño.',
        DROUGHT: 'Sequía — riesgo de incendio ×2. ¡Cuidado con los cañones!',
      };
      const w = this.game.weatherChangeEvent;
      this.hud.notify(`${icons[w]} ${tips[w]}`, w === 'CLEAR' ? 'info' : 'warning');
      this.hintOnce('weather', '💡 El clima afecta el combate: la lluvia inutiliza casi la pólvora, la sequía dobla el riesgo de incendio.');
    }

    // Random events (and cavalry raid messages)
    for (const msg of this.game.pendingEventMessages) {
      const isRaid = msg.startsWith('🐎');
      this.hud.notify(msg, isRaid ? 'success' : 'info');
      this.audio.playBuild();
      if (isRaid) this.hintOnce('cavalryRaid', '💡 Raída de caballería: tus jinetes saquean ⚜️ oro al destruir edificios enemigos. ¡Úsalos para cortar el suministro enemigo!');
    }

    // Treasure cache discoveries
    for (const cache of this.game.newlyClaimedCaches) {
      const parts = [`+${cache.gold}⚜️`, `+${cache.food}🌽`];
      if (cache.stone > 0) parts.push(`+${cache.stone}🪨`);
      this.hud.notify(`💰 ¡Tesoro descubierto! ${parts.join('  ')}`, 'success');
      this.hud.addKillFeedEntry(`💰 Tesoro encontrado — ${parts.join(' ')}`);
      this.renderer.effects.createLevelUpBurst(cache.col * TILE_SIZE, 0.5, cache.row * TILE_SIZE);
    }

    // Historical events chain — show as prominent overlay
    for (const msg of this.game.histEventMessages) {
      this._showHistoricalEventOverlay(msg);
    }

    // Era advancement notifications
    for (const evt of this.game.eraAdvanceEvents) {
      const isHuman = evt.playerId === this.game.humanPlayerId;
      if (isHuman) {
        this._showEraAdvanceOverlay(evt.era);
      } else {
        const p = this.game.players[evt.playerId];
        if (p) {
          const civDef = CIVILIZATIONS[p.civType];
          const eraName = evt.era === 2 ? 'Era II' : 'Era III';
          this.hud.notify(`⚠️ ${civDef.emoji} ${civDef.name} avanzó a ${eraName} — ¡preparate para nuevas amenazas!`, 'warning');
        }
      }
    }

    // Research era-advance reminder: nudge once after 3 min if player can afford Bronze Working
    if (this.game.gameTime > 180) {
      const player = this.game.humanPlayer;
      const era = this.game.getEra(this.game.humanPlayerId);
      if (era === 1) {
        const bronzeDef = TECH_DEFS[TechType.BRONZE_WORKING];
        const canAfford = player.resources.gold >= bronzeDef.costGold && player.resources.food >= Math.round(bronzeDef.costGold * 0.3);
        if (canAfford && player.techs.canResearch(TechType.BRONZE_WORKING, player.civType)) {
          this.hintOnce('eraAdvanceHint', '💡 ¡Puedes investigar Trabajo en Bronce! → desbloquea Era II y nuevas unidades de combate (pestaña Tecnología)');
        }
      }
    }

    // AI diplomacy proposal notification
    this._updateAIDiploUI();

    const selectedNow = this.input.getSelectedUnits();
    if (selectedNow.length >= 4) {
      this.hintOnce('formation', '💡 Filas cerradas: 3+ aliados a 3 casillas dan +2 defensa y moral un 50% más rápida (insignia ⚔️FILA).');
    }
    if (this.game.humanPlayer.aliveUnits.some(u => u.attackBuildingTarget && u.attackRange <= 1.5)) {
      this.hintOnce('capture', '💡 ¿Sabías? Con Ctrl+clic derecho tus tropas cuerpo a cuerpo CAPTURAN el edificio intacto en vez de destruirlo.');
    }
    if (this.game.humanPlayer.aliveUnits.some(u => u.outOfAmmo)) {
      this.hintOnce('ammo', '💡 Sin munición: las unidades a distancia combaten cuerpo a cuerpo. Retíralas a tu asentamiento para reabastecer automáticamente.');
    } else if (this.game.humanPlayer.aliveUnits.some(u => u.lowAmmo)) {
      this.hintOnce('lowAmmo', '💡 Munición baja (🏹 en ámbar). Retira tus arqueros/ballesteros al asentamiento propio para reabastecer. Pulsa V para descarga sincronizada.');
    }
    // War cry ready hint: after 3 minutes, remind player if hero war cry is available
    if (this.game.gameTime > 180) {
      const hero = this.game.humanPlayer.aliveUnits.find(u => u.isHero);
      if (hero && hero.isAlive() && hero.warCryCooldown === 0) {
        this.hintOnce('warCryReady', '💡 Tu héroe tiene el Grito de Guerra listo — pulsa Y junto a tus tropas para dar +25% de ataque por 12s');
      }
      if (hero && hero.isAlive() && hero.heroCooldown2 === 0) {
        this.hintOnce('heroHReady', '💡 Tu héroe tiene su habilidad especial lista — pulsa H para desatar su poder único');
      }
    }

    this.hud.update(selectedNow);
    this.hud.updateWeatherOverlay(dt);
    this.prodPanel.playerEra = this.game.getEra(this.game.humanPlayerId);
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

    const isEconomic = won && this.game.victoryType === 'ECONOMIC';
    const isWonder   = won && this.game.victoryType === 'WONDER';
    icon.textContent = won ? (isEconomic ? '💰' : isWonder ? '🏛️' : '🏆') : '☠️';
    title.textContent = won ? '¡VICTORIA!' : 'DERROTA';
    title.className = 'endgame-title ' + (won ? 'victory' : 'defeat');
    sub.textContent = won
      ? (isEconomic
          ? '¡Tu riqueza conquistó el continente americano! Victoria económica.'
          : isWonder
          ? '¡Tu Gran Maravilla resistió el asedio y pasó a la historia! Victoria por Maravilla.'
          : '¡Has aplastado a tus enemigos! Victoria militar.')
      : 'Tus fuerzas han sido aniquiladas.';

    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    const maxPop = this.game.getAllUnits().filter(u => u.playerId === this.game.humanPlayerId).length;
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
      <div class="endgame-stat">
        <div class="endgame-stat-val">${this._unitsTrainedCount}</div>
        <div class="endgame-stat-lbl">Unidades entrenadas</div>
      </div>
      <div class="endgame-stat">
        <div class="endgame-stat-val">${maxPop}</div>
        <div class="endgame-stat-lbl">Ejército final</div>
      </div>
      <div class="endgame-stat">
        <div class="endgame-stat-val">${Math.round(this._totalResourcesSpent / 100) * 100}</div>
        <div class="endgame-stat-lbl">Recursos invertidos</div>
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

    // Notification log toggle
    document.getElementById('log-btn')?.addEventListener('click', () => this.hud.toggleLog());
    document.getElementById('nl-close')?.addEventListener('click', () => this.hud.toggleLog());

    // Diplomacy panel
    const diploPanel = document.getElementById('diplomacy-panel');
    document.getElementById('diplomacy-btn')?.addEventListener('click', () => {
      if (diploPanel?.classList.contains('hidden')) {
        this.refreshDiplomacyPanel();
        diploPanel?.classList.remove('hidden');
      } else {
        diploPanel?.classList.add('hidden');
      }
    });
    document.getElementById('diplo-close')?.addEventListener('click', () => {
      diploPanel?.classList.add('hidden');
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

  private _diploTargetId: number = -1;

  private refreshDiplomacyPanel() {
    const list = document.getElementById('diplo-relations-list')!;
    list.innerHTML = '';
    const relations = this.game.getDiplomacyRelations(this.game.humanPlayerId);

    for (const r of relations) {
      const player = this.game.players[r.targetId];
      if (!player) continue;
      const civDef = CIVILIZATIONS[player.civType];
      const row = document.createElement('div');
      row.className = 'diplo-relation-row';
      const badge = r.relation === 'ALLY' ? 'ally' : r.relation === 'NEUTRAL' ? 'neutral' : 'enemy';
      const badgeLabel = r.relation === 'ALLY' ? '🤝 Aliado' : r.relation === 'NEUTRAL' ? '☮️ Paz' : '⚔️ Enemigo';
      row.innerHTML = `
        <span class="diplo-civ-emoji">${civDef.emoji}</span>
        <span class="diplo-civ-name">${civDef.name}</span>
        <span class="diplo-status-badge ${badge}">${badgeLabel}</span>
      `;
      row.addEventListener('click', () => {
        this._diploTargetId = r.targetId;
        const nameEl = document.getElementById('diplo-target-name');
        if (nameEl) nameEl.textContent = `${civDef.emoji} ${civDef.name}`;
        document.getElementById('diplo-result')!.textContent = '';
        document.getElementById('diplo-proposal-section')?.classList.remove('hidden');
        const tributeNameEl = document.getElementById('diplo-tribute-target-name');
        if (tributeNameEl) tributeNameEl.textContent = `${civDef.emoji} ${civDef.name}`;
        document.getElementById('diplo-tribute-result')!.textContent = '';
        document.getElementById('diplo-tribute-section')?.classList.remove('hidden');
      });
      list.appendChild(row);
    }

    // Proposal buttons
    const propose = (relation: AllianceType) => {
      const bribe = parseInt((document.getElementById('diplo-bribe') as HTMLInputElement)?.value ?? '0', 10) || 0;
      const result = this.game.proposeDiplomacy(this.game.humanPlayerId, this._diploTargetId, relation, bribe);
      const resultEl = document.getElementById('diplo-result')!;
      if (result === 'accepted') {
        resultEl.style.color = '#88ffaa';
        resultEl.textContent = '✅ ¡Propuesta aceptada!';
        this.hud.notify('🤝 Propuesta diplomática aceptada', 'info');
        this.refreshDiplomacyPanel();
      } else if (result === 'rejected') {
        resultEl.style.color = '#ff9999';
        resultEl.textContent = '❌ Propuesta rechazada';
        this.hud.notify('❌ Propuesta rechazada por el rival', 'warning');
      }
    };

    document.getElementById('diplo-propose-neutral')?.addEventListener('click', () => propose(AllianceType.NEUTRAL));
    document.getElementById('diplo-propose-ally')?.addEventListener('click',    () => propose(AllianceType.ALLY));
    document.getElementById('diplo-propose-war')?.addEventListener('click',     () => propose(AllianceType.ENEMY));

    document.getElementById('diplo-tribute-demand')?.addEventListener('click', () => {
      const amt = parseInt((document.getElementById('diplo-tribute-amount') as HTMLInputElement)?.value ?? '100', 10) || 100;
      const result = this.game.demandTribute(this.game.humanPlayerId, this._diploTargetId, amt);
      const resEl = document.getElementById('diplo-tribute-result')!;
      if (result === 'accepted') {
        resEl.style.color = '#ffdd55';
        resEl.textContent = `✅ ¡Tributo de ${amt}⚜️ entregado!`;
        this.hud.notify(`💰 Tributo aceptado: +${amt}⚜️ oro`, 'success');
        this.refreshDiplomacyPanel();
      } else {
        resEl.style.color = '#ff9999';
        resEl.textContent = '❌ ¡Se niegan! Esto podría desencadenar guerra';
        this.hud.notify('💢 ¡Exigencia rechazada! Pueden declarar la guerra', 'warning');
      }
    });
  }

  private _showEraAdvanceOverlay(era: 2 | 3) {
    const overlay  = document.getElementById('era-advance-overlay');
    const iconEl   = document.getElementById('era-advance-icon');
    const titleEl  = document.getElementById('era-advance-title');
    const subEl    = document.getElementById('era-advance-sub');
    const bonusEl  = document.getElementById('era-advance-bonus');
    if (!overlay) return;

    const ERA_DATA = {
      2: { icon: '⚔️', title: '¡ERA II — COLONIAL!', sub: 'Jinetes · Arquebuceros · élites desbloqueados', bonus: '+150🌽 +80⚜️ +60🪨 · +20 moral a todas las tropas' },
      3: { icon: '💣', title: '¡ERA III — IMPERIAL!', sub: 'Cañones · guerreros supremos disponibles',       bonus: '+200🌽 +120⚜️ +80🪨 · +20 moral a todas las tropas' },
    };
    const d = ERA_DATA[era];
    if (iconEl)  iconEl.textContent  = d.icon;
    if (titleEl) titleEl.textContent = d.title;
    if (subEl)   subEl.textContent   = d.sub;
    if (bonusEl) bonusEl.textContent = d.bonus;

    overlay.classList.remove('hidden');
    (overlay as HTMLElement).style.background = 'rgba(0,0,0,0.55)';
    this.hud.notify(`🏺 ¡NUEVA ERA! ${d.sub}`, 'success');

    setTimeout(() => {
      (overlay as HTMLElement).style.background = 'rgba(0,0,0,0)';
      setTimeout(() => overlay.classList.add('hidden'), 400);
    }, 4000);
  }

  private _villageAllianceTargetId = -1;

  private _showVillageAlliancePrompt(buildingId: number) {
    this._villageAllianceTargetId = buildingId;
    const el = document.getElementById('village-alliance-prompt');
    const canAfford = this.game.humanPlayer.resources.gold >= 80;
    const btn = document.getElementById('village-alliance-accept') as HTMLButtonElement | null;
    if (btn) {
      btn.textContent = canAfford ? '🤝 Aliarse (80⚜️)' : `Sin oro (80⚜️ necesario)`;
      btn.disabled = !canAfford;
    }
    el?.classList.remove('hidden');
  }

  private _bindVillageAllianceButtons() {
    document.getElementById('village-alliance-accept')?.addEventListener('click', () => {
      const ok = this.game.allyWithVillage(this._villageAllianceTargetId);
      if (ok) {
        this.hud.notify('🤝 ¡Alianza! La aldea enviará un guerrero cada 90s', 'success');
        this.hintOnce('villageAlliance', '💡 Aldeas aliadas envían guerreros cada 90s mientras no sean capturadas.');
      } else {
        this.hud.notify('🤝 Sin oro suficiente (necesitas 80⚜️)', 'warning');
      }
      document.getElementById('village-alliance-prompt')?.classList.add('hidden');
    });
    document.getElementById('village-alliance-reject')?.addEventListener('click', () => {
      document.getElementById('village-alliance-prompt')?.classList.add('hidden');
    });
  }

  private _showHistoricalEventOverlay(msg: string) {
    const el = document.getElementById('hist-event-overlay');
    const textEl = document.getElementById('hist-event-text');
    const scoreEl = document.getElementById('hist-event-score');
    if (!el || !textEl) return;
    const dash = msg.indexOf(' — ');
    if (dash >= 0) {
      textEl.innerHTML = `<span style="color:#ffd700;font-weight:900;font-size:18px">${msg.slice(0, dash)}</span><br><span style="color:#fff;font-size:13px">${msg.slice(dash + 3)}</span>`;
    } else {
      textEl.textContent = msg;
    }
    if (scoreEl) {
      const myScore  = this.game.getConquestScore(this.game.humanPlayerId);
      const topScore = Math.max(...this.game.players.filter(p => p.id !== this.game.humanPlayerId && !p.isDefeated()).map(p => this.game.getConquestScore(p.id)), 0);
      const leading  = myScore >= topScore;
      scoreEl.textContent = `⚡ Tu poder de conquista: ${myScore} pts ${leading ? '🏆 Liderando' : `(rival: ${topScore})`}`;
    }
    el.classList.remove('hidden');
    (el as HTMLElement).style.opacity = '1';
    this.hud.notify(msg.slice(0, 60) + (msg.length > 60 ? '…' : ''), 'success');
    this.audio.playBuild();
    setTimeout(() => {
      (el as HTMLElement).style.opacity = '0';
      setTimeout(() => el.classList.add('hidden'), 500);
    }, 5000);
  }

  private _aiDiploShown = false;

  private _updateAIDiploUI() {
    const proposal = this.game.pendingAIDiploProposal;
    const el = document.getElementById('ai-diplo-proposal');
    if (!el) return;

    if (!proposal) {
      el.classList.add('hidden');
      this._aiDiploShown = false;
      return;
    }

    if (!this._aiDiploShown) {
      this._aiDiploShown = true;
      const civPlayer = this.game.players[proposal.fromId];
      if (!civPlayer) return;
      const civDef = CIVILIZATIONS[civPlayer.civType];
      const nameEl  = document.getElementById('ai-diplo-civ-name');
      const emojiEl = document.getElementById('ai-diplo-civ-emoji');
      if (nameEl)  nameEl.textContent  = civDef.name;
      if (emojiEl) emojiEl.textContent = civDef.emoji;
      el.classList.remove('hidden');
    }
  }

  private _bindAIDiploButtons() {
    document.getElementById('ai-diplo-accept')?.addEventListener('click', () => {
      const p = this.game.pendingAIDiploProposal;
      if (!p) return;
      const civPlayer = this.game.players[p.fromId];
      const civDef = civPlayer ? CIVILIZATIONS[civPlayer.civType] : null;
      this.game.respondToAIDiplomacy(true);
      this.hud.notify(`☮️ Tregua aceptada — ${civDef?.name ?? 'el rival'} detiene sus ataques`, 'info');
      document.getElementById('ai-diplo-proposal')?.classList.add('hidden');
      this._aiDiploShown = false;
    });
    document.getElementById('ai-diplo-reject')?.addEventListener('click', () => {
      const p = this.game.pendingAIDiploProposal;
      const civPlayer = p ? this.game.players[p.fromId] : null;
      const civDef = civPlayer ? CIVILIZATIONS[civPlayer.civType] : null;
      this.game.respondToAIDiplomacy(false);
      this.hud.notify(`⚔️ Tregua rechazada — ¡${civDef?.name ?? 'el rival'} continuará la guerra!`, 'warning');
      document.getElementById('ai-diplo-proposal')?.classList.add('hidden');
      this._aiDiploShown = false;
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

      // Cheat codes (AC Easter egg) — buffer last 16 chars
      if (!e.ctrlKey && !e.altKey && e.key.length === 1) {
        this._cheatBuffer = (this._cheatBuffer + e.key.toLowerCase()).slice(-16);
        this._checkCheatCodes();
      }

      // Escape: deselect all, close panels
      if (e.code === 'Escape') {
        if (this._placingType) { this._cancelPlacing(); return; }
        this.input.setAttackMoveMode(false);
        for (const u of this.game.getAllUnits()) u.setSelected(false);
        this._panelBuilding = null;
        this.renderer.clearRallyMarker();
        this.renderer.clearRangeRing();
        this.renderer.clearPatrolPath();
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
      // Tab: center camera on human hero
      if (e.code === 'Tab') {
        e.preventDefault();
        const hero = this.game.getAllUnits().find(u => u.playerId === this.game.humanPlayerId && u.isHero && u.isAlive());
        if (hero) {
          for (const u of this.game.getAllUnits()) u.setSelected(false);
          hero.setSelected(true);
          this.camera.panTo(hero.worldX, hero.worldZ);
          this.hud.update(this.input.getSelectedUnits());
          this.hud.notify(`${hero.def.emoji} ${hero.heroName} localizado`, 'info');
        } else {
          const t = this.game.getHeroRespawnTimer(this.game.humanPlayerId);
          this.hud.notify(t !== undefined ? `⏳ Héroe reaparecerá en ${Math.ceil(t)}s` : 'Sin héroe activo', 'info');
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
      // G: focus fire — all selected units attack the nearest/weakest visible enemy
      if (e.code === 'KeyG' && !e.ctrlKey && !e.altKey) {
        const sel = this.input.getSelectedUnits().filter(u => u.playerId === this.game.humanPlayerId && u.isAlive());
        if (sel.length === 0) return;
        const enemies = this.game.getAllUnits().filter(u => u.playerId !== this.game.humanPlayerId && u.isAlive() && u.garrisonedIn === null);
        if (enemies.length === 0) { this.hud.notify('Sin enemigos en rango', 'info'); return; }
        const maxSight = Math.max(...sel.map(u => u.sight));
        const cx = sel.reduce((s, u) => s + u.col, 0) / sel.length;
        const cz = sel.reduce((s, u) => s + u.row, 0) / sel.length;
        let best: Unit | null = null;
        let bestScore = Infinity;
        for (const en of enemies) {
          const dist = Math.sqrt((en.col - cx) ** 2 + (en.row - cz) ** 2);
          if (dist > maxSight * 1.5) continue;
          // Prefer low-HP targets close to the group
          const score = (en.hp / en.maxHp) * 0.6 + (dist / maxSight) * 0.4;
          if (score < bestScore) { bestScore = score; best = en; }
        }
        if (best) {
          for (const u of sel) u.attackUnit(best);
          this.hud.notify(`🎯 Fuego concentrado — ${best.def.emoji} ${best.def.name}`, 'info');
          this.audio.playClick();
        } else {
          this.hud.notify('Sin enemigos en rango de visión', 'info');
        }
        return;
      }
      // Ctrl+A: select all human units
      if (e.code === 'KeyA' && e.ctrlKey) {
        e.preventDefault();
        for (const u of this.game.getAllUnits()) {
          u.setSelected(u.isAlive() && u.playerId === this.game.humanPlayerId && u.garrisonedIn === null);
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
      // I: cycle through idle military units (find next, select & center)
      if (e.code === 'KeyI' && !e.ctrlKey && !e.altKey) {
        const idle = this.game.humanPlayer.aliveUnits.filter(u => u.state === UnitState.IDLE && u.garrisonedIn === null);
        if (idle.length === 0) { this.hud.notify('Sin unidades inactivas', 'info'); return; }
        this._idleUnitIdx = this._idleUnitIdx % idle.length;
        const u = idle[this._idleUnitIdx];
        this._idleUnitIdx++;
        for (const x of this.game.getAllUnits()) x.setSelected(false);
        u.setSelected(true);
        this.camera.panTo(u.worldX, u.worldZ);
        this.hud.update(this.input.getSelectedUnits());
        this.hud.notify(`🔍 Unidad inactiva seleccionada (${this._idleUnitIdx}/${idle.length})`, 'info');
        return;
      }
      // M: select all critically wounded units (<50% HP) — combine with J to retreat them
      if (e.code === 'KeyM' && !e.ctrlKey && !e.altKey) {
        const wounded = this.game.humanPlayer.aliveUnits.filter(
          u => !u.isHero && u.hp < u.maxHp * 0.5 && u.garrisonedIn === null,
        );
        if (wounded.length === 0) { this.hud.notify('Ninguna unidad gravemente herida', 'info'); return; }
        for (const u of this.game.getAllUnits()) u.setSelected(false);
        for (const u of wounded) u.setSelected(true);
        this.input.onSelectionChange?.();
        const cx = wounded.reduce((s, u) => s + u.col, 0) / wounded.length * TILE_SIZE;
        const cz = wounded.reduce((s, u) => s + u.row, 0) / wounded.length * TILE_SIZE;
        this.camera.panTo(cx, cz);
        this.hud.notify(
          `🩸 ${wounded.length} unidad${wounded.length !== 1 ? 'es' : ''} grave${wounded.length !== 1 ? 'mente heridas' : 'mente herida'} — usa J para retirarlas`,
          'warning',
        );
        return;
      }
      // O: select all units currently engaged in active combat
      if (e.code === 'KeyO' && !e.ctrlKey && !e.altKey) {
        const engaged = this.game.humanPlayer.aliveUnits.filter(
          u => !u.isHero && u.garrisonedIn === null &&
               (u.state === UnitState.ATTACKING || u.state === UnitState.ATTACK_MOVE),
        );
        if (engaged.length === 0) { this.hud.notify('Ninguna unidad en combate activo', 'info'); return; }
        for (const u of this.game.getAllUnits()) u.setSelected(false);
        for (const u of engaged) u.setSelected(true);
        this.input.onSelectionChange?.();
        const cx = engaged.reduce((s, u) => s + u.col, 0) / engaged.length * TILE_SIZE;
        const cz = engaged.reduce((s, u) => s + u.row, 0) / engaged.length * TILE_SIZE;
        this.camera.panTo(cx, cz);
        this.hud.notify(`⚔️ ${engaged.length} unidad${engaged.length !== 1 ? 'es' : ''} en combate seleccionada${engaged.length !== 1 ? 's' : ''}`, 'info');
        return;
      }
      // S: select ALL idle military units at once (complement to I which cycles one-by-one)
      if (e.code === 'KeyS' && !e.ctrlKey && !e.altKey) {
        const idle = this.game.humanPlayer.aliveUnits.filter(
          u => !u.isHero && u.garrisonedIn === null && u.state === UnitState.IDLE,
        );
        if (idle.length === 0) { this.hud.notify('No hay tropas ociosas', 'info'); return; }
        for (const u of this.game.getAllUnits()) u.setSelected(false);
        for (const u of idle) u.setSelected(true);
        this.input.onSelectionChange?.();
        const cx = idle.reduce((s, u) => s + u.col, 0) / idle.length * TILE_SIZE;
        const cz = idle.reduce((s, u) => s + u.row, 0) / idle.length * TILE_SIZE;
        this.camera.panTo(cx, cz);
        this.hud.notify(`🗡️ ${idle.length} tropa${idle.length !== 1 ? 's' : ''} ociosa${idle.length !== 1 ? 's' : ''} seleccionada${idle.length !== 1 ? 's' : ''} — da órdenes`, 'info');
        return;
      }
      // N: select all units of same type as current selection; no selection → select all idle units
      if (e.code === 'KeyN' && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        const sel = this.input.getSelectedUnits().filter(
          u => u.playerId === this.game.humanPlayerId && u.isAlive() && !u.isHero,
        );
        let target: Unit[];
        let msg: string;
        if (sel.length > 0) {
          const types = new Set(sel.map(u => u.type));
          target = this.game.humanPlayer.aliveUnits.filter(u => !u.isHero && types.has(u.type));
          msg = `🎯 ${target.length} unidad${target.length !== 1 ? 'es del mismo tipo' : ' del mismo tipo'} seleccionada${target.length !== 1 ? 's' : ''}`;
        } else {
          target = this.game.humanPlayer.aliveUnits.filter(u => !u.isHero && u.state === UnitState.IDLE);
          if (target.length === 0) { this.hud.notify('No hay unidades ociosas', 'info'); return; }
          msg = `🗡️ ${target.length} unidad${target.length !== 1 ? 'es ociosas' : ' ociosa'} seleccionada${target.length !== 1 ? 's' : ''}`;
        }
        for (const u of this.game.getAllUnits()) u.setSelected(false);
        for (const u of target) u.setSelected(true);
        this.input.onSelectionChange?.();
        this.hud.notify(msg, 'info');
        return;
      }
      // J: retreat — move selected units to nearest friendly building and break off combat
      if (e.code === 'KeyJ' && !e.ctrlKey && !e.altKey) {
        const sel = this.input.getSelectedUnits().filter(
          u => u.playerId === this.game.humanPlayerId && u.isAlive() && !u.isHero && u.garrisonedIn === null,
        );
        if (sel.length === 0) return;
        const friendlyBuildings = this.game.allBuildings.filter(
          b => b.playerId === this.game.humanPlayerId && b.isAlive() && b.isComplete(),
        );
        if (friendlyBuildings.length === 0) {
          this.hud.notify('Sin edificios amigos hacia donde retroceder', 'info');
          return;
        }
        let retreated = 0;
        for (const u of sel) {
          let best = friendlyBuildings[0];
          let bestD = Math.hypot(u.col - best.col, u.row - best.row);
          for (const b of friendlyBuildings) {
            const d = Math.hypot(u.col - b.col, u.row - b.row);
            if (d < bestD) { bestD = d; best = b; }
          }
          const near = this.game.map.findWalkableNear(best.col, best.row, 3);
          if (!near) continue;
          const path = findPath(this.game.map, u.gridPos(), { col: near[0], row: near[1] }, 400);
          if (path.length > 0) {
            u.attackTarget = null;
            u.attackBuildingTarget = null;
            u.moveTo(path);
            retreated++;
          }
        }
        if (retreated > 0) {
          this.hud.notify(`🏃 ${retreated} unidad${retreated !== 1 ? 'es' : ''} en retirada`, 'info');
        }
        return;
      }
      // K: focus fire — all selected units concentrate on the weakest enemy in range
      if (e.code === 'KeyK' && !e.ctrlKey && !e.altKey) {
        const sel = this.input.getSelectedUnits().filter(
          u => u.playerId === this.game.humanPlayerId && u.isAlive() && !u.panicked && u.garrisonedIn === null,
        );
        if (sel.length === 0) return;
        const enemies = this.game.allUnits.filter(u => u.playerId !== this.game.humanPlayerId && u.isAlive());
        if (enemies.length === 0) { this.hud.notify('Sin enemigos en el campo', 'info'); return; }
        // Selection centroid — prefer nearby enemies; among those pick lowest HP
        const cx = sel.reduce((s, u) => s + u.col, 0) / sel.length;
        const cz = sel.reduce((s, u) => s + u.row, 0) / sel.length;
        const nearby = enemies.filter(e => Math.hypot(e.col - cx, e.row - cz) <= 22);
        const pool = nearby.length > 0 ? nearby : enemies;
        const focus = pool.reduce((best, e) => {
          const scoreE = e.hp + Math.hypot(e.col - cx, e.row - cz) * 0.4;
          const scoreB = best.hp + Math.hypot(best.col - cx, best.row - cz) * 0.4;
          return scoreE < scoreB ? e : best;
        }, pool[0]);
        for (const u of sel) u.attackUnit(focus);
        this.hud.notify(
          `🎯 Fuego concentrado: ${sel.length} unidad${sel.length !== 1 ? 'es' : ''} → ${focus.def.name} (${focus.hp}⚔️)`,
          'info',
        );
        return;
      }
      // H: hero secondary ability (when hero selected) or hold position (otherwise)
      if (e.code === 'KeyH' && !e.ctrlKey && !e.altKey) {
        const sel  = this.input.getSelectedUnits().filter(u => u.playerId === this.game.humanPlayerId);
        const hero = sel.find(u => u.isHero && u.isAlive());
        if (hero) {
          if (hero.heroCooldown2 > 0) {
            this.hud.notify(`🦅 Habilidad del héroe — recarga: ${Math.ceil(hero.heroCooldown2)}s`, 'info');
          } else {
            const allies = this.game.humanPlayer.aliveUnits;
            const civ    = this.game.humanPlayer.civType;
            hero.heroCooldown2 = 60;
            if (civ === CivilizationType.AZTEC) {
              const warriors = allies.filter(
                u => u.isAlive() && !u.isHero &&
                     (u.type === UnitType.EAGLE_WARRIOR || u.type === UnitType.JAGUAR_KNIGHT) &&
                     hero.distanceTo(u) <= 8,
              );
              warriors.forEach(u => { u.berserkTimer = 12; });
              this.hud.notify(`🦅 ¡FRENESÍ DE JAGUAR! ${warriors.length} guerrero${warriors.length !== 1 ? 's' : ''} entran en frenesí +25% daño 12s`, 'warning');
              this.hintOnce('heroH_aztec', '💡 Habilidad de héroe (H): Tlacaelel desata el frenesí de los Guerreros Águila y Jaguar cercanos. Recarga 60s.');
            } else if (civ === CivilizationType.MAYA) {
              let healed = 0;
              allies.filter(u => u.isAlive() && hero.distanceTo(u) <= 8).forEach(u => {
                const target = Math.round(u.maxHp * 0.60);
                if (target > u.hp) { u.heal(target - u.hp); healed++; }
              });
              this.hud.notify(`✨ ¡CURACIÓN ASTRAL! ${healed} unidad${healed !== 1 ? 'es' : ''} restauradas al 60% HP`, 'success');
              this.hintOnce('heroH_maya', '💡 Habilidad de héroe (H): Lady Xoc restaura al 60% HP a todos los aliados cercanos. Recarga 60s.');
            } else if (civ === CivilizationType.INCA) {
              const boosted = allies.filter(u => u.isAlive() && !u.isHero && hero.distanceTo(u) <= 10);
              boosted.forEach(u => {
                if (u.heroSpeedBuff <= 0 && !u.incaBuff) u._preBuffSpeed = u.speed;
                u.speed = Math.min(u.speed * 1.5, u.def.stats.speed * 3.5);
                u.heroSpeedBuff = 15;
              });
              this.hud.notify(`🏔️ ¡CAMINO DEL INCA! ${boosted.length} unidades a velocidad de montaña (+50%) 15s`, 'success');
              this.hintOnce('heroH_inca', '💡 Habilidad de héroe (H): Pachacuti concede velocidad andina a todos los aliados cercanos. Recarga 60s.');
            } else {
              const cavalry = allies.filter(
                u => u.isAlive() && u.type === UnitType.CAVALRY && hero.distanceTo(u) <= 6,
              );
              cavalry.forEach(u => { u.chargeReady = true; });
              this.hud.notify(`⚔️ ¡SANTIAGO Y CIERRA ESPAÑA! ${cavalry.length} caballero${cavalry.length !== 1 ? 's' : ''} listos para cargar`, 'warning');
              this.hintOnce('heroH_conq', '💡 Habilidad de héroe (H): Hernán Cortés lanza la carga de caballería — todos los caballos cercanos cargan de inmediato. Recarga 60s.');
            }
            this.renderer.effects.createExplosion(hero.worldX, 0.8, hero.worldZ, 0.8);
            this.audio.playLevelUp();
          }
        } else if (sel.length > 0) {
          const allHold = sel.every(u => u.state === UnitState.HOLD);
          for (const u of sel) {
            u.path = [];
            u.attackTarget = null;
            u.state = allHold ? UnitState.IDLE : UnitState.HOLD;
          }
          this.hud.notify(allHold ? '🏃 Posición liberada' : '🛡️ ¡Posición de defensa! (+2 defensa)', 'info');
        }
        return;
      }
      // R: retreat selected units to nearest friendly settlement
      if (e.code === 'KeyR' && !e.ctrlKey && !e.altKey) {
        const sel = this.input.getSelectedUnits().filter(u => u.playerId === this.game.humanPlayerId && u.isAlive());
        if (sel.length === 0) return;
        const home = this.game.allBuildings.find(
          b => b.playerId === this.game.humanPlayerId && b.isAlive() && b.isComplete() && b.type === BuildingType.SETTLEMENT,
        );
        if (!home) return;
        let n = 0;
        for (const u of sel) {
          u.attackTarget = null;
          const near = this.game.map.findWalkableNear(home.col, home.row, 5);
          if (!near) continue;
          const path = findPath(this.game.map, u.gridPos(), { col: near[0], row: near[1] }, 300);
          if (path.length > 0) { u.moveTo(path); n++; }
        }
        if (n > 0) {
          // Retreat formation: switch to LOOSE for faster escape
          for (const u of sel) u.setFormation('LOOSE');
          this.hud.notify(`🏃 ${n} unidad${n > 1 ? 'es' : ''} en retirada (💨 formación suelta)`, 'info');
          this.audio.playMove();
        }
        return;
      }
      // C: regroup the army on the hero (consolidate under the officer/morale aura)
      if (e.code === 'KeyC' && !e.ctrlKey && !e.altKey) {
        const hero = this.game.humanPlayer.aliveUnits.find(u => u.isHero);
        if (!hero) {
          const t = this.game.getHeroRespawnTimer(this.game.humanPlayerId);
          this.hud.notify(t !== undefined ? `⏳ Héroe reaparecerá en ${Math.ceil(t)}s` : 'Sin héroe activo para reagrupar', 'info');
          return;
        }
        const sel = this.input.getSelectedUnits().filter(u => u.playerId === this.game.humanPlayerId && u.isAlive() && !u.isHero);
        const army = sel.length > 0 ? sel : this.game.humanPlayer.aliveUnits.filter(u => !u.isHero && u.garrisonedIn === null);
        let n = 0;
        army.forEach((u, i) => {
          const off = this.input.spreadOffset(i, army.length);
          const near = this.game.map.findWalkableNear(hero.col + off[0], hero.row + off[1], 3);
          if (!near) return;
          const path = findPath(this.game.map, u.gridPos(), { col: near[0], row: near[1] }, 300);
          if (path.length > 0) { u.attackTarget = null; u.moveTo(path); n++; }
        });
        if (n > 0) {
          this.camera.panTo(hero.worldX, hero.worldZ);
          this.hud.notify(`🎖️ ${n} unidad${n > 1 ? 'es' : ''} reagrupándose con ${hero.heroName}`, 'info');
          this.audio.playMove();
          this.hintOnce('regroup', '💡 C: reagrupa tu ejército junto al héroe. Las unidades cercanas a un héroe o campeón Nv.3 ganan +2 defensa y recuperan moral más rápido.');
        }
        return;
      }
      // W: assign idle workers to repair the nearest damaged friendly building
      if (e.code === 'KeyW' && !e.ctrlKey && !e.altKey) {
        const myWorkers = this.game.allWorkers.filter(
          w => w.playerId === this.game.humanPlayerId &&
               (w.task === WorkerTask.IDLE || w.task === WorkerTask.RETURNING),
        );
        const damaged = this.game.allBuildings
          .filter(b => b.playerId === this.game.humanPlayerId && b.isAlive() && b.hp < b.maxHp * 0.99)
          .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0]; // most damaged first
        if (!damaged || myWorkers.length === 0) {
          this.hud.notify('🔨 Sin edificios dañados o sin trabajadores disponibles', 'info');
          return;
        }
        let sent = 0;
        for (const w of myWorkers.slice(0, 2)) {
          const near = this.game.map.findWalkableNear(damaged.col, damaged.row, 2);
          if (!near) continue;
          const path = findPath(this.game.map, { col: w.col, row: w.row }, { col: near[0], row: near[1] }, 200);
          if (path.length > 0) {
            w.path = path; w.pathIndex = 0; w.task = WorkerTask.MOVING;
            // Set repair task once arrived — we chain it via repairTarget
            w.repairTarget = damaged;
          } else {
            w.task = WorkerTask.REPAIRING;
            w.repairTarget = damaged;
          }
          sent++;
        }
        if (sent > 0) {
          this.hud.notify(`🔨 ${sent} trabajador${sent > 1 ? 'es' : ''} reparando ${damaged.def.name}`, 'info');
          this.hintOnce('repair', '💡 W: envía trabajadores a reparar el edificio más dañado. Los trabajadores reparan 5× más rápido que la reparación automática.');
        }
        return;
      }
      // T: manual trade — convert excess resources (30 s cooldown)
      if (e.code === 'KeyT' && !e.ctrlKey && !e.altKey) {
        if (this._tradeCooldown > 0) {
          this.hud.notify(`🛶 Próximo comercio en ${Math.ceil(this._tradeCooldown)}s`, 'info');
          return;
        }
        const p = this.game.humanPlayer;
        const FOOD_TO_GOLD = 100; const GOLD_REWARD = 60;
        const GOLD_TO_FOOD = 60;  const FOOD_REWARD = 100;
        if (p.resources.food >= p.resources.gold && p.resources.food >= FOOD_TO_GOLD) {
          p.resources.food -= FOOD_TO_GOLD;
          p.resources.gold = Math.min(2000, p.resources.gold + GOLD_REWARD);
          this.hud.notify(`🛶 Ruta comercial: -${FOOD_TO_GOLD}🌽 → +${GOLD_REWARD}⚜️`, 'info');
          this._tradeCooldown = 30;
        } else if (p.resources.gold >= GOLD_TO_FOOD) {
          p.resources.gold -= GOLD_TO_FOOD;
          p.resources.food = Math.min(2000, p.resources.food + FOOD_REWARD);
          this.hud.notify(`🛶 Ruta comercial: -${GOLD_TO_FOOD}⚜️ → +${FOOD_REWARD}🌽`, 'info');
          this._tradeCooldown = 30;
        } else {
          this.hud.notify('🛶 Sin recursos suficientes para comerciar (100🌽 ó 60⚜️)', 'warning');
        }
        this.hintOnce('trade', '💡 T: ruta comercial — convierte alimentos excedentes en oro o viceversa (30 s de recarga).');
        return;
      }
      // Q: auto-assign idle workers to nearest resource
      if (e.code === 'KeyQ' && !e.ctrlKey && !e.altKey) {
        this.autoAssignWorkers();
        return;
      }
      // U: eject garrison (selected building first, else any own garrisoned building)
      if (e.code === 'KeyU' && !e.ctrlKey && !e.altKey) {
        const b = this._panelBuilding && this._panelBuilding.garrison.length > 0
          ? this._panelBuilding
          : this.game.allBuildings.find(x => x.playerId === this.game.humanPlayerId && x.garrison.length > 0);
        if (b) {
          const out = this.game.ejectGarrison(b);
          if (out.length > 0) {
            this.hud.notify(`🏰 ${out.length} unidad${out.length > 1 ? 'es' : ''} desalojada${out.length > 1 ? 's' : ''}`, 'info');
            this.audio.playMove();
          }
        } else {
          this.hud.notify('Sin guarniciones que desalojar', 'info');
        }
        return;
      }
      // Y: hero war cry — rally nearby allies (+30 morale, +25% atk buff for 12s)
      if (e.code === 'KeyY' && !e.ctrlKey && !e.altKey) {
        const hero = this.input.getSelectedUnits().find(u => u.isHero && u.isAlive());
        if (hero) {
          const allies = this.game.humanPlayer.aliveUnits;
          const count = hero.triggerWarCry(allies);
          if (count > 0) {
            this.hud.notify(`📯 ¡GRITO DE GUERRA! ${count} unidad${count > 1 ? 'es' : ''} en llamas — +25% atk 12s`, 'success');
            this.audio.playLevelUp();
            this.hintOnce('warCry', '💡 Grito de guerra (Y): el héroe infunde valor a aliados cercanos — +30 moral, +25% atk 12s. Rompe el pánico. Recarga: 45s.');
          } else if (hero.warCryCooldown > 0) {
            this.hud.notify(`📯 Recarga: ${Math.ceil(hero.warCryCooldown)}s`, 'info');
          }
        } else {
          this.hud.notify('📯 Selecciona al héroe para usar el grito de guerra (Y)', 'info');
        }
        return;
      }
      // F1-F3: formation orders; F4: clear formation
      if (e.code === 'F1' || e.code === 'F2' || e.code === 'F3' || e.code === 'F4') {
        e.preventDefault();
        const sel = this.input.getSelectedUnits().filter(u => u.isAlive());
        if (sel.length > 0) {
          const orders: Record<string, string | null> = { F1: 'LOOSE', F2: 'PHALANX', F3: 'WEDGE', F4: null };
          const labels: Record<string, string> = {
            F1: '💨 Formación suelta — veloz, frágil',
            F2: '🛡️ Falange — máxima defensa',
            F3: '⚔️ Cuña — máximo ataque',
            F4: 'Formación libre',
          };
          for (const u of sel) u.setFormation(orders[e.code] ?? null);
          this.hud.notify(labels[e.code] ?? '', 'info');
          this.hintOnce('formation_order', '💡 Formaciones (F1/F2/F3): SUELTA=+veloc., FALANGE=+def., CUÑA=+atk. Cancela con F4. El ícono aparece en el panel de unidad.');
          if (e.code === 'F2' && sel.filter(u => u.playerId === this.game.humanPlayerId).length >= 3) {
            this.hintOnce('shield_wall', '💡 Muro de escudos: 3+ unidades en Falange a ≤2.5 casillas forman un MURO — proyectiles enemigos −40%. ¡Úsalo para defender choke points!');
          }
        }
        return;
      }
      // V: volley fire — selected ranged units with a live target fire simultaneously (2.5× burst)
      if (e.code === 'KeyV' && !e.ctrlKey && !e.altKey) {
        const ranged = this.input.getSelectedUnits().filter(u => u.ammo > 0 && u.attackTarget?.isAlive());
        if (ranged.length > 0) {
          for (const u of ranged) u.volleyReady = true;
          this.hud.notify(`🔫 ¡DESCARGA! ${ranged.length} unidad${ranged.length > 1 ? 'es' : ''} — daño ×2.5`, 'warning');
          this.audio.playShot();
          this.hintOnce('volley', '💡 ¡Descarga sincronizada! Todas las unidades a distancia seleccionadas disparan a la vez con ×2.5 de daño. Recarga 50% más lenta.');
        } else {
          const outOfAmmo = this.input.getSelectedUnits().filter(u => u.outOfAmmo);
          if (outOfAmmo.length > 0) {
            this.hud.notify('🏹 Sin munición — retira tus unidades a un asentamiento propio para reabastecer', 'warning');
            this.hintOnce('ammo', '💡 Sin munición: las unidades a distancia combaten cuerpo a cuerpo. Retíralas a tu asentamiento para reabastecer automáticamente.');
          }
        }
        return;
      }
      // E: activate civilization power
      if (e.code === 'KeyE' && !e.ctrlKey && !e.altKey) {
        this.triggerCivPower();
        return;
      }
      // Z: rally ALL human units to the hero (or to settlement if hero is absent)
      if (e.code === 'KeyZ' && !e.ctrlKey && !e.altKey) {
        const hero = this.game.humanPlayer.aliveUnits.find(u => u.isHero);
        const rallySrc = hero ?? this.game.allBuildings.find(
          b => b.playerId === this.game.humanPlayerId && b.isAlive() && b.type === BuildingType.SETTLEMENT,
        );
        if (!rallySrc) return;
        const rc = 'col' in rallySrc ? rallySrc.col : (rallySrc as import('./game/Unit').Unit).col;
        const rr = 'row' in rallySrc ? rallySrc.row : (rallySrc as import('./game/Unit').Unit).row;
        const near = this.game.map.findWalkableNear(rc, rr, 5);
        if (!near) return;
        let rallied = 0;
        for (const u of this.game.humanPlayer.aliveUnits) {
          if (u.isHero || u.garrisonedIn !== null) continue;
          const path = findPath(this.game.map, u.gridPos(), { col: near[0], row: near[1] }, 400);
          if (path.length > 0) { u.moveTo(path); rallied++; }
        }
        if (rallied > 0) {
          this.hud.notify(`📯 ${rallied} unidad${rallied > 1 ? 'es' : ''} reuniéndose${hero ? ' con el héroe' : ' en el asentamiento'}`, 'success');
        }
        return;
      }
      // X: toggle entrench — selected units dig in (+5 def, HOLD state; cancelled by movement)
      if (e.code === 'KeyX' && !e.ctrlKey && !e.altKey) {
        const sel = this.input.getSelectedUnits().filter(u => u.playerId === this.game.humanPlayerId && u.isAlive());
        if (sel.length === 0) return;
        const willEntrench = !sel.every(u => u.entrenched);
        for (const u of sel) {
          if (willEntrench && u.entrenched) continue;
          u.entrench();
        }
        if (willEntrench) {
          this.hud.notify(`🏕️ ${sel.length} unidad${sel.length > 1 ? 'es' : ''} atrincherada${sel.length > 1 ? 's' : ''} — +7 def total · pulsa X o mueve para salir`, 'info');
          this.hintOnce('entrench', '💡 Fortín (X): unidades en posición defensiva — +2 HOLD +5 fortín = +7 defensa total. Atrincherarse es ideal en alturas o pasos estrechos. Se cancela al mover.');
        } else {
          this.hud.notify('🏕️ Posición abandonada', 'info');
        }
        return;
      }
      // + / = : speed up;  - : slow down
      if (e.key === '+' || e.key === '=') {
        this._gameSpeed = Math.min(3.0, parseFloat((this._gameSpeed + 0.5).toFixed(1)));
        this.hud.notify(`⏩ Velocidad ${this._gameSpeed}x`, 'info');
        this.updateSpeedIndicator();
        return;
      }
      if (e.key === '-' || e.key === '_') {
        this._gameSpeed = Math.max(0.5, parseFloat((this._gameSpeed - 0.5).toFixed(1)));
        this.hud.notify(`⏪ Velocidad ${this._gameSpeed}x`, 'info');
        this.updateSpeedIndicator();
        return;
      }
      // L: toggle notification log
      if (e.code === 'KeyL' && !e.ctrlKey && !e.altKey) {
        this.hud.toggleLog();
        return;
      }

      // D: toggle diplomacy panel
      if (e.code === 'KeyD' && !e.ctrlKey && !e.altKey) {
        const diploPanel = document.getElementById('diplomacy-panel');
        if (diploPanel?.classList.contains('hidden')) {
          this.refreshDiplomacyPanel();
          diploPanel?.classList.remove('hidden');
        } else {
          diploPanel?.classList.add('hidden');
        }
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
          this.prodPanel.playerEra = this.game.getEra(this.game.humanPlayerId);
          this.prodPanel.show(settlement, this.game.humanPlayer);
        }
        return;
      }
      // 1-4 when production panel is open on train tab: train unit
      if (!e.ctrlKey && !e.altKey && /^Digit[1-4]$/.test(e.code) &&
          this.prodPanel.isVisible && this.prodPanel.currentTab === 'train') {
        e.preventDefault();
        const idx = parseInt(e.code.replace('Digit', '')) - 1;
        const units = this.prodPanel.getTrainableUnits();
        if (idx < units.length) this.prodPanel.onTrain?.(units[idx]);
        return;
      }
      // Ctrl+Shift+1-5: save camera bookmark
      if (e.ctrlKey && e.shiftKey && /^Digit[1-5]$/.test(e.code)) {
        e.preventDefault();
        const n = parseInt(e.code.replace('Digit', ''));
        const { x, z } = this.camera.getPosition();
        this._camBookmarks.set(n, { x, z });
        this.hud.notify(`📍 Posición ${n} guardada`, 'info');
        return;
      }
      // Shift+1-5 (no ctrl): jump to camera bookmark
      if (!e.ctrlKey && e.shiftKey && /^Digit[1-5]$/.test(e.code) && !this.prodPanel.isVisible) {
        e.preventDefault();
        const n = parseInt(e.code.replace('Digit', ''));
        const bm = this._camBookmarks.get(n);
        if (bm) {
          this.camera.panTo(bm.x, bm.z);
          this.hud.notify(`📍 Posición ${n}`, 'info');
        } else {
          this.hud.notify(`📍 Posición ${n} vacía — usa Ctrl+Shift+${n} para guardar`, 'info');
        }
        return;
      }
      // Alt+1-4: sub-select by unit type
      // If units are currently selected → narrow to that type; if nothing selected → global type select
      // Alt+P: cycle target priority for selected units (NEAREST → WEAKEST → STRONGEST)
      if (e.code === 'KeyP' && e.altKey && !e.ctrlKey) {
        e.preventDefault();
        const sel = this.input.getSelectedUnits().filter(u => u.playerId === this.game.humanPlayerId);
        if (sel.length === 0) { this.hud.notify('Selecciona unidades para cambiar prioridad de ataque', 'info'); return; }
        const cur = sel[0].targetPriority;
        const next: 'NEAREST' | 'WEAKEST' | 'STRONGEST' =
          cur === 'NEAREST' ? 'WEAKEST' : cur === 'WEAKEST' ? 'STRONGEST' : 'NEAREST';
        for (const u of sel) u.targetPriority = next;
        const label = next === 'NEAREST' ? '🎯 Más cercano' : next === 'WEAKEST' ? '💔 Más débil' : '💪 Más fuerte';
        this.hud.notify(`🎯 Prioridad de ataque → ${label} (${sel.length} unidad${sel.length !== 1 ? 'es' : ''})`, 'info');
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.shiftKey && /^Digit[1-4]$/.test(e.code)) {
        e.preventDefault();
        const digit = parseInt(e.code.replace('Digit', ''));
        type TypeFilter = { label: string; emoji: string; test: (u: Unit) => boolean };
        const filters: Record<number, TypeFilter> = {
          1: { label: 'infantería de melé',   emoji: '🗡️',  test: u => !u.def.isRanged && !u.def.isCavalry && u.type !== UnitType.CANNON && !u.isHero },
          2: { label: 'unidades a distancia', emoji: '🏹',  test: u => u.def.isRanged },
          3: { label: 'caballería',            emoji: '🐎',  test: u => u.def.isCavalry },
          4: { label: 'artillería',            emoji: '💣',  test: u => u.type === UnitType.CANNON },
        };
        const f = filters[digit];
        if (!f) return;
        const current = this.input.getSelectedUnits().filter(u => u.playerId === this.game.humanPlayerId && !u.garrisonedIn);
        const pool = current.length > 0 ? current : this.game.humanPlayer.aliveUnits.filter(u => u.garrisonedIn === null);
        const typed = pool.filter(f.test);
        if (typed.length === 0) {
          this.hud.notify(`Sin ${f.label} en ${current.length > 0 ? 'la selección' : 'el ejército'}`, 'info');
          return;
        }
        for (const u of this.game.getAllUnits()) u.setSelected(false);
        for (const u of typed) u.setSelected(true);
        this.input.onSelectionChange?.();
        const cx = typed.reduce((s, u) => s + u.col, 0) / typed.length * TILE_SIZE;
        const cz = typed.reduce((s, u) => s + u.row, 0) / typed.length * TILE_SIZE;
        this.camera.panTo(cx, cz);
        const ctx = current.length > 0 ? 'selección' : 'ejército';
        this.hud.notify(`${f.emoji} ${typed.length} ${f.label} del ${ctx} seleccionada${typed.length !== 1 ? 's' : ''}`, 'info');
        return;
      }
      // Ctrl+1-5: save unit group
      if (e.ctrlKey && /^Digit[1-5]$/.test(e.code)) {
        e.preventDefault();
        const n = parseInt(e.code.replace('Digit', ''));
        const sel = this.input.getSelectedUnits();
        this.unitGroups.set(n, sel.map(u => u.id));
        this.hud.notify(`Grupo ${n} guardado — ${sel.length} unidades`, 'info');
        this.updateCtrlGroupsBar();
        return;
      }
      // 1-5 (no ctrl): recall unit group + center camera (skip when production panel is focused)
      if (!e.ctrlKey && !e.altKey && /^Digit[1-5]$/.test(e.code) && !this.prodPanel.isVisible) {
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
        this.flashCtrlGroupSlot(n);
        this.hud.update(this.input.getSelectedUnits());
        return;
      }
    });

    // Click on control group slots to recall
    for (let n = 1; n <= 5; n++) {
      const slot = document.getElementById(`cg-slot-${n}`);
      slot?.addEventListener('click', () => {
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
        this.flashCtrlGroupSlot(n);
        this.hud.update(this.input.getSelectedUnits());
      });
    }
  }

  private _checkCheatCodes() {
    const b = this._cheatBuffer;
    const player = this.game.humanPlayer;
    if (b.endsWith('dorado')) {
      player.resources.gold += 500;
      this.hud.notify('💰 ¡El Dorado! +500 ⚜️', 'success');
      this._cheatBuffer = '';
    } else if (b.endsWith('maiz')) {
      player.resources.food += 500;
      this.hud.notify('🌽 ¡Milpa sagrada! +500 🌽', 'success');
      this._cheatBuffer = '';
    } else if (b.endsWith('piedra')) {
      player.resources.stone += 500;
      this.hud.notify('⛏️ ¡Cantera inca! +500 🪨', 'success');
      this._cheatBuffer = '';
    } else if (b.endsWith('madera')) {
      player.resources.wood += 500;
      this.hud.notify('🪵 ¡Selva amazónica! +500 🪵', 'success');
      this._cheatBuffer = '';
    } else if (b.endsWith('conquistar')) {
      // Reveal full map (clear fog of war)
      this.game.fog.revealAll(this.game.humanPlayerId);
      this.hud.notify('🗺️ ¡Mapa revelado! — Visión total', 'success');
      this._cheatBuffer = '';
    } else if (b.endsWith('ejercito')) {
      // Spawn 5 free warriors for the human player
      const settlement = this.game.allBuildings.find(
        b2 => b2.playerId === this.game.humanPlayerId && b2.type === BuildingType.SETTLEMENT && b2.isAlive(),
      );
      if (settlement) {
        for (let i = 0; i < 5; i++) {
          this.game.spawnFreeUnit(player, settlement.col + 2 + i, settlement.row + 3);
        }
        this.hud.notify('⚔️ ¡Legión divina! 5 guerreros invocados', 'success');
      }
      this._cheatBuffer = '';
    }
  }

  private updateSpeedIndicator() {
    const el = document.getElementById('speed-indicator');
    if (!el) return;
    if (this._gameSpeed === 1.0) {
      el.classList.add('hidden');
    } else {
      el.textContent = `⚡ ×${this._gameSpeed}`;
      el.classList.remove('hidden');
    }
  }

  private updateFpsCounter(rawDt: number) {
    this._fpsFrames++;
    this._fpsAccum += rawDt;
    if (this._fpsAccum >= 0.5) {
      this._fpsDisplay = Math.round(this._fpsFrames / this._fpsAccum);
      this._fpsFrames = 0;
      this._fpsAccum  = 0;
      const el = document.getElementById('fps-counter');
      if (el) {
        const showFps = this.settings.settings.showFPS;
        el.classList.toggle('hidden', !showFps);
        if (showFps) el.textContent = `${this._fpsDisplay} FPS`;
      }
    }
  }

  private _cancelPlacing() {
    this._placingType = null;
    this.input.setPlacingMode(false);
    this.renderer.hideGhost();
  }

  private triggerCivPower() {
    const sel = this.input.getSelectedUnits();
    const selectedUnitId = sel.length > 0 ? sel[0].id : undefined;
    const msg = activateCivPower(this.game, selectedUnitId);
    if (msg) {
      this.hud.notify(msg, 'success');
      this.audio.playLevelUp();
    } else if (this.game.humanPlayer.powerCooldown > 0) {
      const secs = Math.ceil(this.game.humanPlayer.powerCooldown);
      this.hud.notify(`⏳ Poder en recarga: ${secs}s`, 'warning');
    } else {
      // Power ready but couldn't activate (e.g. Aztec needs a selected unit)
      this.hud.notify('⚠️ Selecciona una unidad para usar el poder', 'warning');
    }
  }

  private triggerRandomEvent() {
    const player = this.game.humanPlayer;
    const events = [
      {
        emoji: '🌽', name: 'Cosecha abundante',
        desc: 'Las lluvias favorecieron los cultivos.',
        type: 'success' as const,
        apply: () => { player.resources.food += 180; },
      },
      {
        emoji: '⚜️', name: 'Filón de oro',
        desc: 'Tus exploradores hallaron un yacimiento rico.',
        type: 'success' as const,
        apply: () => { player.resources.gold += 120; },
      },
      {
        emoji: '🪨', name: 'Cantera descubierta',
        desc: 'Una nueva fuente de piedra ha sido localizada.',
        type: 'success' as const,
        apply: () => { player.resources.stone += 150; },
      },
      {
        emoji: '🌩️', name: 'Tormenta devastadora',
        desc: 'Las tormentas destruyeron parte de los suministros.',
        type: 'warning' as const,
        apply: () => {
          player.resources.food  = Math.max(0, player.resources.food  - 80);
          player.resources.stone = Math.max(0, player.resources.stone - 60);
          this.renderer.startRain();
          setTimeout(() => this.renderer.stopRain(), 30000);
        },
      },
      {
        emoji: '🦠', name: 'Epidemia',
        desc: 'Una enfermedad afecta a tus guerreros.',
        type: 'warning' as const,
        apply: () => {
          for (const u of player.aliveUnits) {
            u.hp = Math.max(1, Math.floor(u.hp * 0.75));
          }
        },
      },
      {
        emoji: '🔥', name: 'Espíritu guerrero',
        desc: 'Tus tropas están inspiradas — sus armas brillan.',
        type: 'success' as const,
        apply: () => {
          for (const u of player.aliveUnits) u.attack = Math.round(u.attack * 1.12);
          // revert after 60s
          setTimeout(() => {
            for (const u of player.aliveUnits) u.attack = Math.round(u.attack / 1.12);
          }, 60000);
        },
      },
      {
        emoji: '💨', name: 'Viento favorable',
        desc: 'Tus tropas se mueven con el viento a su favor.',
        type: 'info' as const,
        apply: () => {
          for (const u of player.aliveUnits) u.speed += 0.5;
          setTimeout(() => {
            for (const u of player.aliveUnits) u.speed = Math.max(0.5, u.speed - 0.5);
          }, 45000);
        },
      },
      {
        emoji: '⚔️', name: 'Mercenarios',
        desc: 'Un grupo de guerreros expertos se une a tu causa.',
        type: 'success' as const,
        apply: () => {
          const settle = this.game.allBuildings.find(
            b => b.playerId === this.game.humanPlayerId && b.type === BuildingType.SETTLEMENT && b.isAlive(),
          );
          if (!settle) return;
          const count = Math.min(3, 2 + (this.game.difficulty === 'hard' ? 0 : 1));
          const civDef = player.civDef;
          const unitType = civDef.units[0]?.type as UnitType ?? UnitType.EAGLE_WARRIOR;
          for (let i = 0; i < count; i++) {
            const pos = this.game.map.findWalkableNear(settle.col, settle.row + 3, 5);
            if (!pos) continue;
            const u = new Unit(unitType, player.civType, player.id, pos[0], pos[1], CIV_COLORS[player.civType]);
            u.gainXP(50); // spawn at level 2
            player.addUnit(u);
            this.game.allUnits.push(u);
            this.game.newlySpawnedUnits.push(u);
          }
        },
      },
      {
        emoji: '🌋', name: 'Terremoto',
        desc: 'El suelo tiembla — edificios dañados en toda la región.',
        type: 'warning' as const,
        apply: () => {
          for (const b of this.game.allBuildings) {
            if (b.isAlive()) b.takeDamage(15 + Math.floor(Math.random() * 10));
          }
          this.camera.shake(0.45, 0.9);
        },
      },
      {
        emoji: '🩸', name: 'Sed de sangre',
        desc: 'Tus guerreros entran en frenesí — ataque permanentemente mejorado.',
        type: 'success' as const,
        apply: () => {
          for (const u of player.aliveUnits) u.attack += 4;
          this.renderer.effects.createExplosion(0, 0, 0, 0); // dummy call to pre-warm
        },
      },
      {
        emoji: '🏳️', name: 'Deserción enemiga',
        desc: 'Un soldado enemigo abandona sus filas y cae abatido.',
        type: 'info' as const,
        apply: () => {
          const enemies = this.game.allUnits.filter(
            u => u.playerId !== this.game.humanPlayerId && u.isAlive(),
          );
          if (enemies.length === 0) return;
          const target = enemies[Math.floor(Math.random() * enemies.length)];
          target.takeDamage(target.hp + 9999);
          this.renderer.effects.createExplosion(target.worldX, 0.5, target.worldZ, 0.6);
        },
      },
    ];
    const evt = events[Math.floor(Math.random() * events.length)];
    evt.apply();
    this.hud.notify(`${evt.emoji} ${evt.name}: ${evt.desc}`, evt.type);
    // Camera shake for dramatic events
    if (evt.type === 'warning') this.camera.shake(0.18, 0.3);
  }

  private createMapPing(worldX: number, worldZ: number) {
    const container = document.getElementById('ping-container');
    if (!container) return;
    // Limit to 3 simultaneous pings — remove oldest if needed
    while (this._mapPings.length >= 3) {
      const old = this._mapPings.shift()!;
      old.el.remove();
    }
    const el = document.createElement('div');
    el.className = 'map-ping';
    container.appendChild(el);
    this._mapPings.push({ worldX, worldZ, el, expires: Date.now() + 5000 });
    this.audio.playClick();
  }

  private tickMapPings() {
    const now = Date.now();
    this._mapPings = this._mapPings.filter(ping => {
      if (now >= ping.expires) { ping.el.remove(); return false; }
      const screen = this.renderer.worldToScreen(ping.worldX, 0.5, ping.worldZ);
      ping.el.style.left = `${screen.x}px`;
      ping.el.style.top  = `${screen.y}px`;
      // Fade out in last 1.5s
      const remaining = ping.expires - now;
      ping.el.style.opacity = remaining < 1500 ? String(remaining / 1500) : '1';
      return true;
    });
  }

  private updateCtrlGroupsBar() {
    for (let n = 1; n <= 5; n++) {
      const slot = document.getElementById(`cg-slot-${n}`);
      if (!slot) continue;
      const ids = this.unitGroups.get(n);
      const alive = ids?.length
        ? ids.map(id => this.game.getUnitById(id)).filter(u => u?.isAlive())
        : [];
      const empty = alive.length === 0;
      slot.classList.toggle('cg-empty', empty);
      const emojiEl = slot.querySelector('.cg-emoji') as HTMLElement;
      const countEl = slot.querySelector('.cg-count') as HTMLElement;
      if (empty) {
        emojiEl.textContent = '—';
        countEl.textContent = '';
      } else {
        emojiEl.textContent = alive[0]?.def.emoji ?? '⚔️';
        countEl.textContent = String(alive.length);
      }
    }
  }

  private flashCtrlGroupSlot(n: number) {
    const slot = document.getElementById(`cg-slot-${n}`);
    if (!slot) return;
    slot.classList.remove('cg-flash');
    // force reflow so re-adding the class triggers the animation
    void slot.offsetWidth;
    slot.classList.add('cg-flash');
    setTimeout(() => slot.classList.remove('cg-flash'), 400);
  }

  private showMultiKillAnnouncer(title: string, sub: string, color: string) {
    const el = document.getElementById('multikill-announcer');
    if (!el) return;
    el.innerHTML = `<div class="mk-title" style="color:${color}">${title}</div><div class="mk-sub" style="color:${color}">${sub}</div>`;
    el.classList.remove('hidden', 'mk-exit');
    void el.offsetWidth; // force reflow to restart animation
    el.style.color = color;
    this._mkAnnouncerTimer = 2.2;
  }

  private showBattleReport(kills: number, losses: number) {
    const overlay = document.getElementById('battle-report-overlay');
    if (!overlay) return;

    const ratio = kills / Math.max(1, losses);
    let grade: string, gradeColor: string, gradeLabel: string, advice: string;

    if (losses === 0 && kills >= 6) {
      grade = 'S'; gradeColor = '#ffd700'; gradeLabel = 'IMPECABLE';
      advice = '¡Sin bajas! El enemigo está en fuga — presiona el ataque ahora.';
    } else if (losses === 0) {
      grade = 'A+'; gradeColor = '#44ff88'; gradeLabel = 'EXCELENTE';
      advice = 'Victoria limpia. El momentum es tuyo — sigue avanzando.';
    } else if (ratio >= 4) {
      grade = 'A'; gradeColor = '#66ee88'; gradeLabel = 'MUY BUENO';
      advice = 'Eficiencia sobresaliente. El rival está muy debilitado.';
    } else if (ratio >= 2.5) {
      grade = 'B'; gradeColor = '#88aaff'; gradeLabel = 'BUENO';
      advice = 'Buen intercambio. Reagrupa brevemente y sigue la ofensiva.';
    } else if (ratio >= 1.2) {
      grade = 'C'; gradeColor = '#ffcc44'; gradeLabel = 'ACEPTABLE';
      advice = 'Victoria costosa. Considera una pausa para recuperarte.';
    } else {
      grade = 'D'; gradeColor = '#ff6644'; gradeLabel = 'PYRRHICO';
      advice = 'Combate muy costoso. Retira y consolida en el asentamiento.';
    }

    document.getElementById('br-kills')!.textContent = String(kills);
    document.getElementById('br-losses')!.textContent = String(losses);
    const gradeEl = document.getElementById('br-grade')!;
    gradeEl.textContent = grade;
    gradeEl.style.color = gradeColor;
    document.getElementById('br-grade-label')!.textContent = gradeLabel;
    document.getElementById('br-advice')!.textContent = advice;

    overlay.classList.remove('hidden', 'br-exit');
    // Auto-dismiss after 6s
    const tid = setTimeout(() => {
      overlay.classList.add('br-exit');
      setTimeout(() => overlay.classList.add('hidden'), 400);
    }, 6000);
    // Click to dismiss early
    const dismiss = () => {
      clearTimeout(tid);
      overlay.classList.add('br-exit');
      setTimeout(() => overlay.classList.add('hidden'), 400);
      overlay.removeEventListener('click', dismiss);
    };
    overlay.addEventListener('click', dismiss);
  }

  private showChoiceEvent(evt: ChoiceEventDef) {
    const wasPaused = this.game.paused;
    this.game.paused = true;
    this._choiceEventActive = true;

    const overlay = document.getElementById('choice-event-overlay')!;
    document.getElementById('choice-event-emoji')!.textContent  = evt.emoji;
    document.getElementById('choice-event-title')!.textContent  = evt.title;
    document.getElementById('choice-event-desc')!.textContent   = evt.description;

    const container = document.getElementById('choice-options')!;
    container.innerHTML = '';

    const dismiss = () => {
      overlay.classList.add('hidden');
      if (!wasPaused) this.game.paused = false;
      this._choiceEventActive = false;
    };

    for (const opt of evt.options) {
      const btn = document.createElement('button');
      btn.className = 'choice-option-btn';
      btn.innerHTML =
        `<div class="choice-option-label">${opt.label}</div>` +
        `<div class="choice-option-detail">${opt.detail}</div>`;
      btn.addEventListener('click', () => { opt.apply(); dismiss(); });
      container.appendChild(btn);
    }

    overlay.classList.remove('hidden');
  }

  private triggerChoiceEvent() {
    const player  = this.game.humanPlayer;
    const enemies = this.game.players.filter(p => p.id !== this.game.humanPlayerId && !p.isDefeated());

    const settle = () =>
      this.game.allBuildings.find(
        b => b.playerId === this.game.humanPlayerId && b.type === BuildingType.SETTLEMENT && b.isAlive(),
      );

    const spawnWarrior = (count: number) => {
      const base = settle();
      if (!base) return 0;
      const civDef  = player.civDef;
      const uType   = (civDef.units[0]?.type ?? UnitType.EAGLE_WARRIOR) as UnitType;
      let spawned = 0;
      for (let i = 0; i < count; i++) {
        const pos = this.game.map.findWalkableNear(base.col, base.row + 3, 6);
        if (!pos) continue;
        const u = new Unit(uType, player.civType, player.id, pos[0], pos[1], CIV_COLORS[player.civType]);
        player.addUnit(u);
        this.game.allUnits.push(u);
        this.game.newlySpawnedUnits.push(u);
        spawned++;
      }
      return spawned;
    };

    const boostTroops = (fn: (u: import('./game/Unit').Unit) => void) => {
      for (const u of player.aliveUnits) fn(u);
    };

    const events: ChoiceEventDef[] = [
      // ── 1. Merchant caravan ──────────────────────────────────────────────────
      {
        emoji: '🛶', title: 'Mercader Ambulante',
        description: 'Una caravana de comerciantes llega a tus fronteras cargada de mercancías. ¿Cómo la recibes?',
        options: [
          {
            label: '💰 Comprar provisiones',
            detail: 'Paga 60⚜️ — recibe 200🌽 de comida fresca para las tropas',
            apply: () => {
              if (player.resources.gold < 60) { this.hud.notify('⚠️ No tienes suficiente oro', 'warning'); return; }
              player.resources.gold -= 60;
              player.resources.food  = Math.min(2000, player.resources.food + 200);
              this.hud.notify('🛶 ¡Intercambio exitoso! −60⚜️  +200🌽', 'success');
            },
          },
          {
            label: '⚔️ Contratar mercenarios',
            detail: 'Paga 50🌽 — 3 guerreros expertos se unen a tu causa de inmediato',
            apply: () => {
              if (player.resources.food < 50) { this.hud.notify('⚠️ No tienes comida suficiente', 'warning'); return; }
              player.resources.food -= 50;
              const n = spawnWarrior(3);
              this.hud.notify(`⚔️ ${n} mercenarios reclutados! −50🌽`, 'success');
            },
          },
          {
            label: '✕ Ignorar la caravana',
            detail: 'La caravana sigue su camino. Sin efectos.',
            apply: () => { this.hud.notify('🛶 La caravana parte sin intercambio', 'info'); },
          },
        ],
      },
      // ── 2. War prisoners ─────────────────────────────────────────────────────
      {
        emoji: '⛓️', title: 'Prisioneros de Guerra',
        description: 'Tus guerreros capturaron un grupo de soldados enemigos. ¿Qué ordenas?',
        condition: () => (this.game.killsByPlayer.get(player.id) ?? 0) > 0,
        options: [
          {
            label: '⚔️ Ejecución pública',
            detail: '+30 moral a todas tus unidades — el ejemplo aterra al enemigo',
            apply: () => {
              boostTroops(u => { u.morale = Math.min(100, u.morale + 30); });
              this.hud.notify('⚔️ ¡Ejecución pública! +30 moral al ejército', 'success');
              this.camera.shake(0.2, 0.4);
            },
          },
          {
            label: '💰 Exigir rescate',
            detail: '+120⚜️ de las familias rivales — buena ganancia, poca gloria',
            apply: () => {
              player.resources.gold = Math.min(2000, player.resources.gold + 120);
              this.hud.notify('💰 Rescate cobrado +120⚜️', 'success');
            },
          },
          {
            label: '🤝 Integrar a las filas',
            detail: '2 guerreros enemigos juran lealtad — bajos en moral pero combatientes',
            apply: () => {
              const n = spawnWarrior(2);
              for (const u of player.aliveUnits.slice(-n)) u.morale = 35;
              this.hud.notify(`🤝 ${n} prisioneros integrados al ejército`, 'info');
            },
          },
        ],
      },
      // ── 3. Divine omen ────────────────────────────────────────────────────────
      {
        emoji: '🌟', title: 'Presagio Divino',
        description: 'Un cometa cruza el cielo nocturno. Tus sacerdotes piden instrucciones al respecto.',
        options: [
          {
            label: '🌟 Proclamar victoria divina',
            detail: '+35 moral a todo el ejército — las tropas combaten inspiradas',
            apply: () => {
              boostTroops(u => { u.morale = Math.min(100, u.morale + 35); });
              this.hud.notify('🌟 ¡Presagio de victoria! +35 moral al ejército', 'success');
            },
          },
          {
            label: '🩸 Realizar sacrificio ritual',
            detail: 'Ofrece 60🌽 — tu héroe gana experiencia y tu ejército ataca +8 durante 60s',
            apply: () => {
              if (player.resources.food < 60) { this.hud.notify('⚠️ No tienes comida para el sacrificio', 'warning'); return; }
              player.resources.food -= 60;
              const hero = player.aliveUnits.find(u => u.isHero);
              if (hero) hero.gainXP(120);
              boostTroops(u => { u.attack += 8; });
              setTimeout(() => { boostTroops(u => { u.attack = Math.max(1, u.attack - 8); }); }, 60_000);
              this.hud.notify('🩸 ¡Sacrificio realizado! Héroe +XP, ejército +8⚔️ 60s', 'success');
            },
          },
          {
            label: '🙈 Ignorar la señal',
            detail: 'Los sacerdotes quedan en silencio. No ocurre nada.',
            apply: () => { this.hud.notify('🌟 El presagio se desvanece sin ser interpretado', 'info'); },
          },
        ],
      },
      // ── 4. Enemy camp opportunity ─────────────────────────────────────────────
      {
        emoji: '🗡️', title: 'Campamento Enemigo Detectado',
        description: 'Espías reportan un campamento enemigo mal guarnecido. Tienes la oportunidad de actuar.',
        condition: () => enemies.some(e => e.aliveUnits.length > 0),
        options: [
          {
            label: '🗡️ Lanzar raid relámpago',
            detail: 'Tus tropas causan daño (-25 HP a 4 unidades enemigas) y reggresan con moral alta',
            apply: () => {
              const hostile = enemies.flatMap(e => e.aliveUnits.filter(u => !u.isHero));
              const targets = hostile.sort(() => Math.random() - 0.5).slice(0, 4);
              for (const t of targets) t.takeDamage(25);
              boostTroops(u => { u.morale = Math.min(100, u.morale + 15); });
              this.hud.notify(`🗡️ ¡Raid exitoso! ${targets.length} enemigos dañados, +15 moral`, 'success');
            },
          },
          {
            label: '🔥 Quemar suministros',
            detail: 'Sin bajas propias — el enemigo más fuerte pierde 100🌽 y 80⚜️',
            apply: () => {
              const strongest = enemies.reduce((a, b) => a.aliveUnits.length >= b.aliveUnits.length ? a : b);
              strongest.resources.food  = Math.max(0, strongest.resources.food  - 100);
              strongest.resources.gold  = Math.max(0, strongest.resources.gold  - 80);
              this.hud.notify('🔥 ¡Suministros enemigos quemados! Rival debilitado', 'success');
            },
          },
          {
            label: '👁️ Solo observar',
            detail: 'Consigues información pero no actúas. El campamento se refuerza.',
            apply: () => { this.hud.notify('👁️ El campamento enemigo fue observado — sin acción', 'info'); },
          },
        ],
      },
      // ── 5. Storm approaching ──────────────────────────────────────────────────
      {
        emoji: '🌩️', title: 'Tormenta en el Horizonte',
        description: 'Nubes oscuras se acercan. La batalla se avecina bajo condiciones extremas. ¿Cómo preparas a tus tropas?',
        options: [
          {
            label: '🛡️ Posición defensiva',
            detail: 'Todas las unidades ganan +20 defensa durante 60s — aguanta el temporal',
            apply: () => {
              boostTroops(u => { u.defense += 20; });
              setTimeout(() => { boostTroops(u => { u.defense = Math.max(0, u.defense - 20); }); }, 60_000);
              this.hud.notify('🛡️ Posición defensiva: +20 def 60s', 'info');
            },
          },
          {
            label: '⚡ Atacar antes de la tormenta',
            detail: 'Todas las unidades +30% velocidad 40s — golpea primero',
            apply: () => {
              boostTroops(u => { u.speed *= 1.3; });
              setTimeout(() => { boostTroops(u => { u.speed /= 1.3; }); }, 40_000);
              this.hud.notify('⚡ ¡Carga antes de la tormenta! +30% velocidad 40s', 'success');
              this.camera.shake(0.15, 0.3);
            },
          },
          {
            label: '🌧️ Resistir la tormenta',
            detail: 'Ningún bonificador, pero conservas todas las opciones abiertas',
            apply: () => { this.hud.notify('🌧️ Tus tropas aguantan la tormenta', 'info'); },
          },
        ],
      },
      // ── 6. Ancient ruins ─────────────────────────────────────────────────────
      {
        emoji: '🏛️', title: 'Ruinas Antiguas',
        description: 'Tus exploradores descubren un antiguo templo oculto en la selva. Pleno de riquezas y conocimiento.',
        options: [
          {
            label: '💰 Saquear el templo',
            detail: '+200⚜️ en tesoros, pero la profanación hunde la moral (−25)',
            apply: () => {
              player.resources.gold = Math.min(2000, player.resources.gold + 200);
              boostTroops(u => { u.morale = Math.max(0, u.morale - 25); });
              this.hud.notify('💰 ¡Templo saqueado! +200⚜️ pero −25 moral al ejército', 'warning');
            },
          },
          {
            label: '🔬 Estudiar los artefactos',
            detail: 'El conocimiento fortalece el ataque de todas tus unidades en +5 permanentemente',
            apply: () => {
              boostTroops(u => { u.attack += 5; });
              this.hud.notify('🔬 ¡Conocimiento ancestral! Todas las unidades +5⚔️ permanente', 'success');
            },
          },
          {
            label: '🛡️ Proteger el sitio sagrado',
            detail: 'Un gesto noble: +25 moral al ejército y aliados te respetan más',
            apply: () => {
              boostTroops(u => { u.morale = Math.min(100, u.morale + 25); });
              player.resources.gold = Math.min(2000, player.resources.gold + 40);
              this.hud.notify('🛡️ ¡Acto noble! +25 moral, +40⚜️ de admiración aliada', 'success');
            },
          },
        ],
      },
      // ── 7. War festival ───────────────────────────────────────────────────────
      {
        emoji: '🥁', title: 'Festival de Guerra',
        description: 'Tambores y cantos de guerra resuenan en el campamento. Tus guerreros piden órdenes para honrar a los dioses del combate.',
        options: [
          {
            label: '🔥 Inspira al ejército',
            detail: '+12 ataque a todas las unidades durante 60s — el frenesí se apodera de los guerreros',
            apply: () => {
              boostTroops(u => { u.attack += 12; });
              setTimeout(() => { boostTroops(u => { u.attack = Math.max(1, u.attack - 12); }); }, 60_000);
              this.hud.notify('🔥 ¡Festival de guerra! +12⚔️ 60s a todo el ejército', 'success');
              this.camera.shake(0.12, 0.25);
            },
          },
          {
            label: '🙏 Realizar ceremonias',
            detail: '+50 moral a todo el ejército — el espíritu guerrero se renueva',
            apply: () => {
              boostTroops(u => { u.morale = Math.min(100, u.morale + 50); });
              this.hud.notify('🙏 ¡Ceremonias de guerra! +50 moral al ejército', 'success');
            },
          },
          {
            label: '⚔️ Movilizar reclutas',
            detail: 'Se incorporan 4 milicianos sin coste — refuerzo inmediato',
            apply: () => {
              const n = spawnWarrior(4);
              this.hud.notify(`⚔️ ${n} reclutas del festival se unen a la batalla`, 'success');
            },
          },
        ],
      },
      // ── 8. Enemy deserter ─────────────────────────────────────────────────────
      {
        emoji: '🏃', title: 'Desertor Enemigo',
        description: 'Un guerrero enemigo abandona sus filas y viene a rendirse ante ti. ¿Qué haces con él?',
        condition: () => enemies.some(e => e.aliveUnits.length > 0),
        options: [
          {
            label: '🤝 Reclutar al desertor',
            detail: 'El enemigo pierde un guerrero — tú ganas uno de reemplazo inmediatamente',
            apply: () => {
              const enemy = enemies.find(e => e.aliveUnits.filter(u => !u.isHero).length > 0);
              if (!enemy) { this.hud.notify('🏃 El desertor huyó antes de que pudieras actuar', 'info'); return; }
              const defector = enemy.aliveUnits.filter(u => !u.isHero)[0];
              const name = defector?.def?.name ?? 'guerrero';
              defector?.takeDamage(99999);
              const n = spawnWarrior(1);
              if (n > 0) this.hud.notify(`🤝 ¡${name} desertor se une a tus filas!`, 'success');
            },
          },
          {
            label: '🔍 Extraer información',
            detail: 'El desertor revela dónde se oculta la fuerza enemiga más grande',
            apply: () => {
              const strongest = enemies.reduce((a, b) => a.aliveUnits.length >= b.aliveUnits.length ? a : b);
              if (strongest.aliveUnits.length > 0) {
                const u = strongest.aliveUnits[0];
                this.camera.panTo(u.worldX, u.worldZ);
                this.hud.notify(`🔍 ¡Información valiosa! Fuerza enemiga detectada (${strongest.aliveUnits.length} unidades)`, 'info');
              }
              player.resources.gold = Math.min(2000, player.resources.gold + 40);
            },
          },
          {
            label: '💰 Exigir pago por silencio',
            detail: 'El desertor paga 70⚜️ para que no lo entregues a sus jefes',
            apply: () => {
              player.resources.gold = Math.min(2000, player.resources.gold + 70);
              this.hud.notify('💰 Pago de silencio recibido +70⚜️', 'success');
            },
          },
        ],
      },
      // ── 9. Allied messenger ───────────────────────────────────────────────────
      {
        emoji: '📜', title: 'Mensajero Aliado',
        description: 'Un mensajero trae noticias de una región aliada lejana. Vienen con ofertas de colaboración.',
        options: [
          {
            label: '🌽 Aceptar suministros',
            detail: 'Recibes una remesa de +150🌽 y +80⚜️ a cambio de apoyo futuro',
            apply: () => {
              player.resources.food = Math.min(2000, player.resources.food + 150);
              player.resources.gold = Math.min(2000, player.resources.gold + 80);
              this.hud.notify('📜 ¡Suministros aliados! +150🌽 +80⚜️', 'success');
            },
          },
          {
            label: '⚔️ Pedir refuerzos',
            detail: 'La región aliada envía 3 guerreros de élite — coste: 80🌽',
            apply: () => {
              if (player.resources.food < 80) { this.hud.notify('⚠️ No tienes comida para alojar los refuerzos', 'warning'); return; }
              player.resources.food -= 80;
              const n = spawnWarrior(3);
              for (const u of player.aliveUnits.slice(-n)) u.gainXP(60); // spawn at level 2
              this.hud.notify(`⚔️ ${n} refuerzos aliados de élite se unen (nv.2) −80🌽`, 'success');
            },
          },
          {
            label: '🔬 Compartir conocimiento',
            detail: 'Intercambio técnico — todas las unidades ganan +10 HP máximo permanente',
            apply: () => {
              boostTroops(u => { u.maxHp += 10; u.hp = Math.min(u.hp + 10, u.maxHp); });
              this.hud.notify('🔬 ¡Conocimiento compartido! Todas las unidades +10 HP max', 'success');
            },
          },
        ],
      },
    ];

    const available = events.filter(e => !e.condition || e.condition());
    if (available.length === 0) return;
    const evt = available[Math.floor(Math.random() * available.length)];
    this.showChoiceEvent(evt);
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
    const diff  = civSelect.getDifficulty();
    const numAI = civSelect.getNumAI();
    civSelect.hide();
    await startGame(civ, diff, numAI);
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
