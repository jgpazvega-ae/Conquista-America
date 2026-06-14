import * as THREE from 'three';
import { BuildingType } from './buildings';
import type { BuildingDef } from './buildings';
import { CivilizationType, UnitType } from './types';
import { TILE_SIZE } from './constants';
import { TRAIN_TIMES } from './unitProduction';

export interface ProdQueueItem {
  unitType:  UnitType;
  elapsed:   number;
  totalTime: number;
}

let nextBuildingId = 1;

export enum BuildingState {
  CONSTRUCTING = 'CONSTRUCTING',
  COMPLETE = 'COMPLETE',
  DAMAGED = 'DAMAGED',
  DESTROYED = 'DESTROYED',
}

// Cultural palettes
const TERRACOTTA = 0xb24a2e; // characteristic Mesoamerican red trim
const THATCH      = 0xa8843e;
const ROOF_TILE   = 0xa3402a;

export class Building {
  readonly id: number;
  readonly type: BuildingType;
  playerId: number; // mutable: buildings can be captured (American Conquest style)
  readonly def: BuildingDef;
  readonly civType: CivilizationType;

  // Capture: melee units adjacent to an ungarrisoned enemy building raise this to 100
  captureProgress = 0;
  private _bannerMats: THREE.MeshStandardMaterial[] = [];

  col: number;
  row: number;
  hp: number;
  maxHp: number;
  state: BuildingState = BuildingState.CONSTRUCTING;
  buildProgress: number = 0; // 0..1
  buildTime: number;

  private _prodQueue: ProdQueueItem[] = [];
  finishedUnit: UnitType | null = null;
  readonly MAX_QUEUE = 5;

  // Auto-train: continuously queue this unit type when queue has space (American Conquest style)
  autoTrainUnit: UnitType | null = null;

  // Worker training (Settlement only): separate from unit queue
  workerTrainTimer = 0;   // elapsed seconds; 0 = idle
  workerTrainTotal = 0;   // total seconds for current worker
  workerFinished   = false; // set to true when worker is ready to spawn

  trainWorker(totalTime: number): boolean {
    if (!this.isComplete()) return false;
    if (this.workerTrainTimer > 0 && this.workerTrainTimer < this.workerTrainTotal) return false; // already training
    this.workerTrainTotal = totalTime;
    this.workerTrainTimer = 0.001; // tiny non-zero to mark started
    this.workerFinished   = false;
    return true;
  }

  get workerProductionProgress(): number {
    if (this.workerTrainTotal <= 0) return 0;
    return Math.min(1, this.workerTrainTimer / this.workerTrainTotal);
  }

  // Attack capability (watchtower)
  attackTimer: number = 0;

  // Passive self-repair: seconds since last hit; repair starts after 10 s
  private _timeSinceHit = 0;
  private static readonly REPAIR_DELAY   = 10; // s before repair kicks in
  private static readonly REPAIR_RATE    = 3;  // HP per second

  // Garrison (American Conquest style): troops inside shoot out and stay safe
  garrison: import('./Unit').Unit[] = [];
  get garrisonCapacity(): number {
    switch (this.type) {
      case BuildingType.SETTLEMENT: return 8;
      case BuildingType.WATCHTOWER: return 4;
      case BuildingType.TEMPLE:     return 3;
      case BuildingType.VILLAGE:    return 2;
      case BuildingType.BARRACKS:   return 3;
      case BuildingType.HARBOR:     return 2;
      case BuildingType.HOUSE:      return 2; // shelter — up to 2 units can hide inside
      case BuildingType.WALL:       return 4; // archers on the wall
      default:                      return 0;
    }
  }

  // Rally point for spawned units
  rallyCol: number | null = null;
  rallyRow: number | null = null;

  setRally(col: number, row: number) {
    this.rallyCol = col;
    this.rallyRow = row;
  }

  mesh!: THREE.Group;
  private structure!: THREE.Group;
  progressBar!: THREE.Mesh;
  private _fireMesh: THREE.Mesh | null = null;
  private _fireT = 0; // flicker timer

  constructor(type: BuildingType, def: BuildingDef, playerId: number, col: number, row: number, civColor: number, civType: CivilizationType = CivilizationType.AZTEC) {
    this.id = nextBuildingId++;
    this.type = type;
    this.def = def;
    this.playerId = playerId;
    this.civType = civType;
    this.col = col;
    this.row = row;
    this.maxHp = def.maxHp;
    this.hp = 0;
    this.buildTime = def.buildTime;

    this.buildMesh(civColor);
  }

  private stoneColor(): number {
    switch (this.civType) {
      case CivilizationType.AZTEC:        return 0xb7a07a;
      case CivilizationType.MAYA:         return 0xcdbd95;
      case CivilizationType.INCA:         return 0x8d8782;
      case CivilizationType.CONQUISTADOR: return 0xc9bfa6;
    }
  }

  private buildMesh(civColor: number) {
    this.mesh = new THREE.Group();
    this.mesh.position.set(this.col * TILE_SIZE, 0, this.row * TILE_SIZE);
    this.structure = new THREE.Group();
    this.mesh.add(this.structure);

    const isSettlement = this.type === BuildingType.SETTLEMENT;
    const scaleByType = isSettlement ? 1.0 : 0.62; // secondary buildings are smaller
    this.structure.scale.setScalar(scaleByType);

    const stone  = this.mat(this.stoneColor(), 0.95);
    const stone2 = this.mat(new THREE.Color(this.stoneColor()).multiplyScalar(0.82).getHex(), 0.95);
    const trim   = new THREE.MeshStandardMaterial({ color: civColor, roughness: 0.7, emissive: civColor, emissiveIntensity: 0.06 });

    if (this.type === BuildingType.VILLAGE) {
      this.buildVillage();
    } else if (this.type === BuildingType.HOUSE) {
      this.buildHouse(stone, stone2, trim);
    } else if (this.type === BuildingType.HARBOR) {
      this.buildHarbor(stone, stone2, trim);
    } else if (this.type === BuildingType.MARKET) {
      this.buildMarket(stone, stone2, trim);
    } else if (this.type === BuildingType.WALL) {
      this.buildWall(stone, stone2, trim);
    } else {
      switch (this.civType) {
        case CivilizationType.CONQUISTADOR: this.buildSpanish(stone, stone2, trim); break;
        case CivilizationType.INCA:         this.buildInca(stone, stone2, trim);   break;
        default:                            this.buildMesoamerican(stone, stone2, trim); break;
      }
    }

    // Ownership banner (high & colorful, readable from above)
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.0, 6), this.mat(0x5a4a32, 0.9));
    pole.position.set(0.7, 1.5, 0.7); this.structure.add(pole);
    const bannerMat = new THREE.MeshStandardMaterial({ color: civColor, side: THREE.DoubleSide, emissive: civColor, emissiveIntensity: 0.18, roughness: 0.6 });
    this._bannerMats.push(bannerMat);
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.32), bannerMat);
    banner.position.set(0.5, 1.82, 0.7); this.structure.add(banner);

    // Progress bar
    const progBg = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.13),
      new THREE.MeshBasicMaterial({ color: 0x221500, transparent: true, opacity: 0.85, depthTest: false }));
    this.progressBar = new THREE.Mesh(new THREE.PlaneGeometry(0.88, 0.1),
      new THREE.MeshBasicMaterial({ color: 0x55dd44, depthTest: false }));
    progBg.position.set(0, 2.5, 0);
    this.progressBar.position.set(0, 2.5, 0.01);
    progBg.rotation.x = this.progressBar.rotation.x = -Math.PI / 2;
    progBg.renderOrder = 10; this.progressBar.renderOrder = 11;
    this.mesh.add(progBg, this.progressBar);

    this.mesh.traverse(child => { child.userData.buildingId = this.id; });
    this.mesh.userData.buildingId = this.id;
  }

  private mat(color: number, rough = 0.9) {
    return new THREE.MeshStandardMaterial({ color, roughness: rough });
  }

  /** Show/hide the flame effect based on current HP fraction. */
  private _syncFire() {
    const pct = this.hp / this.maxHp;
    if (pct < 0.25 && this.isAlive()) {
      if (!this._fireMesh) {
        const fireMat = new THREE.MeshStandardMaterial({
          color: 0xff4400, emissive: 0xff2200, emissiveIntensity: 2.0,
          transparent: true, opacity: 0.85,
        });
        this._fireMesh = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.45, 6), fireMat);
        this._fireMesh.position.set(0.2, 2.2, 0.2);
        this._fireMesh.renderOrder = 12;
        this.mesh.add(this._fireMesh);
      }
      this._fireMesh.visible = true;
    } else if (this._fireMesh) {
      this._fireMesh.visible = false;
    }
  }

  private box(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, cast = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = cast; m.receiveShadow = true;
    this.structure.add(m);
    return m;
  }

  // ── Mesoamerican grand stepped temple-pyramid (Aztec / Maya) ────────────────
  private buildMesoamerican(stone: THREE.Material, stone2: THREE.Material, trim: THREE.Material) {
    const maya = this.civType === CivilizationType.MAYA;
    const red  = this.mat(TERRACOTTA, 0.8);
    const dark = this.mat(0x4a3a2a, 0.95);
    const tiers = maya ? 5 : 4;
    let w = 1.7, y = 0;
    const tierH = maya ? 0.42 : 0.4;

    for (let t = 0; t < tiers; t++) {
      this.box(t % 2 ? stone2 : stone, w, tierH, w, 0, y + tierH / 2, 0);
      // red terracotta ledge along the top rim of each tier
      const ledge = this.box(red, w + 0.06, 0.07, w + 0.06, 0, y + tierH, 0, false);
      ledge.receiveShadow = false;
      // carved frieze band (dark) on the lowest two tiers
      if (t < 2) this.box(dark, w + 0.07, 0.1, 0.02, 0, y + tierH * 0.45, w / 2 + 0.04, false);
      y += tierH;
      w *= maya ? 0.78 : 0.8;
    }

    // Grand central staircase up the front (+Z) face
    const steps = 7;
    const stepW = 0.55;
    for (let s = 0; s < steps; s++) {
      const sy = (s + 0.5) * (y / steps);
      const sz = (1.7 / 2) - s * ((1.7 / 2 - w / 2) / steps) + 0.04;
      this.box(stone2, stepW, y / steps, 0.16, 0, sy, sz, false);
    }
    // Balustrades flanking the stairs
    for (const bx of [-stepW / 2 - 0.05, stepW / 2 + 0.05]) {
      this.box(red, 0.07, y, 0.12, bx, y / 2, 1.7 / 2 - 0.1, false);
    }

    // Shrine(s) on the summit
    if (maya) {
      // Single tall shrine + roof comb (cresterÃ­a)
      this.box(stone, 0.6, 0.55, 0.55, 0, y + 0.27, 0);
      this.box(red, 0.5, 0.18, 0.5, 0, y + 0.6, 0, false);
      const comb = this.box(stone2, 0.5, 0.45, 0.08, 0, y + 0.95, 0);
      comb.castShadow = true;
      // dark doorway
      this.box(dark, 0.18, 0.32, 0.05, 0, y + 0.2, 0.28, false);
    } else {
      // Aztec twin temples (Templo Mayor style)
      for (const tx of [-0.28, 0.28]) {
        this.box(tx < 0 ? this.mat(0x9c6a3a) : this.mat(0xb24a2e), 0.42, 0.45, 0.45, tx, y + 0.22, 0);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.32, 4), tx < 0 ? trim : red);
        roof.position.set(tx, y + 0.6, 0); roof.rotation.y = Math.PI / 4; roof.castShadow = true;
        this.structure.add(roof);
        this.box(dark, 0.14, 0.26, 0.05, tx, y + 0.18, 0.24, false);
      }
    }

    // Type-specific extra (smaller buildings reuse the pyramid silhouette but add markers)
    this.addTypeMarker(trim, y);
  }

  // ── Inca megalithic battered terraces with trapezoidal niches ───────────────
  private buildInca(stone: THREE.Material, stone2: THREE.Material, trim: THREE.Material) {
    const gold = new THREE.MeshStandardMaterial({ color: 0xd9a92a, roughness: 0.4, metalness: 0.7, emissive: 0x6a4a00, emissiveIntensity: 0.2 });
    const dark = this.mat(0x1f1b16, 1);
    let y = 0;
    // Two battered (inward-leaning) terraces using 4-sided cylinders
    const terr = [{ rb: 1.05, rt: 0.92, h: 0.6 }, { rb: 0.82, rt: 0.7, h: 0.55 }];
    for (let i = 0; i < terr.length; i++) {
      const t = terr[i];
      const m = new THREE.Mesh(new THREE.CylinderGeometry(t.rt, t.rb, t.h, 4), i % 2 ? stone2 : stone);
      m.rotation.y = Math.PI / 4;
      m.position.y = y + t.h / 2; m.castShadow = m.receiveShadow = true;
      this.structure.add(m);
      y += t.h;
    }
    // Trapezoidal niches (iconic Inca) on the front faces of lower terrace
    for (const nx of [-0.35, 0, 0.35]) {
      const niche = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.34, 4), dark);
      niche.rotation.y = Math.PI / 4;
      niche.position.set(nx, 0.3, 0.78);
      this.structure.add(niche);
    }
    // Golden sun disc above the doorway
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 16), gold);
    disc.rotation.x = Math.PI / 2;
    disc.position.set(0, y + 0.2, 0.5); this.structure.add(disc);
    // Crowning hall
    this.box(stone, 0.85, 0.4, 0.7, 0, y + 0.2, 0);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.7, 0.3, 4), this.mat(THATCH, 0.95));
    roof.position.y = y + 0.55; roof.rotation.y = Math.PI / 4; roof.castShadow = true;
    this.structure.add(roof);

    this.addTypeMarker(trim, y);
  }

  // ── Conquistador stone mission / fortified church ───────────────────────────
  private buildSpanish(stone: THREE.Material, stone2: THREE.Material, trim: THREE.Material) {
    const tile = this.mat(ROOF_TILE, 0.85);
    const dark = this.mat(0x2a2018, 1);
    // Nave
    this.box(stone, 1.3, 0.95, 0.9, 0, 0.48, 0);
    // Gabled red-tile roof (4-sided cone scaled to a ridge)
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.85, 0.5, 4), tile);
    roof.scale.set(1.0, 1, 0.72);
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 1.2; roof.castShadow = true;
    this.structure.add(roof);
    // Bell tower
    this.box(stone2, 0.42, 1.5, 0.42, -0.5, 0.75, 0.25);
    const towerRoof = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.34, 4), tile);
    towerRoof.rotation.y = Math.PI / 4; towerRoof.position.set(-0.5, 1.65, 0.25); towerRoof.castShadow = true;
    this.structure.add(towerRoof);
    // Bell opening
    this.box(dark, 0.18, 0.22, 0.05, -0.5, 1.35, 0.47, false);
    // Cross on top of the tower
    this.box(trim, 0.05, 0.32, 0.05, -0.5, 2.0, 0.25, false);
    this.box(trim, 0.2, 0.05, 0.05, -0.5, 2.05, 0.25, false);
    // Arched doorway + round window
    this.box(dark, 0.3, 0.5, 0.06, 0.15, 0.3, 0.46, false);
    const rose = new THREE.Mesh(new THREE.CircleGeometry(0.1, 16), dark);
    rose.position.set(0.15, 0.75, 0.46); this.structure.add(rose);

    this.addTypeMarker(trim, 1.45);
  }

  // ── Neutral village — thatch hut with a fire pit ────────────────────────────
  private buildVillage() {
    const thatch = this.mat(0x8a7040, 0.96);
    const wall   = this.mat(0xc4aa70, 0.94);
    const fire   = new THREE.MeshStandardMaterial({ color: 0xff6010, emissive: 0xff3000, emissiveIntensity: 1.0 });
    const dark   = this.mat(0x2a1a0a, 0.98);

    // Circular hut base
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.70, 0.76, 0.55, 10), wall);
    base.castShadow = true; base.receiveShadow = true;
    this.structure.add(base);
    base.position.y = 0.28;

    // Conical thatch roof
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.80, 0.70, 10), thatch);
    roof.position.y = 0.90; roof.castShadow = true;
    this.structure.add(roof);

    // Doorway cutout (dark rectangle)
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.34, 0.06), dark);
    door.position.set(0, 0.22, 0.72); this.structure.add(door);

    // Central fire pit
    const pit = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.08, 8), dark);
    pit.position.set(-0.55, 0.04, 0.30); this.structure.add(pit);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.18, 6), fire);
    flame.position.set(-0.55, 0.17, 0.30); this.structure.add(flame);
  }

  // ── Harbor / Port ────────────────────────────────────────────────────────────
  private buildHarbor(stone: THREE.Material, stone2: THREE.Material, _trim: THREE.Material) {
    const wood = this.mat(0x6b4a28, 0.9);
    const rope = this.mat(0xc8aa70, 0.95);
    // Pier base
    this.box(stone,  1.4, 0.2, 0.7, 0, 0.1, 0);
    this.box(stone2, 1.2, 0.15, 0.5, 0, 0.23, 0);
    // Wooden dock planks
    for (let i = -2; i <= 2; i++) {
      this.box(wood, 0.14, 0.05, 0.7, i * 0.26, 0.3, 0);
    }
    // Bollards
    for (const bx of [-0.6, 0.6]) {
      const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.3, 6), rope);
      bollard.position.set(bx, 0.45, 0.3); this.structure.add(bollard);
    }
    // Crane arm
    this.box(wood, 0.05, 0.6, 0.05, -0.5, 0.6, 0);
    this.box(wood, 0.05, 0.05, 0.4, -0.5, 0.88, 0.18);
    this.addTypeMarker(_trim, 0.9);
  }

  // ── Market ────────────────────────────────────────────────────────────────────
  private buildMarket(stone: THREE.Material, stone2: THREE.Material, trim: THREE.Material) {
    const awning = new THREE.MeshStandardMaterial({ color: 0xe8a020, roughness: 0.8 });
    const wood   = this.mat(0x7a5a30, 0.9);
    // Main stall structure
    this.box(stone,  1.1, 0.55, 0.75, 0, 0.28, 0);
    this.box(stone2, 1.0, 0.08, 0.65, 0, 0.57, 0);
    // Wooden posts
    for (const px of [-0.48, 0.48]) {
      this.box(wood, 0.07, 0.7, 0.07, px, 0.35, 0.34);
    }
    // Awning / canopy
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.07, 0.85), awning);
    canopy.position.set(0, 0.75, 0); canopy.castShadow = true;
    this.structure.add(canopy);
    // Trade goods display (colorful boxes)
    for (let i = -1; i <= 1; i++) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.15, 0.18),
        new THREE.MeshStandardMaterial({ color: [0xd04020, 0x20a040, 0xa06010][i + 1], roughness: 0.7 }));
      box.position.set(i * 0.25, 0.64, 0.05);
      this.structure.add(box);
    }
    this.addTypeMarker(trim, 0.82);
  }

  // ── House / Dwelling ─────────────────────────────────────────────────────────
  private buildHouse(stone: THREE.Material, stone2: THREE.Material, trim: THREE.Material) {
    // Small square base
    this.box(stone, 1.0, 0.5, 0.9, 0, 0.25, 0);
    // Door opening
    const dark = this.mat(0x1a0e06, 1);
    this.box(dark, 0.2, 0.3, 0.06, 0, 0.15, 0.48, false);
    // Thatched roof (pyramid)
    const roofMat = this.mat(THATCH, 0.95);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.75, 0.55, 4), roofMat);
    roof.rotation.y = Math.PI / 4;
    roof.position.set(0, 0.78, 0);
    roof.castShadow = true;
    this.structure.add(roof);
    // Small chimney
    this.box(stone2, 0.12, 0.25, 0.12, 0.3, 0.95, 0.1);
    // Civ-color stripe on door frame
    this.box(trim, 0.28, 0.36, 0.05, 0, 0.18, 0.49, false);
  }

  // ── Wall / Palisade ───────────────────────────────────────────────────────────
  private buildWall(stone: THREE.Material, _stone2: THREE.Material, trim: THREE.Material) {
    // Thick defensive wall
    this.box(stone, 1.6, 0.8, 0.45, 0, 0.4, 0);
    // Walkway on top
    this.box(stone, 1.55, 0.08, 0.35, 0, 0.82, 0, false);
    // Arrow slits
    const dark = this.mat(0x1a1208, 1);
    for (const sx of [-0.5, 0, 0.5]) {
      this.box(dark, 0.07, 0.22, 0.06, sx, 0.4, 0.23, false);
    }
    this.addTypeMarker(trim, 0.86);
  }

  // Small marker so different building types are still distinguishable
  private addTypeMarker(trim: THREE.Material, y: number) {
    switch (this.type) {
      case BuildingType.TEMPLE: {
        const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0),
          new THREE.MeshStandardMaterial({ color: 0xffd060, emissive: 0xffb020, emissiveIntensity: 1.3 }));
        orb.position.y = y + 0.55; this.structure.add(orb);
        break;
      }
      case BuildingType.WATCHTOWER: {
        const t = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.7, 8), trim);
        t.position.y = y + 0.35; t.castShadow = true; this.structure.add(t);
        break;
      }
      case BuildingType.FORGE: {
        const ember = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16),
          new THREE.MeshStandardMaterial({ color: 0xff5520, emissive: 0xff4400, emissiveIntensity: 1.5 }));
        ember.position.set(0.3, y + 0.2, 0); this.structure.add(ember);
        break;
      }
      case BuildingType.HARBOR: {
        // Anchor marker
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 6),
          this.mat(0x5a4030, 0.9));
        post.position.set(0, y + 0.3, 0); this.structure.add(post);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.05),
          this.mat(0x5a4030, 0.9));
        arm.position.set(0, y + 0.52, 0); this.structure.add(arm);
        break;
      }
      case BuildingType.MARKET: {
        // Awning / canopy marker
        const awning = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.7),
          new THREE.MeshStandardMaterial({ color: 0xe8a020, roughness: 0.8 }));
        awning.position.set(0, y + 0.35, 0); this.structure.add(awning);
        break;
      }
      case BuildingType.WALL: {
        // Battlements on top
        for (const dx of [-0.35, 0, 0.35]) {
          const merlon = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.28, 0.18), trim);
          merlon.position.set(dx, y + 0.22, 0); this.structure.add(merlon);
        }
        break;
      }
    }
  }

  updateBuild(dt: number) {
    if (this.state === BuildingState.COMPLETE) return;
    this.buildProgress = Math.min(1, this.buildProgress + dt / this.buildTime);
    this.hp = Math.round(this.maxHp * this.buildProgress);

    const pct = this.buildProgress;
    this.progressBar.scale.x = pct;
    this.progressBar.position.x = (pct - 1) * 0.44;
    const baseScale = this.type === BuildingType.SETTLEMENT ? 1.0 : 0.62;
    this.structure.scale.y = baseScale * (0.05 + pct * 0.95);

    if (this.buildProgress >= 1) {
      this.state = BuildingState.COMPLETE;
      this.structure.scale.y = baseScale;
      (this.progressBar.material as THREE.MeshBasicMaterial).color.setHex(0x55dd44);
      this.progressBar.visible = false;
    }
  }

  isComplete(): boolean { return this.state === BuildingState.COMPLETE; }
  isAlive(): boolean { return this.state !== BuildingState.DESTROYED; }

  /** Transfer ownership after a successful capture: new banner color, fresh state. */
  transferTo(newPlayerId: number, newCivColor: number) {
    this.playerId = newPlayerId;
    this.captureProgress = 0;
    this._prodQueue = [];
    this.finishedUnit = null;
    this.rallyCol = null;
    this.rallyRow = null;
    for (const m of this._bannerMats) {
      m.color.setHex(newCivColor);
      m.emissive.setHex(newCivColor);
    }
  }

  trainUnit(unitType: UnitType): boolean {
    if (!this.isComplete()) return false;
    if (this._prodQueue.length >= this.MAX_QUEUE) return false;
    const totalTime = TRAIN_TIMES[unitType] ?? 15;
    this._prodQueue.push({ unitType, elapsed: 0, totalTime });
    return true;
  }

  cancelLastQueued(): UnitType | null {
    if (this._prodQueue.length === 0) return null;
    const last = this._prodQueue[this._prodQueue.length - 1];
    if (last.elapsed === 0) {
      this._prodQueue.pop();
      return last.unitType;
    }
    return null;
  }

  updateProduction(dt: number) {
    // Tick worker training if active
    if (this.workerTrainTimer > 0 && !this.workerFinished) {
      this.workerTrainTimer += dt;
      if (this.workerTrainTimer >= this.workerTrainTotal) {
        this.workerFinished = true;
      }
    }

    if (this._prodQueue.length === 0) return;
    const item = this._prodQueue[0];
    // Veteran garrison training bonus: a garrisoned level-2+ unit trains recruits 20% faster
    const veteranPresent = this.garrison.some(u => u.level >= 2);
    item.elapsed += veteranPresent ? dt * 1.20 : dt;
    if (item.elapsed >= item.totalTime) {
      this.finishedUnit = item.unitType;
      this._prodQueue.shift();
    }
  }

  get productionQueue(): readonly ProdQueueItem[] { return this._prodQueue; }

  /** Remove the first item from the queue and return it (for refund calculation). Returns null if empty. */
  cancelCurrentProduction(): ProdQueueItem | null {
    if (this._prodQueue.length === 0) return null;
    return this._prodQueue.shift()!;
  }

  get productionProgress(): number {
    if (this._prodQueue.length === 0) return 0;
    return this._prodQueue[0].elapsed / this._prodQueue[0].totalTime;
  }

  updateRepair(dt: number) {
    if (this.state === BuildingState.DESTROYED) return;
    if (this.hp >= this.maxHp) { this._timeSinceHit = 0; return; }
    this._timeSinceHit += dt;
    if (this._timeSinceHit < Building.REPAIR_DELAY) return;
    this.hp = Math.min(this.maxHp, this.hp + Building.REPAIR_RATE * dt);
    // Re-sync HP bar
    const pct = this.hp / this.maxHp;
    this.progressBar.visible = pct < 1;
    if (pct < 1) {
      this.progressBar.scale.x = pct;
      this.progressBar.position.x = (pct - 1) * 0.44;
      (this.progressBar.material as THREE.MeshBasicMaterial).color.setHex(
        pct > 0.5 ? 0x55dd44 : pct > 0.25 ? 0xddaa00 : 0xdd2222
      );
    }
    if (this.hp >= this.maxHp * 0.3 && this.state === BuildingState.DAMAGED) {
      this.state = BuildingState.COMPLETE;
    }
  }

  /** Apply worker-assisted repair: +amount HP and sync the HP bar immediately. */
  repairBy(amount: number) {
    if (this.state === BuildingState.DESTROYED || this.hp >= this.maxHp) return;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    this._syncFire();
    const pct = this.hp / this.maxHp;
    this.progressBar.visible = pct < 1;
    if (pct < 1) {
      this.progressBar.scale.x = pct;
      this.progressBar.position.x = (pct - 1) * 0.44;
      (this.progressBar.material as THREE.MeshBasicMaterial).color.setHex(
        pct > 0.5 ? 0x55dd44 : pct > 0.25 ? 0xddaa00 : 0xdd2222
      );
    }
    if (this.hp >= this.maxHp * 0.3 && this.state === BuildingState.DAMAGED) {
      this.state = BuildingState.COMPLETE;
    }
  }

  takeDamage(amount: number) {
    if (this.state === BuildingState.DESTROYED) return;
    this._timeSinceHit = 0; // reset repair timer on hit
    this.hp = Math.max(0, this.hp - amount);
    // Show HP bar when damaged
    if (this.hp > 0 && this.hp < this.maxHp) {
      const pct = this.hp / this.maxHp;
      this.progressBar.visible = true;
      this.progressBar.scale.x = pct;
      this.progressBar.position.x = (pct - 1) * 0.44;
      (this.progressBar.material as THREE.MeshBasicMaterial).color.setHex(
        pct > 0.5 ? 0x55dd44 : pct > 0.25 ? 0xddaa00 : 0xdd2222
      );
    }
    if (this.hp <= 0) {
      this.state = BuildingState.DESTROYED;
      this.mesh.visible = false;
    } else if (this.hp < this.maxHp * 0.3) {
      this.state = BuildingState.DAMAGED;
    }
    this._syncFire();
  }

  /** Animate the fire flicker — call once per frame from the renderer or Game.ts. */
  tickFire(dt: number) {
    if (!this._fireMesh?.visible) return;
    this._fireT += dt;
    const flicker = 0.75 + Math.sin(this._fireT * 18) * 0.25 + Math.sin(this._fireT * 31) * 0.12;
    this._fireMesh.scale.setScalar(flicker);
    this._fireMesh.position.y = 2.1 + Math.sin(this._fireT * 11) * 0.1;
    (this._fireMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.5 + Math.sin(this._fireT * 22) * 0.5;
  }
}
