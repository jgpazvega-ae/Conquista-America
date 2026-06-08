export enum TerrainType {
  WATER = 'WATER',
  BEACH = 'BEACH',
  GRASS = 'GRASS',
  JUNGLE = 'JUNGLE',
  DESERT = 'DESERT',
  HIGHLAND = 'HIGHLAND',
  MOUNTAIN = 'MOUNTAIN',
  SNOW = 'SNOW',
}

export enum CivilizationType {
  AZTEC = 'AZTEC',
  INCA = 'INCA',
  MAYA = 'MAYA',
  CONQUISTADOR = 'CONQUISTADOR',
}

export enum UnitType {
  // Aztec
  EAGLE_WARRIOR = 'EAGLE_WARRIOR',
  JAGUAR_KNIGHT = 'JAGUAR_KNIGHT',
  ATLATL = 'ATLATL',
  CUACHIC = 'CUACHIC',
  // Inca
  QUECHUA = 'QUECHUA',
  SLINGER = 'SLINGER',
  CHAKANA_GUARD = 'CHAKANA_GUARD',
  ANTIS_WARRIOR = 'ANTIS_WARRIOR',
  // Maya
  SPEARMAN = 'SPEARMAN',
  ARCHER = 'ARCHER',
  AHAU_WARRIOR = 'AHAU_WARRIOR',
  BALAM_JAGUAR = 'BALAM_JAGUAR',
  // Conquistador
  SOLDIER = 'SOLDIER',
  ARQUEBUSIER = 'ARQUEBUSIER',
  CAVALRY = 'CAVALRY',
  CANNON = 'CANNON',
}

export enum UnitState {
  IDLE         = 'IDLE',
  MOVING       = 'MOVING',
  ATTACKING    = 'ATTACKING',
  ATTACK_MOVE  = 'ATTACK_MOVE',
  HOLD         = 'HOLD',
  DEAD         = 'DEAD',
}

export interface UnitStats {
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  attackRange: number;
  sight: number;
  attackCooldown: number;
}

export interface GridPos {
  col: number;
  row: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
