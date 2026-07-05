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
  GATHERING_WOOD = 'GATHERING_WOOD',
  RETURNING = 'RETURNING',
  REPAIRING = 'REPAIRING',
}

export class Worker {
  readonly id: number;
  playerId: number; // mutable: workers can be captured (American Conquest style)
  _captureTimer = 0; // seconds an enemy soldier has been seizing this worker

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
  carrying: 'food' | 'gold' | 'stone' | 'wood' | null = null;
  carryAmount: number = 0;
  repairTarget: import('./Building').Building | null = null;

  mesh!: THREE.Group;
  private rig!: THREE.Group;
  private _clothMat: THREE.MeshStandardMaterial | null = null;
  resourceIndicator!: THREE.Mesh;
  private animT = Math.random() * 10;

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
    this.rig  = new THREE.Group();
    this.mesh.add(this.rig);

    const cloth = new THREE.MeshStandardMaterial({ color: civColor, roughness: 0.9 });
    this._clothMat = cloth;
    const skin  = new THREE.MeshStandardMaterial({ color: 0xc28a5a, roughness: 0.75 });
    const wood  = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.9 });
    const lightMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });

    // Legs
    for (const x of [-0.09, 0.09]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.34, 0.12), wood);
      leg.position.set(x, 0.18, 0); leg.castShadow = true; this.rig.add(leg);
    }
    // Torso (tunic)
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.42, 0.2), cloth);
    body.position.y = 0.56; body.castShadow = true; this.rig.add(body);
    // Head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), skin);
    head.position.y = 0.9; head.castShadow = true; this.rig.add(head);
    // Tool over shoulder (pick/hoe)
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.6, 6), wood);
    handle.position.set(0.22, 0.7, 0); handle.rotation.z = 0.5; this.rig.add(handle);
    const headTool = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.06), new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.5, metalness: 0.6 }));
    headTool.position.set(0.38, 0.95, 0); this.rig.add(headTool);

    // Carry indicator (resource crate above)
    this.resourceIndicator = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.18), lightMat);
    this.resourceIndicator.position.y = 1.18;
    this.resourceIndicator.visible = false;
    this.mesh.add(this.resourceIndicator);

    this.mesh.position.set(this.worldX, 0, this.worldZ);
    this.mesh.userData.workerId = this.id;
  }

  /** Capture: transfer this worker to another player (AC style). Drops any cargo and task. */
  convertTo(playerId: number, civColor: number) {
    this.playerId = playerId;
    this._clothMat?.color.setHex(civColor);
    this.task = WorkerTask.IDLE;
    this.carrying = null;
    this.carryAmount = 0;
    this.path = [];
    this.pathIndex = 0;
    this.repairTarget = null;
    this._captureTimer = 0;
  }

  setTask(task: WorkerTask, targetCol?: number, targetRow?: number) {
    this.task = task;
    this.repairTarget = null; // clear any pending repair when taking a new task
    if (targetCol !== undefined && targetRow !== undefined) {
      this.targetCol = targetCol;
      this.targetRow = targetRow;
    }
    this.taskProgress = 0;
  }

  update(dt: number, _map: GameMap) {
    this.animT += dt;
    const gathering = this.task === WorkerTask.GATHERING_FOOD || this.task === WorkerTask.GATHERING_GOLD || this.task === WorkerTask.GATHERING_STONE || this.task === WorkerTask.GATHERING_WOOD;

    if (this.task === WorkerTask.MOVING || this.task === WorkerTask.RETURNING) {
      this.updateMovement(dt);
    } else if (gathering) {
      this.taskProgress += dt;
      if (this.taskProgress >= 3.0) {
        this.carryAmount = 30;
        if (this.task === WorkerTask.GATHERING_FOOD) this.carrying = 'food';
        else if (this.task === WorkerTask.GATHERING_GOLD) this.carrying = 'gold';
        else if (this.task === WorkerTask.GATHERING_WOOD) this.carrying = 'wood';
        else this.carrying = 'stone';
        this.updateResourceIndicator();
        this.task = WorkerTask.IDLE;
      }
    } else if (this.task === WorkerTask.REPAIRING && this.repairTarget) {
      const b = this.repairTarget;
      if (!b.isAlive() || b.hp >= b.maxHp) {
        this.task = WorkerTask.IDLE;
        this.repairTarget = null;
      } else {
        b.repairBy(15 * dt); // 15 HP/s — ~5× faster than the 3 HP/s auto-repair
      }
    }

    // Animation on the rig (mesh.y owned by renderer)
    if (this.rig) {
      if (this.task === WorkerTask.MOVING || this.task === WorkerTask.RETURNING) {
        this.rig.position.y = Math.abs(Math.sin(this.animT * 10)) * 0.05;
      } else if (gathering) {
        this.rig.rotation.x = Math.sin(this.animT * 8) * 0.25; // swinging tool
        this.rig.position.y = 0;
      } else {
        this.rig.position.y = 0;
        this.rig.rotation.x = 0;
      }
    }

    this.mesh.position.x = this.worldX;
    this.mesh.position.z = this.worldZ;
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
        // If we had a repair target queued, start repairing now that we've arrived
        this.task = this.repairTarget?.isAlive() ? WorkerTask.REPAIRING : WorkerTask.IDLE;
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
      const mat = this.resourceIndicator.material as THREE.MeshStandardMaterial;
      if (this.carrying === 'food') mat.color.setHex(0xddaa44);
      else if (this.carrying === 'gold') mat.color.setHex(0xffd000);
      else if (this.carrying === 'wood') mat.color.setHex(0x8B5A2B);
      else mat.color.setHex(0x999999);
    } else {
      this.resourceIndicator.visible = false;
    }
  }

  dropResources(): { type: 'food' | 'gold' | 'stone' | 'wood'; amount: number } | null {
    if (!this.carrying) return null;
    const res = { type: this.carrying as 'food' | 'gold' | 'stone' | 'wood', amount: this.carryAmount };
    this.carrying = null;
    this.carryAmount = 0;
    this.updateResourceIndicator();
    return res;
  }
}
