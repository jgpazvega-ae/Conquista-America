export enum BuildingType {
  SETTLEMENT = 'SETTLEMENT',      // Centro urbano (produce trabajadores)
  BARRACKS = 'BARRACKS',          // Cuartel (produce guerreros)
  TEMPLE = 'TEMPLE',              // Templo (investigación, poder especial)
  WATCHTOWER = 'WATCHTOWER',      // Torre de vigilancia (defensa)
  STOREHOUSE = 'STOREHOUSE',      // Almacén (bonus recursos)
  FORGE = 'FORGE',                // Herrería (mejora armamentos)
}

export interface BuildingDef {
  type: BuildingType;
  name: string;
  emoji: string;
  cost: { food: number; gold: number; stone: number };
  buildTime: number;
  maxHp: number;
  buildRadius: number;
  description: string;
}

export enum TechType {
  ANIMAL_HUSBANDRY = 'ANIMAL_HUSBANDRY',
  BRONZE_WORKING = 'BRONZE_WORKING',
  IRON_WORKING = 'IRON_WORKING',
  AGRICULTURE = 'AGRICULTURE',
  MILITARY_TACTICS = 'MILITARY_TACTICS',
  SIEGE_ENGINEERING = 'SIEGE_ENGINEERING',
  GUNPOWDER = 'GUNPOWDER',
}

export interface TechDef {
  type: TechType;
  name: string;
  description: string;
  cost: number; // research time in seconds
  effects: string[];
}

export enum UnitCommandType {
  MOVE = 'MOVE',
  ATTACK = 'ATTACK',
  BUILD = 'BUILD',
  GATHER = 'GATHER',
  STOP = 'STOP',
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
