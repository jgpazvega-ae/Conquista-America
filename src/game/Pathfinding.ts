import type { GridPos } from './types';
import type { GameMap } from './Map';
import { TerrainType } from './types';

/** Movement cost multiplier per terrain type — mirrors the speed penalty in Unit.ts */
function terrainMoveCost(map: GameMap, col: number, row: number): number {
  switch (map.getTile(col, row)?.terrain) {
    case TerrainType.JUNGLE:   return 1.61; // 1/0.62
    case TerrainType.MOUNTAIN: return 2.08; // 1/0.48
    case TerrainType.HIGHLAND: return 1.39; // 1/0.72
    case TerrainType.DESERT:   return 1.14; // 1/0.88
    default:                   return 1.0;
  }
}

// Binary min-heap for the A* open list — O(log n) instead of O(n) linear scan
class MinHeap {
  private data: { f: number; idx: number }[] = [];
  private nodes: Node[] = [];

  push(node: Node, idx: number) {
    this.nodes[idx] = node;
    this.data.push({ f: node.f, idx });
    this._siftUp(this.data.length - 1);
  }

  pop(): Node | null {
    if (this.data.length === 0) return null;
    const top = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      this._siftDown(0);
    }
    return this.nodes[top.idx];
  }

  updateKey(idx: number, f: number) {
    for (let i = 0; i < this.data.length; i++) {
      if (this.data[i].idx === idx) {
        this.data[i].f = f;
        this._siftUp(i);
        return;
      }
    }
  }

  get size() { return this.data.length; }

  private _siftUp(i: number) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.data[p].f <= this.data[i].f) break;
      [this.data[p], this.data[i]] = [this.data[i], this.data[p]];
      i = p;
    }
  }
  private _siftDown(i: number) {
    const n = this.data.length;
    while (true) {
      let s = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && this.data[l].f < this.data[s].f) s = l;
      if (r < n && this.data[r].f < this.data[s].f) s = r;
      if (s === i) break;
      [this.data[s], this.data[i]] = [this.data[i], this.data[s]];
      i = s;
    }
  }
}

interface Node {
  col: number; row: number;
  g: number; h: number; f: number;
  parent: Node | null;
  inOpen: boolean;
}

function heuristic(ac: number, ar: number, bc: number, br: number): number {
  return Math.max(Math.abs(ac - bc), Math.abs(ar - br));
}

export function findPath(
  map:     GameMap,
  start:   GridPos,
  goal:    GridPos,
  maxIter = 400,
): GridPos[] {
  if (!map.isWalkable(goal.col, goal.row)) {
    const near = map.findWalkableNear(goal.col, goal.row);
    if (!near) return [];
    goal = { col: near[0], row: near[1] };
  }
  if (start.col === goal.col && start.row === goal.row) return [];

  const cols = map.cols;
  const nodeGrid = new Map<number, Node>();

  const key = (c: number, r: number) => r * cols + c;

  const startNode: Node = {
    col: start.col, row: start.row,
    g: 0, h: heuristic(start.col, start.row, goal.col, goal.row),
    f: 0, parent: null, inOpen: true,
  };
  startNode.f = startNode.h;
  nodeGrid.set(key(start.col, start.row), startNode);

  const heap = new MinHeap();
  heap.push(startNode, key(start.col, start.row));

  const closed = new Uint8Array(cols * map.rows);
  let iters = 0;

  while (heap.size > 0 && iters++ < maxIter) {
    const current = heap.pop()!;
    const ck = key(current.col, current.row);
    if (closed[ck]) continue;
    closed[ck] = 1;

    if (current.col === goal.col && current.row === goal.row) {
      return reconstructPath(current);
    }

    for (const [nc, nr] of map.getNeighborCoords(current.col, current.row)) {
      if (!map.isWalkable(nc, nr)) continue;
      const nk = key(nc, nr);
      if (closed[nk]) continue;

      const diag = nc !== current.col && nr !== current.row;
      const g = current.g + (diag ? 1.414 : 1.0) * terrainMoveCost(map, nc, nr);
      let node = nodeGrid.get(nk);

      if (!node) {
        node = {
          col: nc, row: nr,
          g, h: heuristic(nc, nr, goal.col, goal.row),
          f: 0, parent: current, inOpen: true,
        };
        node.f = g + node.h;
        nodeGrid.set(nk, node);
        heap.push(node, nk);
      } else if (g < node.g) {
        node.g = g;
        node.f = g + node.h;
        node.parent = current;
        heap.updateKey(nk, node.f);
      }
    }
  }

  return [];
}

function reconstructPath(node: Node): GridPos[] {
  const path: GridPos[] = [];
  let cur: Node | null = node;
  while (cur?.parent) {
    path.unshift({ col: cur.col, row: cur.row });
    cur = cur.parent;
  }
  return path;
}
