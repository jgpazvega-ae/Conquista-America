import { CivilizationType, UnitType } from './types';
import type { Building } from './Building';
import { BuildingType } from './buildings';
import { BUILDING_DEFS } from './buildingDefs';

export enum AIStrategy {
  AGGRESSIVE = 'AGGRESSIVE',
  ECONOMIC = 'ECONOMIC',
  DEFENSIVE = 'DEFENSIVE',
  BALANCED = 'BALANCED',
}

export interface StrategyConfig {
  strategy: AIStrategy;
  militaryRatio: number; // 0-1, how many units to train vs buildings
  buildOrder: BuildingType[];
  unitComposition: UnitType[];
  researchPriority: string[];
}

export const STRATEGY_BY_CIV: Record<CivilizationType, StrategyConfig> = {
  [CivilizationType.AZTEC]: {
    strategy: AIStrategy.AGGRESSIVE,
    militaryRatio: 0.8,
    buildOrder: [BuildingType.HOUSE, BuildingType.FARM, BuildingType.BARRACKS, BuildingType.HOUSE, BuildingType.FARM, BuildingType.WATCHTOWER, BuildingType.TEMPLE, BuildingType.HARBOR, BuildingType.MARKET],
    unitComposition: [UnitType.EAGLE_WARRIOR, UnitType.JAGUAR_KNIGHT, UnitType.ATLATL],
    researchPriority: ['AGRICULTURE', 'BRONZE_WORKING', 'MILITARY_TACTICS'],
  },
  [CivilizationType.INCA]: {
    strategy: AIStrategy.BALANCED,
    militaryRatio: 0.5,
    buildOrder: [BuildingType.HOUSE, BuildingType.FARM, BuildingType.STOREHOUSE, BuildingType.HOUSE, BuildingType.FARM, BuildingType.BARRACKS, BuildingType.MARKET, BuildingType.HARBOR],
    unitComposition: [UnitType.QUECHUA, UnitType.SLINGER, UnitType.CHAKANA_GUARD],
    researchPriority: ['AGRICULTURE', 'MINING', 'INCA_ROAD_SYSTEM'],
  },
  [CivilizationType.MAYA]: {
    strategy: AIStrategy.BALANCED,
    militaryRatio: 0.55,
    buildOrder: [BuildingType.HOUSE, BuildingType.FARM, BuildingType.BARRACKS, BuildingType.HOUSE, BuildingType.FARM, BuildingType.TEMPLE, BuildingType.WATCHTOWER, BuildingType.MARKET, BuildingType.HARBOR],
    unitComposition: [UnitType.SPEARMAN, UnitType.ARCHER, UnitType.AHAU_WARRIOR],
    researchPriority: ['AGRICULTURE', 'ASTRONOMY', 'SIEGE_ENGINEERING'],
  },
  [CivilizationType.CONQUISTADOR]: {
    strategy: AIStrategy.AGGRESSIVE,
    militaryRatio: 0.75,
    buildOrder: [BuildingType.HOUSE, BuildingType.FARM, BuildingType.BARRACKS, BuildingType.HOUSE, BuildingType.FARM, BuildingType.FORGE, BuildingType.WATCHTOWER, BuildingType.HARBOR, BuildingType.MARKET],
    unitComposition: [UnitType.SOLDIER, UnitType.ARQUEBUSIER, UnitType.CAVALRY],
    researchPriority: ['BRONZE_WORKING', 'CAVALRY_TRAINING', 'GUNPOWDER'],
  },
};

export class AIBuildingPlanner {
  priorityQueue: BuildingType[] = [];
  lastBuiltTime = 0;

  update(buildings: Building[], strategy: StrategyConfig, elapsedTime: number) {
    const buildingCounts = this.countBuildings(buildings);

    // Regenerate priority if empty or long time passed
    if (this.priorityQueue.length === 0 || elapsedTime - this.lastBuiltTime > 60) {
      this.priorityQueue = [...strategy.buildOrder];
      this.lastBuiltTime = elapsedTime;
    }
  }

  getNextBuildType(): BuildingType | null {
    return this.priorityQueue.shift() ?? null;
  }

  private countBuildings(buildings: Building[]): Record<BuildingType, number> {
    const counts: Record<BuildingType, number> = {
      [BuildingType.HOUSE]: 0,
      [BuildingType.FARM]: 0,
      [BuildingType.SETTLEMENT]: 0,
      [BuildingType.BARRACKS]: 0,
      [BuildingType.TEMPLE]: 0,
      [BuildingType.WATCHTOWER]: 0,
      [BuildingType.STOREHOUSE]: 0,
      [BuildingType.FORGE]: 0,
      [BuildingType.WONDER]: 0,
      [BuildingType.VILLAGE]: 0,
      [BuildingType.HARBOR]: 0,
      [BuildingType.MARKET]: 0,
      [BuildingType.WALL]: 0,
    };

    for (const b of buildings) {
      counts[b.type]++;
    }

    return counts;
  }
}
