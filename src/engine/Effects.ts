import * as THREE from 'three';

export class EffectManager {
  private scene: THREE.Scene;
  private particles: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  createExplosion(x: number, y: number, z: number, intensity = 1.0) {
    const count = Math.floor(8 * intensity);
    const colors = [0xff6600, 0xffaa00, 0xffffff, 0xff3300];

    for (let i = 0; i < count; i++) {
      const geo = new THREE.SphereGeometry(0.15 * (1 + Math.random() * 0.5), 6, 6);
      const color = colors[Math.floor(Math.random() * colors.length)];
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
      const mesh = new THREE.Mesh(geo, mat);

      const vx = (Math.random() - 0.5) * 8;
      const vy = Math.random() * 6;
      const vz = (Math.random() - 0.5) * 8;

      mesh.position.set(x, y, z);
      mesh.userData.velocity = new THREE.Vector3(vx, vy, vz);
      mesh.userData.life = 1.0;
      mesh.userData.maxLife = 0.8 + Math.random() * 0.4;

      this.scene.add(mesh);
      this.particles.push(mesh);
    }
  }

  createDustCloud(x: number, z: number) {
    const count = 5;
    for (let i = 0; i < count; i++) {
      const geo = new THREE.SphereGeometry(0.3 + Math.random() * 0.2, 4, 4);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xaaaaaa,
        transparent: true,
        opacity: 0.5,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x + (Math.random() - 0.5) * 2, 0.5, z + (Math.random() - 0.5) * 2);
      mesh.userData.velocity = new THREE.Vector3((Math.random() - 0.5) * 2, 1, (Math.random() - 0.5) * 2);
      mesh.userData.life = 1.0;
      mesh.userData.maxLife = 1.2;
      this.scene.add(mesh);
      this.particles.push(mesh);
    }
  }

  createHitEffect(x: number, y: number, z: number) {
    const count = 3;
    for (let i = 0; i < count; i++) {
      const geo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
      const mat = new THREE.MeshBasicMaterial({ color: 0xff4444 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.userData.velocity = new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4);
      mesh.userData.life = 1.0;
      mesh.userData.maxLife = 0.5;
      this.scene.add(mesh);
      this.particles.push(mesh);
    }
  }

  update(dt: number) {
    const toRemove: number[] = [];

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const vel = p.userData.velocity as THREE.Vector3;
      const life = p.userData.life as number;
      const maxLife = p.userData.maxLife as number;

      p.userData.life -= dt;

      // Update physics
      p.position.add(vel.clone().multiplyScalar(dt));
      vel.y -= 9.8 * dt; // gravity

      // Update appearance
      if (p.material instanceof THREE.MeshBasicMaterial) {
        p.material.opacity = (p.userData.life / maxLife) * 0.8;
      }

      // Remove if dead
      if (p.userData.life <= 0) {
        this.scene.remove(p);
        toRemove.push(i);
      }
    }

    // Remove dead particles
    for (let i = toRemove.length - 1; i >= 0; i--) {
      this.particles.splice(toRemove[i], 1);
    }
  }
}
