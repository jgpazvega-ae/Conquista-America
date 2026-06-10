import * as THREE from 'three';
import { CAMERA_PAN_SPEED, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX, CAMERA_TILT_DEG, MAP_COLS, MAP_ROWS, TILE_SIZE } from '../game/constants';

const EDGE_PAN_MARGIN = 40; // px from edge to trigger pan

export class RTSCamera {
  private camera: THREE.PerspectiveCamera;

  // Logical target (what keys/mouse aim at)
  private targetX: number;
  private targetZ: number;
  // Smoothed position (interpolates toward target each frame)
  private currentX: number;
  private currentZ: number;

  private zoom: number = 28;
  private yaw:  number = 0;

  private keys = new Set<string>();

  // Middle-mouse drag → yaw rotation
  private middleDrag  = false;
  private lastMiddleX = 0;
  private lastMiddleY = 0;

  // Right-mouse drag → camera pan
  private rightDrag  = false;
  private lastRightX = 0;
  private lastRightY = 0;
  private _rightDragDist = 0; // accumulated pixels dragged; reset on mousedown

  // Edge pan
  private mouseX = 0;
  private mouseY = 0;

  // Camera shake
  private _shakeIntensity = 0;
  private _shakeDuration  = 0;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera   = camera;
    this.targetX  = this.currentX = (MAP_COLS / 2) * TILE_SIZE;
    this.targetZ  = this.currentZ = (MAP_ROWS / 2) * TILE_SIZE;

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
        this.yaw += dx * 0.005;
        this.lastMiddleX = e.clientX;
        this.lastMiddleY = e.clientY;
      }

      if (this.rightDrag) {
        const dx = e.clientX - this.lastRightX;
        const dy = e.clientY - this.lastRightY;
        this._rightDragDist += Math.abs(dx) + Math.abs(dy);
        this.panByPixels(-dx, -dy);
        this.lastRightX = e.clientX;
        this.lastRightY = e.clientY;
      }
    });

    window.addEventListener('mousedown', e => {
      if (e.button === 1) {
        this.middleDrag  = true;
        this.lastMiddleX = e.clientX;
        this.lastMiddleY = e.clientY;
        e.preventDefault();
      }
      if (e.button === 2) {
        this.rightDrag       = true;
        this.lastRightX      = e.clientX;
        this.lastRightY      = e.clientY;
        this._rightDragDist  = 0;
      }
    });

    window.addEventListener('mouseup', e => {
      if (e.button === 1) this.middleDrag = false;
      if (e.button === 2) this.rightDrag  = false;
    });
  }

  update(dt: number) {
    const spd = CAMERA_PAN_SPEED * (this.zoom / 20) * dt;

    const fwd   = new THREE.Vector2(Math.sin(this.yaw), Math.cos(this.yaw));
    const right = new THREE.Vector2(fwd.y, -fwd.x);

    // Keyboard pan
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp'))    { this.targetX -= fwd.x * spd;   this.targetZ -= fwd.y * spd; }
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown'))  { this.targetX += fwd.x * spd;   this.targetZ += fwd.y * spd; }
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft'))  { this.targetX -= right.x * spd; this.targetZ -= right.y * spd; }
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) { this.targetX += right.x * spd; this.targetZ += right.y * spd; }

    // Keyboard zoom
    if (this.keys.has('Equal') || this.keys.has('NumpadAdd'))      this.zoom = Math.max(CAMERA_ZOOM_MIN, this.zoom - 20 * dt);
    if (this.keys.has('Minus') || this.keys.has('NumpadSubtract')) this.zoom = Math.min(CAMERA_ZOOM_MAX, this.zoom + 20 * dt);

    // Edge scrolling
    const edgeSpd = spd * 0.9;
    const W = window.innerWidth, H = window.innerHeight;
    if (this.mouseX < EDGE_PAN_MARGIN)     { this.targetX -= right.x * edgeSpd; this.targetZ -= right.y * edgeSpd; }
    if (this.mouseX > W - EDGE_PAN_MARGIN) { this.targetX += right.x * edgeSpd; this.targetZ += right.y * edgeSpd; }
    if (this.mouseY < EDGE_PAN_MARGIN)     { this.targetX -= fwd.x * edgeSpd;   this.targetZ -= fwd.y * edgeSpd; }
    if (this.mouseY > H - EDGE_PAN_MARGIN) { this.targetX += fwd.x * edgeSpd;   this.targetZ += fwd.y * edgeSpd; }

    // Clamp target
    const maxX = MAP_COLS * TILE_SIZE;
    const maxZ = MAP_ROWS * TILE_SIZE;
    this.targetX = THREE.MathUtils.clamp(this.targetX, 0, maxX);
    this.targetZ = THREE.MathUtils.clamp(this.targetZ, 0, maxZ);

    // Smooth lerp toward target (feels fluid, ~10 frames to catch up)
    const lerp = Math.min(1.0, dt * 10);
    this.currentX += (this.targetX - this.currentX) * lerp;
    this.currentZ += (this.targetZ - this.currentZ) * lerp;

    // Decay shake
    if (this._shakeDuration > 0) this._shakeDuration -= dt;

    this.applyTransform();
  }

  private applyTransform() {
    const tiltRad = THREE.MathUtils.degToRad(CAMERA_TILT_DEG);
    const dist    = this.zoom;
    const offY    = Math.sin(tiltRad) * dist;
    const offZ    = Math.cos(tiltRad) * dist;

    let sx = 0, sz = 0;
    if (this._shakeDuration > 0) {
      const mag = this._shakeIntensity * this._shakeDuration;
      sx = (Math.random() * 2 - 1) * mag;
      sz = (Math.random() * 2 - 1) * mag;
    }

    const cx = this.currentX + Math.sin(this.yaw) * offZ + sx;
    const cz = this.currentZ + Math.cos(this.yaw) * offZ + sz;

    this.camera.position.set(cx, offY, cz);
    this.camera.lookAt(this.currentX + sx * 0.3, 0, this.currentZ + sz * 0.3);
  }

  panTo(worldX: number, worldZ: number) {
    this.targetX  = worldX;
    this.targetZ  = worldZ;
    this.currentX = worldX;
    this.currentZ = worldZ;
  }

  /** Returns true if the most recent right-click was a drag (not a tap) */
  rightClickWasDrag(): boolean {
    return this._rightDragDist > 6;
  }

  /** Trigger a camera shake. intensity is world-units peak offset; duration in seconds decays linearly. */
  shake(intensity: number, duration: number) {
    if (intensity > this._shakeIntensity || this._shakeDuration <= 0) {
      this._shakeIntensity = intensity;
      this._shakeDuration  = duration;
    }
  }

  getZoom(): number { return this.zoom; }
  setZoom(z: number) { this.zoom = THREE.MathUtils.clamp(z, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX); }

  getPosition(): { x: number; z: number } { return { x: this.currentX, z: this.currentZ }; }

  /** Translate screen pixel delta → world pan (called from TouchHandler & right-drag) */
  panByPixels(dx: number, dy: number) {
    const fovH = (this.camera.fov * Math.PI / 180) * this.camera.aspect;
    const worldPerPxX = (this.zoom * Math.tan(fovH / 2) * 2) / window.innerWidth;
    const worldPerPxY = (this.zoom * Math.tan(this.camera.fov * Math.PI / 360) * 2) / window.innerHeight;

    const fwd   = new THREE.Vector2(Math.sin(this.yaw), Math.cos(this.yaw));
    const right = new THREE.Vector2(fwd.y, -fwd.x);

    this.targetX += right.x * dx * worldPerPxX + fwd.x * dy * worldPerPxY;
    this.targetZ += right.y * dx * worldPerPxX + fwd.y * dy * worldPerPxY;

    const maxX = MAP_COLS * TILE_SIZE;
    const maxZ = MAP_ROWS * TILE_SIZE;
    this.targetX = THREE.MathUtils.clamp(this.targetX, 0, maxX);
    this.targetZ = THREE.MathUtils.clamp(this.targetZ, 0, maxZ);
  }
}
