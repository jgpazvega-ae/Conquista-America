import * as THREE from 'three';
import { UnitType, CivilizationType, UnitState } from './types';
import type { GridPos } from './types';
import type { UnitDef } from './civilizations';
import { getUnitDef } from './civilizations';
import { TILE_SIZE } from './constants';
import type { GameMap } from './Map';

let nextId = 1;

const SKIN  = 0xc28a5a;
const DARK  = 0x241810;

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
  private rig!: THREE.Group;
  healthBar!: THREE.Mesh;
  selectionRing!: THREE.Mesh;
  private selected = false;
  private animT = Math.random() * 10;
  private attackAnim = 0;

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

  // ── Mesh construction ─────────────────────────────────────────────────────────
  private buildMesh(civColor: number) {
    this.mesh = new THREE.Group();
    this.rig  = new THREE.Group();
    this.mesh.add(this.rig);

    const isConq = this.civType === CivilizationType.CONQUISTADOR;
    const accent = this.civAccent();

    const cloth  = new THREE.MeshStandardMaterial({ color: civColor, roughness: 0.85 });
    const skin   = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.7 });
    const dark   = new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.8 });
    const accMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.6, emissive: accent, emissiveIntensity: 0.05 });
    const metal  = new THREE.MeshStandardMaterial({ color: 0xc2c6ce, roughness: 0.35, metalness: 0.85 });
    const wood   = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.9 });

    const bodyMat = isConq ? metal : cloth;

    if (this.type === UnitType.CANNON) {
      this.buildCannon(metal, wood, accMat);
    } else if (this.def.isCavalry) {
      this.buildCavalry(bodyMat, skin, dark, metal, wood, accMat);
    } else {
      this.buildFootSoldier(bodyMat, cloth, skin, dark, metal, wood, accMat, isConq);
    }

    // ── Health bar (billboarded plane above unit) ──
    const barY = 1.95;
    const hpBg = new THREE.Mesh(new THREE.PlaneGeometry(0.74, 0.11),
      new THREE.MeshBasicMaterial({ color: 0x180000, transparent: true, opacity: 0.8, depthTest: false }));
    this.healthBar = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.09),
      new THREE.MeshBasicMaterial({ color: 0x33dd55, depthTest: false }));
    hpBg.position.set(0, barY, 0);
    this.healthBar.position.set(0, barY, 0.002);
    hpBg.rotation.x = -Math.PI / 2;
    this.healthBar.rotation.x = -Math.PI / 2;
    hpBg.renderOrder = 10; this.healthBar.renderOrder = 11;
    this.mesh.add(hpBg, this.healthBar);

    // ── Selection ring ──
    const ringGeo = new THREE.RingGeometry(0.42, 0.54, 28);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x66ddff, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
    this.selectionRing = new THREE.Mesh(ringGeo, ringMat);
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

  private addLimb(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) {
    const limb = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    limb.position.set(x, y, z);
    limb.castShadow = true;
    this.rig.add(limb);
    return limb;
  }

  private buildFootSoldier(
    bodyMat: THREE.Material, cloth: THREE.Material, skin: THREE.Material, dark: THREE.Material,
    metal: THREE.Material, wood: THREE.Material, accMat: THREE.Material, isConq: boolean,
  ) {
    // Legs
    this.addLimb(dark, 0.16, 0.5, 0.18, -0.12, 0.27, 0);
    this.addLimb(dark, 0.16, 0.5, 0.18,  0.12, 0.27, 0);

    // Torso
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.6, 0.26), bodyMat);
    torso.position.y = 0.82; torso.castShadow = true; this.rig.add(torso);
    // Sash / belt accent for ownership clarity
    const sash = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.3), accMat);
    sash.position.y = 0.62; this.rig.add(sash);

    // Arms
    const armMat = isConq ? metal : skin;
    this.addLimb(armMat, 0.13, 0.5, 0.14, -0.32, 0.85, 0);
    const rArm = this.addLimb(armMat, 0.13, 0.5, 0.14, 0.32, 0.85, 0);

    // Head + face
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), skin);
    head.position.y = 1.28; head.castShadow = true; this.rig.add(head);

    // Headgear by civ
    this.addHeadgear(1.28, skin, dark, metal, accMat, isConq);

    // Weapon / shield by role
    const heavy = this.maxHp >= 120; // elite/defensive => shield
    if (this.def.isRanged) {
      this.buildRangedWeapon(rArm, wood, dark, metal, accMat, isConq);
    } else {
      // Melee weapon in right hand (raised)
      if (isConq) {
        // Steel sword
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 0.02), metal);
        blade.position.set(0.46, 1.15, 0.05); this.rig.add(blade);
        const guard = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.05), dark);
        guard.position.set(0.46, 0.82, 0.05); this.rig.add(guard);
      } else {
        // Macuahuitl / club with obsidian edges
        const club = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.6, 0.06), wood);
        club.position.set(0.46, 1.12, 0.05); this.rig.add(club);
        const edge = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.4, 0.02), dark);
        edge.position.set(0.46, 1.2, 0.07); this.rig.add(edge);
      }
    }

    if (heavy) {
      // Shield on left arm
      const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.06, 16), accMat);
      shield.rotation.z = Math.PI / 2;
      shield.rotation.y = Math.PI / 2;
      shield.position.set(-0.4, 0.85, 0.12);
      shield.castShadow = true;
      this.rig.add(shield);
      const boss = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), isConq ? metal : dark);
      boss.position.set(-0.46, 0.85, 0.12); this.rig.add(boss);
    }
  }

  private addHeadgear(headY: number, skin: THREE.Material, dark: THREE.Material, metal: THREE.Material, accMat: THREE.Material, isConq: boolean) {
    if (isConq) {
      // Morrión helmet (steel)
      const helm = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 1.7), metal);
      helm.position.y = headY + 0.06; this.rig.add(helm);
      const crest = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.34), metal);
      crest.position.y = headY + 0.2; this.rig.add(crest);
      return;
    }
    // Native feather headdress — fan of feathers behind head
    const feathers = this.civType === CivilizationType.MAYA ? 7 : 5;
    const palette = [0xe03030, 0x2060e0, 0x20c060, 0xffcc20, 0xe060c0];
    for (let i = 0; i < feathers; i++) {
      const t = (i / (feathers - 1)) - 0.5; // -0.5..0.5
      const fmat = new THREE.MeshStandardMaterial({ color: palette[i % palette.length], roughness: 0.6 });
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.42, 5), fmat);
      f.position.set(t * 0.34, headY + 0.32, -0.14);
      f.rotation.x = -0.5;
      f.rotation.z = t * 0.6;
      f.castShadow = true;
      this.rig.add(f);
    }
    // Band around head
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.035, 6, 16), accMat);
    band.rotation.x = Math.PI / 2;
    band.position.y = headY + 0.1;
    this.rig.add(band);
  }

  private buildRangedWeapon(_rArm: THREE.Mesh, wood: THREE.Material, dark: THREE.Material, metal: THREE.Material, accMat: THREE.Material, isConq: boolean) {
    if (isConq) {
      // Arquebus — long barrel
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.7), wood);
      stock.position.set(0.3, 0.95, 0.1); this.rig.add(stock);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 8), dark);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0.3, 1.02, 0.25); this.rig.add(barrel);
      return;
    }
    if (this.type === UnitType.SLINGER) {
      // Sling — small pouch on a cord
      const cord = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.012, 5, 12), dark);
      cord.position.set(0.42, 1.0, 0.1); cord.rotation.y = Math.PI / 2; this.rig.add(cord);
      return;
    }
    if (this.type === UnitType.ATLATL) {
      // Spear-thrower with javelin
      const jav = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.0, 6), wood);
      jav.rotation.z = Math.PI / 2.2;
      jav.position.set(0.4, 1.05, 0.0); this.rig.add(jav);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.12, 6), dark);
      tip.rotation.z = -Math.PI / 2.2;
      tip.position.set(0.86, 1.18, 0.0); this.rig.add(tip);
      return;
    }
    // Bow (archers)
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.025, 6, 14, Math.PI * 1.1), wood);
    bow.position.set(0.4, 0.95, 0.05);
    bow.rotation.y = Math.PI / 2;
    this.rig.add(bow);
    const string = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.52, 0.005), dark);
    string.position.set(0.4, 0.95, 0.05); this.rig.add(string);
  }

  private buildCavalry(bodyMat: THREE.Material, skin: THREE.Material, dark: THREE.Material, metal: THREE.Material, wood: THREE.Material, accMat: THREE.Material) {
    const horseMat = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.85 });
    // Horse body
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 1.1), horseMat);
    body.position.set(0, 0.78, 0); body.castShadow = true; this.rig.add(body);
    // Neck + head
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.5, 0.3), horseMat);
    neck.position.set(0, 1.05, 0.55); neck.rotation.x = -0.5; this.rig.add(neck);
    const hhead = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.24, 0.42), horseMat);
    hhead.position.set(0, 1.28, 0.78); this.rig.add(hhead);
    // Legs
    for (const [x, z] of [[-0.18, 0.42], [0.18, 0.42], [-0.18, -0.42], [0.18, -0.42]] as const) {
      this.addLimb(dark, 0.12, 0.55, 0.12, x, 0.28, z);
    }
    // Tail
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.5, 6), dark);
    tail.position.set(0, 0.9, -0.62); tail.rotation.x = 0.7; this.rig.add(tail);

    // Rider torso + head (steel for conquistador)
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.5, 0.24), bodyMat);
    torso.position.set(0, 1.45, -0.05); torso.castShadow = true; this.rig.add(torso);
    const rhead = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), skin);
    rhead.position.set(0, 1.82, -0.05); this.rig.add(rhead);
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8, 0, Math.PI * 2, 0, Math.PI / 1.7), metal);
    helm.position.set(0, 1.88, -0.05); this.rig.add(helm);
    // Banner accent
    const banner = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.4, 0.28), accMat);
    banner.position.set(-0.2, 1.7, -0.1); this.rig.add(banner);

    // Lance
    const lance = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.5, 6), wood);
    lance.rotation.x = Math.PI / 2.3;
    lance.position.set(0.26, 1.4, 0.2); this.rig.add(lance);
    const ltip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 6), metal);
    ltip.rotation.x = Math.PI / 2.3;
    ltip.position.set(0.26, 1.95, 0.78); this.rig.add(ltip);
  }

  private buildCannon(metal: THREE.Material, wood: THREE.Material, accMat: THREE.Material) {
    // Wooden carriage
    const carriage = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.8), wood);
    carriage.position.y = 0.4; carriage.castShadow = true; this.rig.add(carriage);
    // Barrel
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.9, 14), metal);
    barrel.rotation.x = Math.PI / 2.6;
    barrel.position.set(0, 0.6, 0.1); barrel.castShadow = true; this.rig.add(barrel);
    const muzzle = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.04, 8, 16), metal);
    muzzle.rotation.x = Math.PI / 2.6 + Math.PI / 2;
    muzzle.position.set(0, 0.78, 0.48); this.rig.add(muzzle);
    // Wheels
    for (const x of [-0.3, 0.3]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.08, 16), wood);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.28, -0.1); wheel.castShadow = true; this.rig.add(wheel);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 8), metal);
      hub.rotation.z = Math.PI / 2; hub.position.set(x, 0.28, -0.1); this.rig.add(hub);
    }
    // Ownership flag
    const flag = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.3, 0.22), accMat);
    flag.position.set(-0.2, 0.95, -0.3); this.rig.add(flag);
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
    this.attackAnim   = 1;
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
    this.healthBar.position.x = (pct - 1) * 0.36;
    const mat = this.healthBar.material as THREE.MeshBasicMaterial;
    mat.color.setHex(pct > 0.5 ? 0x33dd55 : pct > 0.25 ? 0xddaa00 : 0xdd2222);
  }

  update(dt: number, map: GameMap) {
    if (this.state === UnitState.DEAD) return;

    this.attackTimer = Math.max(0, this.attackTimer - dt);
    this.animT += dt;

    if (this.state === UnitState.MOVING) {
      this.updateMovement(dt, map);
    }

    // ── Procedural animation on the rig (mesh.y is owned by the renderer) ──
    if (this.rig) {
      if (this.state === UnitState.MOVING) {
        this.rig.position.y = Math.abs(Math.sin(this.animT * 11)) * 0.07;
        this.rig.rotation.z = Math.sin(this.animT * 11) * 0.04;
      } else {
        this.rig.position.y = Math.sin(this.animT * 2.2) * 0.015;
        this.rig.rotation.z = 0;
      }
      // Attack lunge
      if (this.attackAnim > 0) {
        this.attackAnim = Math.max(0, this.attackAnim - dt * 3);
        this.rig.position.z = Math.sin((1 - this.attackAnim) * Math.PI) * 0.18;
      } else {
        this.rig.position.z = 0;
      }
    }

    // Sync planar position (Y set by Renderer.syncHeights)
    this.mesh.position.x = this.worldX;
    this.mesh.position.z = this.worldZ;
  }

  private updateMovement(dt: number, _map: GameMap) {
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
      this.mesh.rotation.y = Math.atan2(dx, dz);
    }
  }
}
