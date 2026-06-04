import * as THREE from 'three';
import { TILE_SIZE } from './constants';

let nextNodeId = 1;

export enum ResourceType {
  FOOD = 'FOOD',
  GOLD = 'GOLD',
  STONE = 'STONE',
}

export class ResourceNode {
  readonly id: number;
  readonly type: ResourceType;

  col: number;
  row: number;
  amount: number;
  maxAmount: number;

  mesh!: THREE.Mesh;

  constructor(type: ResourceType, col: number, row: number, amount: number) {
    this.id = nextNodeId++;
    this.type = type;
    this.col = col;
    this.row = row;
    this.amount = amount;
    this.maxAmount = amount;

    this.buildMesh();
  }

  private buildMesh() {
    let color: number;
    let emoji: string;
    let shape: THREE.BufferGeometry;

    if (this.type === ResourceType.FOOD) {
      color = 0xd4a850;
      emoji = '🌽';
      shape = new THREE.ConeGeometry(0.25, 0.4, 8);
    } else if (this.type === ResourceType.GOLD) {
      color = 0xffdd00;
      emoji = '💛';
      shape = new THREE.OctahedronGeometry(0.2);
    } else {
      color = 0x8a7a6a;
      emoji = '🪨';
      shape = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    }

    const mat = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.3 });
    this.mesh = new THREE.Mesh(shape, mat);
    this.mesh.position.set(this.col * TILE_SIZE, 0.35, this.row * TILE_SIZE);
    this.mesh.castShadow = true;
    this.mesh.userData.nodeId = this.id;
  }

  gather(amount: number): number {
    const taken = Math.min(amount, this.amount);
    this.amount = Math.max(0, this.amount - taken);
    return taken;
  }

  isEmpty(): boolean {
    return this.amount <= 0;
  }

  updateVisibility() {
    const alpha = Math.max(0.3, this.amount / this.maxAmount);
    const mat = this.mesh.material as THREE.MeshLambertMaterial;
    mat.opacity = alpha;
    mat.transparent = alpha < 1;
  }
}
