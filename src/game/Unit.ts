import * as THREE from 'three';
import { UnitType, CivilizationType, UnitState } from './types';
import type { GridPos } from './types';
import type { UnitDef } from './civilizations';
import { getUnitDef } from './civilizations';
import { TILE_SIZE } from './constants';
import type { GameMap } from './Map';

let nextId = 1;

export class Unit {
  readonly id: number;
  readonly type: UnitType;
  readonly civType: CivilizationType;
  readonly playerId: number;
  readonly def: UnitDef;

  // Stats
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  attackRange: number;
  sight: number;
  attackCooldown: number;

  // State
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
  attackTimer: number = 0;

  // Smooth movement
  moveX: number = 0;
  moveZ: number = 0;
  moveProgress: number = 1;

  // Three.js
  mesh!: THREE.Group;
  healthBar!: THREE.Mesh;
  selectionRing!: THREE.Mesh;
  private selected = false;

  constructor(type: UnitType, civ: CivilizationType, playerId: number, col: number, row: number, civColor: number) {
    this.id      = nextId++;
    this.type    = type;
    this.civType = civ;
    this.playerId = playerId;
    this.def     = getUnitDef(type);

    const s = this.def.stats;
    this.hp = this.maxHp = s.maxHp;
    this.attack        = s.attack;
    this.defense       = s.defense;
    this.speed         = s.speed;
    this.attackRange   = s.attackRange;
    this.sight         = s.sight;
    this.attackCooldown = s.attackCooldown;

    this.col = this.targetCol = col;
    this.row = this.targetRow = row;
    this.worldX = col * TILE_SIZE;
    this.worldZ = row * TILE_SIZE;

    this.buildMesh(civColor);
  }

  private buildMesh(civColor: number) {
    this.mesh = new THREE.Group();

    const mat = new THREE.MeshLambertMaterial({ color: civColor });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x111111 });

    let body: THREE.Mesh;
    if (this.def.isCavalry) {
      // Horse shape: elongated box
      body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.9), mat);
      body.position.y = 0.55;
      const rider = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.5, 8), mat);
      rider.position.set(0, 1.1, -0.15);
      this.mesh.add(rider);
    } else if (this.def.isRanged) {
      // Cone body for ranged units
      body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 0.65, 8), mat);
      body.position.y = 0.5;
      const bow = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 6, 10, Math.PI), darkMat);
      bow.position.set(0.2, 0.8, 0);
      bow.rotation.y = Math.PI / 2;
      this.mesh.add(bow);
    } else {
      // Standard infantry
      body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.70, 8), mat);
      body.position.y = 0.52;
    }

    body.castShadow = true;
    body.receiveShadow = true;
    this.mesh.add(body);

    // Head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), mat);
    head.position.y = this.def.isCavalry ? 1.45 : 1.05;
    head.castShadow = true;
    this.mesh.add(head);

    // HP bar (simple plane above unit)
    const hpBg  = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.10), new THREE.MeshBasicMaterial({ color: 0x220000 }));
    this.healthBar = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.10), new THREE.MeshBasicMaterial({ color: 0x22dd44 }));
    hpBg.position.set(0, 1.55, 0);
    this.healthBar.position.set(0, 1.55, 0.001);
    hpBg.rotation.x = -Math.PI / 2;
    this.healthBar.rotation.x = -Math.PI / 2;
    this.mesh.add(hpBg);
    this.mesh.add(this.healthBar);

    // Selection ring
    const ringGeo = new THREE.RingGeometry(0.35, 0.45, 20);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x44ccff, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
    this.selectionRing = new THREE.Mesh(ringGeo, ringMat);
    this.selectionRing.rotation.x = -Math.PI / 2;
    this.selectionRing.position.y = 0.05;
    this.selectionRing.visible = false;
    this.mesh.add(this.selectionRing);

    // Store unit id for raycasting
    this.mesh.traverse(child => { child.userData.unitId = this.id; });
    this.mesh.userData.unitId = this.id;

    this.mesh.position.set(this.worldX, 0, this.worldZ);
  }

  setSelected(sel: boolean) {
    this.selected = sel;
    this.selectionRing.visible = sel;
  }

  isSelected() { return this.selected; }

  isAlive() { return this.state !== UnitState.DEAD; }

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
    this.state     = UnitState.MOVING;
    this.attackTarget = null;
  }

  attackUnit(target: Unit) {
    this.attackTarget = target;
    this.state        = UnitState.ATTACKING;
  }

  takeDamage(amount: number): number {
    const dmg = Math.max(1, amount - this.defense);
    this.hp  = Math.max(0, this.hp - dmg);
    this.updateHealthBar();
    if (this.hp <= 0) this.die();
    return dmg;
  }

  private die() {
    this.state = UnitState.DEAD;
    this.mesh.visible = false;
    this.selected = false;
  }

  private updateHealthBar() {
    const pct = this.hp / this.maxHp;
    this.healthBar.scale.x = pct;
    this.healthBar.position.x = (pct - 1) * 0.35;
    const mat = this.healthBar.material as THREE.MeshBasicMaterial;
    mat.color.setHex(pct > 0.5 ? 0x22dd44 : pct > 0.25 ? 0xddaa00 : 0xdd2222);
  }

  update(dt: number, map: GameMap) {
    if (this.state === UnitState.DEAD) return;

    this.attackTimer = Math.max(0, this.attackTimer - dt);

    if (this.state === UnitState.MOVING) {
      this.updateMovement(dt, map);
    }

    // Sync mesh position
    this.mesh.position.set(this.worldX, 0, this.worldZ);
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
    const step = this.speed * TILE_SIZE * dt;

    if (dist <= step) {
      this.worldX = tx;
      this.worldZ = tz;
      this.col    = target.col;
      this.row    = target.row;
      this.pathIndex++;
      if (this.pathIndex >= this.path.length) {
        this.state = UnitState.IDLE;
      }
    } else {
      this.worldX += (dx / dist) * step;
      this.worldZ += (dz / dist) * step;
      // Face direction
      this.mesh.rotation.y = Math.atan2(dx, dz);
    }
  }
}
