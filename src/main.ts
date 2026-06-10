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
import { activateCivPower } from './game/CivPowers';

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
  private _statusParticleTimers = new Map<number, number>(); // unit.id → time since last status particle
  private _wasNight = false;
  private _wasStorm = false;
  private _berserkUnits = new Set<number>(); // unit ids currently in berserk
  private _hintsShown = new Set<string>(); // one-time contextual tutorial hints

  /** Show a tutorial hint at most once per match. */
  private hintOnce(key: string, msg: string) {
    if (this._hintsShown.has(key)) return;
    this._hintsShown.add(key);
    this.hud.notify(msg, 'info');
  }

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
        this._totalResourcesSpent += cost.food + cost.gold + (cost.stone ?? 0);
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
          this.hud.notify(`🔬 ${names[key]} investigada — beneficio aplicado`, 'success');
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

    const rawDt = Math.min(this.clock.getDelta(), 0.1);
    const dt = rawDt * this._gameSpeed;

    this.updateFpsCounter(rawDt);
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
      if (vis !== 0 /* UNEXPLORED */) {
        this.audio.playResourceDepleted();
        const typeLabel = node.type === ResourceType.FOOD ? 'Alimentos' : node.type === ResourceType.GOLD ? 'Oro' : 'Piedra';
        this.hud.notify(`⚠️ Yacimiento de ${typeLabel} agotado`, 'warning');
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
      this.hud.notify(isNight ? '🌙 Anochece — visión -40% · combate +15% daño ambos bandos' : '☀️ Amanece — visión restaurada', 'info');
      if (isNight) this.hintOnce('nightCombat', '💡 De noche: la visión cae un 40% pero el daño de combate sube 15% para ambos bandos. ¡Los ataques sorpresa nocturnos son devastadores!');
      if (!isNight) this.hintOnce('highGround', '💡 El terreno importa en combate: las tierras altas y montañas dan bonificación de ataque. El desierto expone a tus arqueros.');
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
          if (evt.target.playerId !== this.game.humanPlayerId) this.killCount++;
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
          // Hero death notification
          if (evt.target.isHero && evt.target.playerId === this.game.humanPlayerId) {
            this.hud.notify(`☠️ ${evt.target.heroName} ha caído — regresará en 60s`, 'warning');
            this.camera.shake(0.4, 0.6);
          }
        } else {
          this.audio.playHit(evt.damage / 30);
          if (evt.target.playerId === this.game.humanPlayerId) humanUnderAttack = true;
        }
      }
      if (humanUnderAttack && Math.random() < 0.05) {
        this.hud.notify('⚔️ ¡Tus tropas están bajo ataque!', 'warning');
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
        this.hud.notify(`🔥 ¡${u.def.name} entró en frenesí! +25% daño por 12s`, 'warning');
        this.renderer.effects.createExplosion(u.worldX, 0.8, u.worldZ, 0.6);
      } else if (u.berserkTimer <= 0 && wasBerserk) {
        this._berserkUnits.delete(u.id);
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

    this.hud.update(selectedNow);
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
      // H: toggle Hold Position for selected units
      if (e.code === 'KeyH' && !e.ctrlKey && !e.altKey) {
        const sel = this.input.getSelectedUnits().filter(u => u.playerId === this.game.humanPlayerId);
        if (sel.length > 0) {
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
          this.hud.notify(`🏃 ${n} unidad${n > 1 ? 'es' : ''} en retirada`, 'info');
          this.audio.playMove();
        }
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
      // 1-4 when production panel is open on train tab: train unit
      if (!e.ctrlKey && !e.altKey && /^Digit[1-4]$/.test(e.code) &&
          this.prodPanel.isVisible && this.prodPanel.currentTab === 'train') {
        e.preventDefault();
        const idx = parseInt(e.code.replace('Digit', '')) - 1;
        const units = this.prodPanel.getTrainableUnits();
        if (idx < units.length) this.prodPanel.onTrain?.(units[idx]);
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
        this.hud.update(this.input.getSelectedUnits());
        return;
      }
    });
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
