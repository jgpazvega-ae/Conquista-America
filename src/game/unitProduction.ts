import { UnitType } from './types';

export interface TrainCost {
  food:   number;
  gold:   number;
  stone?: number;
  wood?:  number;
}

export const TRAIN_COSTS: Partial<Record<UnitType, TrainCost>> = {
  // Aztec
  [UnitType.EAGLE_WARRIOR]: { food: 60,  gold: 20 },
  [UnitType.JAGUAR_KNIGHT]: { food: 90,  gold: 40 },
  [UnitType.ATLATL]:        { food: 50,  gold: 30 },
  [UnitType.CUACHIC]:       { food: 120, gold: 60 },
  // Inca
  [UnitType.QUECHUA]:       { food: 60,  gold: 15 },
  [UnitType.SLINGER]:       { food: 45,  gold: 25 },
  [UnitType.CHAKANA_GUARD]: { food: 100, gold: 45 },
  [UnitType.ANTIS_WARRIOR]: { food: 55,  gold: 30 },
  // Maya
  [UnitType.SPEARMAN]:      { food: 55,  gold: 15 },
  [UnitType.ARCHER]:        { food: 50,  gold: 25 },
  [UnitType.AHAU_WARRIOR]:  { food: 90,  gold: 40 },
  [UnitType.BALAM_JAGUAR]:  { food: 75,  gold: 35 },
  // Conquistador
  [UnitType.SOLDIER]:       { food: 70,  gold: 30 },
  [UnitType.ARQUEBUSIER]:   { food: 60,  gold: 45 },
  [UnitType.CAVALRY]:       { food: 80,  gold: 60 },
  [UnitType.CANNON]:        { food: 50,  gold: 80, stone: 40 },
  // Naval — nativas
  [UnitType.CANOE]:         { food: 40,  gold: 20, wood: 60 },
  [UnitType.WAR_CANOE]:     { food: 60,  gold: 40, wood: 90 },
  // Naval — Conquistador
  [UnitType.BRIGANTINE]:    { food: 80,  gold: 120, wood: 150 },
  [UnitType.GALLEON]:       { food: 100, gold: 250, wood: 250, stone: 50 },
  // Espiritual
  [UnitType.SHAMAN]:        { food: 80,  gold: 60 },
  [UnitType.MISSIONARY]:    { food: 60,  gold: 80 },
};

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
};
