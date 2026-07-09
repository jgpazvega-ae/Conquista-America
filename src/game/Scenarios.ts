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
  {
    id: 'noche-triste',
    name: 'La Noche Triste',
    emoji: '🌙',
    year: '1520',
    description:
      'Esta vez el invasor huye. Como Conquistador, tu ejército escapa de Tenochtitlán de noche, cargado ' +
      'de oro y perseguido por miles de guerreros mexicas enfurecidos. Sobrevive con lo que puedas salvar.',
    humanCiv: CivilizationType.CONQUISTADOR,
    aiCivs: [CivilizationType.AZTEC],
    difficulty: 'hard',
    mapSeed: 15201,
    humanBonus: { gold: 400, coal: 100, iron: 120 },  // the looted treasure of Moctezuma
    aiBonus:    { food: 500, stone: 200 },            // the roused Mexica host
    intro: '🌙 La Noche Triste, 1520 — Huyes de Tenochtitlán con el tesoro. ¡Los mexicas vienen por ti!',
  },
  {
    id: 'otumba',
    name: 'Batalla de Otumba',
    emoji: '🌾',
    year: '1520',
    description:
      'Días después de la Noche Triste, el ejército mexica alcanza a los españoles en el valle de Otumba. ' +
      'Como Azteca, aplasta a los invasores debilitados antes de que reciban refuerzos de Tlaxcala.',
    humanCiv: CivilizationType.AZTEC,
    aiCivs: [CivilizationType.CONQUISTADOR],
    difficulty: 'normal',
    mapSeed: 15202,
    humanBonus: { food: 400, gold: 150 },             // the full levy of the Triple Alliance
    aiBonus:    { iron: 100, coal: 80 },              // battered but disciplined survivors
    intro: '🌾 Otumba, 1520 — El invasor está herido y sin pólvora. ¡Acaba con él antes de que se recupere!',
  },
  {
    id: 'vilcabamba',
    name: 'Vilcabamba, el Último Reino',
    emoji: '🌿',
    year: '1572',
    description:
      'Cuarenta años tras Cajamarca, el último estado inca resiste oculto en la selva. Como Inca, defiende ' +
      'Vilcabamba de la expedición final del virrey Toledo. Si caes, cae el Tawantinsuyu para siempre.',
    humanCiv: CivilizationType.INCA,
    aiCivs: [CivilizationType.CONQUISTADOR],
    difficulty: 'hard',
    mapSeed: 15721,
    humanBonus: { food: 300, wood: 300 },             // jungle refuge: timber and hidden crops
    aiBonus:    { gold: 400, coal: 200, iron: 250 },  // the viceroy's fully equipped expedition
    intro: '🌿 Vilcabamba, 1572 — La última ciudad libre del Tawantinsuyu. ¡Resiste o desaparece de la historia!',
  },
];

export function getScenario(id: string): ScenarioDef | undefined {
  return SCENARIOS.find(s => s.id === id);
}
