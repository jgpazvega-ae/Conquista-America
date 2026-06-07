import { CivilizationType } from './types';
import { CIVILIZATIONS } from './civilizations';
import { STARTING_RESOURCES, CIV_COLORS } from './constants';
import type { Unit } from './Unit';

export interface Resources {
  food:  number;
  gold:  number;
  stone: number;
}

export interface PlayerUpgrades {
  metallurgy:    boolean; // +6 attack all units
  logistics:     boolean; // +0.4 speed all units
  fortification: boolean; // +50 HP all units
}

export class Player {
  readonly id: number;
  readonly civType: CivilizationType;
  readonly isHuman: boolean;
  readonly color: number;

  resources: Resources;
  units: Unit[] = [];
  upgrades: PlayerUpgrades = { metallurgy: false, logistics: false, fortification: false };

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
