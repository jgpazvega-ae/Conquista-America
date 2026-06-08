import * as THREE from 'three';
import { UnitType, CivilizationType, UnitState, TerrainType } from './types';
import type { GridPos } from './types';
import type { UnitDef } from './civilizations';
import { getUnitDef } from './civilizations';
import { TILE_SIZE } from './constants';
import type { GameMap } from './Map';

let nextId = 1;

const SKIN_TONES: Record<CivilizationType, number> = {
  [CivilizationType.AZTEC]:        0xc27848,
  [CivilizationType.INCA]:         0xb87040,
  [CivilizationType.MAYA]:         0xca8050,
  [CivilizationType.CONQUISTADOR]: 0xdba870,
};

export class Unit {
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
  attackTarget: Unit | null = null;
  attackBuildingTarget: import('./Building').Building | null = null;
  attackTimer: number = 0;

  // Patrol
  patrolA: GridPos | null = null;
  patrolB: GridPos | null = null;
  patrolFlip = false;

  // XP / leveling
  xp:    number = 0;
  level: number = 1;

  // Civilization power buffs
  incaBuff  = false;
  conquBuff = false;

  moveX: number = 0;
  moveZ: number = 0;
  moveProgress: number = 1;

  mesh!: THREE.Group;
  private rig!: THREE.Group;
  private leftArm:  THREE.Group | null = null;
  private rightArm: THREE.Group | null = null;
  healthBar!: THREE.Mesh;
  selectionRing!: THREE.Mesh;
  private _levelRing: THREE.Mesh | null = null;
  private selected    = false;
  private animT       = Math.random() * 10;
  private attackAnim  = 0;
  private _deathTimer = -1;

  // Passive healing / retreat
  _damageCooldown  = 0;     // seconds since last hit; healing begins when this reaches 0
  _idleHealTimer   = 0;     // accumulates while healing
  _nearSettlement  = false; // set each frame by Game.ts; boosts idle heal rate
  wantsRetreat     = false; // set by takeDamage when HP < 20%; cleared by Game

  // Status effects (damage over time)
  burning  = 0;  // remaining burn duration (s); 2 HP every 0.5 s
  poisoned = 0;  // remaining poison duration (s); 2 HP every 1 s
  private _burnTick   = 0;
  private _poisonTick = 0;

  // Cavalry charge: ready after 3s idle; consumed on first attack
  chargeReady     = false;
  private _chargeIdleTime = 0;

  // Hero unit
  isHero   = false;
  heroName = '';

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
    this.attackRange       = s.attackRange;
    this.sight             = s.sight;
    this.attackCooldown    = s.attackCooldown;

    this.col = this.targetCol = col;
    this.row = this.targetRow = row;
    this.worldX = col * TILE_SIZE;
    this.worldZ = row * TILE_SIZE;

    this.buildMesh(civColor);
  }

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

  moveTo(path: GridPos[]) {
    if (path.length === 0) return;
    this.path      = path;
    this.pathIndex = 0;
    this.state                = UnitState.MOVING;
    this.attackTarget         = null;
    this.attackBuildingTarget = null;
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
    this.attackTarget         = target;
    this.attackBuildingTarget = null;
    this.state                = UnitState.ATTACKING;
    this.attackAnim           = 1;
  }

  attackBuilding(target: import('./Building').Building) {
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
    if (this.hp > 0 && this.hp < this.maxHp * 0.20 && !this.wantsRetreat) {
      this.wantsRetreat = true;
    }
    this.updateHealthBar();
    if (this.hp <= 0) this.die();
    return dmg;
  }

  private die() {
    this.state         = UnitState.DEAD;
    this.selected      = false;
    this.selectionRing.visible = false;
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

    this.attackTimer = Math.max(0, this.attackTimer - dt);
    this.animT += dt;

    // Passive idle healing: 2 HP every 0.5 s after 5 s without damage
    // (nearSettlement flag set externally by Game.ts each frame for +3 extra HP/tick)
    if (this._damageCooldown > 0) {
      this._damageCooldown -= dt;
    } else if (this.state === UnitState.IDLE && this.hp < this.maxHp) {
      this._idleHealTimer += dt;
      const healPerTick = this._nearSettlement ? 5 : 2;
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
      this.state = UnitState.IDLE;
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
    const step = this.speed * TILE_SIZE * dt * terrainMult;

    if (dist <= step) {
      this.worldX = tx; this.worldZ = tz;
      this.col = target.col; this.row = target.row;
      this.pathIndex++;
      if (this.pathIndex >= this.path.length) this.state = UnitState.IDLE;
    } else {
      this.worldX += (dx / dist) * step;
      this.worldZ += (dz / dist) * step;
      this.mesh.rotation.y = Math.atan2(dx, dz);
    }
  }

  /** Issue an attack-move command: unit moves along path, auto-attacks anything in range. */
  attackMove(path: GridPos[]) {
    this.path        = path;
    this.pathIndex   = 0;
    this.attackTarget = null;
    this.state       = UnitState.ATTACK_MOVE;
  }

  /** Award XP and level up if threshold reached. */
  gainXP(amount: number) {
    if (this.level >= 3) return;
    this.xp += amount;
    const needed = this.level === 1 ? 50 : 150;
    if (this.xp >= needed) this.levelUp();
  }

  private levelUp() {
    this.level++;
    this.attack  = Math.round(this.attack  * 1.15);
    this.defense = Math.round(this.defense * 1.15);
    this.maxHp   = Math.round(this.maxHp   * 1.10);
    this.hp      = this.maxHp;
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
