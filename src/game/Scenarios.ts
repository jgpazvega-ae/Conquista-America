import { CivilizationType } from './types';

/** Historical scenario (American Conquest style): a curated matchup with a fixed
 *  map, forced civilizations, difficulty and flavor bonuses that recreate the battle. */
export interface ScenarioDef {
  id: string;
  name: string;
  emoji: string;
  year: string;
  description: string;
  humanCiv: CivilizationType;
  aiCivs: CivilizationType[];
  difficulty: 'easy' | 'normal' | 'hard';
  mapSeed: number; // fixed seed → the same historical battlefield every time
  /** Extra starting resources for the human player (scenario flavor). */
  humanBonus?: { food?: number; gold?: number; stone?: number; wood?: number; coal?: number; iron?: number };
  /** Extra starting resources for every AI player. */
  aiBonus?: { food?: number; gold?: number; stone?: number; wood?: number; coal?: number; iron?: number };
  /** Intro line shown in the HUD when the scenario begins. */
  intro: string;
}

export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'tenochtitlan',
    name: 'Sitio de Tenochtitlán',
    emoji: '🏯',
    year: '1521',
    description:
      'Defiende la capital mexica del asedio de Hernán Cortés. Los conquistadores llegan con acero, ' +
      'pólvora y caballos — pero tú conoces la ciudad y tus guerreros Águila luchan por sus dioses.',
    humanCiv: CivilizationType.AZTEC,
    aiCivs: [CivilizationType.CONQUISTADOR],
    difficulty: 'hard',
    mapSeed: 15211,
    humanBonus: { food: 300, stone: 200 },          // the island city's granaries and causeways
    aiBonus:    { gold: 300, coal: 150, iron: 200 }, // Cortés' armory: powder and steel
    intro: '🏯 Tenochtitlán, 1521 — ¡Cortés avanza sobre la ciudad! Resiste el asedio y expulsa al invasor.',
  },
  {
    id: 'cajamarca',
    name: 'Emboscada de Cajamarca',
    emoji: '⛰️',
    year: '1532',
    description:
      'Pizarro ha tendido una trampa en los Andes. Como Inca, tu imperio es vasto y tus honderos dominan ' +
      'las alturas — pero el enemigo golpeará rápido y fuerte. Sobrevive al golpe inicial y contraataca.',
    humanCiv: CivilizationType.INCA,
    aiCivs: [CivilizationType.CONQUISTADOR],
    difficulty: 'hard',
    mapSeed: 15322,
    humanBonus: { stone: 300, food: 200 },           // Andean strongholds and terraced farms
    aiBonus:    { gold: 250, coal: 120, iron: 180 },  // Pizarro's small but deadly expedition
    intro: '⛰️ Cajamarca, 1532 — ¡Emboscada! Pizarro ataca sin aviso. Reagrupa al Tawantinsuyu y resiste.',
  },
];

export function getScenario(id: string): ScenarioDef | undefined {
  return SCENARIOS.find(s => s.id === id);
}
