export const MAP_COLS = 60;
export const MAP_ROWS = 72;
export const TILE_SIZE = 2;
export const TILE_GAP = 0.05;

export const TERRAIN_HEIGHTS: Record<string, number> = {
  WATER:    0.05,
  BEACH:    0.15,
  GRASS:    0.25,
  JUNGLE:   0.30,
  DESERT:   0.25,
  HIGHLAND: 0.50,
  MOUNTAIN: 1.10,
  SNOW:     1.40,
};

export const TERRAIN_COLORS: Record<string, number> = {
  WATER:    0x1a5f8a,
  BEACH:    0xd4b878,
  GRASS:    0x3a8c2a,
  JUNGLE:   0x1a5c14,
  DESERT:   0xc8954a,
  HIGHLAND: 0x6a8c4a,
  MOUNTAIN: 0x7a6c54,
  SNOW:     0xe8e8ee,
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
  food:  200,
  gold:  100,
  stone: 150,
};

export const CAMERA_PAN_SPEED = 24;
export const CAMERA_ZOOM_MIN  = 8;
export const CAMERA_ZOOM_MAX  = 60;
export const CAMERA_TILT_DEG  = 55;
