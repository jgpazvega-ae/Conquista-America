import * as THREE from 'three';

interface Particle extends THREE.Mesh {
  userData: {
    velocity: THREE.Vector3;
    life: number;
    maxLife: number;
    gravity: number;
    grow: number;   // scale growth per second
    spin: number;   // rotation per second
    baseOpacity: number;
  };
}

interface Projectile {
  mesh: THREE.Mesh;
  sx: number; sy: number; sz: number;
  tx: number; ty: number; tz: number;
  t: number; dur: number;
  trailTimer: number;
}

export class EffectManager {
  private scene: THREE.Scene;
  private particles: Particle[] = [];
  private projectiles: Projectile[] = [];

  // Shared geometries
  private sphere = new THREE.SphereGeometry(1, 8, 7);
  private shard  = new THREE.TetrahedronGeometry(1, 0);

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  private spawn(
    geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number,
    size: number, vel: THREE.Vector3, life: number,
    opts: { additive?: boolean; gravity?: number; grow?: number; spin?: number; opacity?: number } = {},
  ) {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: opts.opacity ?? 0.9,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: false,
    });
    const p = new THREE.Mesh(geo, mat) as unknown as Particle;
    p.position.set(x, y, z);
    p.scale.setScalar(size);
    p.userData = {
      velocity: vel,
      life,
      maxLife: life,
      gravity: opts.gravity ?? 0,
      grow: opts.grow ?? 0,
      spin: opts.spin ?? 0,
      baseOpacity: opts.opacity ?? 0.9,
    };
    this.scene.add(p);
    this.particles.push(p);
  }

  createExplosion(x: number, y: number, z: number, intensity = 1.0) {
    // Bright fire core (additive)
    const fireColors = [0xffdd66, 0xffaa22, 0xff6600, 0xff3300];
    const fireCount = Math.floor(10 * intensity);
    for (let i = 0; i < fireCount; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 5 + 1, (Math.random() - 0.5) * 6);
      this.spawn(this.sphere, fireColors[i % fireColors.length], x, y, z,
        0.12 + Math.random() * 0.18 * intensity, v, 0.4 + Math.random() * 0.35,
        { additive: true, gravity: 2, grow: 0.6, opacity: 1 });
    }
    // Smoke puffs (rise + expand + fade)
    const smokeCount = Math.floor(5 * intensity);
    for (let i = 0; i < smokeCount; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 2 + 1.5, (Math.random() - 0.5) * 2);
      this.spawn(this.sphere, 0x444444, x, y + 0.2, z,
        0.25 + Math.random() * 0.2, v, 0.9 + Math.random() * 0.6,
        { gravity: -0.5, grow: 1.2, opacity: 0.45 });
    }
    // Debris shards
    for (let i = 0; i < Math.floor(6 * intensity); i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 8, Math.random() * 6 + 2, (Math.random() - 0.5) * 8);
      this.spawn(this.shard, 0x5a4a3a, x, y, z, 0.08 + Math.random() * 0.06, v, 0.6,
        { gravity: 14, spin: 12, opacity: 1 });
    }
  }

  createDustCloud(x: number, z: number) {
    for (let i = 0; i < 6; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 2, 0.8 + Math.random(), (Math.random() - 0.5) * 2);
      this.spawn(this.sphere, 0xb8a888, x + (Math.random() - 0.5) * 1.5, 0.4, z + (Math.random() - 0.5) * 1.5,
        0.3 + Math.random() * 0.2, v, 0.8, { gravity: -0.3, grow: 1.0, opacity: 0.5 });
    }
  }

  createHitEffect(x: number, y: number, z: number) {
    // Spark burst (additive)
    for (let i = 0; i < 5; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 5, Math.random() * 4, (Math.random() - 0.5) * 5);
      this.spawn(this.sphere, 0xffcc44, x, y, z, 0.05 + Math.random() * 0.05, v, 0.3,
        { additive: true, gravity: 10, opacity: 1 });
    }
    // Small impact flash
    this.spawn(this.sphere, 0xffffff, x, y, z, 0.18, new THREE.Vector3(0, 0, 0), 0.12,
      { additive: true, grow: 1.5, opacity: 0.9 });
  }

  createProjectile(sx: number, sz: number, tx: number, tz: number, color = 0xffdd44) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(this.sphere, mat);
    mesh.scale.setScalar(0.09);
    this.scene.add(mesh);
    const dist = Math.sqrt((tx - sx) ** 2 + (tz - sz) ** 2);
    this.projectiles.push({ mesh, sx, sy: 0.6, sz, tx, ty: 0.6, tz, t: 0, dur: Math.max(0.12, dist * 0.04), trailTimer: 0 });
  }

  /** Golden star burst for unit level-up. */
  createLevelUpBurst(x: number, y: number, z: number) {
    // Rising gold sparks
    for (let i = 0; i < 14; i++) {
      const angle = (i / 14) * Math.PI * 2;
      const speed = 2.5 + Math.random() * 2;
      const v = new THREE.Vector3(Math.cos(angle) * speed, 3 + Math.random() * 2, Math.sin(angle) * speed);
      this.spawn(this.sphere, i % 2 === 0 ? 0xffdd00 : 0xffffff, x, y, z,
        0.07 + Math.random() * 0.06, v, 0.7 + Math.random() * 0.3,
        { additive: true, gravity: 4, spin: 8, opacity: 1 });
    }
    // Central flash
    this.spawn(this.sphere, 0xffffaa, x, y + 0.5, z, 0.35,
      new THREE.Vector3(0, 0, 0), 0.25, { additive: true, grow: 2.5, opacity: 1 });
    // Floating star shards
    for (let i = 0; i < 6; i++) {
      const v = new THREE.Vector3((Math.random()-0.5)*3, 4+Math.random()*3, (Math.random()-0.5)*3);
      this.spawn(this.shard, 0xffd700, x, y, z, 0.06, v, 0.9,
        { additive: true, gravity: -1, spin: 10, opacity: 0.9 });
    }
  }

  createBurningEffect(x: number, y: number, z: number) {
    const colors = [0xff6600, 0xffaa22, 0xff3300];
    for (let i = 0; i < 3; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 1.5, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 1.5);
      this.spawn(this.sphere, colors[i % colors.length],
        x + (Math.random() - 0.5) * 0.6, 0.6, z + (Math.random() - 0.5) * 0.6,
        0.07 + Math.random() * 0.05, v, 0.35 + Math.random() * 0.25,
        { additive: true, gravity: -1.5, grow: 0.4, opacity: 0.9 });
    }
  }

  createPoisonEffect(x: number, y: number, z: number) {
    const colors = [0x44cc44, 0x228822, 0x66ff44];
    for (let i = 0; i < 4; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.8 + Math.random() * 0.8, (Math.random() - 0.5) * 1.2);
      this.spawn(this.sphere, colors[i % colors.length],
        x + (Math.random() - 0.5) * 0.8, 0.4, z + (Math.random() - 0.5) * 0.8,
        0.1 + Math.random() * 0.08, v, 0.6 + Math.random() * 0.4,
        { gravity: -0.8, grow: 0.8, opacity: 0.55 });
    }
  }

  createMuzzleFlash(x: number, y: number, z: number) {
    this.spawn(this.sphere, 0xffee99, x, y, z, 0.2, new THREE.Vector3(0, 0, 0), 0.1,
      { additive: true, grow: 2, opacity: 1 });
    for (let i = 0; i < 3; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3);
      this.spawn(this.sphere, 0x888888, x, y, z, 0.1, v, 0.4, { gravity: -0.5, grow: 1.5, opacity: 0.4 });
    }
  }

  update(dt: number) {
    // Projectiles: lerp from source to target, leave spark trail
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.t += dt;
      p.trailTimer += dt;
      const frac = Math.min(p.t / p.dur, 1);
      p.mesh.position.set(
        p.sx + (p.tx - p.sx) * frac,
        p.sy + Math.sin(frac * Math.PI) * 0.6, // slight arc
        p.sz + (p.tz - p.sz) * frac,
      );
      // Leave a spark every 0.04 s
      if (p.trailTimer >= 0.04) {
        p.trailTimer = 0;
        const { x, z } = p.mesh.position;
        this.spawn(this.sphere, 0xffcc44, x, p.sy, z, 0.04,
          new THREE.Vector3((Math.random()-0.5)*0.5, Math.random()*0.5, (Math.random()-0.5)*0.5),
          0.18, { additive: true, gravity: 2, opacity: 0.8 });
      }
      if (frac >= 1) {
        this.scene.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        this.projectiles.splice(i, 1);
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      const d = p.userData;
      d.life -= dt;

      if (d.life <= 0) {
        this.scene.remove(p);
        (p.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
        continue;
      }

      p.position.addScaledVector(d.velocity, dt);
      d.velocity.y -= d.gravity * dt;
      if (d.grow) p.scale.addScalar(d.grow * dt);
      if (d.spin) p.rotation.set(p.rotation.x + d.spin * dt, p.rotation.y + d.spin * dt, 0);

      const t = d.life / d.maxLife;
      (p.material as THREE.MeshBasicMaterial).opacity = d.baseOpacity * t;
    }
  }
}
