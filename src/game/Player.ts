import { CivilizationType } from './types';
import { CIVILIZATIONS } from './civilizations';
import { STARTING_RESOURCES, CIV_COLORS } from './constants';
import type { Unit } from './Unit';

export interface Resources {
  food:  number;
  gold:  number;
  stone: number;
}

export class Player {
  readonly id: number;
  readonly civType: CivilizationType;
  readonly isHuman: boolean;
  readonly color: number;

  resources: Resources;
  units: Unit[] = [];

  // Simple AI state
  aiTimer = 0;
  aiAttackTimer = 0;

  constructor(id: number, civType: CivilizationType, isHuman: boolean) {
    this.id       = id;
    this.civType  = civType;
    this.isHuman  = isHuman;
    this.color    = CIV_COLORS[civType];
    this.resources = { ...STARTING_RESOURCES };
  }

  get civDef() { return CIVILIZATIONS[this.civType]; }

  get aliveUnits(): Unit[] {
    return this.units.filter(u => u.isAlive());
  }

  isDefeated(): boolean {
    return this.aliveUnits.length === 0;
  }

  addUnit(unit: Unit) {
    this.units.push(unit);
  }
}
