export const MAP_COLS = 60;
export const MAP_ROWS = 72;
export const TILE_SIZE = 2;
export const TILE_GAP = 0.05;

// ── Relieve del terreno (malla continua suavizada) ─────────────────────────────
export const SEA_LEVEL_ELEV = 0.18;  // umbral de elevación para agua (coincide con Map.ts)
export const HEIGHT_SCALE   = 7.0;   // escala vertical: cuánto se elevan montañas/colinas
export const WATER_LEVEL    = 0.12;  // altura del plano de agua animada

// Altura base relativa por tipo de terreno (para vegetación / referencia)
export const TERRAIN_HEIGHTS: Record<string, number> = {
  WATER:    0.0,
  BEACH:    0.3,
  GRASS:    0.9,
  JUNGLE:   1.1,
  DESERT:   0.8,
  HIGHLAND: 2.8,
  MOUNTAIN: 5.0,
  SNOW:     6.5,
};

// Paleta natural — colores más ricos y orgánicos (no caricaturescos)
export const TERRAIN_COLORS: Record<string, number> = {
  WATER:    0x2a6f97,
  BEACH:    0xe6d2a0,
  GRASS:    0x5d9b3e,
  JUNGLE:   0x2f6d28,
  DESERT:   0xd8b066,
  HIGHLAND: 0x7d9450,
  MOUNTAIN: 0x877b6b,
  SNOW:     0xf2f4f8,
};

export const TERRAIN_WALKABLE: Record<string, boolean> = {
  WATER:    false,
  BEACH:    true,
  GRASS:    true,
  JUNGLE:   true,
  DESERT:   true,
  HIGHLAND: true,
  MOUNTAIN: false,
  SNOW:     false,
};

export const CIV_COLORS: Record<string, number> = {
  AZTEC:        0x2ecc8a,
  INCA:         0xe8c020,
  MAYA:         0x30c060,
  CONQUISTADOR: 0xe03030,
};

export const CIV_NAMES: Record<string, string> = {
  AZTEC:        'Imperio Azteca',
  INCA:         'Tawantinsuyu (Incas)',
  MAYA:         'Ciudades-Estado Mayas',
  CONQUISTADOR: 'Conquistadores',
};

export const CIV_EMOJIS: Record<string, string> = {
  AZTEC:        '🦅',
  INCA:         '🌄',
  MAYA:         '🌿',
  CONQUISTADOR: '⚔️',
};

export const STARTING_RESOURCES = {
  food:  400,
  gold:  200,
  stone: 250,
};

export const CAMERA_PAN_SPEED = 24;
export const CAMERA_ZOOM_MIN  = 8;
export const CAMERA_ZOOM_MAX  = 60;
export const CAMERA_TILT_DEG  = 55;
