import * as THREE from 'three';
import { UnitState } from './types';
import type { GridPos } from './types';
import { TILE_SIZE } from './constants';
import type { GameMap } from './Map';

let nextWorkerId = 1;

export enum WorkerTask {
  IDLE = 'IDLE',
  MOVING = 'MOVING',
  GATHERING_FOOD = 'GATHERING_FOOD',
  GATHERING_GOLD = 'GATHERING_GOLD',
  GATHERING_STONE = 'GATHERING_STONE',
  RETURNING = 'RETURNING',
}

export class Worker {
  readonly id: number;
  readonly playerId: number;

  col: number;
  row: number;
  worldX: number;
  worldZ: number;
  task: WorkerTask = WorkerTask.IDLE;
  taskProgress: number = 0;
  targetCol: number;
  targetRow: number;
  path: GridPos[] = [];
  pathIndex: number = 0;
  carrying: 'food' | 'gold' | 'stone' | null = null;
  carryAmount: number = 0;

  mesh!: THREE.Group;
  resourceIndicator!: THREE.Mesh;

  constructor(playerId: number, col: number, row: number, civColor: number) {
    this.id = nextWorkerId++;
    this.playerId = playerId;
    this.col = this.targetCol = col;
    this.row = this.targetRow = row;
    this.worldX = col * TILE_SIZE;
    this.worldZ = row * TILE_SIZE;

    this.buildMesh(civColor);
  }

  private buildMesh(civColor: number) {
    this.mesh = new THREE.Group();

    const mat = new THREE.MeshLambertMaterial({ color: civColor });
    const lightMat = new THREE.MeshLambertMaterial({ color: Math.min(0xffffff, civColor + 0x333333) });

    // Body
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.55, 8), mat);
    body.position.y = 0.38;
    body.castShadow = true;
    this.mesh.add(body);

    // Head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), mat);
    head.position.y = 0.85;
    head.castShadow = true;
    this.mesh.add(head);

    // Carry indicator (small box above)
    this.resourceIndicator = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), lightMat);
    this.resourceIndicator.position.y = 1.1;
    this.resourceIndicator.visible = false;
    this.mesh.add(this.resourceIndicator);

    this.mesh.position.set(this.worldX, 0, this.worldZ);
    this.mesh.userData.workerId = this.id;
  }

  setTask(task: WorkerTask, targetCol?: number, targetRow?: number) {
    this.task = task;
    if (targetCol !== undefined && targetRow !== undefined) {
      this.targetCol = targetCol;
      this.targetRow = targetRow;
    }
    this.taskProgress = 0;
  }

  update(dt: number, map: GameMap) {
    if (this.task === WorkerTask.MOVING) {
      this.updateMovement(dt);
    } else if (this.task === WorkerTask.GATHERING_FOOD || this.task === WorkerTask.GATHERING_GOLD || this.task === WorkerTask.GATHERING_STONE) {
      this.taskProgress += dt;
      if (this.taskProgress >= 3.0) {
        this.carryAmount = 30;
        if (this.task === WorkerTask.GATHERING_FOOD) this.carrying = 'food';
        else if (this.task === WorkerTask.GATHERING_GOLD) this.carrying = 'gold';
        else this.carrying = 'stone';
        this.updateResourceIndicator();
        this.task = WorkerTask.IDLE;
      }
    }

    this.mesh.position.set(this.worldX, 0, this.worldZ);
  }

  private updateMovement(dt: number) {
    if (this.pathIndex >= this.path.length) {
      this.task = WorkerTask.IDLE;
      return;
    }

    const target = this.path[this.pathIndex];
    const tx = target.col * TILE_SIZE;
    const tz = target.row * TILE_SIZE;
    const dx = tx - this.worldX;
    const dz = tz - this.worldZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const step = 2.5 * TILE_SIZE * dt;

    if (dist <= step) {
      this.worldX = tx;
      this.worldZ = tz;
      this.col = target.col;
      this.row = target.row;
      this.pathIndex++;
      if (this.pathIndex >= this.path.length) {
        this.task = WorkerTask.IDLE;
      }
    } else {
      this.worldX += (dx / dist) * step;
      this.worldZ += (dz / dist) * step;
      this.mesh.rotation.y = Math.atan2(dx, dz);
    }
  }

  private updateResourceIndicator() {
    if (this.carrying) {
      this.resourceIndicator.visible = true;
      const mat = this.resourceIndicator.material as THREE.MeshLambertMaterial;
      if (this.carrying === 'food') mat.color.setHex(0xddaa44);
      else if (this.carrying === 'gold') mat.color.setHex(0xffff00);
      else mat.color.setHex(0x888888);
    } else {
      this.resourceIndicator.visible = false;
    }
  }

  dropResources(): { type: 'food' | 'gold' | 'stone'; amount: number } | null {
    if (!this.carrying) return null;
    const res = { type: this.carrying as 'food' | 'gold' | 'stone', amount: this.carryAmount };
    this.carrying = null;
    this.carryAmount = 0;
    this.updateResourceIndicator();
    return res;
  }
}
