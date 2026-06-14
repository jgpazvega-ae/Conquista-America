import { CivilizationType } from './types';

export enum TechType {
  // Económico
  AGRICULTURE = 'AGRICULTURE',
  HERDING = 'HERDING',
  MINING = 'MINING',
  // Militar
  BRONZE_WORKING = 'BRONZE_WORKING',
  IRON_WORKING = 'IRON_WORKING',
  CAVALRY_TRAINING = 'CAVALRY_TRAINING',
  SIEGE_ENGINEERING = 'SIEGE_ENGINEERING',
  // Especial por civ
  AZTEC_JAGUAR_ELITE = 'AZTEC_JAGUAR_ELITE',
  INCA_ROAD_SYSTEM = 'INCA_ROAD_SYSTEM',
  MAYA_ASTRONOMY = 'MAYA_ASTRONOMY',
  CONQUISTADOR_GUNPOWDER = 'CONQUISTADOR_GUNPOWDER',
}

export interface TechDef {
  type: TechType;
  name: string;
  description: string;
  costGold: number; // research time in seconds
  effects: string[];
  availableTo?: CivilizationType[];
  requires?: TechType[];
}

export const TECH_DEFS: Record<TechType, TechDef> = {
  [TechType.AGRICULTURE]: {
    type: TechType.AGRICULTURE,
    name: 'Agricultura Avanzada',
    description: 'Aumenta producción de comida en +25%',
    costGold: 150,
    effects: ['food_production +25%'],
  },
  [TechType.HERDING]: {
    type: TechType.HERDING,
    name: 'Ganadería',
    description: 'Desbloquea recolección de carne de animales',
    costGold: 120,
    effects: ['food_source unlock'],
  },
  [TechType.MINING]: {
    type: TechType.MINING,
    name: 'Minería Profunda',
    description: 'Aumenta producción de oro y piedra en +35%',
    costGold: 180,
    effects: ['stone_production +35%', 'gold_production +35%'],
  },
  [TechType.BRONZE_WORKING]: {
    type: TechType.BRONZE_WORKING,
    name: 'Trabajo del Bronce',
    description: 'Aumenta ataque y defensa de unidades en +15%',
    costGold: 200,
    effects: ['unit_attack +15%', 'unit_defense +15%'],
  },
  [TechType.IRON_WORKING]: {
    type: TechType.IRON_WORKING,
    name: 'Trabajo del Hierro',
    description: 'Aumenta ataque y defensa en +25%',
    costGold: 250,
    effects: ['unit_attack +25%', 'unit_defense +25%'],
    availableTo: [CivilizationType.CONQUISTADOR, CivilizationType.MAYA],
    requires: [TechType.BRONZE_WORKING],
  },
  [TechType.CAVALRY_TRAINING]: {
    type: TechType.CAVALRY_TRAINING,
    name: 'Entrenamiento Ecuestre',
    description: 'Desbloquea unidades de caballería avanzada',
    costGold: 220,
    effects: ['cavalry_unlock'],
  },
  [TechType.SIEGE_ENGINEERING]: {
    type: TechType.SIEGE_ENGINEERING,
    name: 'Ingeniería de Asedio',
    description: 'Mejora rango y daño de unidades de rango lejano +20%',
    costGold: 300,
    effects: ['ranged_damage +20%', 'ranged_range +15%'],
    requires: [TechType.IRON_WORKING],
  },
  [TechType.AZTEC_JAGUAR_ELITE]: {
    type: TechType.AZTEC_JAGUAR_ELITE,
    name: 'Élite Jaguar',
    description: 'Caballeros Jaguar reciben +50% salud y daño',
    costGold: 250,
    effects: ['jaguar_elite'],
    availableTo: [CivilizationType.AZTEC],
    requires: [TechType.BRONZE_WORKING],
  },
  [TechType.INCA_ROAD_SYSTEM]: {
    type: TechType.INCA_ROAD_SYSTEM,
    name: 'Sistema de Caminos',
    description: 'Unidades se mueven 30% más rápido',
    costGold: 200,
    effects: ['movement_speed +30%'],
    availableTo: [CivilizationType.INCA],
  },
  [TechType.MAYA_ASTRONOMY]: {
    type: TechType.MAYA_ASTRONOMY,
    name: 'Astronomía',
    description: 'Aumenta visión de unidades y edificios en +2 tiles',
    costGold: 175,
    effects: ['sight +2'],
    availableTo: [CivilizationType.MAYA],
  },
  [TechType.CONQUISTADOR_GUNPOWDER]: {
    type: TechType.CONQUISTADOR_GUNPOWDER,
    name: 'Tecnología de Pólvora',
    description: 'Arcabuceros y Cañones reciben +40% daño',
    costGold: 350,
    effects: ['gunpowder_elite'],
    availableTo: [CivilizationType.CONQUISTADOR],
    requires: [TechType.IRON_WORKING],
  },
};

export class PlayerTechs {
  private researched = new Set<TechType>();
  private researching: TechType | null = null;
  private researchProgress = 0;
  private researchTime = 0;

  isResearched(tech: TechType): boolean {
    return this.researched.has(tech);
  }

  canResearch(tech: TechType, civ: CivilizationType): boolean {
    if (this.researched.has(tech)) return false;
    const def = TECH_DEFS[tech];
    if (def.availableTo && !def.availableTo.includes(civ)) return false;
    if (def.requires) {
      for (const req of def.requires) {
        if (!this.researched.has(req)) return false;
      }
    }
    return true;
  }

  startResearch(tech: TechType) {
    this.researching = tech;
    this.researchProgress = 0;
    this.researchTime = TECH_DEFS[tech].costGold;
  }

  update(dt: number): TechType | null {
    if (!this.researching) return null;

    this.researchProgress += dt;
    const pct = this.researchProgress / this.researchTime;

    if (pct >= 1.0) {
      const completed = this.researching;
      this.researched.add(completed);
      this.researching = null;
      this.researchProgress = 0;
      return completed;
    }

    return null;
  }

  getResearchProgress(): number {
    if (!this.researching) return 0;
    return this.researchProgress / this.researchTime;
  }

  getResearchingTech(): TechType | null {
    return this.researching;
  }
}
