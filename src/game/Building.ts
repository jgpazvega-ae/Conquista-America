import * as THREE from 'three';
import { BuildingType } from './buildings';
import type { BuildingDef } from './buildings';
import { CivilizationType } from './types';
import { TILE_SIZE } from './constants';

let nextBuildingId = 1;

export enum BuildingState {
  CONSTRUCTING = 'CONSTRUCTING',
  COMPLETE = 'COMPLETE',
  DAMAGED = 'DAMAGED',
  DESTROYED = 'DESTROYED',
}

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
    this.hp = 0; // Starts at 0, fills as building completes
    this.buildTime = def.buildTime;

    this.buildMesh(civColor);
  }

  // ── Civ-specific stone palette ──────────────────────────────────────────────
  private stoneColor(): number {
    switch (this.civType) {
      case CivilizationType.AZTEC:        return 0x9c8a6e; // sandstone
      case CivilizationType.MAYA:         return 0xb0a484; // pale limestone
      case CivilizationType.INCA:         return 0x8d8782; // grey granite
      case CivilizationType.CONQUISTADOR: return 0xada48c; // mortar
    }
  }

  private buildMesh(civColor: number) {
    this.mesh = new THREE.Group();
    this.mesh.position.set(this.col * TILE_SIZE, 0, this.row * TILE_SIZE);
    this.structure = new THREE.Group();
    this.mesh.add(this.structure);

    const stone  = new THREE.MeshStandardMaterial({ color: this.stoneColor(), roughness: 0.95 });
    const stone2 = new THREE.MeshStandardMaterial({ color: new THREE.Color(this.stoneColor()).multiplyScalar(0.85).getHex(), roughness: 0.95 });
    const trim   = new THREE.MeshStandardMaterial({ color: civColor, roughness: 0.7, emissive: civColor, emissiveIntensity: 0.06 });

    const isConq = this.civType === CivilizationType.CONQUISTADOR;

    if (isConq) {
      this.buildSpanishStructure(stone, stone2, trim);
    } else if (this.civType === CivilizationType.INCA) {
      this.buildIncaStructure(stone, stone2, trim);
    } else {
      this.buildPyramidStructure(stone, stone2, trim);
    }

    // ── Ownership banner (always colored, very readable from above) ──
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.0, 6),
      new THREE.MeshStandardMaterial({ color: 0x5a4a32, roughness: 0.9 }));
    pole.position.set(0.62, 1.4, 0.62); this.structure.add(pole);
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.3), new THREE.MeshStandardMaterial({ color: civColor, side: THREE.DoubleSide, emissive: civColor, emissiveIntensity: 0.15, roughness: 0.6 }));
    banner.position.set(0.42, 1.7, 0.62); this.structure.add(banner);

    // ── Build progress bar ──
    const progBg = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.13),
      new THREE.MeshBasicMaterial({ color: 0x221500, transparent: true, opacity: 0.85, depthTest: false }));
    this.progressBar = new THREE.Mesh(new THREE.PlaneGeometry(0.88, 0.1),
      new THREE.MeshBasicMaterial({ color: 0x55dd44, depthTest: false }));
    progBg.position.set(0, 2.3, 0);
    this.progressBar.position.set(0, 2.3, 0.01);
    progBg.rotation.x = -Math.PI / 2;
    this.progressBar.rotation.x = -Math.PI / 2;
    progBg.renderOrder = 10; this.progressBar.renderOrder = 11;
    this.mesh.add(progBg, this.progressBar);

    this.mesh.traverse(child => { child.userData.buildingId = this.id; });
    this.mesh.userData.buildingId = this.id;
  }

  // Aztec / Maya — stepped temple pyramid
  private buildPyramidStructure(stone: THREE.Material, stone2: THREE.Material, trim: THREE.Material) {
    const tall = this.civType === CivilizationType.MAYA;
    const tiers = tall ? 4 : 3;
    let w = 1.5, y = 0;
    for (let t = 0; t < tiers; t++) {
      const h = tall ? 0.45 : 0.4;
      const tier = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), t % 2 ? stone2 : stone);
      tier.position.y = y + h / 2;
      tier.castShadow = tier.receiveShadow = true;
      this.structure.add(tier);
      y += h;
      w *= tall ? 0.74 : 0.78;
    }
    // Central staircase
    const stair = new THREE.Mesh(new THREE.BoxGeometry(0.4, y, 0.18), stone2);
    stair.position.set(0, y / 2, w * 1.6);
    this.structure.add(stair);
    // Shrine on top (trim-colored, the identity color)
    this.addTypeTopper(trim, stone, y);
  }

  // Inca — terraced trapezoidal stone platform
  private buildIncaStructure(stone: THREE.Material, stone2: THREE.Material, trim: THREE.Material) {
    let w = 1.5, y = 0;
    for (let t = 0; t < 2; t++) {
      const h = 0.55;
      const tier = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * 0.9), t % 2 ? stone2 : stone);
      tier.position.y = y + h / 2;
      tier.castShadow = tier.receiveShadow = true;
      this.structure.add(tier);
      y += h;
      w *= 0.86;
    }
    // Trapezoidal doorway (dark recess)
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x1a1612, roughness: 1 }));
    door.position.set(0, 0.3, w * 0.62); this.structure.add(door);
    this.addTypeTopper(trim, stone, y);
  }

  // Conquistador — stone keep with battlements
  private buildSpanishStructure(stone: THREE.Material, stone2: THREE.Material, trim: THREE.Material) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.0, 1.4), stone);
    base.position.y = 0.5; base.castShadow = base.receiveShadow = true; this.structure.add(base);
    // Battlements (merlons) around the top
    const merlonMat = stone2;
    for (let i = 0; i < 4; i++) {
      for (let s = -1; s <= 1; s += 2) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), merlonMat);
        if (i < 2) m.position.set(s * 0.5, 1.1, (i === 0 ? -0.6 : 0.6));
        else       m.position.set((i === 2 ? -0.6 : 0.6), 1.1, s * 0.5);
        this.structure.add(m);
      }
    }
    this.addTypeTopper(trim, stone, 1.0);
  }

  // Type-specific topper placed at height y
  private addTypeTopper(trim: THREE.Material, stone: THREE.Material, y: number) {
    switch (this.type) {
      case BuildingType.SETTLEMENT: {
        const shrine = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.6), trim);
        shrine.position.y = y + 0.25; shrine.castShadow = true; this.structure.add(shrine);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.45, 4), trim);
        roof.position.y = y + 0.7; roof.rotation.y = Math.PI / 4; this.structure.add(roof);
        break;
      }
      case BuildingType.TEMPLE: {
        const shrine = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.55), trim);
        shrine.position.y = y + 0.35; this.structure.add(shrine);
        // Glowing sacred orb
        const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18, 0),
          new THREE.MeshStandardMaterial({ color: 0xffd060, emissive: 0xffb020, emissiveIntensity: 1.2 }));
        orb.position.y = y + 0.9; this.structure.add(orb);
        break;
      }
      case BuildingType.WATCHTOWER: {
        const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 1.2, 8), stone);
        tower.position.y = y + 0.6; tower.castShadow = true; this.structure.add(tower);
        const top = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.2, 8), trim);
        top.position.y = y + 1.25; this.structure.add(top);
        break;
      }
      case BuildingType.FORGE: {
        const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.7, 0.3), stone);
        chimney.position.set(0.3, y + 0.35, 0); this.structure.add(chimney);
        const ember = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.18),
          new THREE.MeshStandardMaterial({ color: 0xff5520, emissive: 0xff4400, emissiveIntensity: 1.5 }));
        ember.position.set(0.3, y + 0.75, 0); this.structure.add(ember);
        break;
      }
      case BuildingType.STOREHOUSE: {
        const roof = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18, 0.9), trim);
        roof.position.y = y + 0.1; this.structure.add(roof);
        break;
      }
      case BuildingType.BARRACKS: {
        // Crossed weapon trophy
        for (const r of [Math.PI / 5, -Math.PI / 5]) {
          const spear = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 6), trim);
          spear.position.y = y + 0.3; spear.rotation.z = r; this.structure.add(spear);
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
    // Rise out of the ground as it builds
    this.structure.scale.y = 0.05 + pct * 0.95;

    if (this.buildProgress >= 1) {
      this.state = BuildingState.COMPLETE;
      this.structure.scale.y = 1;
      (this.progressBar.material as THREE.MeshBasicMaterial).color.setHex(0x55dd44);
      // Hide progress bars when complete
      this.progressBar.visible = false;
    }
  }

  isComplete(): boolean {
    return this.state === BuildingState.COMPLETE;
  }

  isAlive(): boolean {
    return this.state !== BuildingState.DESTROYED;
  }

  takeDamage(amount: number) {
    if (this.state === BuildingState.DESTROYED) return;
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) {
      this.state = BuildingState.DESTROYED;
      this.mesh.visible = false;
    } else if (this.hp < this.maxHp * 0.3) {
      this.state = BuildingState.DAMAGED;
    }
  }
}
