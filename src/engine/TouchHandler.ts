import type { RTSCamera } from './Camera';
import type { Renderer } from './Renderer';
import type { Game } from '../game/Game';
import type { Unit } from '../game/Unit';
import { UnitState } from '../game/types';
import { findPath } from '../game/Pathfinding';

const LONG_PRESS_MS  = 500;
const TAP_MOVE_PX    = 8;
const DOUBLE_TAP_MS  = 300;

export class TouchHandler {
  private camera:   RTSCamera;
  private renderer: Renderer;
  private game:     Game;
  private canvas:   HTMLCanvasElement;

  // Pan state
  private panActive  = false;
  private panStartX  = 0;
  private panStartZ  = 0;
  private lastTouchX = 0;
  private lastTouchY = 0;

  // Pinch state
  private pinchActive = false;
  private pinchDist0  = 0;
  private zoom0       = 0;

  // Tap state
  private touchDownX  = 0;
  private touchDownY  = 0;
  private touchDownT  = 0;
  private longTimer:  ReturnType<typeof setTimeout> | null = null;
  private lastTapT    = 0;

  onSelectionChange: (() => void) | null = null;

  constructor(camera: RTSCamera, renderer: Renderer, game: Game) {
    this.camera   = camera;
    this.renderer = renderer;
    this.game     = game;
    this.canvas   = renderer.renderer.domElement;
    this.bind();
  }

  private bind() {
    this.canvas.addEventListener('touchstart',  this.onTouchStart.bind(this),  { passive: false });
    this.canvas.addEventListener('touchmove',   this.onTouchMove.bind(this),   { passive: false });
    this.canvas.addEventListener('touchend',    this.onTouchEnd.bind(this),    { passive: false });
    this.canvas.addEventListener('touchcancel', this.onTouchCancel.bind(this), { passive: false });
  }

  private onTouchStart(e: TouchEvent) {
    e.preventDefault();

    if (e.touches.length === 2) {
      // Pinch
      this.cancelLongPress();
      this.panActive   = false;
      this.pinchActive = true;
      this.pinchDist0  = this.touchDistance(e.touches[0], e.touches[1]);
      this.zoom0       = this.camera.getZoom();
      return;
    }

    if (e.touches.length === 1) {
      const t = e.touches[0];
      this.touchDownX = t.clientX;
      this.touchDownY = t.clientY;
      this.touchDownT = Date.now();
      this.lastTouchX = t.clientX;
      this.lastTouchY = t.clientY;
      this.panActive  = false;

      // Long-press timer → right-click equivalent
      this.longTimer = setTimeout(() => {
        this.longTimer = null;
        this.handleLongPress(this.touchDownX, this.touchDownY);
      }, LONG_PRESS_MS);
    }
  }

  private onTouchMove(e: TouchEvent) {
    e.preventDefault();

    if (e.touches.length === 2 && this.pinchActive) {
      const dist = this.touchDistance(e.touches[0], e.touches[1]);
      const scale = this.pinchDist0 / dist;
      this.camera.setZoom(this.zoom0 * scale);
      return;
    }

    if (e.touches.length === 1) {
      const t = e.touches[0];
      const dx = t.clientX - this.lastTouchX;
      const dy = t.clientY - this.lastTouchY;
      const totalMoved = Math.hypot(t.clientX - this.touchDownX, t.clientY - this.touchDownY);

      if (!this.panActive && totalMoved > TAP_MOVE_PX) {
        this.panActive = true;
        this.cancelLongPress();
      }

      if (this.panActive) {
        // Move camera: invert dx/dy to pan in correct direction
        this.camera.panByPixels(-dx, -dy);
      }

      this.lastTouchX = t.clientX;
      this.lastTouchY = t.clientY;
    }
  }

  private onTouchEnd(e: TouchEvent) {
    e.preventDefault();
    this.cancelLongPress();
    this.pinchActive = false;

    if (e.changedTouches.length === 1 && !this.panActive) {
      const t = e.changedTouches[0];
      const moved = Math.hypot(t.clientX - this.touchDownX, t.clientY - this.touchDownY);
      if (moved < TAP_MOVE_PX) {
        // Check double-tap
        const now = Date.now();
        if (now - this.lastTapT < DOUBLE_TAP_MS) {
          this.handleDoubleTap(t.clientX, t.clientY);
          this.lastTapT = 0;
        } else {
          this.lastTapT = now;
          this.handleTap(t.clientX, t.clientY);
        }
      }
    }

    this.panActive = false;
  }

  private onTouchCancel(e: TouchEvent) {
    this.cancelLongPress();
    this.panActive   = false;
    this.pinchActive = false;
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  private handleTap(x: number, y: number) {
    const hit = this.renderer.pickFromScreen(x, y);

    // Deselect all
    for (const unit of this.game.getAllUnits()) unit.setSelected(false);

    if (hit?.type === 'unit') {
      const unit = this.game.getUnitById(hit.unitId);
      if (unit?.isAlive() && this.game.fog.canSeeUnit(unit, this.game.humanPlayerId)) {
        unit.setSelected(true);
      }
    }

    this.onSelectionChange?.();
  }

  private handleDoubleTap(x: number, y: number) {
    // Double-tap = move / attack order
    this.handleMoveOrder(x, y);
  }

  private handleLongPress(x: number, y: number) {
    // Long-press = attack / move
    this.handleMoveOrder(x, y);
    // Visual feedback
    this.showTapRipple(x, y, true);
  }

  private handleMoveOrder(x: number, y: number) {
    const selected = this.getSelectedHumanUnits();
    if (selected.length === 0) return;

    const hit = this.renderer.pickFromScreen(x, y);
    if (!hit) return;

    if (hit.type === 'unit') {
      const target = this.game.getUnitById(hit.unitId);
      if (target?.isAlive() && target.playerId !== this.game.humanPlayerId) {
        for (const u of selected) u.attackUnit(target);
        return;
      }
    }

    if (hit.type === 'tile') {
      const map = this.game.map;
      selected.forEach((unit, i) => {
        const offset = this.spreadOffset(i, selected.length);
        const near = map.findWalkableNear(hit.col + offset[0], hit.row + offset[1], 3);
        if (!near) return;
        const path = findPath(map, unit.gridPos(), { col: near[0], row: near[1] }, 400);
        if (path.length > 0) unit.moveTo(path);
        else unit.state = UnitState.IDLE;
      });

      this.showTapRipple(x, y, false);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private getSelectedHumanUnits(): Unit[] {
    return this.game.getAllUnits().filter(u => u.isSelected() && u.isAlive() && u.playerId === this.game.humanPlayerId);
  }

  private spreadOffset(idx: number, total: number): [number, number] {
    if (total === 1) return [0, 0];
    const cols = Math.ceil(Math.sqrt(total));
    const c = idx % cols - Math.floor(cols / 2);
    const r = Math.floor(idx / cols) - Math.floor(Math.ceil(total / cols) / 2);
    return [c, r];
  }

  private touchDistance(a: Touch, b: Touch): number {
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }

  private cancelLongPress() {
    if (this.longTimer !== null) {
      clearTimeout(this.longTimer);
      this.longTimer = null;
    }
  }

  private showTapRipple(x: number, y: number, isAttack: boolean) {
    const el = document.createElement('div');
    el.className = isAttack ? 'tap-ripple attack' : 'tap-ripple move';
    el.style.left = `${x}px`;
    el.style.top  = `${y}px`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 700);
  }
}
