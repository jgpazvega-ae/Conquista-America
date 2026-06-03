import * as THREE from 'three';
import { CAMERA_PAN_SPEED, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX, CAMERA_TILT_DEG, MAP_COLS, MAP_ROWS, TILE_SIZE } from '../game/constants';

const EDGE_PAN_MARGIN = 40; // px from edge to trigger pan

export class RTSCamera {
  private camera: THREE.PerspectiveCamera;

  // Camera target point on the ground plane
  private targetX: number;
  private targetZ: number;
  private zoom:    number = 28;
  private yaw:     number = 0;

  // Keys held
  private keys = new Set<string>();

  // Middle mouse drag for rotation
  private middleDrag   = false;
  private middleDragX  = 0;
  private middleDragY  = 0;
  private lastMiddleX  = 0;
  private lastMiddleY  = 0;

  // Edge pan
  private mouseX = 0;
  private mouseY = 0;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera  = camera;
    this.targetX = (MAP_COLS / 2) * TILE_SIZE;
    this.targetZ = (MAP_ROWS / 2) * TILE_SIZE;

    this.bindEvents();
    this.applyTransform();
  }

  private bindEvents() {
    window.addEventListener('keydown', e => this.keys.add(e.code));
    window.addEventListener('keyup',   e => this.keys.delete(e.code));

    window.addEventListener('wheel', e => {
      this.zoom = THREE.MathUtils.clamp(this.zoom + e.deltaY * 0.04, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX);
    }, { passive: true });

    window.addEventListener('mousemove', e => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      if (this.middleDrag) {
        const dx = e.clientX - this.lastMiddleX;
        const dy = e.clientY - this.lastMiddleY;
        this.yaw += dx * 0.005;
        this.lastMiddleX = e.clientX;
        this.lastMiddleY = e.clientY;
      }
    });

    window.addEventListener('mousedown', e => {
      if (e.button === 1) {
        this.middleDrag  = true;
        this.lastMiddleX = e.clientX;
        this.lastMiddleY = e.clientY;
        e.preventDefault();
      }
    });

    window.addEventListener('mouseup', e => {
      if (e.button === 1) this.middleDrag = false;
    });
  }

  update(dt: number) {
    const spd = CAMERA_PAN_SPEED * (this.zoom / 20) * dt;

    // Keyboard pan (WASD / arrows)
    const fwd  = new THREE.Vector2(Math.sin(this.yaw), Math.cos(this.yaw));
    const right = new THREE.Vector2(fwd.y, -fwd.x);

    if (this.keys.has('KeyW') || this.keys.has('ArrowUp'))    { this.targetX -= fwd.x * spd;   this.targetZ -= fwd.y * spd; }
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown'))  { this.targetX += fwd.x * spd;   this.targetZ += fwd.y * spd; }
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft'))  { this.targetX -= right.x * spd; this.targetZ -= right.y * spd; }
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) { this.targetX += right.x * spd; this.targetZ += right.y * spd; }

    // Zoom keyboard
    if (this.keys.has('Equal') || this.keys.has('NumpadAdd'))    this.zoom = Math.max(CAMERA_ZOOM_MIN, this.zoom - 20 * dt);
    if (this.keys.has('Minus') || this.keys.has('NumpadSubtract')) this.zoom = Math.min(CAMERA_ZOOM_MAX, this.zoom + 20 * dt);

    // Edge scrolling
    const edgeSpd = spd * 0.8;
    const W = window.innerWidth, H = window.innerHeight;
    if (this.mouseX < EDGE_PAN_MARGIN)     { this.targetX -= right.x * edgeSpd; this.targetZ -= right.y * edgeSpd; }
    if (this.mouseX > W - EDGE_PAN_MARGIN) { this.targetX += right.x * edgeSpd; this.targetZ += right.y * edgeSpd; }
    if (this.mouseY < EDGE_PAN_MARGIN)     { this.targetX -= fwd.x * edgeSpd;   this.targetZ -= fwd.y * edgeSpd; }
    if (this.mouseY > H - EDGE_PAN_MARGIN) { this.targetX += fwd.x * edgeSpd;   this.targetZ += fwd.y * edgeSpd; }

    // Clamp
    const maxX = MAP_COLS * TILE_SIZE;
    const maxZ = MAP_ROWS * TILE_SIZE;
    this.targetX = THREE.MathUtils.clamp(this.targetX, 0, maxX);
    this.targetZ = THREE.MathUtils.clamp(this.targetZ, 0, maxZ);

    this.applyTransform();
  }

  private applyTransform() {
    const tiltRad = THREE.MathUtils.degToRad(CAMERA_TILT_DEG);
    const dist    = this.zoom;

    // Camera offset from target in world space
    const offY =  Math.sin(tiltRad) * dist;
    const offZ =  Math.cos(tiltRad) * dist;

    const cx = this.targetX + Math.sin(this.yaw) * offZ;
    const cz = this.targetZ + Math.cos(this.yaw) * offZ;

    this.camera.position.set(cx, offY, cz);
    this.camera.lookAt(this.targetX, 0, this.targetZ);
  }

  panTo(worldX: number, worldZ: number, duration = 0) {
    this.targetX = worldX;
    this.targetZ = worldZ;
  }
}
