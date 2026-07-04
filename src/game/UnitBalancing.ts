import { UnitType } from './types';

export interface CounterMatrix {
  [key: string]: { multiplier: number; reason: string };
}

export const UNIT_COUNTERS: Record<UnitType, CounterMatrix> = {
  // Aztecas
  [UnitType.EAGLE_WARRIOR]: {
    [UnitType.SLINGER]: { multiplier: 1.3, reason: 'Rápido vs ranged' },
    [UnitType.ARQUEBUSIER]: { multiplier: 0.6, reason: 'Vulnerable a fuego' },
  },
  [UnitType.JAGUAR_KNIGHT]: {
    [UnitType.CAVALRY]: { multiplier: 0.7, reason: 'Menos móvil' },
    [UnitType.CHAKANA_GUARD]: { multiplier: 0.8, reason: 'Defensa fuerte' },
  },
  [UnitType.ATLATL]: {
    [UnitType.CAVALRY]: { multiplier: 1.2, reason: 'Carga rápida' },
    [UnitType.SOLDIER]: { multiplier: 0.8, reason: 'Armados contra proyectiles' },
  },
  [UnitType.CUACHIC]: {
    [UnitType.CANNON]: { multiplier: 0.3, reason: 'Artillería devastadora' },
    [UnitType.ARCHER]: { multiplier: 1.4, reason: 'Elite en cuerpo a cuerpo' },
  },

  // Incas
  [UnitType.QUECHUA]: {
    [UnitType.EAGLE_WARRIOR]: { multiplier: 0.9, reason: 'Balanced' },
    [UnitType.CAVALRY]: { multiplier: 1.5, reason: 'Lanzas largas detienen la carga' },
  },
  [UnitType.SLINGER]: {
    [UnitType.ARCHER]: { multiplier: 0.9, reason: 'Similar tipo' },
    [UnitType.CAVALRY]: { multiplier: 1.4, reason: 'Proyectiles detienen carga' },
  },
  [UnitType.CHAKANA_GUARD]: {
    [UnitType.CANNON]: { multiplier: 0.5, reason: 'Poco puede contra artillería' },
    [UnitType.JAGUAR_KNIGHT]: { multiplier: 1.2, reason: 'Defensa mejor' },
  },
  [UnitType.ANTIS_WARRIOR]: {
    [UnitType.CAVALRY]: { multiplier: 1.7, reason: 'Lanzas de selva — destroza caballería' },
    [UnitType.ARQUEBUSIER]: { multiplier: 0.7, reason: 'Vulnerable a fuego' },
  },

  // Mayas
  [UnitType.SPEARMAN]: {
    [UnitType.CAVALRY]: { multiplier: 1.9, reason: 'Formación de lanzas — la respuesta a la caballería' },
    [UnitType.CANNON]: { multiplier: 0.4, reason: 'Indefenso contra artillería' },
  },
  [UnitType.ARCHER]: {
    [UnitType.ATLATL]: { multiplier: 1.1, reason: 'Rango superior' },
    [UnitType.CAVALRY]: { multiplier: 0.8, reason: 'Carga rápida' },
  },
  [UnitType.AHAU_WARRIOR]: {
    [UnitType.ARQUEBUSIER]: { multiplier: 0.7, reason: 'Fuego superior' },
    [UnitType.CUACHIC]: { multiplier: 1.1, reason: 'Elite Maya' },
  },
  [UnitType.BALAM_JAGUAR]: {
    [UnitType.CAVALRY]: { multiplier: 0.8, reason: 'Menos móvil' },
    [UnitType.SOLDIER]: { multiplier: 1.2, reason: 'Melee superior' },
  },

  // Conquistadores
  [UnitType.SOLDIER]: {
    [UnitType.EAGLE_WARRIOR]: { multiplier: 1.3, reason: 'Armadura' },
    [UnitType.ATLATL]: { multiplier: 1.2, reason: 'Resistencia' },
  },
  [UnitType.ARQUEBUSIER]: {
    [UnitType.ARCHER]: { multiplier: 1.4, reason: 'Fuego superior' },
    [UnitType.CAVALRY]: { multiplier: 0.9, reason: 'Carga rápida' },
  },
  [UnitType.CAVALRY]: {
    [UnitType.SPEARMAN]: { multiplier: 0.8, reason: 'Lanzas defensivas' },
    [UnitType.SLINGER]: { multiplier: 1.2, reason: 'Carga irresistible' },
  },
  [UnitType.CANNON]: {
    [UnitType.CHAKANA_GUARD]: { multiplier: 2.5, reason: 'Artillería imbatible' },
    [UnitType.SPEARMAN]: { multiplier: 2.0, reason: 'Artillería vs infantería' },
    [UnitType.CANOE]: { multiplier: 2.0, reason: 'Cañón destruye canoas' },
    [UnitType.WAR_CANOE]: { multiplier: 1.8, reason: 'Artillería vs embarcación' },
  },
  [UnitType.CANOE]: {
    [UnitType.SOLDIER]: { multiplier: 0.7, reason: 'Poco impacto contra infantería' },
    [UnitType.BRIGANTINE]: { multiplier: 0.5, reason: 'Superado por bergantín' },
  },
  [UnitType.WAR_CANOE]: {
    [UnitType.CANOE]: { multiplier: 1.5, reason: 'Canoa de guerra más potente' },
    [UnitType.BRIGANTINE]: { multiplier: 0.6, reason: 'Bergantín con cañones' },
    [UnitType.SOLDIER]: { multiplier: 0.8, reason: 'Difícil atacar tierra' },
  },
  [UnitType.BRIGANTINE]: {
    [UnitType.CANOE]: { multiplier: 2.0, reason: 'Bergantín aplasta canoas' },
    [UnitType.WAR_CANOE]: { multiplier: 1.5, reason: 'Superior en artillería' },
    [UnitType.GALLEON]: { multiplier: 0.5, reason: 'Galeón dominante' },
  },
  [UnitType.GALLEON]: {
    [UnitType.BRIGANTINE]: { multiplier: 2.0, reason: 'Galeón aplasta bergantín' },
    [UnitType.WAR_CANOE]: { multiplier: 3.0, reason: 'Galeón destroza canoas' },
    [UnitType.CANNON]: { multiplier: 0.9, reason: 'Artillería terrestre eficaz' },
  },
  [UnitType.SHAMAN]: {
    [UnitType.MISSIONARY]: { multiplier: 1.3, reason: 'Contrarresta conversión' },
    [UnitType.CANNON]: { multiplier: 0.5, reason: 'Indefenso contra artillería' },
  },
  [UnitType.MISSIONARY]: {
    [UnitType.SHAMAN]: { multiplier: 0.8, reason: 'Chamán resiste conversión' },
    [UnitType.SOLDIER]: { multiplier: 0.6, reason: 'No es combatiente' },
  },
  [UnitType.OFFICER]: {},
  [UnitType.DRUMMER]: {},
};

export function getDamageMultiplier(attacker: UnitType, defender: UnitType): number {
  if (UNIT_COUNTERS[attacker]?.[defender]) {
    return UNIT_COUNTERS[attacker][defender].multiplier;
  }
  return 1.0;
}

export interface Formation {
  name: string;
  description: string;
  bonusAttack: number;
  bonusDefense: number;
  bonusSpeed: number;
}

export const FORMATIONS: Record<string, Formation> = {
  LOOSE: {
    name: 'Formación Suelta',
    description: 'Máxima velocidad y flexibilidad',
    bonusAttack: -0.1,
    bonusDefense: -0.15,
    bonusSpeed: 0.2,
  },
  PHALANX: {
    name: 'Falange',
    description: 'Máxima defensa, movimiento lento',
    bonusAttack: -0.2,
    bonusDefense: 0.3,
    bonusSpeed: -0.3,
  },
  WEDGE: {
    name: 'Cuña',
    description: 'Penetración de líneas enemigas',
    bonusAttack: 0.25,
    bonusDefense: 0.1,
    bonusSpeed: 0.0,
  },
};
