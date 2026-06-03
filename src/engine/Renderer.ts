import * as THREE from 'three';
import type { GameMap, Tile } from '../game/Map';
import type { Unit } from '../game/Unit';
import { TILE_SIZE, TERRAIN_COLORS, TERRAIN_HEIGHTS } from '../game/constants';

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene:    THREE.Scene;
  readonly camera:   THREE.PerspectiveCamera;

  private tileMeshes = new Map<string, THREE.Mesh>();
  private tileGroup  = new THREE.Group();
  private unitGroup  = new THREE.Group();

  // For click picking
  readonly raycaster = new THREE.Raycaster();
  readonly mouse     = new THREE.Vector2();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x8ab4d4);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.scene  = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 400);

    this.setupScene();

    window.addEventListener('resize', this.onResize.bind(this));
  }

  private setupScene() {
    // Sky/fog
    this.scene.background = new THREE.Color(0x7aa8c8);
    this.scene.fog         = new THREE.Fog(0x7aa8c8, 60, 140);

    // Ambient
    const ambient = new THREE.AmbientLight(0xfff4e0, 0.55);
    this.scene.add(ambient);

    // Hemisphere light
    const hemi = new THREE.HemisphereLight(0x87ceeb, 0x4a5c2a, 0.45);
    this.scene.add(hemi);

    // Sun (directional)
    const sun = new THREE.DirectionalLight(0xfff8e0, 1.2);
    sun.position.set(30, 60, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far  = 200;
    sun.shadow.camera.left  = -80;
    sun.shadow.camera.right = 80;
    sun.shadow.camera.top   = 80;
    sun.shadow.camera.bottom = -80;
    sun.shadow.bias = -0.001;
    this.scene.add(sun);

    this.scene.add(this.tileGroup);
    this.scene.add(this.unitGroup);
  }

  buildTerrain(map: GameMap) {
    this.tileGroup.clear();
    this.tileMeshes.clear();

    const geometryCache = new Map<string, THREE.BoxGeometry>();
    const materialCache = new Map<number, THREE.MeshLambertMaterial>();

    for (let r = 0; r < map.rows; r++) {
      for (let c = 0; c < map.cols; c++) {
        const tile = map.getTile(c, r)!;
        const h    = TERRAIN_HEIGHTS[tile.terrain] ?? 0.25;
        const col  = TERRAIN_COLORS[tile.terrain]  ?? 0x888888;

        const geoKey = `${h.toFixed(2)}`;
        let geo = geometryCache.get(geoKey);
        if (!geo) {
          geo = new THREE.BoxGeometry(TILE_SIZE - 0.05, h, TILE_SIZE - 0.05);
          geometryCache.set(geoKey, geo);
        }

        let mat = materialCache.get(col);
        if (!mat) {
          mat = new THREE.MeshLambertMaterial({ color: col });
          materialCache.set(col, mat);
        }

        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(c * TILE_SIZE, h / 2, r * TILE_SIZE);
        mesh.receiveShadow = true;
        mesh.userData.tile = { col: c, row: r } as { col: number; row: number };

        this.tileMeshes.set(`${c},${r}`, mesh);
        this.tileGroup.add(mesh);
      }
    }
  }

  addUnit(unit: Unit) {
    this.unitGroup.add(unit.mesh);
  }

  removeUnit(unit: Unit) {
    this.unitGroup.remove(unit.mesh);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  private onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  /** Returns {tileCol, tileRow} or {unitId} depending on what was hit */
  pickFromScreen(screenX: number, screenY: number): { type: 'tile'; col: number; row: number } | { type: 'unit'; unitId: number } | null {
    this.mouse.x =  (screenX / window.innerWidth)  * 2 - 1;
    this.mouse.y = -(screenY / window.innerHeight) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Check units first
    const unitHits = this.raycaster.intersectObjects(this.unitGroup.children, true);
    for (const hit of unitHits) {
      const uid = hit.object.userData.unitId ?? hit.object.parent?.userData.unitId;
      if (uid !== undefined) return { type: 'unit', unitId: uid };
    }

    // Then terrain
    const tileHits = this.raycaster.intersectObjects(this.tileGroup.children, false);
    if (tileHits.length > 0) {
      const tile = tileHits[0].object.userData.tile as { col: number; row: number } | undefined;
      if (tile) return { type: 'tile', col: tile.col, row: tile.row };
    }

    return null;
  }

  worldToScreen(worldX: number, worldY: number, worldZ: number): { x: number; y: number } {
    const v = new THREE.Vector3(worldX, worldY, worldZ).project(this.camera);
    return {
      x: ((v.x + 1) / 2) * window.innerWidth,
      y: ((-v.y + 1) / 2) * window.innerHeight,
    };
  }
}
