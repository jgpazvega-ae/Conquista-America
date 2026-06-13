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
import type { FogOfWarManager } from '../game/FogOfWar';
import { TileVisibility } from '../game/FogOfWar';

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

  // Day/night cycle — references kept for runtime updates
  private _ambientLight: THREE.AmbientLight | null = null;
  private _sunLight:     THREE.DirectionalLight | null = null;
  private _hemiLight:    THREE.HemisphereLight | null = null;
  private _fillLight:    THREE.DirectionalLight | null = null;

  // Height field for placing entities on the terrain surface
  private heightField: Float32Array = new Float32Array(0);
  private hfCols = 0; // = map.cols
  private hfRows = 0; // = map.rows
  private clock  = new THREE.Clock();

  // For click picking
  readonly raycaster = new THREE.Raycaster();
  readonly mouse     = new THREE.Vector2();

  // ── Fog of war overlay ──────────────────────────────────────────────────────
  private fogCanvas:  HTMLCanvasElement | null = null;
  private fogTexture: THREE.CanvasTexture | null = null;
  private fogImgData: ImageData | null = null;
  private fogCols = 0; private fogRows = 0;
  private fogFrameSkip = 0;

  // ── Markers ────────────────────────────────────────────────────────────────
  private moveMarkers: { mesh: THREE.Mesh; age: number }[] = [];
  private objMarkers:  { group: THREE.Group; phase: number }[] = [];

  // ── Ghost building preview ─────────────────────────────────────────────────
  private _ghostMesh: THREE.Group | null = null;
  private _ghostMat: THREE.MeshStandardMaterial | null = null;

  // ── Unit path visualization ────────────────────────────────────────────────
  private _pathDots: THREE.Mesh[] = [];

  // ── Rally point marker ─────────────────────────────────────────────────────
  private _rallyMarker: THREE.Group | null = null;
  private _rallyPhase  = 0;

  // ── Attack range ring for selected unit ────────────────────────────────────
  private _rangeRing: THREE.Mesh | null = null;

  // ── Patrol path line ────────────────────────────────────────────────────────
  private _patrolLine: THREE.Line | null = null;

  // ── Rain effect ────────────────────────────────────────────────────────────
  private _rainSystem: THREE.Points | null = null;
  private _rainPositions: Float32Array | null = null;
  private _rainActive = false;
  private static readonly RAIN_COUNT = 1200;

  private readonly _isMobile: boolean;

  constructor(canvas: HTMLCanvasElement) {
    const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
                     navigator.maxTouchPoints > 1;
    this._isMobile = isMobile;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !isMobile,      // antialias causes context loss on mobile
      powerPreference: 'default', // 'high-performance' → black screen on iOS Safari
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = !isMobile; // shadow maps exhaust mobile VRAM
    this.renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace  = THREE.SRGBColorSpace;
    // ACES filmic shaders fail to compile on older mobile GPUs → Reinhard fallback
    this.renderer.toneMapping = isMobile ? THREE.ReinhardToneMapping : THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    // Handle WebGL context loss on iOS (triggered by memory pressure)
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); }, false);
    canvas.addEventListener('webglcontextrestored', () => { this.onResize(); }, false);

    this.scene  = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 600);
    this.effects = new EffectManager(this.scene);

    this.setupScene();

    window.addEventListener('resize', this.onResize.bind(this));
  }

  private setupScene() {
    // Default sky color so WebGL clear shows blue instead of black on mobile
    // (setDayNight() overwrites this later, but may not run before first frame)
    this.scene.background = new THREE.Color(0x84b4dc);

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
        precision highp float;
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        precision highp float;
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
    this._ambientLight = ambient;

    const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x4a4030, 0.65);
    this.scene.add(hemi);
    this._hemiLight = hemi;

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
    this._sunLight = sun;

    // Cool rim/fill from opposite side to sculpt silhouettes
    const fill = new THREE.DirectionalLight(0x9fc0ff, 0.45);
    fill.position.set(-60, 40, -50);
    this.scene.add(fill);
    this._fillLight = fill;

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
    this.buildFogPlane(map, W, D);
  }

  private buildFogPlane(map: GameMap, W: number, D: number) {
    this.fogCols = map.cols;
    this.fogRows = map.rows;
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width  = map.cols;
    this.fogCanvas.height = map.rows;
    const ctx = this.fogCanvas.getContext('2d')!;
    // Start fully dark (all unexplored)
    ctx.fillStyle = 'rgba(0,0,0,1)';
    ctx.fillRect(0, 0, map.cols, map.rows);
    this.fogImgData = ctx.createImageData(map.cols, map.rows);
    this.fogTexture = new THREE.CanvasTexture(this.fogCanvas);
    this.fogTexture.magFilter = THREE.LinearFilter;
    this.fogTexture.minFilter = THREE.LinearFilter;

    const fogGeo = new THREE.PlaneGeometry(W, D);
    fogGeo.rotateX(-Math.PI / 2);
    const fogMat = new THREE.MeshBasicMaterial({
      map: this.fogTexture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    const fogMesh = new THREE.Mesh(fogGeo, fogMat);
    fogMesh.position.set(W / 2 - TILE_SIZE / 2, 15, D / 2 - TILE_SIZE / 2);
    fogMesh.renderOrder = 5;
    this.scene.add(fogMesh);
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

    const waterSubdiv = this._isMobile ? 32 : 80;
    const waterGeo = new THREE.PlaneGeometry(W * 1.4, D * 1.4, waterSubdiv, waterSubdiv);
    this.waterMat = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        time:       { value: 0 },
        shallow:    { value: new THREE.Color(0x3f8fb0) },
        deep:       { value: new THREE.Color(0x123f63) },
        sunDir:     { value: this.sunDir.clone() },
      },
      vertexShader: /* glsl */`
        precision highp float;
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
        precision highp float;
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

  // ── Move order marker — pulsing green ring that fades in ~1.6 s ─────────────
  showMoveMarker(worldX: number, worldZ: number) {
    const y = this.getHeightAt(worldX, worldZ) + 0.12;
    const mat = new THREE.MeshBasicMaterial({
      color: 0x44ff88, transparent: true, opacity: 0.90,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.48, 24), mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(worldX, y, worldZ);
    ring.renderOrder = 5;
    this.scene.add(ring);
    // Inner bright dot
    const dotMat = new THREE.MeshBasicMaterial({ color: 0xaaffcc, transparent: true, opacity: 0.80, depthWrite: false });
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.14, 12), dotMat);
    dot.rotation.x = -Math.PI / 2;
    dot.position.set(worldX, y + 0.01, worldZ);
    dot.renderOrder = 5;
    this.scene.add(dot);
    // Store both; share same age via userData
    (ring as any)._dot = dot;
    this.moveMarkers.push({ mesh: ring, age: 0 });
  }

  // ── Enemy base objective marker — red chevron + exclamation floating above ──
  addObjectiveMarker(worldX: number, worldZ: number) {
    const baseY = this.getHeightAt(worldX, worldZ) + 5.5;
    const group = new THREE.Group();
    group.position.set(worldX, baseY, worldZ);
    group.userData.baseY = baseY;

    // Downward-pointing arrow (cone)
    const arrowMat = new THREE.MeshBasicMaterial({ color: 0xff3333, transparent: true, opacity: 0.92, depthWrite: false });
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.5, 6), arrowMat);
    cone.rotation.x = Math.PI;   // tip points down
    cone.position.y = -0.2;
    group.add(cone);

    // Pulsing ring beneath the arrow
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xff4444, transparent: true, opacity: 0.78, side: THREE.DoubleSide, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.65, 0.95, 24), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -1.2;
    group.add(ring);

    // Exclamation shaft
    const exMat = new THREE.MeshBasicMaterial({ color: 0xffee22, transparent: true, opacity: 0.95, depthWrite: false });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.80, 6), exMat);
    shaft.position.y = 1.30;
    group.add(shaft);
    const exDot = new THREE.Mesh(new THREE.SphereGeometry(0.18, 7, 5), exMat);
    exDot.position.y = 0.72;
    group.add(exDot);

    group.renderOrder = 8;
    this.scene.add(group);
    this.objMarkers.push({ group, phase: Math.random() * Math.PI * 2 });
  }

  private updateMarkers(dt: number) {
    const MAX_AGE = 1.6;
    // Move markers
    for (let i = this.moveMarkers.length - 1; i >= 0; i--) {
      const m = this.moveMarkers[i];
      m.age += dt;
      const t    = m.age / MAX_AGE;
      const fade = 1 - t;
      const scale = 1 + Math.sin(t * Math.PI * 5) * 0.18;
      m.mesh.scale.set(scale, scale, scale);
      (m.mesh.material as THREE.MeshBasicMaterial).opacity = fade * 0.90;
      const dot: THREE.Mesh | undefined = (m.mesh as any)._dot;
      if (dot) {
        dot.scale.set(scale, scale, scale);
        (dot.material as THREE.MeshBasicMaterial).opacity = fade * 0.80;
      }
      if (m.age >= MAX_AGE) {
        this.scene.remove(m.mesh);
        m.mesh.geometry.dispose();
        (m.mesh.material as THREE.MeshBasicMaterial).dispose();
        if (dot) { this.scene.remove(dot); dot.geometry.dispose(); (dot.material as THREE.MeshBasicMaterial).dispose(); }
        this.moveMarkers.splice(i, 1);
      }
    }
    // Objective markers — gentle bob + ring pulse
    for (const m of this.objMarkers) {
      m.phase += dt * 1.8;
      m.group.position.y = m.group.userData.baseY + Math.sin(m.phase) * 0.45;
      // Pulse ring scale
      const ring = m.group.children[1] as THREE.Mesh;
      const ps = 1 + Math.sin(m.phase * 2) * 0.12;
      ring.scale.set(ps, ps, ps);
    }
  }

  updateFog(fog: FogOfWarManager, humanPlayerId: number) {
    this.fogFrameSkip++;
    if (this.fogFrameSkip < 2) return; // update every 2 frames
    this.fogFrameSkip = 0;

    if (!this.fogCanvas || !this.fogTexture || !this.fogImgData) return;
    const humanFog = fog.getFog(humanPlayerId);
    if (!humanFog) return;

    const data = this.fogImgData.data;
    for (let r = 0; r < this.fogRows; r++) {
      for (let c = 0; c < this.fogCols; c++) {
        const idx = (r * this.fogCols + c) * 4;
        const vis = humanFog.getVisibility(c, r);
        data[idx]   = 0;
        data[idx+1] = 0;
        data[idx+2] = 0;
        data[idx+3] = vis === TileVisibility.VISIBLE    ? 0   :
                      vis === TileVisibility.FOGGED      ? 120 :
                                                           210;
      }
    }
    const ctx = this.fogCanvas.getContext('2d')!;
    ctx.putImageData(this.fogImgData, 0, 0);
    this.fogTexture.needsUpdate = true;
  }

  /** Place a pulsing flag at the rally point grid position. Replaces any existing rally marker. */
  setRallyMarker(col: number, row: number) {
    this.clearRallyMarker();
    const wx = col * TILE_SIZE + TILE_SIZE / 2;
    const wz = row * TILE_SIZE + TILE_SIZE / 2;
    const y  = this.getHeightAt(wx, wz);
    const group = new THREE.Group();
    group.position.set(wx, y, wz);
    group.userData.baseY = y;

    // Flagpole
    const poleMat = new THREE.MeshBasicMaterial({ color: 0xddddcc });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6), poleMat);
    pole.position.y = 1.1;
    group.add(pole);

    // Flag (flat box)
    const flagMat = new THREE.MeshBasicMaterial({ color: 0x44ccff, transparent: true, opacity: 0.92, side: THREE.DoubleSide });
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.45), flagMat);
    flag.position.set(0.4, 2.15, 0);
    flag.rotation.y = Math.PI / 2;
    group.add(flag);

    // Ground ring
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x44ccff, transparent: true, opacity: 0.65, side: THREE.DoubleSide, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.55, 20), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    ring.renderOrder = 4;
    group.add(ring);

    group.renderOrder = 6;
    this.scene.add(group);
    this._rallyMarker = group;
    this._rallyPhase  = 0;
  }

  clearRallyMarker() {
    if (this._rallyMarker) {
      this.scene.remove(this._rallyMarker);
      this._rallyMarker = null;
    }
  }

  /** Show a dashed range ring around a world position. radius in world units. */
  showRangeRing(worldX: number, worldZ: number, radius: number, color = 0x88ddff) {
    this.clearRangeRing();
    const y = this.getHeightAt(worldX, worldZ) + 0.08;
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.40,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.12, radius + 0.12, 48), mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(worldX, y, worldZ);
    ring.renderOrder = 4;
    this.scene.add(ring);
    this._rangeRing = ring;
  }

  clearRangeRing() {
    if (this._rangeRing) {
      this.scene.remove(this._rangeRing);
      (this._rangeRing.material as THREE.Material).dispose();
      this._rangeRing = null;
    }
  }

  showPatrolPath(ax: number, az: number, bx: number, bz: number) {
    this.clearPatrolPath();
    const ya = this.getHeightAt(ax, az) + 0.12;
    const yb = this.getHeightAt(bx, bz) + 0.12;
    const points = [new THREE.Vector3(ax, ya, az), new THREE.Vector3(bx, yb, bz)];
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color: 0x00ddff, transparent: true, opacity: 0.55, depthWrite: false });
    this._patrolLine = new THREE.Line(geo, mat);
    this._patrolLine.renderOrder = 5;
    this.scene.add(this._patrolLine);
    // Endpoint markers
    for (const [wx, wz, y] of [[ax, az, ya], [bx, bz, yb]] as [number, number, number][]) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.18, 0.30, 20),
        new THREE.MeshBasicMaterial({ color: 0x00ddff, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(wx, y, wz);
      ring.renderOrder = 5;
      this._patrolLine.add(ring);
    }
  }

  clearPatrolPath() {
    if (this._patrolLine) {
      this.scene.remove(this._patrolLine);
      this._patrolLine.traverse(c => {
        if (c instanceof THREE.Mesh || c instanceof THREE.Line) {
          c.geometry.dispose();
          (c.material as THREE.Material).dispose();
        }
      });
      this._patrolLine = null;
    }
  }

  updateEffects(dt: number) {
    this.effects.update(dt);
    if (this.waterMat) this.waterMat.uniforms.time.value += dt;
    this.updateMarkers(dt);
    this.updateRain(dt);
    // Animate rally marker: gentle bob + ring pulse
    if (this._rallyMarker) {
      this._rallyPhase += dt * 2.2;
      this._rallyMarker.position.y = this._rallyMarker.userData.baseY + Math.sin(this._rallyPhase) * 0.12;
      const ring = this._rallyMarker.children[2] as THREE.Mesh;
      const ps = 1 + Math.sin(this._rallyPhase * 1.5) * 0.15;
      ring.scale.set(ps, ps, ps);
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.5 + Math.sin(this._rallyPhase) * 0.2;
    }
  }

  /**
   * Update scene lighting for time-of-day.
   * @param t Normalised time: 0 = midnight, 0.25 = dawn, 0.5 = noon, 0.75 = dusk
   */
  setDayNight(t: number) {
    if (!this._ambientLight || !this._sunLight || !this._hemiLight || !this._fillLight) return;

    // sun elevation: rises at t=0.25, peaks t=0.5, sets t=0.75
    const sunElevation = Math.sin((t - 0.25) * Math.PI * 2); // -1..1, positive during day

    // Daytime fraction for interpolation
    const dayFraction = THREE.MathUtils.clamp((sunElevation + 0.1) / 1.1, 0, 1);

    // Ambient: bright white at noon, deep blue at midnight
    const ambIntensity = 0.12 + dayFraction * 0.38;
    this._ambientLight.intensity = ambIntensity;

    // Sun: warm at dawn/dusk, white at noon, off at night
    const sunIntensity = Math.max(0, sunElevation) * 2.4;
    this._sunLight.intensity = sunIntensity;
    // Colour: orange at dawn/dusk, white at noon
    const warmth = 1 - Math.abs(sunElevation - 0.5) * 0.8; // 0 at rise/set, 1 at noon
    this._sunLight.color.setRGB(1.0, 0.85 + warmth * 0.15, 0.65 + warmth * 0.35);

    // Sun position arc: rises east (−x), peaks above, sets west (+x)
    const sunAngle = (t - 0.25) * Math.PI * 2;
    this._sunLight.position.set(
      Math.sin(sunAngle) * 100,
      Math.cos(sunAngle) * 80 + 20,
      40,
    );
    this._sunLight.target.position.set(0, 0, 0);

    // Hemisphere: sky blue during day, deep violet at night
    const skyR = 0.55 + dayFraction * 0.20;
    const skyG = 0.65 + dayFraction * 0.20;
    const skyB = 0.80 + dayFraction * 0.20;
    this._hemiLight.color.setRGB(skyR, skyG, skyB);
    this._hemiLight.groundColor.setRGB(0.18 + dayFraction * 0.11, 0.15 + dayFraction * 0.10, 0.09 + dayFraction * 0.06);
    this._hemiLight.intensity = 0.25 + dayFraction * 0.55;

    // Fill: only noticeable at night as cool moonlight
    this._fillLight.intensity = THREE.MathUtils.clamp(0.35 - dayFraction * 0.28, 0.07, 0.35);

    // Background sky colour
    const bgR = 0.04 + dayFraction * 0.35;
    const bgG = 0.05 + dayFraction * 0.45;
    const bgB = 0.12 + dayFraction * 0.50;
    this.scene.background = new THREE.Color(bgR, bgG, bgB);
  }

  /** Start rain particles. Call stopRain() to end. */
  startRain() {
    if (this._rainSystem) return;
    const N = Renderer.RAIN_COUNT;
    const positions = new Float32Array(N * 3);
    const SPREAD = 80;
    for (let i = 0; i < N; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * SPREAD;
      positions[i * 3 + 1] = Math.random() * 30 + 5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * SPREAD;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x99ccff, size: 0.09, transparent: true, opacity: 0.45,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this._rainSystem = new THREE.Points(geo, mat);
    this._rainSystem.renderOrder = 10;
    this._rainPositions = positions;
    this.scene.add(this._rainSystem);
    this._rainActive = true;
  }

  stopRain() {
    if (!this._rainSystem) return;
    this.scene.remove(this._rainSystem);
    (this._rainSystem.geometry as THREE.BufferGeometry).dispose();
    (this._rainSystem.material as THREE.Material).dispose();
    this._rainSystem = null;
    this._rainPositions = null;
    this._rainActive = false;
  }

  private updateRain(dt: number) {
    if (!this._rainActive || !this._rainSystem || !this._rainPositions) return;
    const N = Renderer.RAIN_COUNT;
    const fallSpeed = 18 * dt;
    const drift = 2 * dt;
    const SPREAD = 80;
    // Follow camera roughly
    const camX = this.camera.position.x;
    const camZ = this.camera.position.z;
    for (let i = 0; i < N; i++) {
      this._rainPositions[i * 3 + 1] -= fallSpeed;
      this._rainPositions[i * 3]     -= drift;
      if (this._rainPositions[i * 3 + 1] < 0) {
        this._rainPositions[i * 3]     = camX + (Math.random() - 0.5) * SPREAD;
        this._rainPositions[i * 3 + 1] = 28 + Math.random() * 8;
        this._rainPositions[i * 3 + 2] = camZ + (Math.random() - 0.5) * SPREAD;
      }
    }
    (this._rainSystem.geometry as THREE.BufferGeometry)
      .attributes.position.needsUpdate = true;
  }

  get isRaining() { return this._rainActive; }

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

  /** Returns the closest unit, building, or terrain tile hit by a screen-space ray. */
  pickFromScreen(screenX: number, screenY: number):
    | { type: 'tile';     col: number; row: number }
    | { type: 'unit';     unitId: number }
    | { type: 'building'; buildingId: number }
    | null
  {
    this.mouse.x =  (screenX / window.innerWidth)  * 2 - 1;
    this.mouse.y = -(screenY / window.innerHeight) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const hits = this.raycaster.intersectObjects(this.unitGroup.children, true);
    for (const hit of hits) {
      let obj: THREE.Object3D | null = hit.object;
      while (obj) {
        if (obj.userData.unitId     !== undefined) return { type: 'unit',     unitId:     obj.userData.unitId };
        if (obj.userData.buildingId !== undefined) return { type: 'building', buildingId: obj.userData.buildingId };
        obj = obj.parent;
      }
    }

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

  showGhost(color: number) {
    this.hideGhost();
    const group = new THREE.Group();
    const geo = new THREE.BoxGeometry(1.8, 2, 1.8);
    const mat = new THREE.MeshStandardMaterial({
      color,
      opacity: 0.35,
      transparent: true,
      depthWrite: false,
    });
    group.add(new THREE.Mesh(geo, mat));
    this.scene.add(group);
    this._ghostMesh = group;
    this._ghostMat  = mat;
  }

  updateGhostAt(col: number, row: number, valid = true) {
    if (!this._ghostMesh) return;
    this._ghostMesh.position.set(col * TILE_SIZE, 1, row * TILE_SIZE);
    if (this._ghostMat) {
      this._ghostMat.color.setHex(valid ? 0x44dd88 : 0xdd3333);
      this._ghostMat.opacity = valid ? 0.38 : 0.45;
    }
  }

  hideGhost() {
    if (!this._ghostMesh) return;
    this.scene.remove(this._ghostMesh);
    this._ghostMesh = null;
    this._ghostMat  = null;
  }

  showUnitPath(path: import('../game/types').GridPos[], fromIndex = 0) {
    this.clearUnitPath();
    const geo = new THREE.CircleGeometry(0.18, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x44aaff, transparent: true, opacity: 0.65, depthTest: false,
    });
    const step = Math.max(1, Math.ceil((path.length - fromIndex) / 24)); // max 24 dots
    for (let i = fromIndex; i < path.length; i += step) {
      const dot = new THREE.Mesh(geo, mat);
      dot.rotation.x = -Math.PI / 2;
      dot.position.set(path[i].col * TILE_SIZE, 0.06, path[i].row * TILE_SIZE);
      dot.renderOrder = 5;
      this.scene.add(dot);
      this._pathDots.push(dot);
    }
  }

  clearUnitPath() {
    for (const dot of this._pathDots) this.scene.remove(dot);
    this._pathDots = [];
  }
}
