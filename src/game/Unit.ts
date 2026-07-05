import * as THREE from 'three';
import { UnitType, CivilizationType, UnitState, TerrainType } from './types';
import type { GridPos } from './types';
import type { UnitDef } from './civilizations';
import { getUnitDef } from './civilizations';
import { TILE_SIZE } from './constants';
import type { GameMap } from './Map';
import { FORMATIONS } from './UnitBalancing';

let nextId = 1;

const SKIN_TONES: Record<CivilizationType, number> = {
  [CivilizationType.AZTEC]:        0xc27848,
  [CivilizationType.INCA]:         0xb87040,
  [CivilizationType.MAYA]:         0xca8050,
  [CivilizationType.CONQUISTADOR]: 0xdba870,
};

export class Unit {
  /** Global weather movement multiplier, set once per frame by Game (1.0 = clear, <1 = rain/storm mud). */
  static weatherSpeedMult = 1.0;

  /** Gunpowder economy hook (AC style), set by Game: deducts coal/iron for one round of
   *  ARQUEBUSIER/CANNON ammo. Returns false when the player's stock is empty — no resupply. */
  static tryConsumeGunpowder: ((playerId: number, unitType: UnitType) => boolean) | null = null;

  readonly id: number;
  readonly type: UnitType;
  readonly civType: CivilizationType;
  readonly playerId: number;
  readonly def: UnitDef;

  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  attackRange: number;
  sight: number;
  attackCooldown: number;

  state: UnitState = UnitState.IDLE;
  col: number;
  row: number;
  worldX: number;
  worldZ: number;
  targetCol: number;
  targetRow: number;
  path: GridPos[] = [];
  pathIndex: number = 0;
  waypointPaths: GridPos[][] = []; // queued paths to visit sequentially
  attackTarget: Unit | null = null;
  attackBuildingTarget: import('./Building').Building | null = null;
  attackTimer: number = 0;

  // Patrol
  patrolA: GridPos | null = null;
  patrolB: GridPos | null = null;
  patrolFlip = false;

  // XP / leveling
  xp:           number  = 0;
  level:        number  = 1;
  justLeveledUp = false; // cleared by Game.ts each frame; true on the frame levelUp fires
  justRallied   = false; // set on the frame panicked→false; cleared by Game to broadcast contagion

  // Civilization power buffs
  incaBuff  = false;
  conquBuff = false;
  _preBuffAttack = 0; // attack value before civ power buff (0 = not buffed)
  _preBuffSpeed  = 0;

  moveX: number = 0;
  moveZ: number = 0;
  moveProgress: number = 1;

  mesh!: THREE.Group;
  private rig!: THREE.Group;
  private leftArm:  THREE.Group | null = null;
  private rightArm: THREE.Group | null = null;
  healthBar!: THREE.Mesh;
  selectionRing!: THREE.Mesh;
  private _levelRing:  THREE.Mesh | null = null;
  private _statusRing: THREE.Mesh | null = null;
  private _statusRingT = Math.random() * 6.28;
  private _regimentBanner: THREE.Group | null = null;
  private selected    = false;
  private animT       = Math.random() * 10;
  private attackAnim  = 0;
  private _deathTimer = -1;

  // Passive healing / retreat
  _damageCooldown  = 0;     // seconds since last hit; healing begins when this reaches 0
  _idleHealTimer   = 0;     // accumulates while healing
  _nearSettlement  = false; // set each frame by Game.ts; boosts idle heal rate
  _nearSupplyDepot = false; // true when within 4 tiles of a friendly complete Storehouse
  _isolated        = false; // set each frame by Game.ts; no friendly unit within 6 tiles
  wantsRetreat     = false; // set by takeDamage when HP < 20%; cleared by Game
  _missionaryTimer = 0;    // conversion/curse timer for Missionary and Shaman units
  _crewCaptureTimer = 0;   // CANNON only: seconds an enemy melee unit has been seizing this crippled gun

  // Status effects (damage over time)
  burning  = 0;  // remaining burn duration (s); 2 HP every 0.5 s
  poisoned = 0;  // remaining poison duration (s); 2 HP every 1 s
  slowed   = 0;  // remaining slow duration (s); -40% speed from slinger stones
  private _burnTick   = 0;
  private _poisonTick = 0;

  // Cavalry charge: ready after 3s idle; consumed on first attack
  chargeReady      = false;
  private _chargeIdleTime = 0;
  chargeSpeedTimer = 0; // seconds of post-charge speed boost remaining

  // Kill streak / berserk
  killStreak  = 0;          // consecutive kills without taking damage
  killsTotal  = 0;          // lifetime confirmed kills (for veteran display)
  berserkTimer = 0;         // seconds of berserk buff remaining (3-kill streak → 12s)

  // Morale (American Conquest style): 0-100; panic below 25, recover at 50
  morale   = 100;
  panicked = false;
  private _moraleCooldown = 0; // seconds until morale starts regenerating

  // Entrench (X key): dig in for +5 defense; cleared on any movement order
  entrenched = false;

  // Target priority for auto-attack targeting
  targetPriority: 'NEAREST' | 'WEAKEST' | 'STRONGEST' = 'NEAREST';

  // Unit AI stance: Aggressive (seek combat), Defensive (retreat on damage), Balanced (normal)
  stance: 'AGGRESSIVE' | 'DEFENSIVE' | 'BALANCED' = 'BALANCED';

  // Shield wall: set each frame when ≥2 PHALANX allies are adjacent (within 2.5 tiles)
  shieldWall = false;

  // Battle fatigue: prolonged combat lowers effectiveness
  combatTimer      = 0;   // seconds spent continuously in ATTACKING state
  fatigued         = false;
  private _preFatigueAttack = 0;

  // Stationary defense: seconds spent holding position (IDLE/HOLD) without moving
  stationaryTimer = 0;

  // Garrison: inside building id, or moving toward one to enter
  garrisonedIn: number | null = null;
  garrisonTarget: import('./Building').Building | null = null;

  // Capture: enemy building this melee unit is seizing
  captureTarget: import('./Building').Building | null = null;

  // Formation march: group moves are capped to the slowest member's speed
  formationSpeedCap: number | null = null;

  // Supply line: distance to nearest friendly building; applies penalties if too far
  supplyDist: number = 0; // updated each frame; 0 = just built or at base

  // Close ranks: 3+ allies within 3 tiles → +2 defense, faster morale recovery.
  // Recomputed periodically by Game.updateFormations.
  inFormation = false;

  // Officer aura: a level-3 champion ally, hero, or OFFICER unit within 5 tiles grants +2 defense.
  // Recomputed periodically by Game.updateFormations.
  nearOfficer = false;

  // Drummer aura: a DRUMMER ally within 6 tiles → morale regen 2× and panic resistance.
  // Recomputed periodically by Game.updateFormations.
  nearDrummer = false;

  // Regiment (AC style): formed with Alt+B from officer + drummer + 9 soldiers.
  // While the officer lives and is within 8 tiles: +15% attack, −3 damage taken, morale floor 30.
  regimentLeaderId: number | null = null;
  regimentBuff = false;

  // Civ unit synergy: complementary elite unit type nearby (Eagle+Jaguar, Quechua+Antis, etc.)
  // Grants +10% damage when active. Recomputed periodically by Game.updateFormations.
  nearSynergy = false;

  // Hero passive specialization: hero within 6 tiles and this is its signature unit type.
  // Grants +15% damage. Recomputed periodically by Game.updateFormations.
  heroPowerBuff = false;

  // Champion last stand: level-3 unit drops below 25% HP → +25% damage for 10s.
  lastStandTimer = 0;

  // Inspired fury: landing a killing blow at ≥80 morale grants +15% damage for 5s.
  inspiredTimer = 0;

  // Historically-themed name earned when the unit reaches level 3.
  veteranName: string | null = null;

  // Veteran teaching: level-3 same-type unit within 3 tiles — this unit gains XP 30% faster.
  _nearVeteranTeacher = false;
  // Counter-charge: spear unit that absorbs a cavalry charge deals +20% on their next attack.
  counterChargeBuff = false;
  // Ambush ready: JAGUAR_KNIGHT/CUACHIC held still for ≥5s — first strike deals +35% damage.
  ambushReady = false;

  // Ranged unit pinned in melee: an enemy melee unit is adjacent → -40% ranged damage.
  // Set each frame by CombatSystem when the unit fires while threatened.
  meleePinned = false;

  // Ammo (ranged units only; -1 = melee, never depletes)
  ammo    = -1;
  maxAmmo = 0;
  private _ammoRechargeTimer = 0;

  // Volley fire: V-key sets this to bypass attackTimer once for a burst shot
  volleyReady = false;

  // Formation order: 'LOOSE' | 'PHALANX' | 'WEDGE' | null
  formation: string | null = null;
  private _defSpeed = 0;           // canonical speed without formation modifier
  private _formationSpeedMul = 1.0;

  // Hero unit
  isHero   = false;
  heroName = '';

  // Hero war cry: Y-key buff that boosts nearby allies
  warCryCooldown  = 0;  // seconds remaining before war cry can be used again
  buffAttackTimer = 0;  // seconds of +25% attack buff remaining (from allied hero war cry)
  // Hero secondary ability: H-key civ-flavored power (60s cooldown)
  heroCooldown2    = 0;  // seconds remaining before secondary ability can be used again
  heroSpeedBuff    = 0;  // seconds of Inca hero speed boost remaining
  // Hero auto-rally: triggers when hero morale drops below 40
  rallyCooldown = 0;

  constructor(
    type: UnitType, civ: CivilizationType, playerId: number,
    col: number, row: number, civColor: number,
  ) {
    this.id       = nextId++;
    this.type     = type;
    this.civType  = civ;
    this.playerId = playerId;
    this.def      = getUnitDef(type);

    const s = this.def.stats;
    this.hp = this.maxHp   = s.maxHp;
    this.attack            = s.attack;
    this.defense           = s.defense;
    this.speed             = s.speed;
    this._defSpeed         = s.speed;
    this.attackRange       = s.attackRange;
    this.sight             = s.sight;
    this.attackCooldown    = s.attackCooldown;

    this.col = this.targetCol = col;
    this.row = this.targetRow = row;
    this.worldX = col * TILE_SIZE;
    this.worldZ = row * TILE_SIZE;

    this.buildMesh(civColor);

    if (this.def.isRanged) {
      const AMMO: Partial<Record<UnitType, number>> = {
        [UnitType.ARCHER]:      28,
        [UnitType.ATLATL]:      25,
        [UnitType.SLINGER]:     30,
        [UnitType.ARQUEBUSIER]: 15,
        [UnitType.CANNON]:      10,
      };
      this.maxAmmo = AMMO[this.type] ?? 20;
      this.ammo    = this.maxAmmo;
    }
  }

  get outOfAmmo(): boolean { return this.ammo === 0; }
  get lowAmmo():   boolean { return this.ammo > 0 && this.ammo <= Math.ceil(this.maxAmmo * 0.25); }

  // ── Mesh construction ────────────────────────────────────────────────────────
  private buildMesh(civColor: number) {
    this.mesh = new THREE.Group();
    this.rig  = new THREE.Group();
    this.mesh.add(this.rig);

    const isConq  = this.civType === CivilizationType.CONQUISTADOR;
    const accent  = this.civAccent();
    const skinTone = SKIN_TONES[this.civType];

    const cloth   = new THREE.MeshStandardMaterial({ color: civColor,  roughness: 0.85 });
    const skin    = new THREE.MeshStandardMaterial({ color: skinTone,  roughness: 0.65 });
    const dark    = new THREE.MeshStandardMaterial({ color: 0x18100a,  roughness: 0.88 });
    const accMat  = new THREE.MeshStandardMaterial({ color: accent,    roughness: 0.50, emissive: accent, emissiveIntensity: 0.15 });
    const metal   = new THREE.MeshStandardMaterial({ color: 0xbac1cc,  roughness: 0.22, metalness: 0.90 });
    const wood    = new THREE.MeshStandardMaterial({ color: 0x6a4018,  roughness: 0.95 });
    const leather = new THREE.MeshStandardMaterial({ color: 0x7a4c24,  roughness: 0.82 });
    const jade    = new THREE.MeshStandardMaterial({ color: 0x1ea060,  roughness: 0.55, metalness: 0.05, emissive: 0x083820, emissiveIntensity: 0.08 });
    const gold    = new THREE.MeshStandardMaterial({ color: 0xffcc18,  roughness: 0.30, metalness: 0.82 });

    const bodyMat = isConq ? metal : cloth;

    if (this.type === UnitType.CANNON) {
      this.buildCannon(metal, wood, accMat);
    } else if (this.def.isCavalry) {
      this.buildCavalry(bodyMat, skin, dark, metal, wood, accMat);
    } else {
      this.buildFootSoldier(bodyMat, cloth, skin, dark, metal, wood, leather, jade, gold, accMat, isConq);
    }

    // Officer regiment banner: a flag raised above the officer while a regiment is formed
    if (this.type === UnitType.OFFICER) {
      const banner = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6), wood);
      pole.position.y = 2.6;
      const flag = new THREE.Mesh(
        new THREE.PlaneGeometry(0.65, 0.4),
        new THREE.MeshStandardMaterial({ color: civColor, roughness: 0.7, side: THREE.DoubleSide, emissive: civColor, emissiveIntensity: 0.25 }),
      );
      flag.position.set(0.35, 3.05, 0);
      banner.add(pole, flag);
      banner.visible = false;
      this.mesh.add(banner);
      this._regimentBanner = banner;
    }

    // 30 % scale-up for better close-range presence
    this.rig.scale.setScalar(1.3);

    // ── Health bar ──────────────────────────────────────────────────────────────
    const barY = 2.55;
    const hpBg = new THREE.Mesh(
      new THREE.PlaneGeometry(0.80, 0.12),
      new THREE.MeshBasicMaterial({ color: 0x180000, transparent: true, opacity: 0.8, depthTest: false }),
    );
    this.healthBar = new THREE.Mesh(
      new THREE.PlaneGeometry(0.78, 0.10),
      new THREE.MeshBasicMaterial({ color: 0x33dd55, depthTest: false }),
    );
    hpBg.position.set(0, barY, 0);
    this.healthBar.position.set(0, barY, 0.001);
    hpBg.rotation.x = -Math.PI / 2;
    this.healthBar.rotation.x = -Math.PI / 2;
    hpBg.renderOrder = 10; this.healthBar.renderOrder = 11;
    this.mesh.add(hpBg, this.healthBar);

    // ── Selection ring ──────────────────────────────────────────────────────────
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x66ddff, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
    this.selectionRing = new THREE.Mesh(new THREE.RingGeometry(0.52, 0.66, 32), ringMat);
    this.selectionRing.rotation.x = -Math.PI / 2;
    this.selectionRing.position.y = 0.06;
    this.selectionRing.visible = false;
    this.mesh.add(this.selectionRing);

    this.mesh.traverse(child => { child.userData.unitId = this.id; });
    this.mesh.userData.unitId = this.id;
    this.mesh.position.set(this.worldX, 0, this.worldZ);
  }

  private civAccent(): number {
    switch (this.civType) {
      case CivilizationType.AZTEC:        return 0x18d0a0;
      case CivilizationType.INCA:         return 0xffcc20;
      case CivilizationType.MAYA:         return 0x30e070;
      case CivilizationType.CONQUISTADOR: return 0xe03030;
    }
  }

  private addTo(parent: THREE.Group | null, mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    (parent ?? this.rig).add(m);
    return m;
  }

  // shorthand that always adds to rig
  private addLimb(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) {
    return this.addTo(null, mat, w, h, d, x, y, z);
  }

  // ── Foot soldier ────────────────────────────────────────────────────────────
  private buildFootSoldier(
    bodyMat: THREE.Material, cloth: THREE.Material, skin: THREE.Material,
    dark: THREE.Material, metal: THREE.Material, wood: THREE.Material,
    leather: THREE.Material, jade: THREE.Material, gold: THREE.Material,
    accMat: THREE.Material, isConq: boolean,
  ) {
    const isHeavy = this.maxHp >= 120;
    const accent  = this.civAccent();

    // Boots / feet
    this.addLimb(dark,    0.14, 0.11, 0.22, -0.11, 0.055, 0.02);
    this.addLimb(dark,    0.14, 0.11, 0.22,  0.11, 0.055, 0.02);

    // Lower legs
    const legMat = isConq ? leather : cloth;
    this.addLimb(legMat,  0.13, 0.36, 0.15, -0.11, 0.30, 0);
    this.addLimb(legMat,  0.13, 0.36, 0.15,  0.11, 0.30, 0);

    // Upper legs
    this.addLimb(dark,    0.15, 0.34, 0.16, -0.11, 0.60, 0);
    this.addLimb(dark,    0.15, 0.34, 0.16,  0.11, 0.60, 0);

    // Loincloth/skirt (natives) or trousers trim (conquistador)
    if (!isConq) {
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.22, 0.28), cloth);
      skirt.position.y = 0.74; this.rig.add(skirt);
    }

    // Torso
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.44, 0.28), bodyMat);
    torso.position.y = 0.98; torso.castShadow = true; this.rig.add(torso);

    // Belt / sash (accent color — marks ownership clearly)
    const sash = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.11, 0.32), accMat);
    sash.position.y = 0.78; this.rig.add(sash);

    // Armor overlay
    if (isConq) {
      // Steel breastplate
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.38, 0.06), metal);
      plate.position.set(0, 0.98, 0.16); this.rig.add(plate);
      const lowerPlate = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.06), metal);
      lowerPlate.position.set(0, 0.78, 0.16); this.rig.add(lowerPlate);
    } else if (isHeavy) {
      const plateMat = this.civType === CivilizationType.INCA ? gold : jade;
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.36, 0.06), plateMat);
      plate.position.set(0, 0.98, 0.15); this.rig.add(plate);
    }

    // War paint (natives) — emissive stripes for vivid close-range color
    if (!isConq) {
      const paintMat = new THREE.MeshStandardMaterial({
        color: accent, emissive: accent, emissiveIntensity: 0.38, roughness: 0.8,
      });
      // Horizontal stripe across face (over eyes)
      const faceStripe = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 0.02), paintMat);
      faceStripe.position.set(0, 1.43, 0.20); this.rig.add(faceStripe);
      // Chest stripe
      const bodyStripe = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.045, 0.01), paintMat);
      bodyStripe.position.set(0, 1.02, 0.15); this.rig.add(bodyStripe);
      // Inca diagonal sash decoration
      if (this.civType === CivilizationType.INCA) {
        const diag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.52, 0.01), paintMat);
        diag.position.set(0.10, 0.96, 0.15); diag.rotation.z = 0.35; this.rig.add(diag);
      }
      // Maya cheek dots
      if (this.civType === CivilizationType.MAYA) {
        for (const sx of [-0.11, 0.11]) {
          const dot = new THREE.Mesh(new THREE.SphereGeometry(0.028, 5, 4), paintMat);
          dot.position.set(sx, 1.40, 0.185); this.rig.add(dot);
        }
      }
    }

    // Neck
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.10, 0.14, 8), skin);
    neck.position.y = 1.22; this.rig.add(neck);

    // Arms — stored as groups for swing animation
    const armSkin = isConq ? metal : skin;
    this.leftArm  = new THREE.Group(); this.leftArm.position.set(-0.30, 1.10, 0);
    this.rightArm = new THREE.Group(); this.rightArm.position.set( 0.30, 1.10, 0);
    this.rig.add(this.leftArm, this.rightArm);

    for (const [g, sx] of [[this.leftArm, -1], [this.rightArm, 1]] as [THREE.Group, number][]) {
      // upper arm
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.30, 0.14), armSkin);
      upper.position.y = -0.08; g.add(upper);
      // forearm
      const fore = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.26, 0.12), isConq ? metal : skin);
      fore.position.y = -0.32; g.add(fore);
      void sx; // used implicitly by group position
    }

    // Head — 16 × 12 segments for smoother silhouette
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.205, 16, 12), skin);
    head.position.y = 1.42; head.castShadow = true; this.rig.add(head);

    // Eyes
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x050202, roughness: 0.8 });
    const eyeL   = new THREE.Mesh(new THREE.SphereGeometry(0.034, 6, 4), eyeMat);
    const eyeR   = new THREE.Mesh(new THREE.SphereGeometry(0.034, 6, 4), eyeMat);
    eyeL.position.set(-0.078, 1.44, 0.185); this.rig.add(eyeL);
    eyeR.position.set( 0.078, 1.44, 0.185); this.rig.add(eyeR);

    // Nose bump
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.030, 5, 4), skin);
    nose.position.set(0, 1.37, 0.200); this.rig.add(nose);

    // Headgear
    this.addHeadgear(1.42, skin, dark, metal, accMat, jade, gold, isConq);

    // Weapon
    if (this.def.isRanged) {
      this.buildRangedWeapon(wood, dark, metal, isConq);
    } else {
      if (isConq) {
        // Steel sword — blade + guard + pommel
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.060, 0.70, 0.025), metal);
        blade.position.set(0.44, 1.16, 0.06); this.rig.add(blade);
        const guard = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.058, 0.06), dark);
        guard.position.set(0.44, 0.83, 0.06); this.rig.add(guard);
        const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.052, 6, 4), dark);
        pommel.position.set(0.44, 0.78, 0.06); this.rig.add(pommel);
      } else {
        // Macuahuitl — wooden paddle with alternating obsidian blades
        const club = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.58, 0.06), wood);
        club.position.set(0.44, 1.12, 0.06); this.rig.add(club);
        for (let i = 0; i < 3; i++) {
          const y = 1.33 - i * 0.14;
          for (const ox of [0.508, 0.372]) {
            const blade = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.095, 0.020), dark);
            blade.position.set(ox, y, 0.066); this.rig.add(blade);
          }
        }
      }
    }

    // Shield (heavy / elite units)
    if (isHeavy) {
      if (isConq) {
        const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.07, 16), metal);
        sh.rotation.z = Math.PI / 2; sh.rotation.y = Math.PI / 2;
        sh.position.set(-0.42, 0.88, 0.14); sh.castShadow = true; this.rig.add(sh);
        // Red cross emblem
        const redMat = new THREE.MeshStandardMaterial({ color: 0xcc1818, roughness: 0.75 });
        const cH = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.044, 0.020), redMat);
        cH.position.set(-0.47, 0.88, 0.14); this.rig.add(cH);
        const cV = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.20, 0.020), redMat);
        cV.position.set(-0.47, 0.88, 0.14); this.rig.add(cV);
      } else {
        const shMat = this.civType === CivilizationType.INCA ? gold : jade;
        const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.07, 16), shMat);
        sh.rotation.z = Math.PI / 2; sh.rotation.y = Math.PI / 2;
        sh.position.set(-0.40, 0.88, 0.14); sh.castShadow = true; this.rig.add(sh);
        // Circular emblem
        const emblem = new THREE.Mesh(new THREE.CircleGeometry(0.13, 8), accMat);
        emblem.rotation.y = Math.PI / 2; emblem.position.set(-0.45, 0.88, 0.14); this.rig.add(emblem);
      }
    }
  }

  // ── Headgear ─────────────────────────────────────────────────────────────────
  private addHeadgear(
    headY: number,
    _skin: THREE.Material, dark: THREE.Material, metal: THREE.Material,
    accMat: THREE.Material, jade: THREE.Material, gold: THREE.Material,
    isConq: boolean,
  ) {
    if (isConq) {
      // Morion helmet — rounded skull + oval brim + fore-aft crest
      const skull = new THREE.Mesh(new THREE.SphereGeometry(0.220, 14, 10, 0, Math.PI * 2, 0, Math.PI / 1.6), metal);
      skull.position.y = headY + 0.04; this.rig.add(skull);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.285, 0.285, 0.034, 22), metal);
      brim.position.y = headY + 0.06; this.rig.add(brim);
      const crest = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.16, 0.42), metal);
      crest.position.y = headY + 0.20; this.rig.add(crest);
      return;
    }

    // Feather fan colors
    const fanPalette = [0xe82020, 0x2065e8, 0x20c060, 0xffcc20, 0xe060c0, 0xff7020, 0xb000c0];

    if (this.civType === CivilizationType.AZTEC) {
      if (this.type === UnitType.EAGLE_WARRIOR) {
        // Eagle head helmet — white plumage cap + yellow beak
        const eagleCap = new THREE.Mesh(
          new THREE.SphereGeometry(0.235, 14, 10),
          new THREE.MeshStandardMaterial({ color: 0xf4f0e8, roughness: 0.72 }),
        );
        eagleCap.position.y = headY + 0.06; this.rig.add(eagleCap);
        const beak = new THREE.Mesh(
          new THREE.ConeGeometry(0.060, 0.28, 6),
          new THREE.MeshStandardMaterial({ color: 0xd4a820, roughness: 0.55, metalness: 0.10 }),
        );
        beak.rotation.x = Math.PI / 2;
        beak.position.set(0, headY + 0.10, 0.36); this.rig.add(beak);
        // Black eye-ring on helmet
        const ering = new THREE.Mesh(
          new THREE.TorusGeometry(0.068, 0.018, 5, 10),
          new THREE.MeshStandardMaterial({ color: 0x0a0806, roughness: 0.8 }),
        );
        ering.rotation.y = Math.PI / 5;
        ering.position.set(-0.17, headY + 0.12, 0.14); this.rig.add(ering);
        // Tail feathers fanning up from back
        this.addFeatherFan(headY, [0xf4f0e8, 0xd4d0c8, 0xf4f0e8], 3, 0.44, 0.55);

      } else if (this.type === UnitType.JAGUAR_KNIGHT) {
        // Jaguar skull helmet — golden-ochre cap + ears + dark spots
        const jagCap = new THREE.Mesh(
          new THREE.SphereGeometry(0.238, 12, 10),
          new THREE.MeshStandardMaterial({ color: 0xe2b850, roughness: 0.78 }),
        );
        jagCap.position.y = headY + 0.06; this.rig.add(jagCap);
        for (const ex of [-0.16, 0.16]) {
          const ear = new THREE.Mesh(
            new THREE.ConeGeometry(0.060, 0.10, 4),
            new THREE.MeshStandardMaterial({ color: 0xe2b850, roughness: 0.80 }),
          );
          ear.position.set(ex, headY + 0.30, -0.02); this.rig.add(ear);
        }
        const spotMat = new THREE.MeshStandardMaterial({ color: 0x2c1a08, roughness: 0.9 });
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          const sp = new THREE.Mesh(new THREE.SphereGeometry(0.030, 5, 4), spotMat);
          sp.position.set(Math.cos(a) * 0.20, headY + 0.11, Math.sin(a) * 0.09 + 0.04);
          this.rig.add(sp);
        }
        // Back feather fan
        this.addFeatherFan(headY, fanPalette, 4, 0.44, 0.72);

      } else {
        // Generic Aztec warrior — tall colorful feather fan + jade band
        this.addFeatherFan(headY, fanPalette, 6, 0.50, 0.90);
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.200, 0.038, 7, 18), accMat);
        band.rotation.x = Math.PI / 2; band.position.y = headY + 0.10; this.rig.add(band);
      }

    } else if (this.civType === CivilizationType.INCA) {
      // Woven gold headband + 4 large upright feathers + sun disc
      const headband = new THREE.Mesh(new THREE.CylinderGeometry(0.218, 0.218, 0.10, 18), gold);
      headband.position.y = headY + 0.08; this.rig.add(headband);
      this.addFeatherFan(headY, [0xdd2020, 0x2040cc, 0xffcc20, 0x20aa50], 4, 0.54, 0.90);
      // Gold sun disc on forehead
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.10, 12), gold);
      disc.position.set(0, headY + 0.10, 0.22); this.rig.add(disc);
      // Turquoise studs on band
      const studMat = new THREE.MeshStandardMaterial({ color: 0x00b8b0, roughness: 0.5, metalness: 0.1 });
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI;
        const stud = new THREE.Mesh(new THREE.SphereGeometry(0.022, 5, 4), studMat);
        stud.position.set(Math.cos(a) * 0.218, headY + 0.08, Math.sin(a) * 0.218);
        this.rig.add(stud);
      }

    } else if (this.civType === CivilizationType.MAYA) {
      // Stepped jade headdress (mini-pyramid layered tiers) + jade collar
      const tiers: [number, number, number, number][] = [
        [0.42, 0.12, 0.22, headY + 0.18],
        [0.32, 0.12, 0.18, headY + 0.30],
        [0.22, 0.11, 0.14, headY + 0.42],
        [0.14, 0.10, 0.10, headY + 0.52],
      ];
      for (const [w, h, d, y] of tiers) {
        const tier = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), jade);
        tier.position.y = y; this.rig.add(tier);
      }
      // Jade collar
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.215, 0.052, 7, 18), jade);
      collar.rotation.x = Math.PI / 2; collar.position.y = headY - 0.05; this.rig.add(collar);
      // Gold capping stone on top tier
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.058, 7, 5), gold);
      cap.position.set(0, headY + 0.59, 0); this.rig.add(cap);
    }

    void dark; // available for future detail
  }

  private addFeatherFan(headY: number, palette: number[], count: number, height: number, spread: number) {
    for (let i = 0; i < count; i++) {
      const t  = count > 1 ? (i / (count - 1)) - 0.5 : 0;
      const fc = palette[i % palette.length];
      const fmat = new THREE.MeshStandardMaterial({
        color: fc, roughness: 0.65, emissive: fc, emissiveIntensity: 0.05,
      });
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.056, height, 5), fmat);
      f.position.set(t * spread * 0.52, headY + 0.32 + Math.abs(t) * 0.06, -0.14 - Math.abs(t) * 0.04);
      f.rotation.x = -0.56 - Math.abs(t) * 0.10;
      f.rotation.z =  t * 0.66;
      f.castShadow = true;
      this.rig.add(f);
    }
  }

  // ── Ranged weapons ───────────────────────────────────────────────────────────
  private buildRangedWeapon(wood: THREE.Material, dark: THREE.Material, metal: THREE.Material, isConq: boolean) {
    if (isConq) {
      // Arquebus — stock + barrel + trigger guard
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.10, 0.72), wood);
      stock.position.set(0.30, 0.96, 0.12); this.rig.add(stock);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.68, 8), dark);
      barrel.rotation.x = Math.PI / 2; barrel.position.set(0.30, 1.04, 0.28); this.rig.add(barrel);
      const guard = new THREE.Mesh(new THREE.TorusGeometry(0.060, 0.012, 4, 8, Math.PI), metal);
      guard.rotation.x = -Math.PI / 2; guard.position.set(0.30, 0.92, -0.06); this.rig.add(guard);
      return;
    }
    if (this.type === UnitType.SLINGER) {
      const cord = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.013, 5, 12), dark);
      cord.position.set(0.42, 1.02, 0.10); cord.rotation.y = Math.PI / 2; this.rig.add(cord);
      const pouch = new THREE.Mesh(new THREE.SphereGeometry(0.060, 6, 4), wood);
      pouch.position.set(0.53, 1.02, 0.10); this.rig.add(pouch);
      return;
    }
    if (this.type === UnitType.ATLATL) {
      // Javelin + atlatl board
      const jav = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.05, 6), wood);
      jav.rotation.z = Math.PI / 2.2; jav.position.set(0.40, 1.06, 0.0); this.rig.add(jav);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.044, 0.14, 6), dark);
      tip.rotation.z = -Math.PI / 2.2; tip.position.set(0.88, 1.19, 0.0); this.rig.add(tip);
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.34), wood);
      board.rotation.z = Math.PI / 2.2; board.position.set(0.16, 1.02, 0.05); this.rig.add(board);
      return;
    }
    // Bow + string + nocked arrow
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.30, 0.026, 6, 16, Math.PI * 1.05), wood);
    bow.position.set(0.40, 0.96, 0.06); bow.rotation.y = Math.PI / 2; this.rig.add(bow);
    const str = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.56, 0.005), dark);
    str.position.set(0.40, 0.96, 0.06); this.rig.add(str);
    const arrow = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.52, 5), wood);
    arrow.rotation.z = Math.PI / 2; arrow.position.set(0.40, 1.00, 0.08); this.rig.add(arrow);
  }

  // ── Cavalry ──────────────────────────────────────────────────────────────────
  private buildCavalry(
    bodyMat: THREE.Material, skin: THREE.Material, dark: THREE.Material,
    metal: THREE.Material, wood: THREE.Material, accMat: THREE.Material,
  ) {
    const horseMat = new THREE.MeshStandardMaterial({ color: 0x4e3018, roughness: 0.88 });
    const maneMat  = new THREE.MeshStandardMaterial({ color: 0x2a1808, roughness: 0.90 });

    // Horse body
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.58, 1.15), horseMat);
    body.position.set(0, 0.80, 0); body.castShadow = true; this.rig.add(body);
    // Neck + head
    const neck  = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.52, 0.30), horseMat);
    neck.position.set(0, 1.07, 0.57); neck.rotation.x = -0.50; this.rig.add(neck);
    const hhead = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.25, 0.44), horseMat);
    hhead.position.set(0, 1.30, 0.80); this.rig.add(hhead);
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.10), horseMat);
    snout.position.set(0, 1.24, 1.00); this.rig.add(snout);
    // Mane
    const mane = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.30, 0.80), maneMat);
    mane.position.set(0, 1.30, 0.36); this.rig.add(mane);
    // Legs + hooves
    for (const [lx, lz] of [[-0.19, 0.44], [0.19, 0.44], [-0.19, -0.44], [0.19, -0.44]] as const) {
      this.addLimb(horseMat, 0.13, 0.58, 0.13, lx, 0.30, lz);
      this.addLimb(dark,     0.14, 0.11, 0.14, lx, 0.04, lz);
    }
    // Tail
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.52, 6), maneMat);
    tail.position.set(0, 0.90, -0.64); tail.rotation.x = 0.72; this.rig.add(tail);
    // Saddlecloth
    const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.07, 0.58), accMat);
    saddle.position.set(0, 1.10, -0.08); this.rig.add(saddle);

    // Rider — torso + breastplate
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.50, 0.26), bodyMat);
    torso.position.set(0, 1.50, -0.06); torso.castShadow = true; this.rig.add(torso);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.40, 0.06), metal);
    plate.position.set(0, 1.50, 0.08); this.rig.add(plate);
    // Head + morion
    const rhead = new THREE.Mesh(new THREE.SphereGeometry(0.165, 14, 10), skin);
    rhead.position.set(0, 1.86, -0.06); this.rig.add(rhead);
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.185, 12, 8, 0, Math.PI * 2, 0, Math.PI / 1.6), metal);
    helm.position.set(0, 1.92, -0.06); this.rig.add(helm);
    const crest = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.14, 0.40), metal);
    crest.position.set(0, 2.04, -0.06); this.rig.add(crest);

    // Banner pole + flag
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.60, 5), wood);
    pole.position.set(-0.22, 1.65, -0.14); this.rig.add(pole);
    const banner = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.36, 0.30), accMat);
    banner.position.set(-0.22, 1.80, -0.06); this.rig.add(banner);

    // Lance + tip
    const lance = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 1.55, 6), wood);
    lance.rotation.x = Math.PI / 2.3; lance.position.set(0.26, 1.44, 0.22); this.rig.add(lance);
    const ltip = new THREE.Mesh(new THREE.ConeGeometry(0.050, 0.18, 6), metal);
    ltip.rotation.x = Math.PI / 2.3; ltip.position.set(0.26, 2.00, 0.80); this.rig.add(ltip);
  }

  // ── Cannon ───────────────────────────────────────────────────────────────────
  private buildCannon(metal: THREE.Material, wood: THREE.Material, accMat: THREE.Material) {
    // Carriage
    const carriage = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.24, 0.84), wood);
    carriage.position.y = 0.42; carriage.castShadow = true; this.rig.add(carriage);
    this.addLimb(wood, 0.07, 0.20, 0.84, -0.31, 0.44, 0);
    this.addLimb(wood, 0.07, 0.20, 0.84,  0.31, 0.44, 0);
    // Barrel
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.21, 0.92, 14), metal);
    barrel.rotation.x = Math.PI / 2.7; barrel.position.set(0, 0.62, 0.12); barrel.castShadow = true; this.rig.add(barrel);
    const muzzle = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.044, 8, 16), metal);
    muzzle.rotation.x = Math.PI / 2.7 + Math.PI / 2; muzzle.position.set(0, 0.80, 0.50); this.rig.add(muzzle);
    // Wheels with spokes
    for (const wx of [-0.32, 0.32]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.30, 0.09, 18), wood);
      wheel.rotation.z = Math.PI / 2; wheel.position.set(wx, 0.30, -0.10); wheel.castShadow = true; this.rig.add(wheel);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.11, 8), metal);
      hub.rotation.z = Math.PI / 2; hub.position.set(wx, 0.30, -0.10); this.rig.add(hub);
      for (let s = 0; s < 6; s++) {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.030, 0.50, 0.030), wood);
        spoke.position.set(wx, 0.30, -0.10);
        spoke.rotation.z = (s / 6) * Math.PI * 2;
        this.rig.add(spoke);
      }
    }
    // Flag
    const flag = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.32, 0.24), accMat);
    flag.position.set(-0.22, 0.98, -0.32); this.rig.add(flag);
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  setSelected(sel: boolean) {
    this.selected = sel;
    this.selectionRing.visible = sel;
  }
  isSelected() { return this.selected; }
  isAlive()    { return this.state !== UnitState.DEAD; }
  gridPos(): GridPos { return { col: this.col, row: this.row }; }

  distanceTo(other: Unit): number {
    const dx = this.col - other.col;
    const dz = this.row - other.row;
    return Math.sqrt(dx * dx + dz * dz);
  }

  /** Reduce morale; heroes never waver. Panic is triggered by Game when morale ≤ 25. */
  loseMorale(amount: number) {
    if (this.isHero) return;
    // Drummer aura: the steady beat halves morale damage (panic resistance)
    if (this.nearDrummer) amount = Math.ceil(amount * 0.5);
    // Regiment discipline: formed troops never rout — morale can't drop below 30
    const floor = this.regimentBuff ? 30 : 0;
    this.morale = Math.max(floor, this.morale - amount);
    this._moraleCooldown = 3;
  }

  moveTo(path: GridPos[]) {
    if (this.panicked) return; // routed troops ignore orders
    if (path.length === 0) return;
    this.entrenched = false;
    this.path      = path;
    this.pathIndex = 0;
    this.state                = UnitState.MOVING;
    this.attackTarget         = null;
    this.attackBuildingTarget = null;
    this.garrisonTarget       = null;
    this.captureTarget        = null;
    this.formationSpeedCap    = null;
    this.patrolA = null; this.patrolB = null;
  }

  setPatrol(a: GridPos, b: GridPos) {
    this.patrolA   = a;
    this.patrolB   = b;
    this.patrolFlip = false;
    this.attackTarget         = null;
    this.attackBuildingTarget = null;
  }

  attackUnit(target: Unit) {
    if (this.panicked) return;
    this.entrenched           = false;
    this.attackTarget         = target;
    this.attackBuildingTarget = null;
    this.garrisonTarget       = null;
    this.captureTarget        = null;
    this.formationSpeedCap    = null;
    this.state                = UnitState.ATTACKING;
    this.attackAnim           = 1;
  }

  attackBuilding(target: import('./Building').Building) {
    if (this.panicked) return;
    this.entrenched           = false;
    this.attackBuildingTarget = target;
    this.attackTarget         = null;
    this.state                = UnitState.ATTACKING;
    this.attackAnim           = 1;
  }

  triggerAttackAnim() { this.attackAnim = 1; }

  takeDamage(amount: number): number {
    const dmg = Math.max(1, amount - this.defense);
    this.hp   = Math.max(0, this.hp - dmg);
    this._damageCooldown = 5;  // 5 s before healing starts
    this._idleHealTimer  = 0;
    this.killStreak      = 0;  // reset streak on taking damage
    this.loseMorale(3);
    // Retreat threshold based on stance: DEFENSIVE 30%, BALANCED 20%, AGGRESSIVE 10%
    const retreatThreshold = this.stance === 'DEFENSIVE' ? 0.30 : this.stance === 'AGGRESSIVE' ? 0.10 : 0.20;
    if (this.hp > 0 && this.hp < this.maxHp * retreatThreshold && !this.wantsRetreat) {
      this.wantsRetreat = true;
    }
    // Champion last stand: veteran (level 3) unit drops below 25% HP → surge of desperate fury
    if (this.hp > 0 && this.level >= 3 && !this.isHero && this.hp < this.maxHp * 0.25 && this.lastStandTimer <= 0) {
      this.lastStandTimer = 10;
    }
    this.updateHealthBar();
    if (this.hp <= 0) this.die();
    return dmg;
  }

  /** Restore HP (up to maxHp) and refresh the health bar. */
  heal(amount: number) {
    this.hp = Math.min(this.maxHp, this.hp + amount);
    this.updateHealthBar();
  }

  /** Get effective attack value, reduced by supply line penalties. */
  getEffectiveAttack(): number {
    if (this.supplyDist > 30) return this.attack * 0.8;  // -20% attack far from supply
    if (this.supplyDist > 15) return this.attack * 0.9;  // -10% attack medium distance
    return this.attack;
  }

  /** Get effective speed value, reduced by supply line penalties. */
  getEffectiveSpeed(): number {
    if (this.supplyDist > 30) return this.speed * 0.8;   // -20% speed far from supply
    if (this.supplyDist > 15) return this.speed * 0.9;   // -10% speed medium distance
    return this.speed;
  }

  private die() {
    this.state         = UnitState.DEAD;
    this.selected      = false;
    this.selectionRing.visible = false;
    if (this._statusRing) { this.mesh.remove(this._statusRing); this._statusRing = null; }
    this._deathTimer   = 0;   // start fall animation; mesh hides after animation completes
  }

  private updateHealthBar() {
    const pct = this.hp / this.maxHp;
    this.healthBar.scale.x = pct;
    this.healthBar.position.x = (pct - 1) * 0.39;
    (this.healthBar.material as THREE.MeshBasicMaterial).color.setHex(
      pct > 0.5 ? 0x33dd55 : pct > 0.25 ? 0xddaa00 : 0xdd2222,
    );
  }

  // ── Per-frame update ──────────────────────────────────────────────────────────
  update(dt: number, map: GameMap) {
    // Death fall animation (runs even after state=DEAD)
    if (this._deathTimer >= 0) {
      this._deathTimer += dt;
      const fallT = Math.min(1, this._deathTimer / 0.55);
      if (this.rig) {
        this.rig.rotation.z  = fallT * Math.PI / 2;   // tilt 90° sideways
        this.rig.position.y  = -fallT * 0.25;          // sink into ground
      }
      (this.healthBar.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - this._deathTimer * 2);
      if (this._deathTimer >= 2.2) {
        this.mesh.visible  = false;
        this._deathTimer   = -1;
      }
      return;
    }
    if (this.state === UnitState.DEAD) return;

    this.attackTimer  = Math.max(0, this.attackTimer - dt);
    if (this.berserkTimer > 0) this.berserkTimer = Math.max(0, this.berserkTimer - dt);
    this.animT += dt;

    // Officer banner: raised while the regiment is formed; gentle flag sway
    if (this._regimentBanner) {
      this._regimentBanner.visible = this.regimentLeaderId !== null;
      if (this._regimentBanner.visible) {
        this._regimentBanner.rotation.y = Math.sin(this.animT * 1.8) * 0.25;
      }
    }

    // Status ring: pulsing colored aura for panic / berserk / DoT effects
    const statusColor = this.panicked ? 0xff2222
      : this.berserkTimer > 0       ? 0xff8800
      : (this.burning > 0 || this.poisoned > 0) ? 0xcc44ff : 0;
    if (statusColor) {
      if (!this._statusRing) {
        const mat = new THREE.MeshBasicMaterial({
          color: statusColor, transparent: true, opacity: 0.7,
          depthTest: false, side: THREE.DoubleSide,
        });
        this._statusRing = new THREE.Mesh(new THREE.RingGeometry(0.86, 1.02, 32), mat);
        this._statusRing.rotation.x = -Math.PI / 2;
        this._statusRing.position.y = 0.04;
        this._statusRing.renderOrder = 8;
        this.mesh.add(this._statusRing);
      }
      this._statusRingT += dt * (this.panicked ? 4.5 : 2.5);
      const pulse = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(this._statusRingT));
      (this._statusRing.material as THREE.MeshBasicMaterial).color.setHex(statusColor);
      (this._statusRing.material as THREE.MeshBasicMaterial).opacity = pulse * 0.85;
    } else if (this._statusRing) {
      this.mesh.remove(this._statusRing);
      this._statusRing = null;
    }

    // Stationary defense: track time spent holding ground without moving
    if (this.state === UnitState.IDLE || this.state === UnitState.HOLD) {
      this.stationaryTimer = Math.min(10, this.stationaryTimer + dt);
    } else {
      this.stationaryTimer = 0;
    }
    // Ambush: melee stalkers prime a devastating first strike after holding still ≥5s
    if ((this.type === UnitType.JAGUAR_KNIGHT || this.type === UnitType.CUACHIC) && this.stationaryTimer >= 5) {
      this.ambushReady = true;
    }

    // Battle fatigue: ≥60s continuous combat reduces attack by 10%; rest clears it
    if (this.state === UnitState.ATTACKING) {
      this.combatTimer += dt;
      if (this.combatTimer >= 60 && !this.fatigued && !this.isHero) {
        this.fatigued          = true;
        this._preFatigueAttack = this.attack;
        this.attack            = Math.max(1, Math.round(this.attack * 0.9));
      }
    } else if (this.fatigued) {
      // HOLD command doubles recovery speed — troops resting in position shake off fatigue faster
      const recoveryRate = this.state === UnitState.HOLD ? 4 : 2;
      this.combatTimer = Math.max(0, this.combatTimer - dt * recoveryRate);
      if (this.combatTimer <= 0) {
        this.fatigued = false;
        this.attack   = this._preFatigueAttack; // restore pre-fatigue attack
      }
    } else {
      this.combatTimer = Math.max(0, this.combatTimer - dt);
    }

    // Morale regeneration: faster near own settlement; rally at 50 ends panic
    if (this._moraleCooldown > 0) {
      this._moraleCooldown -= dt;
    } else if (this.morale < 100) {
      let regen = this._nearSettlement ? 9 : 4;
      if (this._isolated) regen *= 0.5; // lone units struggle to recover morale
      if (this.inFormation) regen *= 1.5; // close ranks steady the nerves
      if (this.nearDrummer) regen *= 2.0; // the drumbeat steels the ranks
      // Home terrain bonus: natives recover morale faster on their ancestral lands
      const tile = map.getTile(this.col, this.row);
      if (tile) {
        const t = tile.terrain;
        const onHome =
          ((this.civType === CivilizationType.AZTEC || this.civType === CivilizationType.MAYA) &&
           t === TerrainType.JUNGLE) ||
          (this.civType === CivilizationType.INCA &&
           (t === TerrainType.HIGHLAND || t === TerrainType.MOUNTAIN));
        if (onHome) regen *= 1.6;
        // CONQUISTADOR supply line: disciplined logistics — morale recovers 40% faster near settlement
        if (this.civType === CivilizationType.CONQUISTADOR && this._nearSettlement) regen *= 1.4;
      }
      this.morale = Math.min(100, this.morale + regen * dt);
    }
    // Poison disrupts morale recovery — toxins sap the will to fight
    if (this.poisoned > 0) this.morale = Math.max(0, this.morale - 0.5 * dt);
    if (this.panicked && this.morale >= 50) { this.panicked = false; this.justRallied = true; }

    // Passive idle healing: 2 HP every 0.5 s after 5 s without damage
    // (nearSettlement flag set externally by Game.ts each frame for +3 extra HP/tick)
    if (this._damageCooldown > 0) {
      this._damageCooldown -= dt;
    } else if (this.state === UnitState.IDLE && this.hp < this.maxHp) {
      this._idleHealTimer += dt;
      // Civ terrain affinity: native terrain multiplies idle regen (AC: homeland endurance)
      const tile2 = map.getTile(this.col, this.row);
      let terrainHealMult = 1.0;
      if (tile2) {
        const t2 = tile2.terrain;
        if ((this.civType === CivilizationType.AZTEC || this.civType === CivilizationType.MAYA) && t2 === TerrainType.JUNGLE) {
          terrainHealMult = 1.5;
        } else if (this.civType === CivilizationType.INCA && (t2 === TerrainType.HIGHLAND || t2 === TerrainType.MOUNTAIN)) {
          terrainHealMult = 2.0;
        } else if (this.civType === CivilizationType.CONQUISTADOR && (t2 === TerrainType.BEACH || t2 === TerrainType.DESERT)) {
          terrainHealMult = 1.25;
        }
        // Beach healing spring: all units recover faster near water (fresh coastal springs)
        if (t2 === TerrainType.BEACH) terrainHealMult = Math.max(terrainHealMult, 1.5);
      }
      const healPerTick = Math.round((this._nearSettlement ? 5 : 2) * terrainHealMult);
      while (this._idleHealTimer >= 0.5) {
        this._idleHealTimer -= 0.5;
        this.hp = Math.min(this.maxHp, this.hp + healPerTick);
        this.updateHealthBar();
      }
    } else if (this.state !== UnitState.IDLE) {
      this._idleHealTimer = 0;
    }

    // Status effect DoT
    if (this.burning > 0) {
      this.burning = Math.max(0, this.burning - dt);
      this._burnTick += dt;
      while (this._burnTick >= 0.5) {
        this._burnTick -= 0.5;
        this.hp = Math.max(1, this.hp - 2);
        this.updateHealthBar();
      }
    }
    if (this.poisoned > 0) {
      this.poisoned = Math.max(0, this.poisoned - dt);
      this._poisonTick += dt;
      while (this._poisonTick >= 1) {
        this._poisonTick -= 1;
        this.hp = Math.max(1, this.hp - 2);
        this.updateHealthBar();
      }
    }

    // Slinger slow: -40% speed for the duration (does not stack)
    if (this.slowed > 0) this.slowed = Math.max(0, this.slowed - dt);

    // Hero war cry cooldown, attack buff, and rally cooldown
    if (this.warCryCooldown > 0) this.warCryCooldown = Math.max(0, this.warCryCooldown - dt);
    if (this.heroCooldown2   > 0) this.heroCooldown2  = Math.max(0, this.heroCooldown2  - dt);
    if (this.heroSpeedBuff   > 0) {
      this.heroSpeedBuff = Math.max(0, this.heroSpeedBuff - dt);
      if (this.heroSpeedBuff === 0 && this._preBuffSpeed > 0 && !this.incaBuff) {
        this.speed = this._preBuffSpeed; // restore only if incaBuff isn't also active
        this._preBuffSpeed = 0;
      }
    }
    if (this.buffAttackTimer  > 0) this.buffAttackTimer  = Math.max(0, this.buffAttackTimer  - dt);
    if (this.rallyCooldown    > 0) this.rallyCooldown    = Math.max(0, this.rallyCooldown    - dt);
    if (this.inspiredTimer    > 0) this.inspiredTimer    = Math.max(0, this.inspiredTimer    - dt);
    if (this.lastStandTimer   > 0) this.lastStandTimer   = Math.max(0, this.lastStandTimer   - dt);

    // Auto-entrench: units holding position for ≥8s dig in automatically
    if (this.state === UnitState.HOLD && !this.entrenched && !this.isHero &&
        this.type !== UnitType.CAVALRY && this.stationaryTimer >= 8) {
      this.entrenched = true;
    }

    // Cavalry charge tracking
    if (this.type === UnitType.CAVALRY) {
      if (this.state === UnitState.IDLE || this.state === UnitState.HOLD) {
        this._chargeIdleTime += dt;
        if (this._chargeIdleTime >= 3) this.chargeReady = true;
      } else if (this.state === UnitState.MOVING || this.state === UnitState.ATTACK_MOVE) {
        this._chargeIdleTime = 0;
        this.chargeReady = false;
      }
      // While ATTACKING: chargeReady persists until consumed in CombatSystem
    }

    // Charge speed burst: apply +0.6 speed for 2s after a successful cavalry charge
    if (this.chargeSpeedTimer > 0) {
      this.chargeSpeedTimer = Math.max(0, this.chargeSpeedTimer - dt);
      this.speed = Math.max(this.speed, this._defSpeed + 0.6);
      if (this.chargeSpeedTimer === 0) {
        this.speed = Math.max(0.1, this.speed - 0.6); // remove burst when timer expires
      }
    }

    // Ammo resupply: 1 round per 1.5 s when near own settlement OR a Storehouse supply depot.
    // Gunpowder rounds (arquebus/cannon) consume coal + iron from the player's stock (AC style).
    if (this.ammo >= 0 && this.ammo < this.maxAmmo && (this._nearSettlement || this._nearSupplyDepot)) {
      this._ammoRechargeTimer += dt;
      if (this._ammoRechargeTimer >= 1.5) {
        this._ammoRechargeTimer -= 1.5;
        const isGunpowder = this.type === UnitType.ARQUEBUSIER || this.type === UnitType.CANNON;
        if (!isGunpowder || Unit.tryConsumeGunpowder === null ||
            Unit.tryConsumeGunpowder(this.playerId, this.type)) {
          this.ammo++;
        }
      }
    } else {
      this._ammoRechargeTimer = 0;
    }

    // Supply regen: Storehouse proximity slowly heals wounded troops (up to 50% max HP)
    if (this._nearSupplyDepot && this.hp < this.maxHp * 0.5 && this.hp > 0) {
      this.hp = Math.min(Math.round(this.maxHp * 0.5), this.hp + dt);
      this.updateHealthBar();
    }

    if (this.state === UnitState.MOVING || this.state === UnitState.ATTACK_MOVE) {
      this.updateMovement(dt, map);
    }

    if (this.rig) {
      // Bob / lean while moving, gentle breath at idle
      if (this.state === UnitState.MOVING || this.state === UnitState.ATTACK_MOVE) {
        this.rig.position.y = Math.abs(Math.sin(this.animT * 11)) * 0.07;
        this.rig.rotation.z = Math.sin(this.animT * 11) * 0.04;
      } else {
        this.rig.position.y = Math.sin(this.animT * 2.2) * 0.015;
        this.rig.rotation.z = 0;
      }
      // Panic: frantic trembling while routed
      if (this.panicked) {
        this.rig.rotation.z = Math.sin(this.animT * 28) * 0.10;
      }
      // Entrenched: low crouching stance
      if (this.entrenched) {
        this.rig.position.y = -0.08 + Math.sin(this.animT * 1.2) * 0.008;
        this.rig.rotation.z = 0;
      }
      // Attack lunge forward
      if (this.attackAnim > 0) {
        this.attackAnim   = Math.max(0, this.attackAnim - dt * 3);
        this.rig.position.z = Math.sin((1 - this.attackAnim) * Math.PI) * 0.18;
      } else {
        this.rig.position.z = 0;
      }
    }

    // Arm swing when walking
    if (this.leftArm && this.rightArm) {
      if (this.state === UnitState.MOVING || this.state === UnitState.ATTACK_MOVE) {
        const swing = Math.sin(this.animT * 11) * 0.42;
        this.leftArm.rotation.x  =  swing;
        this.rightArm.rotation.x = -swing;
      } else {
        this.leftArm.rotation.x  *= 0.88;
        this.rightArm.rotation.x *= 0.88;
      }
    }

    // Planar position — Y is owned by Renderer.syncHeights
    this.mesh.position.x = this.worldX;
    this.mesh.position.z = this.worldZ;
  }

  private updateMovement(dt: number, map: GameMap) {
    if (this.pathIndex >= this.path.length) {
      // Check if there are waypoint paths to visit
      if (this.waypointPaths.length > 0) {
        const nextPath = this.waypointPaths.shift();
        if (nextPath && nextPath.length > 0) {
          this.path = nextPath;
          this.pathIndex = 0;
          this.state = UnitState.MOVING;
          return;
        }
      }
      this.state = UnitState.IDLE;
      this.formationSpeedCap = null;
      return;
    }

    const target = this.path[this.pathIndex];
    const tx = target.col * TILE_SIZE;
    const tz = target.row * TILE_SIZE;
    const dx = tx - this.worldX;
    const dz = tz - this.worldZ;
    const dist = Math.sqrt(dx * dx + dz * dz);

    // Terrain-based speed modifier
    const tile = map.getTile(this.col, this.row);
    let terrainMult = 1.0;
    switch (tile?.terrain) {
      case TerrainType.JUNGLE:   terrainMult = 0.62; break;
      case TerrainType.MOUNTAIN: terrainMult = 0.48; break;
      case TerrainType.HIGHLAND: terrainMult = 0.72; break;
      case TerrainType.DESERT:   terrainMult = 0.88; break;
    }
    // Cavalry desert sprint: horses thrive in open arid terrain (+20% speed)
    if (this.type === UnitType.CAVALRY && tile?.terrain === TerrainType.DESERT) terrainMult *= 1.20;
    // Civilization terrain affinity bonuses (historical flavor)
    if (this.civType === CivilizationType.INCA && !this.isHero &&
        (tile?.terrain === TerrainType.HIGHLAND || tile?.terrain === TerrainType.MOUNTAIN)) {
      terrainMult *= 1.22; // Inca highland/mountain runners
    }
    if ((this.civType === CivilizationType.AZTEC || this.civType === CivilizationType.MAYA) &&
        !this.isHero && tile?.terrain === TerrainType.JUNGLE) {
      terrainMult *= 1.28; // Native jungle expertise (partially offsets 0.62× penalty)
    }
    if (this.civType === CivilizationType.CONQUISTADOR && !this.isHero &&
        tile?.terrain === TerrainType.JUNGLE) {
      terrainMult *= 0.82; // European steel armour is brutally hot in the jungle
    }
    // Heavy wounds (< 25% HP) impair movement — bleeding soldiers can't keep pace
    if (this.hp < this.maxHp * 0.25) terrainMult *= 0.7;
    // Wet weather turns ground to mud — all units move slower in rain/storm
    terrainMult *= Unit.weatherSpeedMult;
    // Slinger slow: stone projectiles stagger the target (-40% speed)
    if (this.slowed > 0) terrainMult *= 0.6;
    // Apply supply line speed penalty (units far from bases move slower)
    const supplyAdjustedSpeed = this.getEffectiveSpeed();
    const effSpeed = this.formationSpeedCap !== null ? Math.min(supplyAdjustedSpeed, this.formationSpeedCap) : supplyAdjustedSpeed;
    const step = effSpeed * TILE_SIZE * dt * terrainMult;

    if (dist <= step) {
      this.worldX = tx; this.worldZ = tz;
      this.col = target.col; this.row = target.row;
      this.pathIndex++;
      if (this.pathIndex >= this.path.length) {
        this.state = UnitState.IDLE;
        this.formationSpeedCap = null;
      }
    } else {
      this.worldX += (dx / dist) * step;
      this.worldZ += (dz / dist) * step;
      this.mesh.rotation.y = Math.atan2(dx, dz);
    }
  }

  /** Issue an attack-move command: unit moves along path, auto-attacks anything in range. */
  attackMove(path: GridPos[]) {
    if (this.panicked) return;
    this.entrenched  = false;
    this.path        = path;
    this.pathIndex   = 0;
    this.attackTarget = null;
    this.garrisonTarget = null;
    this.captureTarget  = null;
    this.state       = UnitState.ATTACK_MOVE;
  }

  /**
   * Toggle entrench: digs the unit into cover (+5 defense, HOLD state).
   * Any movement order cancels the entrench.
   */
  entrench() {
    if (this.entrenched) {
      this.entrenched = false;
      if (this.state === UnitState.HOLD) this.state = UnitState.IDLE;
    } else {
      this.entrenched = true;
      this.state = UnitState.HOLD;
      this.path = [];
      this.pathIndex = 0;
      this.attackTarget = null;
      this.attackBuildingTarget = null;
      this.garrisonTarget = null;
      this.captureTarget = null;
      // Trench confidence: digging in gives troops a sense of security (+10 morale)
      this.morale = Math.min(100, this.morale + 10);
    }
  }

  /** Set tactical formation. Adjusts unit speed; attack/defense bonuses applied in CombatSystem. */
  setFormation(name: string | null) {
    this.formation = (name && FORMATIONS[name]) ? name : null;
    const f = this.formation ? FORMATIONS[this.formation] : null;
    this._formationSpeedMul = f ? Math.max(0.2, 1 + f.bonusSpeed) : 1.0;
    this.speed = Math.max(0.5, this._defSpeed * this._formationSpeedMul);
  }

  /**
   * Hero war cry: boosts morale and attack of all friendly units within 8 tiles.
   * Returns number of units affected, or 0 if on cooldown / not a hero.
   */
  triggerWarCry(alliedUnits: Unit[]): number {
    if (!this.isHero || this.warCryCooldown > 0) return 0;
    this.warCryCooldown = 45;
    let count = 0;
    for (const u of alliedUnits) {
      if (!u.isAlive()) continue;
      const d = Math.sqrt((u.col - this.col) ** 2 + (u.row - this.row) ** 2);
      if (d <= 8) {
        u.morale = Math.min(100, u.morale + 30);
        u.buffAttackTimer = 12;
        if (u.panicked) { u.panicked = false; }
        count++;
      }
    }
    return count;
  }

  /** Award XP and level up if threshold reached. */
  gainXP(amount: number) {
    if (this.level >= 3) return;
    this.xp += this._nearVeteranTeacher ? Math.round(amount * 1.30) : amount;
    const needed = this.level === 1 ? 50 : 150;
    if (this.xp >= needed) this.levelUp();
  }

  private levelUp() {
    this.level++;
    this.attack       = Math.round(this.attack       * 1.15);
    this.defense      = Math.round(this.defense      * 1.15);
    this.maxHp        = Math.round(this.maxHp        * 1.10);
    this.hp           = this.maxHp;
    // Veterans attack faster: 8% cooldown reduction per level (cap at 0.3s)
    this.attackCooldown = Math.max(0.3, this.attackCooldown * 0.92);
    this.justLeveledUp  = true;
    this.refreshLevelRing();
  }

  private refreshLevelRing() {
    if (this._levelRing) { this.mesh.remove(this._levelRing); this._levelRing = null; }
    if (this.level < 2) return;
    const color = this.level >= 3 ? 0xff7700 : 0xffdd00;
    const mat   = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, depthTest: false });
    this._levelRing = new THREE.Mesh(new THREE.RingGeometry(0.68, 0.84, 32), mat);
    this._levelRing.rotation.x = -Math.PI / 2;
    this._levelRing.position.y = 0.04;
    this._levelRing.renderOrder = 9;
    this.mesh.add(this._levelRing);
  }

  markAsHero(name: string) {
    this.isHero   = true;
    this.heroName = name;
    // Boost stats
    this.maxHp    = Math.round(this.maxHp    * 1.5);
    this.hp       = this.maxHp;
    this.attack   = Math.round(this.attack   * 1.35);
    this.defense  = Math.round(this.defense  * 1.5);
    this.speed   += 0.2;
    this._defSpeed = this.speed; // sync canonical speed with hero boost
    // Distinctive double gold ring
    const matOuter = new THREE.MeshBasicMaterial({ color: 0xffd700, transparent: true, opacity: 0.90, depthTest: false });
    const matInner = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.50, depthTest: false });
    const outer = new THREE.Mesh(new THREE.RingGeometry(0.90, 1.10, 32), matOuter);
    const inner = new THREE.Mesh(new THREE.RingGeometry(0.72, 0.88, 32), matInner);
    outer.rotation.x = inner.rotation.x = -Math.PI / 2;
    outer.position.y = 0.02;
    inner.position.y = 0.03;
    outer.renderOrder = inner.renderOrder = 8;
    this.mesh.add(outer, inner);
  }
}
