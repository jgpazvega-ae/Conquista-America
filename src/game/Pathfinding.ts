import type { GridPos } from './types';
import type { GameMap } from './Map';

interface Node {
  col: number;
  row: number;
  g: number;
  h: number;
  f: number;
  parent: Node | null;
}

function heuristic(a: GridPos, b: GridPos): number {
  // Chebyshev distance (allows diagonal)
  return Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
}

function key(col: number, row: number): string {
  return `${col},${row}`;
}

export function findPath(
  map: GameMap,
  start: GridPos,
  goal: GridPos,
  maxIter = 400,
): GridPos[] {
  if (!map.isWalkable(goal.col, goal.row)) {
    // Try to find nearest walkable
    const near = map.findWalkableNear(goal.col, goal.row);
    if (!near) return [];
    goal = { col: near[0], row: near[1] };
  }

  if (start.col === goal.col && start.row === goal.row) return [];

  const open: Node[]  = [];
  const closed = new Set<string>();
  const nodeMap = new Map<string, Node>();

  const startNode: Node = { col: start.col, row: start.row, g: 0, h: heuristic(start, goal), f: 0, parent: null };
  startNode.f = startNode.h;
  open.push(startNode);
  nodeMap.set(key(start.col, start.row), startNode);

  let iters = 0;
  while (open.length > 0 && iters++ < maxIter) {
    // Find node with lowest f
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) bestIdx = i;
    }
    const current = open.splice(bestIdx, 1)[0];
    const ck = key(current.col, current.row);
    closed.add(ck);

    if (current.col === goal.col && current.row === goal.row) {
      return reconstructPath(current);
    }

    for (const [nc, nr] of map.getNeighborCoords(current.col, current.row)) {
      if (!map.isWalkable(nc, nr)) continue;
      const nk = key(nc, nr);
      if (closed.has(nk)) continue;

      const isDiag = nc !== current.col && nr !== current.row;
      const moveCost = isDiag ? 1.414 : 1.0;
      const g = current.g + moveCost;
      const existing = nodeMap.get(nk);

      if (!existing || g < existing.g) {
        const h = heuristic({ col: nc, row: nr }, goal);
        const node: Node = { col: nc, row: nr, g, h, f: g + h, parent: current };
        nodeMap.set(nk, node);
        if (!existing) open.push(node);
        else {
          // Update in place
          existing.g = node.g;
          existing.f = node.f;
          existing.parent = node.parent;
        }
      }
    }
  }

  return [];
}

function reconstructPath(node: Node): GridPos[] {
  const path: GridPos[] = [];
  let cur: Node | null = node;
  while (cur) {
    path.unshift({ col: cur.col, row: cur.row });
    cur = cur.parent;
  }
  path.shift(); // Remove start position
  return path;
}
