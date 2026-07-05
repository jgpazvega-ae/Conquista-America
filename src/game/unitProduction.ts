import { UnitType } from './types';

export interface TrainCost {
  food:   number;
  gold:   number;
  stone?: number;
  wood?:  number;
  coal?:  number; // gunpowder economy (AC style)
  iron?:  number;
}

export const TRAIN_COSTS: Partial<Record<UnitType, TrainCost>> = {
  // Aztec — reduced ~20% to encourage mass armies like American Conquest
  [UnitType.EAGLE_WARRIOR]: { food: 45,  gold: 15 },
  [UnitType.JAGUAR_KNIGHT]: { food: 70,  gold: 30 },
  [UnitType.ATLATL]:        { food: 40,  gold: 22 },
  [UnitType.CUACHIC]:       { food: 95,  gold: 50 },
  // Inca
  [UnitType.QUECHUA]:       { food: 45,  gold: 12 },
  [UnitType.SLINGER]:       { food: 35,  gold: 18 },
  [UnitType.CHAKANA_GUARD]: { food: 80,  gold: 35 },
  [UnitType.ANTIS_WARRIOR]: { food: 42,  gold: 22 },
  // Maya
  [UnitType.SPEARMAN]:      { food: 42,  gold: 12 },
  [UnitType.ARCHER]:        { food: 38,  gold: 20 },
  [UnitType.AHAU_WARRIOR]:  { food: 70,  gold: 30 },
  [UnitType.BALAM_JAGUAR]:  { food: 58,  gold: 28 },
  // Conquistador
  [UnitType.SOLDIER]:       { food: 55,  gold: 22 },
  [UnitType.ARQUEBUSIER]:   { food: 48,  gold: 35, coal: 10, iron: 15 },
  [UnitType.CAVALRY]:       { food: 65,  gold: 48 },
  [UnitType.CANNON]:        { food: 40,  gold: 65, stone: 30, coal: 25, iron: 40 },
  // Naval — nativas
  [UnitType.CANOE]:         { food: 40,  gold: 20, wood: 60 },
  [UnitType.WAR_CANOE]:     { food: 60,  gold: 40, wood: 90 },
  // Naval — Conquistador
  [UnitType.BRIGANTINE]:    { food: 80,  gold: 120, wood: 150, iron: 20 },
  [UnitType.GALLEON]:       { food: 100, gold: 250, wood: 250, stone: 50, coal: 30, iron: 50 },
  // Espiritual
  [UnitType.SHAMAN]:        { food: 80,  gold: 60 },
  [UnitType.MISSIONARY]:    { food: 60,  gold: 80 },
  // Mando (estilo American Conquest)
  [UnitType.OFFICER]:       { food: 90,  gold: 70 },
  [UnitType.DRUMMER]:       { food: 50,  gold: 35 },
};

// Units that require a Barracks building to train (not available in Settlement)
export const ELITE_UNITS = new Set<UnitType>([
  UnitType.JAGUAR_KNIGHT, UnitType.CUACHIC,     // Aztec elite
  UnitType.CHAKANA_GUARD, UnitType.ANTIS_WARRIOR, // Inca elite
  UnitType.AHAU_WARRIOR, UnitType.BALAM_JAGUAR,  // Maya elite
  UnitType.CAVALRY, UnitType.CANNON,             // Conquistador elite
  UnitType.OFFICER, UnitType.DRUMMER,            // command units (Barracks-trained)
]);

export const TRAIN_TIMES: Partial<Record<UnitType, number>> = {
  [UnitType.EAGLE_WARRIOR]: 14,
  [UnitType.JAGUAR_KNIGHT]: 22,
  [UnitType.ATLATL]:        11,
  [UnitType.CUACHIC]:       28,
  [UnitType.QUECHUA]:       13,
  [UnitType.SLINGER]:       10,
  [UnitType.CHAKANA_GUARD]: 24,
  [UnitType.ANTIS_WARRIOR]: 12,
  [UnitType.SPEARMAN]:      12,
  [UnitType.ARCHER]:        11,
  [UnitType.AHAU_WARRIOR]:  20,
  [UnitType.BALAM_JAGUAR]:  17,
  [UnitType.SOLDIER]:       15,
  [UnitType.ARQUEBUSIER]:   20,
  [UnitType.CAVALRY]:       24,
  [UnitType.CANNON]:        40,
  [UnitType.CANOE]:         18,
  [UnitType.WAR_CANOE]:     28,
  [UnitType.BRIGANTINE]:    40,
  [UnitType.GALLEON]:       70,
  [UnitType.SHAMAN]:        22,
  [UnitType.MISSIONARY]:    25,
  [UnitType.OFFICER]:       26,
  [UnitType.DRUMMER]:       14,
};
