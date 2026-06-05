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
  readonly playerId: number;
  readonly def: BuildingDef;
  readonly civType: CivilizationType;

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

  // Attack capability (watchtower)
  attackTimer: number = 0;

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

    switch (this.civType) {
      case CivilizationType.CONQUISTADOR: this.buildSpanish(stone, stone2, trim); break;
      case CivilizationType.INCA:         this.buildInca(stone, stone2, trim);   break;
      default:                            this.buildMesoamerican(stone, stone2, trim); break;
    }

    // Ownership banner (high & colorful, readable from above)
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.0, 6), this.mat(0x5a4a32, 0.9));
    pole.position.set(0.7, 1.5, 0.7); this.structure.add(pole);
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.32),
      new THREE.MeshStandardMaterial({ color: civColor, side: THREE.DoubleSide, emissive: civColor, emissiveIntensity: 0.18, roughness: 0.6 }));
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
    if (this._prodQueue.length === 0) return;
    const item = this._prodQueue[0];
    item.elapsed += dt;
    if (item.elapsed >= item.totalTime) {
      this.finishedUnit = item.unitType;
      this._prodQueue.shift();
    }
  }

  get productionQueue(): readonly ProdQueueItem[] { return this._prodQueue; }
  get productionProgress(): number {
    if (this._prodQueue.length === 0) return 0;
    return this._prodQueue[0].elapsed / this._prodQueue[0].totalTime;
  }

  takeDamage(amount: number) {
    if (this.state === BuildingState.DESTROYED) return;
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
  }
}
