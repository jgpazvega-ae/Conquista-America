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

  onSelectionChange:  (() => void) | null = null;
  onMoveOrder:        (() => void) | null = null;
  onBuildingClick:    ((buildingId: number) => void) | null = null;
  onTerrainClick:     ((col: number, row: number) => void) | null = null;
  onTerrainHover:     ((col: number, row: number) => void) | null = null;
  onAttackMove:       ((units: import('../game/Unit').Unit[], col: number, row: number) => void) | null = null;
  onRallySet:         ((col: number, row: number) => void) | null = null;
  onPatrolSet:        (() => void) | null = null;
  onGarrisonOrder:    ((count: number, buildingId: number) => void) | null = null;
  onCaptureOrder:     ((count: number, buildingId: number) => void) | null = null;
  onHover:            ((unitId: number | null, buildingId: number | null, screenX: number, screenY: number, tileCol?: number, tileRow?: number) => void) | null = null;
  onMapPing:          ((worldX: number, worldZ: number) => void) | null = null;

  private _placingMode     = false;
  private _attackMoveMode  = false;
  private _lastClickTime   = 0;
  private _lastClickUnitId: number | null = null;

  setAttackMoveMode(on: boolean) {
    this._attackMoveMode = on;
    this.renderer.renderer.domElement.style.cursor = on ? 'crosshair' : '';
  }

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
    // Ghost preview hover
    if (this._placingMode && this.onTerrainHover) {
      const hit = this.renderer.pickFromScreen(e.clientX, e.clientY);
      if (hit?.type === 'tile') this.onTerrainHover(hit.col, hit.row);
    }

    // Unit/building hover tooltip (only when not dragging)
    if (this.onHover && !this.drag.active && e.buttons === 0) {
      const hit = this._placingMode ? null : this.renderer.pickFromScreen(e.clientX, e.clientY);
      if (hit?.type === 'unit') {
        this.onHover(hit.unitId, null, e.clientX, e.clientY);
      } else if (hit?.type === 'building') {
        this.onHover(null, hit.buildingId, e.clientX, e.clientY);
      } else if (hit?.type === 'tile') {
        this.onHover(null, null, e.clientX, e.clientY, hit.col, hit.row);
      } else {
        this.onHover(null, null, e.clientX, e.clientY);
      }
    }

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
      this.endDragSelect(e.ctrlKey);
    } else {
      this.handleClick(e.clientX, e.clientY, e.ctrlKey);
    }
    this.drag.active  = false;
    this.mouseDownPos = null;
    this.selectionBox.style.display = 'none';
  }

  // Right-click fires AFTER Camera has had a chance to accumulate drag distance
  private onRightUp(e: MouseEvent) {
    e.preventDefault();
    // Alt+right-click → drop a tactical map ping
    if (e.altKey) {
      const hit = this.renderer.pickFromScreen(e.clientX, e.clientY);
      if (hit?.type === 'tile') {
        this.onMapPing?.(hit.col * TILE_SIZE + TILE_SIZE / 2, hit.row * TILE_SIZE + TILE_SIZE / 2);
      }
      return;
    }
    // Cancel placement mode on right-click
    if (this._placingMode) {
      this._placingMode = false;
      this.renderer.renderer.domElement.style.cursor = '';
      this.onTerrainClick?.(NaN, NaN); // signal cancellation
      return;
    }
    if (this.camera.rightClickWasDrag()) return;

    const selected = this.getSelectedUnits();
    if (selected.length === 0) {
      // No units selected: right-click on terrain → set rally point
      const hit = this.renderer.pickFromScreen(e.clientX, e.clientY);
      if (hit?.type === 'tile') this.onRallySet?.(hit.col, hit.row);
      return;
    }

    const myUnits = selected.filter(u => u.playerId === this.game.humanPlayerId);
    if (myUnits.length === 0) return;

    // Shift+right-click = set patrol route (current pos → clicked tile)
    if (e.shiftKey) {
      const hit = this.renderer.pickFromScreen(e.clientX, e.clientY);
      if (hit?.type === 'tile') {
        for (const u of myUnits) u.setPatrol(u.gridPos(), { col: hit.col, row: hit.row });
        this.onMoveOrder?.();
        this.onPatrolSet?.();
      }
      return;
    }

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

    if (hit.type === 'building') {
      const bldg = this.game.getBuildingById(hit.buildingId);
      if (!bldg || !bldg.isAlive()) return;
      if (bldg.playerId !== this.game.humanPlayerId) {
        if (e.ctrlKey && bldg.isComplete() && bldg.garrison.length === 0) {
          // Ctrl+right-click → capture: melee units seize the building intact
          let ordered = 0;
          for (const u of myUnits) {
            if (u.attackRange > 1.5 || u.panicked || u.garrisonedIn !== null) continue;
            u.captureTarget = bldg;
            u.attackTarget = null;
            u.attackBuildingTarget = null;
            u.garrisonTarget = null;
            const near = this.game.map.findWalkableNear(bldg.col, bldg.row, 3);
            if (near) {
              const path = findPath(this.game.map, u.gridPos(), { col: near[0], row: near[1] }, 300);
              if (path.length > 0) { u.path = path; u.pathIndex = 0; u.state = UnitState.MOVING; }
            }
            ordered++;
          }
          if (ordered > 0) {
            this.onCaptureOrder?.(ordered, bldg.id);
            this.onMoveOrder?.();
          }
          return;
        }
        for (const u of myUnits) u.attackBuilding(bldg);
        this.onMoveOrder?.();
      } else if (bldg.isComplete() && bldg.garrisonCapacity > 0) {
        // Right-click own building → garrison selected units inside
        const free = bldg.garrisonCapacity - bldg.garrison.length;
        let ordered = 0;
        for (const u of myUnits) {
          if (ordered >= free || u.panicked || u.garrisonedIn !== null) continue;
          u.garrisonTarget = bldg;
          const near = this.game.map.findWalkableNear(bldg.col, bldg.row, 3);
          if (near) {
            const path = findPath(this.game.map, u.gridPos(), { col: near[0], row: near[1] }, 300);
            if (path.length > 0) {
              u.path = path; u.pathIndex = 0; u.state = UnitState.MOVING;
            }
          }
          ordered++;
        }
        if (ordered > 0) {
          this.onGarrisonOrder?.(ordered, bldg.id);
          this.onMoveOrder?.();
        }
      }
      return;
    }

    if (hit.type === 'tile') {
      const map = this.game.map;
      // Formation movement: preserve unit offsets from their centroid
      let cx = 0, cz = 0;
      for (const u of myUnits) { cx += u.col; cz += u.row; }
      cx /= myUnits.length; cz /= myUnits.length;

      // When units are tightly clustered (e.g. just spawned), use grid spread so they don't all pile on one tile
      const maxSpread = myUnits.length > 1
        ? Math.max(...myUnits.map(u => Math.abs(u.col - cx) + Math.abs(u.row - cz)))
        : 0;
      const useGridSpread = maxSpread < 1.5 && myUnits.length > 1;

      let sumX = 0, sumZ = 0, moved = 0;
      myUnits.forEach((unit, i) => {
        let offsetC: number, offsetR: number;
        if (useGridSpread) {
          [offsetC, offsetR] = this.spreadOffset(i, myUnits.length);
        } else {
          offsetC = myUnits.length > 1 ? Math.round(unit.col - cx) : 0;
          offsetR = myUnits.length > 1 ? Math.round(unit.row - cz) : 0;
        }
        const tc = hit.col + offsetC;
        const tr = hit.row + offsetR;
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
      // Formation march: the whole group keeps pace with its slowest member
      if (moved > 1) {
        const minSpeed = Math.min(...myUnits.map(u => u.speed));
        for (const u of myUnits) {
          if (u.state === UnitState.MOVING) u.formationSpeedCap = minSpeed;
        }
      }
      // Show move marker at centroid of ordered destinations
      if (moved > 0) {
        this.renderer.showMoveMarker(sumX / moved, sumZ / moved);
        this.onMoveOrder?.();
      }
    }
  }

  spreadOffset(idx: number, total: number): [number, number] {
    if (total === 1) return [0, 0];
    const cols = Math.ceil(Math.sqrt(total));
    const c    = idx % cols - Math.floor(cols / 2);
    const r    = Math.floor(idx / cols) - Math.floor(Math.ceil(total / cols) / 2);
    return [c, r];
  }

  setPlacingMode(on: boolean) {
    this._placingMode = on;
    const canvas = this.renderer.renderer.domElement;
    canvas.style.cursor = on ? 'crosshair' : '';
  }

  private handleClick(screenX: number, screenY: number, ctrlKey = false) {
    const hit = this.renderer.pickFromScreen(screenX, screenY);

    // Placement mode intercepts terrain clicks
    if (this._placingMode) {
      if (hit?.type === 'tile') this.onTerrainClick?.(hit.col, hit.row);
      return;
    }

    // Attack-move mode: issue attack-move order to selected units
    if (this._attackMoveMode) {
      this._attackMoveMode = false;
      this.renderer.renderer.domElement.style.cursor = '';
      if (hit?.type === 'tile') {
        const myUnits = this.getSelectedUnits().filter(u => u.playerId === this.game.humanPlayerId);
        if (myUnits.length > 0) this.onAttackMove?.(myUnits, hit.col, hit.row);
      }
      return;
    }

    if (!ctrlKey) for (const unit of this.game.getAllUnits()) unit.setSelected(false);

    if (hit?.type === 'unit') {
      const unit = this.game.getUnitById(hit.unitId);
      if (unit?.isAlive()) {
        const canSee = this.game.fog.canSeeUnit(unit, this.game.humanPlayerId);
        if (canSee) {
          const now = Date.now();
          const isDouble = now - this._lastClickTime < 300 && this._lastClickUnitId === hit.unitId;
          if (isDouble && unit.playerId === this.game.humanPlayerId) {
            // Double-click: select all visible alive same-type units
            const targetType = unit.def.type;
            for (const u of this.game.getAllUnits()) {
              u.setSelected(
                u.isAlive() &&
                u.playerId === this.game.humanPlayerId &&
                u.def.type === targetType &&
                this.game.fog.canSeeUnit(u, this.game.humanPlayerId),
              );
            }
          } else if (ctrlKey && unit.playerId === this.game.humanPlayerId) {
            // Ctrl+click: toggle this unit in/out of current selection
            unit.setSelected(!unit.isSelected());
          } else {
            unit.setSelected(true);
          }
          this._lastClickTime   = now;
          this._lastClickUnitId = hit.unitId;
        }
      }
      this.onSelectionChange?.();
      return;
    }

    if (hit?.type === 'building') {
      this.onBuildingClick?.(hit.buildingId);
      this.onSelectionChange?.();
      return;
    }

    this.onSelectionChange?.();
  }

  private endDragSelect(additive = false) {
    const x1 = Math.min(this.drag.startX, this.drag.currentX);
    const y1 = Math.min(this.drag.startY, this.drag.currentY);
    const x2 = Math.max(this.drag.startX, this.drag.currentX);
    const y2 = Math.max(this.drag.startY, this.drag.currentY);

    if (!additive) for (const unit of this.game.getAllUnits()) unit.setSelected(false);

    for (const unit of this.game.getAllUnits()) {
      if (!unit.isAlive()) continue;
      if (unit.playerId !== this.game.humanPlayerId) continue;
      if (unit.garrisonedIn !== null) continue;
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
