import * as THREE from 'three';
import type { GameMap } from '../game/Map';
import type { Unit } from '../game/Unit';
import { EffectManager } from './Effects';
import {
  TILE_SIZE,
  TERRAIN_COLORS,
  HEIGHT_SCALE,
  SEA_LEVEL_ELEV,
  WATER_LEVEL,
} from '../game/constants';
import { TerrainType } from '../game/types';

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene:    THREE.Scene;
  readonly camera:   THREE.PerspectiveCamera;

  private tileGroup  = new THREE.Group();
  private unitGroup  = new THREE.Group();
  private decoGroup  = new THREE.Group();
  readonly effects: EffectManager;

  private terrainMesh?: THREE.Mesh;
  private waterMat?: THREE.ShaderMaterial;
  private sunDir = new THREE.Vector3(0.4, 1.0, 0.3).normalize();

  // Height field for placing entities on the terrain surface
  private heightField: Float32Array = new Float32Array(0);
  private hfCols = 0; // = map.cols
  private hfRows = 0; // = map.rows
  private clock  = new THREE.Clock();

  // For click picking
  readonly raycaster = new THREE.Raycaster();
  readonly mouse     = new THREE.Vector2();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace  = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene  = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 600);
    this.effects = new EffectManager(this.scene);

    this.setupScene();

    window.addEventListener('resize', this.onResize.bind(this));
  }

  private setupScene() {
    // ── Atmospheric fog tuned to the sky horizon ──────────────────────────────
    const horizon = new THREE.Color(0xbcd6e8);
    this.scene.fog = new THREE.Fog(horizon.getHex(), 70, 220);

    // ── Gradient sky dome ──────────────────────────────────────────────────────
    const skyGeo = new THREE.SphereGeometry(400, 32, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor:    { value: new THREE.Color(0x2e6fb5) },
        midColor:    { value: new THREE.Color(0x84b4dc) },
        bottomColor: { value: new THREE.Color(0xd9e6ee) },
        offset:      { value: 40 },
      },
      vertexShader: /* glsl */`
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        uniform vec3 topColor; uniform vec3 midColor; uniform vec3 bottomColor; uniform float offset;
        varying vec3 vPos;
        void main() {
          float h = normalize(vPos).y;
          vec3 col = h > 0.0
            ? mix(midColor, topColor, pow(clamp(h, 0.0, 1.0), 0.7))
            : mix(midColor, bottomColor, clamp(-h * 3.0, 0.0, 1.0));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.scene.add(new THREE.Mesh(skyGeo, skyMat));

    // ── Lighting rig: warm key sun + cool sky fill + soft ambient ──────────────
    const ambient = new THREE.AmbientLight(0xffffff, 0.35);
    this.scene.add(ambient);

    const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x4a4030, 0.65);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff1d4, 2.1);
    sun.position.copy(this.sunDir).multiplyScalar(120);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far  = 320;
    sun.shadow.camera.left   = -110;
    sun.shadow.camera.right  =  110;
    sun.shadow.camera.top    =  110;
    sun.shadow.camera.bottom = -110;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.5;
    this.scene.add(sun);
    this.scene.add(sun.target);

    // Cool rim/fill from opposite side to sculpt silhouettes
    const fill = new THREE.DirectionalLight(0x9fc0ff, 0.45);
    fill.position.set(-60, 40, -50);
    this.scene.add(fill);

    this.scene.add(this.tileGroup);
    this.scene.add(this.decoGroup);
    this.scene.add(this.unitGroup);
  }

  // ── Terrain base height from tile elevation ──────────────────────────────────
  private tileBaseHeight(map: GameMap, c: number, r: number): number {
    const tile = map.getTile(c, r);
    if (!tile) return 0;
    if (tile.terrain === TerrainType.WATER) return 0; // sea floor flush with water plane
    const above = Math.max(0, tile.elevation - SEA_LEVEL_ELEV);
    return Math.pow(above, 1.15) * HEIGHT_SCALE;
  }

  /** Height at a shared grid corner (i,j): average of up to 4 surrounding tiles. */
  private cornerHeight(map: GameMap, i: number, j: number): number {
    let sum = 0, n = 0;
    for (const [dc, dr] of [[-1, -1], [0, -1], [-1, 0], [0, 0]] as const) {
      const c = i + dc, r = j + dr;
      if (c >= 0 && c < map.cols && r >= 0 && r < map.rows) {
        sum += this.tileBaseHeight(map, c, r);
        n++;
      }
    }
    return n > 0 ? sum / n : 0;
  }

  private cornerColor(map: GameMap, i: number, j: number, out: THREE.Color) {
    let rr = 0, gg = 0, bb = 0, n = 0;
    const tmp = new THREE.Color();
    for (const [dc, dr] of [[-1, -1], [0, -1], [-1, 0], [0, 0]] as const) {
      const c = i + dc, r = j + dr;
      const tile = map.getTile(c, r);
      if (!tile) continue;
      tmp.setHex(TERRAIN_COLORS[tile.terrain] ?? 0x808080).convertSRGBToLinear();
      // subtle per-vertex variation for organic look
      const noise = 0.92 + ((Math.sin(c * 12.9 + r * 78.2) * 0.5 + 0.5) * 0.16);
      rr += tmp.r * noise; gg += tmp.g * noise; bb += tmp.b * noise; n++;
    }
    if (n > 0) out.setRGB(rr / n, gg / n, bb / n);
    else out.setHex(0x808080);
  }

  buildTerrain(map: GameMap) {
    this.tileGroup.clear();
    this.decoGroup.clear();

    const cols = map.cols, rows = map.rows;
    const W = cols * TILE_SIZE, D = rows * TILE_SIZE;

    this.hfCols = cols; this.hfRows = rows;
    this.heightField = new Float32Array((cols + 1) * (rows + 1));

    const geo = new THREE.PlaneGeometry(W, D, cols, rows);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const tmpCol = new THREE.Color();

    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= cols; i++) {
        const vi = j * (cols + 1) + i;
        const h = this.cornerHeight(map, i, j);
        this.heightField[vi] = h;
        pos.setY(vi, h);
        this.cornerColor(map, i, j, tmpCol);
        colors[vi * 3]     = tmpCol.r;
        colors[vi * 3 + 1] = tmpCol.g;
        colors[vi * 3 + 2] = tmpCol.b;
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    // Scale UVs so the detail texture repeats across the terrain (fine grain)
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) {
      uv.setXY(k, uv.getX(k) * cols * 0.7, uv.getY(k) * rows * 0.7);
    }
    geo.computeVertexNormals();

    const detailTex = this.makeGroundTexture();
    const terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: detailTex,
      roughness: 0.98,
      metalness: 0.0,
      flatShading: false,
    });
    this.terrainMesh = new THREE.Mesh(geo, terrainMat);
    this.terrainMesh.position.set(W / 2 - TILE_SIZE / 2, 0, D / 2 - TILE_SIZE / 2);
    this.terrainMesh.receiveShadow = true;
    this.terrainMesh.castShadow = false; // avoids slope self-shadow acne; mountains still receive
    this.tileGroup.add(this.terrainMesh);

    this.buildWater(W, D);
    this.scatterVegetation(map);
  }

  // ── Procedural grayscale detail texture (modulates vertex colors) ───────────
  private makeGroundTexture(): THREE.Texture {
    const S = 256;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d')!;
    // Base mid-tone so it multiplies the vertex color without shifting hue much
    ctx.fillStyle = '#b8b8b8';
    ctx.fillRect(0, 0, S, S);
    // Mottled clumps (darker + lighter) for organic variation
    for (let i = 0; i < 1600; i++) {
      const x = Math.random() * S, y = Math.random() * S;
      const r = 2 + Math.random() * 9;
      const v = 130 + Math.floor(Math.random() * 110); // 130..240 grey
      ctx.fillStyle = `rgba(${v},${v},${v},0.5)`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    // Fine grass-blade strokes for texture
    for (let i = 0; i < 2600; i++) {
      const x = Math.random() * S, y = Math.random() * S;
      const len = 2 + Math.random() * 4;
      const v = Math.random() < 0.5 ? 95 + Math.random() * 40 : 200 + Math.random() * 50;
      ctx.strokeStyle = `rgba(${v},${v},${v},0.35)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (Math.random() - 0.5) * 2, y - len);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // ── Animated water surface ───────────────────────────────────────────────────
  private buildWater(W: number, D: number) {
    // Dark sea floor so transparent water reads as depth
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(W * 1.4, D * 1.4),
      new THREE.MeshStandardMaterial({ color: 0x123347, roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(W / 2 - TILE_SIZE / 2, -1.2, D / 2 - TILE_SIZE / 2);
    floor.receiveShadow = true;
    this.tileGroup.add(floor);

    const waterGeo = new THREE.PlaneGeometry(W * 1.4, D * 1.4, 80, 80);
    this.waterMat = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        time:       { value: 0 },
        shallow:    { value: new THREE.Color(0x3f8fb0) },
        deep:       { value: new THREE.Color(0x123f63) },
        sunDir:     { value: this.sunDir.clone() },
      },
      vertexShader: /* glsl */`
        uniform float time;
        varying float vWave;
        varying vec3  vWorld;
        void main() {
          vec3 p = position;
          float w = sin(p.x * 0.25 + time * 1.3) * 0.10
                  + cos(p.y * 0.31 - time * 1.1) * 0.10
                  + sin((p.x + p.y) * 0.15 + time * 0.7) * 0.06;
          p.z += w;
          vWave = w;
          vec4 wp = modelMatrix * vec4(p, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */`
        uniform vec3 shallow; uniform vec3 deep; uniform vec3 sunDir; uniform float time;
        varying float vWave; varying vec3 vWorld;
        void main() {
          vec3 col = mix(deep, shallow, clamp(vWave * 3.0 + 0.5, 0.0, 1.0));
          // sparkle highlights along wave crests
          float spec = pow(clamp(vWave * 4.0, 0.0, 1.0), 3.0);
          col += spec * 0.5;
          // faint moving glints
          float g = sin(vWorld.x * 2.0 + time * 3.0) * sin(vWorld.z * 2.0 - time * 2.0);
          col += smoothstep(0.85, 1.0, g) * 0.25;
          gl_FragColor = vec4(col, 0.86);
        }
      `,
    });
    const water = new THREE.Mesh(waterGeo, this.waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(W / 2 - TILE_SIZE / 2, WATER_LEVEL, D / 2 - TILE_SIZE / 2);
    this.tileGroup.add(water);
  }

  // ── Instanced vegetation & rocks for richness ───────────────────────────────
  private scatterVegetation(map: GameMap) {
    type Spot = { x: number; z: number; y: number; s: number };
    const trees: Spot[] = [];
    const palms: Spot[] = [];
    const rocks: Spot[] = [];
    const cacti: Spot[] = [];

    const rand = (() => { let s = 1337; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();

    for (let r = 0; r < map.rows; r++) {
      for (let c = 0; c < map.cols; c++) {
        const tile = map.getTile(c, r)!;
        const x = c * TILE_SIZE + (rand() - 0.5) * TILE_SIZE * 0.7;
        const z = r * TILE_SIZE + (rand() - 0.5) * TILE_SIZE * 0.7;
        const y = this.getHeightAt(x, z);
        const s = 0.7 + rand() * 0.7;
        switch (tile.terrain) {
          case TerrainType.JUNGLE:
            if (rand() < 0.55) trees.push({ x, z, y, s: s * 1.15 });
            break;
          case TerrainType.GRASS:
            if (rand() < 0.10) trees.push({ x, z, y, s });
            break;
          case TerrainType.BEACH:
            if (rand() < 0.10) palms.push({ x, z, y, s });
            break;
          case TerrainType.DESERT:
            if (rand() < 0.10) cacti.push({ x, z, y, s });
            break;
          case TerrainType.MOUNTAIN:
            if (rand() < 0.22) rocks.push({ x, z, y, s: s * 1.4 });
            break;
          case TerrainType.HIGHLAND:
            if (rand() < 0.08) rocks.push({ x, z, y, s });
            break;
        }
      }
    }

    this.addTrees(trees, 0x2f5e22, 0x6a4a2a);
    this.addPalms(palms);
    this.addCacti(cacti);
    this.addRocks(rocks);
  }

  private addTrees(spots: { x: number; z: number; y: number; s: number }[], leaf: number, bark: number) {
    if (spots.length === 0) return;
    const trunkGeo = new THREE.CylinderGeometry(0.08, 0.13, 0.9, 5);
    const leafGeo  = new THREE.IcosahedronGeometry(0.55, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: bark, roughness: 1 });
    const leafMat  = new THREE.MeshStandardMaterial({ color: leaf, roughness: 0.9, flatShading: true });

    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
    const crowns = new THREE.InstancedMesh(leafGeo, leafMat, spots.length);
    trunks.castShadow = crowns.castShadow = true;
    crowns.receiveShadow = true;
    trunks.frustumCulled = crowns.frustumCulled = false;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    spots.forEach((p, idx) => {
      const s = p.s;
      m.compose(new THREE.Vector3(p.x, p.y + 0.45 * s, p.z), q, sc.set(s, s, s));
      trunks.setMatrixAt(idx, m);
      m.compose(new THREE.Vector3(p.x, p.y + 1.05 * s, p.z), q, sc.set(s, s * 1.2, s));
      crowns.setMatrixAt(idx, m);
    });
    this.decoGroup.add(trunks, crowns);
  }

  private addPalms(spots: { x: number; z: number; y: number; s: number }[]) {
    if (spots.length === 0) return;
    const trunkGeo = new THREE.CylinderGeometry(0.06, 0.1, 1.4, 5);
    const frondGeo = new THREE.ConeGeometry(0.6, 0.35, 5, 1, true);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 1 });
    const frondMat = new THREE.MeshStandardMaterial({ color: 0x3c8a3a, roughness: 0.9, side: THREE.DoubleSide, flatShading: true });

    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
    const fronds = new THREE.InstancedMesh(frondGeo, frondMat, spots.length);
    trunks.castShadow = fronds.castShadow = true;
    trunks.frustumCulled = fronds.frustumCulled = false;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    spots.forEach((p, idx) => {
      const s = p.s;
      q.setFromEuler(new THREE.Euler(0, idx * 1.3, 0.12));
      m.compose(new THREE.Vector3(p.x, p.y + 0.7 * s, p.z), q, sc.set(s, s, s));
      trunks.setMatrixAt(idx, m);
      q.identity();
      m.compose(new THREE.Vector3(p.x, p.y + 1.45 * s, p.z), q, sc.set(s, s, s));
      fronds.setMatrixAt(idx, m);
    });
    this.decoGroup.add(trunks, fronds);
  }

  private addCacti(spots: { x: number; z: number; y: number; s: number }[]) {
    if (spots.length === 0) return;
    const geo = new THREE.CapsuleGeometry(0.14, 0.7, 3, 6);
    const mat = new THREE.MeshStandardMaterial({ color: 0x4a7a3a, roughness: 0.85 });
    const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    const m = new THREE.Matrix4(); const q = new THREE.Quaternion(); const sc = new THREE.Vector3();
    spots.forEach((p, idx) => {
      m.compose(new THREE.Vector3(p.x, p.y + 0.5 * p.s, p.z), q, sc.set(p.s, p.s, p.s));
      mesh.setMatrixAt(idx, m);
    });
    this.decoGroup.add(mesh);
  }

  private addRocks(spots: { x: number; z: number; y: number; s: number }[]) {
    if (spots.length === 0) return;
    const geo = new THREE.DodecahedronGeometry(0.4, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x6f6a6a, roughness: 1, flatShading: true });
    const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    const m = new THREE.Matrix4(); const sc = new THREE.Vector3();
    spots.forEach((p, idx) => {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(idx, idx * 1.7, idx * 0.4));
      m.compose(new THREE.Vector3(p.x, p.y + 0.2 * p.s, p.z), q, sc.set(p.s, p.s * 0.8, p.s));
      mesh.setMatrixAt(idx, m);
    });
    this.decoGroup.add(mesh);
  }

  // ── Height sampling (bilinear over the corner height field) ──────────────────
  getHeightAt(worldX: number, worldZ: number): number {
    if (this.heightField.length === 0) return 0;
    // tile center (c,r) maps to corner coord (c+0.5, r+0.5)
    const fx = THREE.MathUtils.clamp(worldX / TILE_SIZE + 0.5, 0, this.hfCols);
    const fz = THREE.MathUtils.clamp(worldZ / TILE_SIZE + 0.5, 0, this.hfRows);
    const i0 = Math.floor(fx), j0 = Math.floor(fz);
    const i1 = Math.min(i0 + 1, this.hfCols), j1 = Math.min(j0 + 1, this.hfRows);
    const tx = fx - i0, tz = fz - j0;
    const stride = this.hfCols + 1;
    const h00 = this.heightField[j0 * stride + i0];
    const h10 = this.heightField[j0 * stride + i1];
    const h01 = this.heightField[j1 * stride + i0];
    const h11 = this.heightField[j1 * stride + i1];
    const a = h00 * (1 - tx) + h10 * tx;
    const b = h01 * (1 - tx) + h11 * tx;
    return a * (1 - tz) + b * tz;
  }

  addUnit(unit: Unit) {
    unit.mesh.position.y = this.getHeightAt(unit.worldX, unit.worldZ);
    this.unitGroup.add(unit.mesh);
  }

  removeUnit(unit: Unit) {
    this.unitGroup.remove(unit.mesh);
  }

  addBuilding(building: any) {
    building.mesh.position.y = this.getHeightAt(building.col * TILE_SIZE, building.row * TILE_SIZE);
    this.unitGroup.add(building.mesh);
  }

  addWorker(worker: any) {
    worker.mesh.position.y = this.getHeightAt(worker.worldX, worker.worldZ);
    this.unitGroup.add(worker.mesh);
  }

  addResourceNode(node: any) {
    node.mesh.position.y = this.getHeightAt(node.col * TILE_SIZE, node.row * TILE_SIZE) + (node.baseY ?? 0);
    this.unitGroup.add(node.mesh);
  }

  /** Sit moving entities on the terrain surface each frame. */
  syncHeights(units: { worldX: number; worldZ: number; mesh: THREE.Group; isAlive?: () => boolean }[],
              workers: { worldX: number; worldZ: number; mesh: THREE.Group }[]) {
    for (const u of units) {
      if (u.isAlive && !u.isAlive()) continue;
      u.mesh.position.y = this.getHeightAt(u.worldX, u.worldZ);
    }
    for (const w of workers) {
      w.mesh.position.y = this.getHeightAt(w.worldX, w.worldZ);
    }
  }

  updateEffects(dt: number) {
    this.effects.update(dt);
    if (this.waterMat) this.waterMat.uniforms.time.value += dt;
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

    // Then terrain — convert hit point back to grid coords
    if (this.terrainMesh) {
      const tileHits = this.raycaster.intersectObject(this.terrainMesh, false);
      if (tileHits.length > 0) {
        const p = tileHits[0].point;
        const col = Math.round(p.x / TILE_SIZE);
        const row = Math.round(p.z / TILE_SIZE);
        return { type: 'tile', col, row };
      }
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
