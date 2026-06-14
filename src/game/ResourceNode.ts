import * as THREE from 'three';
import { TILE_SIZE } from './constants';

let nextNodeId = 1;

export enum ResourceType {
  FOOD = 'FOOD',
  GOLD = 'GOLD',
  STONE = 'STONE',
  WOOD = 'WOOD',
}

export class ResourceNode {
  readonly id: number;
  readonly type: ResourceType;

  col: number;
  row: number;
  amount: number;
  maxAmount: number;
  baseY = 0;
  private regenTimer = 0;
  private static readonly REGEN_DELAY = 120; // 2 minutes before partial regen
  private static readonly REGEN_AMOUNT = 0.55; // restore to 55% of original
  justRegenerated = false; // set for one frame when regen fires; read by Game.ts

  mesh!: THREE.Group;

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
    this.mesh = new THREE.Group();

    if (this.type === ResourceType.FOOD) {
      // Berry bushes — green foliage clumps with red berries
      const leaf = new THREE.MeshStandardMaterial({ color: 0x3c7a32, roughness: 0.9, flatShading: true });
      const berry = new THREE.MeshStandardMaterial({ color: 0xd03030, roughness: 0.6, emissive: 0x801010, emissiveIntensity: 0.2 });
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 0), leaf);
        bush.position.set(Math.cos(a) * 0.28, 0.26, Math.sin(a) * 0.28);
        bush.castShadow = true; this.mesh.add(bush);
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), berry);
        b.position.set(Math.cos(a) * 0.28 + 0.1, 0.36, Math.sin(a) * 0.28);
        this.mesh.add(b);
      }
    } else if (this.type === ResourceType.GOLD) {
      // Rocky outcrop laced with glittering gold veins
      const rock = new THREE.MeshStandardMaterial({ color: 0x6a6258, roughness: 1, flatShading: true });
      const gold = new THREE.MeshStandardMaterial({ color: 0xffcc20, roughness: 0.3, metalness: 0.8, emissive: 0xffaa00, emissiveIntensity: 0.4 });
      const base = new THREE.Mesh(new THREE.DodecahedronGeometry(0.4, 0), rock);
      base.position.y = 0.3; base.castShadow = true; this.mesh.add(base);
      for (let i = 0; i < 5; i++) {
        const nug = new THREE.Mesh(new THREE.OctahedronGeometry(0.08, 0), gold);
        const a = Math.random() * Math.PI * 2;
        nug.position.set(Math.cos(a) * 0.3, 0.25 + Math.random() * 0.3, Math.sin(a) * 0.3);
        this.mesh.add(nug);
      }
    } else if (this.type === ResourceType.WOOD) {
      // Timber logs — stacked brown cylinders
      const bark = new THREE.MeshStandardMaterial({ color: 0x5c3d1e, roughness: 1, flatShading: true });
      const grain = new THREE.MeshStandardMaterial({ color: 0x8B5A2B, roughness: 0.9 });
      for (let i = 0; i < 3; i++) {
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.7, 8), bark);
        log.rotation.z = Math.PI / 2;
        log.position.set((i - 1) * 0.22, 0.16 + Math.floor(i / 2) * 0.28, (i % 2) * 0.1 - 0.05);
        log.castShadow = true; this.mesh.add(log);
        const end = new THREE.Mesh(new THREE.CircleGeometry(0.14, 8), grain);
        end.rotation.y = Math.PI / 2; end.position.set((i - 1) * 0.22 + 0.35, 0.16 + Math.floor(i / 2) * 0.28, (i % 2) * 0.1 - 0.05);
        this.mesh.add(end);
      }
    } else {
      // Stone — pile of grey boulders
      const rock = new THREE.MeshStandardMaterial({ color: 0x8a847c, roughness: 1, flatShading: true });
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const s = 0.2 + Math.random() * 0.18;
        const b = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rock);
        b.position.set(Math.cos(a) * 0.25, s * 0.8, Math.sin(a) * 0.25);
        b.rotation.set(i, i * 1.7, i * 0.5);
        b.castShadow = true; this.mesh.add(b);
      }
    }

    this.mesh.position.set(this.col * TILE_SIZE, 0, this.row * TILE_SIZE);
    this.mesh.traverse(c => { c.userData.nodeId = this.id; });
    this.mesh.userData.nodeId = this.id;
  }

  gather(amount: number): number {
    const taken = Math.min(amount, this.amount);
    this.amount = Math.max(0, this.amount - taken);
    if (this.amount <= 0) this.regenTimer = 0; // start regen countdown
    return taken;
  }

  isEmpty(): boolean {
    return this.amount <= 0;
  }

  updateRegen(dt: number) {
    this.justRegenerated = false;
    if (this.amount > 0) return;
    this.regenTimer += dt;
    if (this.regenTimer >= ResourceNode.REGEN_DELAY) {
      this.amount = Math.floor(this.maxAmount * ResourceNode.REGEN_AMOUNT);
      this.regenTimer = 0;
      this.justRegenerated = true;
    }
  }

  updateVisibility() {
    // Shrink the cluster as it is depleted
    const ratio = Math.max(0.35, this.amount / this.maxAmount);
    this.mesh.scale.setScalar(ratio);
  }
}
