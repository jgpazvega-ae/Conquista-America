import * as THREE from 'three';
import { BuildingType } from './buildings';
import type { BuildingDef } from './buildings';
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

  col: number;
  row: number;
  hp: number;
  maxHp: number;
  state: BuildingState = BuildingState.CONSTRUCTING;
  buildProgress: number = 0; // 0..1
  buildTime: number;

  mesh!: THREE.Group;
  progressBar!: THREE.Mesh;

  constructor(type: BuildingType, def: BuildingDef, playerId: number, col: number, row: number, civColor: number) {
    this.id = nextBuildingId++;
    this.type = type;
    this.def = def;
    this.playerId = playerId;
    this.col = col;
    this.row = row;
    this.maxHp = def.maxHp;
    this.hp = 0; // Starts at 0, fills as building completes
    this.buildTime = def.buildTime;

    this.buildMesh(civColor);
  }

  private buildMesh(civColor: number) {
    this.mesh = new THREE.Group();
    this.mesh.position.set(this.col * TILE_SIZE, 0, this.row * TILE_SIZE);

    const mat = new THREE.MeshLambertMaterial({ color: civColor });
    const roofMat = new THREE.MeshLambertMaterial({ color: civColor, emissive: civColor, emissiveIntensity: 0.1 });

    // Base structure (box)
    const structure = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.7, 0.8), mat);
    structure.position.y = 0.45;
    structure.castShadow = true;
    structure.receiveShadow = true;
    this.mesh.add(structure);

    // Roof (pyramid)
    const roofGeo = new THREE.ConeGeometry(0.6, 0.6, 4);
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.y = 1.25;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    this.mesh.add(roof);

    // Building progress bar (top)
    const progBg = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.12), new THREE.MeshBasicMaterial({ color: 0x332200 }));
    this.progressBar = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.12), new THREE.MeshBasicMaterial({ color: 0x44dd44 }));
    progBg.position.set(0, 1.65, 0);
    this.progressBar.position.set(0, 1.65, 0.01);
    progBg.rotation.x = -Math.PI / 2;
    this.progressBar.rotation.x = -Math.PI / 2;
    this.mesh.add(progBg);
    this.mesh.add(this.progressBar);

    this.mesh.traverse(child => { child.userData.buildingId = this.id; });
    this.mesh.userData.buildingId = this.id;
  }

  updateBuild(dt: number) {
    if (this.state === BuildingState.COMPLETE) return;

    this.buildProgress = Math.min(1, this.buildProgress + dt / this.buildTime);
    this.hp = Math.round(this.maxHp * this.buildProgress);

    const pct = this.buildProgress;
    this.progressBar.scale.x = pct;
    this.progressBar.position.x = (pct - 1) * 0.4;

    if (this.buildProgress >= 1) {
      this.state = BuildingState.COMPLETE;
      const mat = this.progressBar.material as THREE.MeshBasicMaterial;
      mat.color.setHex(0x44dd44);
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
