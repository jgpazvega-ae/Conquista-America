import type { Renderer } from './Renderer';
import type { RTSCamera } from './Camera';
import type { Game } from '../game/Game';
import type { Unit } from '../game/Unit';
import { UnitState } from '../game/types';
import { findPath } from '../game/Pathfinding';
import { TILE_SIZE } from '../game/constants';

interface DragState {
  active:   boolean;
  startX:   number;
  startY:   number;
  currentX: number;
  currentY: number;
}

export class InputHandler {
  private renderer:     Renderer;
  private camera:       RTSCamera;
  private game:         Game;
  private selectionBox: HTMLElement;
  private drag: DragState = { active: false, startX: 0, startY: 0, currentX: 0, currentY: 0 };
  private mouseDownPos: { x: number; y: number } | null = null;

  onSelectionChange: (() => void) | null = null;

  constructor(renderer: Renderer, game: Game, camera: RTSCamera) {
    this.renderer     = renderer;
    this.camera       = camera;
    this.game         = game;
    this.selectionBox = document.getElementById('selection-box')!;
    this.bind();
  }

  private bind() {
    const canvas = this.renderer.renderer.domElement;
    canvas.addEventListener('mousedown',    this.onMouseDown.bind(this));
    canvas.addEventListener('mousemove',    this.onMouseMove.bind(this));
    canvas.addEventListener('mouseup',      this.onMouseUp.bind(this));
    canvas.addEventListener('contextmenu',  e => e.preventDefault());
    // Right-click ORDER fires on mouseup (so drag is detected first)
    canvas.addEventListener('mouseup',      e => { if (e.button === 2) this.onRightUp(e); });
  }

  private onMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    this.mouseDownPos = { x: e.clientX, y: e.clientY };
    this.drag = { active: false, startX: e.clientX, startY: e.clientY, currentX: e.clientX, currentY: e.clientY };
  }

  private onMouseMove(e: MouseEvent) {
    if (!this.mouseDownPos || e.buttons !== 1) return;
    const dx = e.clientX - this.drag.startX;
    const dy = e.clientY - this.drag.startY;
    if (!this.drag.active && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
      this.drag.active = true;
    }
    if (this.drag.active) {
      this.drag.currentX = e.clientX;
      this.drag.currentY = e.clientY;
      this.updateSelectionBox();
    }
  }

  private onMouseUp(e: MouseEvent) {
    if (e.button !== 0) return;
    if (this.drag.active) {
      this.endDragSelect();
    } else {
      this.handleClick(e.clientX, e.clientY);
    }
    this.drag.active  = false;
    this.mouseDownPos = null;
    this.selectionBox.style.display = 'none';
  }

  // Right-click fires AFTER Camera has had a chance to accumulate drag distance
  private onRightUp(e: MouseEvent) {
    e.preventDefault();
    // If the right mouse was dragged to pan the camera, don't issue a game order
    if (this.camera.rightClickWasDrag()) return;

    const selected = this.getSelectedUnits();
    if (selected.length === 0) return;

    const myUnits = selected.filter(u => u.playerId === this.game.humanPlayerId);
    if (myUnits.length === 0) return;

    const hit = this.renderer.pickFromScreen(e.clientX, e.clientY);
    if (!hit) return;

    if (hit.type === 'unit') {
      const target = this.game.getUnitById(hit.unitId);
      if (!target || !target.isAlive()) return;
      if (target.playerId !== this.game.humanPlayerId) {
        for (const u of myUnits) u.attackUnit(target);
      }
      return;
    }

    if (hit.type === 'tile') {
      const map = this.game.map;
      // Compute centroid for move marker
      let sumX = 0, sumZ = 0, moved = 0;
      myUnits.forEach((unit, i) => {
        const offset = this.spreadOffset(i, myUnits.length);
        const tc = hit.col + offset[0];
        const tr = hit.row + offset[1];
        const near = map.findWalkableNear(tc, tr, 3);
        if (!near) return;
        const path = findPath(map, unit.gridPos(), { col: near[0], row: near[1] }, 400);
        if (path.length > 0) {
          unit.moveTo(path);
          sumX += near[0] * TILE_SIZE;
          sumZ += near[1] * TILE_SIZE;
          moved++;
        } else {
          unit.state = UnitState.IDLE;
        }
      });
      // Show move marker at centroid of ordered destinations
      if (moved > 0) {
        this.renderer.showMoveMarker(sumX / moved, sumZ / moved);
      }
    }
  }

  private spreadOffset(idx: number, total: number): [number, number] {
    if (total === 1) return [0, 0];
    const cols = Math.ceil(Math.sqrt(total));
    const c    = idx % cols - Math.floor(cols / 2);
    const r    = Math.floor(idx / cols) - Math.floor(Math.ceil(total / cols) / 2);
    return [c, r];
  }

  private handleClick(screenX: number, screenY: number) {
    const hit = this.renderer.pickFromScreen(screenX, screenY);

    for (const unit of this.game.getAllUnits()) unit.setSelected(false);

    if (hit?.type === 'unit') {
      const unit = this.game.getUnitById(hit.unitId);
      if (unit?.isAlive()) {
        const canSee = this.game.fog.canSeeUnit(unit, this.game.humanPlayerId);
        if (canSee) unit.setSelected(true);
      }
    }

    this.onSelectionChange?.();
  }

  private endDragSelect() {
    const x1 = Math.min(this.drag.startX, this.drag.currentX);
    const y1 = Math.min(this.drag.startY, this.drag.currentY);
    const x2 = Math.max(this.drag.startX, this.drag.currentX);
    const y2 = Math.max(this.drag.startY, this.drag.currentY);

    for (const unit of this.game.getAllUnits()) unit.setSelected(false);

    for (const unit of this.game.getAllUnits()) {
      if (!unit.isAlive()) continue;
      if (unit.playerId !== this.game.humanPlayerId) continue;
      const pos = this.renderer.worldToScreen(unit.worldX, 0.5, unit.worldZ);
      if (pos.x >= x1 && pos.x <= x2 && pos.y >= y1 && pos.y <= y2) {
        unit.setSelected(true);
      }
    }

    this.onSelectionChange?.();
  }

  private updateSelectionBox() {
    const x = Math.min(this.drag.startX, this.drag.currentX);
    const y = Math.min(this.drag.startY, this.drag.currentY);
    const w = Math.abs(this.drag.currentX - this.drag.startX);
    const h = Math.abs(this.drag.currentY - this.drag.startY);

    this.selectionBox.style.display = 'block';
    this.selectionBox.style.left    = `${x}px`;
    this.selectionBox.style.top     = `${y}px`;
    this.selectionBox.style.width   = `${w}px`;
    this.selectionBox.style.height  = `${h}px`;
  }

  getSelectedUnits(): Unit[] {
    return this.game.getAllUnits().filter(u => u.isSelected() && u.isAlive());
  }
}
