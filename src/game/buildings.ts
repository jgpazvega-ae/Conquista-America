export enum BuildingType {
  SETTLEMENT = 'SETTLEMENT',      // Centro urbano (produce trabajadores)
  HOUSE = 'HOUSE',                // Casa/Cabaña — aumenta límite de población (+12 por casa)
  FARM = 'FARM',                  // Granja — produce comida pasivamente (+50 🌽 cada ciclo)
  BARRACKS = 'BARRACKS',          // Cuartel (produce guerreros de élite)
  TEMPLE = 'TEMPLE',              // Templo (produce chamanes/misioneros, investigación)
  WATCHTOWER = 'WATCHTOWER',      // Torre de vigilancia (defensa)
  STOREHOUSE = 'STOREHOUSE',      // Almacén (bonus recursos)
  FORGE = 'FORGE',                // Herrería (mejora armamentos)
  WONDER = 'WONDER',              // Maravilla (victoria por supervivencia)
  VILLAGE = 'VILLAGE',            // Aldea neutral — capturar para ingresos pasivos
  HARBOR = 'HARBOR',              // Puerto — produce unidades navales (requiere agua adyacente)
  MARKET = 'MARKET',              // Mercado — comercio de recursos por oro
  WALL = 'WALL',                  // Muralla — barrera defensiva de alta resistencia
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
