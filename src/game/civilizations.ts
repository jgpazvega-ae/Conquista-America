import { CivilizationType, UnitType } from './types';
import type { UnitStats } from './types';

export interface UnitDef {
  type: UnitType;
  name: string;
  emoji: string;
  stats: UnitStats;
  isRanged: boolean;
  isCavalry: boolean;
  description: string;
}

export interface CivDef {
  type: CivilizationType;
  name: string;
  emoji: string;
  color: number;
  accentColor: number;
  description: string;
  units: UnitDef[];
  startUnits: UnitType[];
}

const UNIT_DEFS: Record<UnitType, UnitDef> = {
  // ── AZTEC ──────────────────────────────────────────────
  [UnitType.EAGLE_WARRIOR]: {
    type: UnitType.EAGLE_WARRIOR, name: 'Guerrero Águila', emoji: '🦅',
    isRanged: false, isCavalry: false,
    description: 'Elite de infantería azteca, rápido y agresivo.',
    stats: { maxHp: 80, attack: 18, defense: 12, speed: 3.5, attackRange: 1.5, sight: 6, attackCooldown: 1.4 },
  },
  [UnitType.JAGUAR_KNIGHT]: {
    type: UnitType.JAGUAR_KNIGHT, name: 'Caballero Jaguar', emoji: '🐆',
    isRanged: false, isCavalry: false,
    description: 'Guerrero de élite, duro y poderoso en cuerpo a cuerpo.',
    stats: { maxHp: 120, attack: 24, defense: 18, speed: 2.5, attackRange: 1.5, sight: 5, attackCooldown: 1.8 },
  },
  [UnitType.ATLATL]: {
    type: UnitType.ATLATL, name: 'Guerrero Atlatl', emoji: '🏹',
    isRanged: true, isCavalry: false,
    description: 'Lanzador de jabalinas de larga distancia.',
    stats: { maxHp: 55, attack: 14, defense: 6, speed: 3.0, attackRange: 4.5, sight: 7, attackCooldown: 1.6 },
  },
  [UnitType.CUACHIC]: {
    type: UnitType.CUACHIC, name: 'Cuāuhchic', emoji: '💀',
    isRanged: false, isCavalry: false,
    description: 'Guerrero que jamás retrocede. Extremadamente peligroso.',
    stats: { maxHp: 150, attack: 30, defense: 20, speed: 2.0, attackRange: 1.5, sight: 5, attackCooldown: 2.0 },
  },
  // ── INCA ───────────────────────────────────────────────
  [UnitType.QUECHUA]: {
    type: UnitType.QUECHUA, name: 'Quechua', emoji: '🗡️',
    isRanged: false, isCavalry: false,
    description: 'Infantería base del Tawantinsuyu, numerosa y resistente.',
    stats: { maxHp: 90, attack: 16, defense: 14, speed: 3.0, attackRange: 1.5, sight: 5, attackCooldown: 1.5 },
  },
  [UnitType.SLINGER]: {
    type: UnitType.SLINGER, name: 'Hondero', emoji: '⚪',
    isRanged: true, isCavalry: false,
    description: 'Experto en honda, ataca desde lejos con alta cadencia.',
    stats: { maxHp: 50, attack: 12, defense: 5, speed: 3.2, attackRange: 5.0, sight: 8, attackCooldown: 1.2 },
  },
  [UnitType.CHAKANA_GUARD]: {
    type: UnitType.CHAKANA_GUARD, name: 'Guardia Chakana', emoji: '🛡️',
    isRanged: false, isCavalry: false,
    description: 'Unidad defensiva élite, alta armadura.',
    stats: { maxHp: 160, attack: 20, defense: 28, speed: 2.0, attackRange: 1.5, sight: 5, attackCooldown: 2.0 },
  },
  [UnitType.ANTIS_WARRIOR]: {
    type: UnitType.ANTIS_WARRIOR, name: 'Guerrero Antis', emoji: '🌿',
    isRanged: false, isCavalry: false,
    description: 'Guerrero selvático, se mueve rápido en jungla.',
    stats: { maxHp: 70, attack: 20, defense: 10, speed: 4.0, attackRange: 1.5, sight: 6, attackCooldown: 1.3 },
  },
  // ── MAYA ───────────────────────────────────────────────
  [UnitType.SPEARMAN]: {
    type: UnitType.SPEARMAN, name: 'Lancero Maya', emoji: '⚡',
    isRanged: false, isCavalry: false,
    description: 'Infantería básica con lanza de obsidiana.',
    stats: { maxHp: 75, attack: 14, defense: 10, speed: 3.0, attackRange: 2.0, sight: 5, attackCooldown: 1.5 },
  },
  [UnitType.ARCHER]: {
    type: UnitType.ARCHER, name: 'Arquero Maya', emoji: '🎯',
    isRanged: true, isCavalry: false,
    description: 'Arquero preciso, bueno contra infantería ligera.',
    stats: { maxHp: 60, attack: 16, defense: 6, speed: 3.0, attackRange: 5.5, sight: 8, attackCooldown: 1.4 },
  },
  [UnitType.AHAU_WARRIOR]: {
    type: UnitType.AHAU_WARRIOR, name: 'Guerrero Ahau', emoji: '👑',
    isRanged: false, isCavalry: false,
    description: 'Guerrero noble, inspirador y poderoso.',
    stats: { maxHp: 130, attack: 26, defense: 16, speed: 2.8, attackRange: 1.5, sight: 6, attackCooldown: 1.6 },
  },
  [UnitType.BALAM_JAGUAR]: {
    type: UnitType.BALAM_JAGUAR, name: 'Balam (Jaguar)', emoji: '🐾',
    isRanged: false, isCavalry: false,
    description: 'Guerrero jaguar maya, versión equivalente al azteca.',
    stats: { maxHp: 100, attack: 22, defense: 14, speed: 3.2, attackRange: 1.5, sight: 6, attackCooldown: 1.5 },
  },
  // ── CONQUISTADOR ───────────────────────────────────────
  [UnitType.SOLDIER]: {
    type: UnitType.SOLDIER, name: 'Soldado', emoji: '🗡️',
    isRanged: false, isCavalry: false,
    description: 'Infantería española con espada y rodela.',
    stats: { maxHp: 100, attack: 20, defense: 20, speed: 2.8, attackRange: 1.5, sight: 5, attackCooldown: 1.5 },
  },
  [UnitType.ARQUEBUSIER]: {
    type: UnitType.ARQUEBUSIER, name: 'Arcabucero', emoji: '💥',
    isRanged: true, isCavalry: false,
    description: 'Alto daño a distancia, recarga lenta.',
    stats: { maxHp: 65, attack: 28, defense: 8, speed: 2.5, attackRange: 6.0, sight: 8, attackCooldown: 3.0 },
  },
  [UnitType.CAVALRY]: {
    type: UnitType.CAVALRY, name: 'Caballería', emoji: '🐎',
    isRanged: false, isCavalry: true,
    description: 'Caballero montado, rápido y devastador en carga.',
    stats: { maxHp: 140, attack: 32, defense: 16, speed: 5.5, attackRange: 2.0, sight: 7, attackCooldown: 1.8 },
  },
  [UnitType.CANNON]: {
    type: UnitType.CANNON, name: 'Cañón', emoji: '💣',
    isRanged: true, isCavalry: false,
    description: 'Artillería devastadora, lento pero mortal.',
    stats: { maxHp: 80, attack: 60, defense: 10, speed: 1.0, attackRange: 8.0, sight: 10, attackCooldown: 5.0 },
  },
  // ── NAVAL — NATIVAS ────────────────────────────────────
  [UnitType.CANOE]: {
    type: UnitType.CANOE, name: 'Canoa', emoji: '🛶',
    isRanged: false, isCavalry: false,
    description: 'Embarcación ligera nativa. Solo navega en agua. Rápida y ágil.',
    stats: { maxHp: 70, attack: 14, defense: 8, speed: 4.5, attackRange: 1.5, sight: 8, attackCooldown: 1.6 },
  },
  [UnitType.WAR_CANOE]: {
    type: UnitType.WAR_CANOE, name: 'Canoa de Guerra', emoji: '⚓',
    isRanged: true, isCavalry: false,
    description: 'Canoa blindada con arqueros. Dispara flechas a corta distancia.',
    stats: { maxHp: 100, attack: 22, defense: 12, speed: 3.5, attackRange: 4.0, sight: 9, attackCooldown: 1.8 },
  },
  // ── NAVAL — CONQUISTADOR ───────────────────────────────
  [UnitType.BRIGANTINE]: {
    type: UnitType.BRIGANTINE, name: 'Bergantín', emoji: '⛵',
    isRanged: true, isCavalry: false,
    description: 'Buque ligero español. Dispara cañonazos a media distancia.',
    stats: { maxHp: 150, attack: 35, defense: 18, speed: 3.0, attackRange: 6.0, sight: 10, attackCooldown: 3.5 },
  },
  [UnitType.GALLEON]: {
    type: UnitType.GALLEON, name: 'Galeón', emoji: '🚢',
    isRanged: true, isCavalry: false,
    description: 'Poderoso galeón de guerra con cañones pesados. Domina el océano.',
    stats: { maxHp: 280, attack: 70, defense: 30, speed: 2.0, attackRange: 9.0, sight: 12, attackCooldown: 5.0 },
  },
  // ── MAPUCHE ────────────────────────────────────────────
  [UnitType.WEICHAFE]: {
    type: UnitType.WEICHAFE, name: 'Weichafe', emoji: '🪓',
    isRanged: false, isCavalry: false,
    description: 'Guerrero mapuche: rápido, barato y feroz. La columna vertebral de Arauco.',
    stats: { maxHp: 85, attack: 17, defense: 11, speed: 3.6, attackRange: 1.5, sight: 6, attackCooldown: 1.4 },
  },
  [UnitType.LANCERO_MAPUCHE]: {
    type: UnitType.LANCERO_MAPUCHE, name: 'Lancero de Arauco', emoji: '🔱',
    isRanged: false, isCavalry: false,
    description: 'Pica larga adoptada para destrozar la caballería española. Su especialidad histórica.',
    stats: { maxHp: 95, attack: 16, defense: 14, speed: 2.9, attackRange: 2.0, sight: 5, attackCooldown: 1.5 },
  },
  [UnitType.BOLEADORA]: {
    type: UnitType.BOLEADORA, name: 'Boleador', emoji: '🪃',
    isRanged: true, isCavalry: false,
    description: 'Lanza boleadoras que enredan las piernas de cualquier enemigo — incluso jinetes.',
    stats: { maxHp: 55, attack: 13, defense: 6, speed: 3.2, attackRange: 4.5, sight: 7, attackCooldown: 1.7 },
  },
  [UnitType.TOQUI]: {
    type: UnitType.TOQUI, name: 'Toqui', emoji: '🗿',
    isRanged: false, isCavalry: false,
    description: 'Jefe de guerra portador del hacha toki. Élite que lidera desde el frente.',
    stats: { maxHp: 145, attack: 27, defense: 17, speed: 3.0, attackRange: 1.5, sight: 7, attackCooldown: 1.7 },
  },
  // ── ESPIRITUAL ─────────────────────────────────────────
  [UnitType.SHAMAN]: {
    type: UnitType.SHAMAN, name: 'Chamán', emoji: '🌀',
    isRanged: false, isCavalry: false,
    description: 'Chamán nativo. Cura aliados y puede maldecir enemigos cercanos.',
    stats: { maxHp: 55, attack: 8, defense: 6, speed: 2.5, attackRange: 3.0, sight: 7, attackCooldown: 2.5 },
  },
  [UnitType.MISSIONARY]: {
    type: UnitType.MISSIONARY, name: 'Misionero', emoji: '✝️',
    isRanged: false, isCavalry: false,
    description: 'Convierte unidades enemigas al bando español con el tiempo.',
    stats: { maxHp: 50, attack: 5, defense: 5, speed: 2.5, attackRange: 3.5, sight: 7, attackCooldown: 4.0 },
  },
  // ── MANDO (estilo American Conquest) ───────────────────
  [UnitType.OFFICER]: {
    type: UnitType.OFFICER, name: 'Oficial', emoji: '🎖️',
    isRanged: false, isCavalry: false,
    description: 'Líder de campo. Los aliados a 5 casillas luchan con más disciplina (+ataque/defensa).',
    stats: { maxHp: 110, attack: 18, defense: 16, speed: 3.0, attackRange: 1.5, sight: 8, attackCooldown: 1.6 },
  },
  [UnitType.DRUMMER]: {
    type: UnitType.DRUMMER, name: 'Tambor', emoji: '🥁',
    isRanged: false, isCavalry: false,
    description: 'Marca el ritmo de marcha. Aliados cercanos recuperan moral 2× más rápido y resisten el pánico.',
    stats: { maxHp: 60, attack: 4, defense: 8, speed: 3.2, attackRange: 1.5, sight: 6, attackCooldown: 2.5 },
  },
};

export const CIVILIZATIONS: Record<CivilizationType, CivDef> = {
  [CivilizationType.AZTEC]: {
    type: CivilizationType.AZTEC,
    name: 'Imperio Azteca',
    emoji: '🦅',
    color: 0x1aaa60,
    accentColor: 0x0d7040,
    description: 'El poderoso Imperio Mexica, maestros de la guerra florida.',
    units: [UNIT_DEFS[UnitType.EAGLE_WARRIOR], UNIT_DEFS[UnitType.JAGUAR_KNIGHT], UNIT_DEFS[UnitType.ATLATL], UNIT_DEFS[UnitType.CUACHIC], UNIT_DEFS[UnitType.CANOE], UNIT_DEFS[UnitType.WAR_CANOE], UNIT_DEFS[UnitType.SHAMAN], UNIT_DEFS[UnitType.OFFICER], UNIT_DEFS[UnitType.DRUMMER]],
    startUnits: [
      ...Array(6).fill(UnitType.EAGLE_WARRIOR),
      ...Array(3).fill(UnitType.JAGUAR_KNIGHT),
      ...Array(4).fill(UnitType.ATLATL),
      ...Array(2).fill(UnitType.CUACHIC),
    ],
  },
  [CivilizationType.INCA]: {
    type: CivilizationType.INCA,
    name: 'Tawantinsuyu',
    emoji: '🌄',
    color: 0xd4a810,
    accentColor: 0xa07808,
    description: 'El vasto Imperio Inca, maestros de organización y arquitectura.',
    units: [UNIT_DEFS[UnitType.QUECHUA], UNIT_DEFS[UnitType.SLINGER], UNIT_DEFS[UnitType.CHAKANA_GUARD], UNIT_DEFS[UnitType.ANTIS_WARRIOR], UNIT_DEFS[UnitType.CANOE], UNIT_DEFS[UnitType.SHAMAN], UNIT_DEFS[UnitType.OFFICER], UNIT_DEFS[UnitType.DRUMMER]],
    startUnits: [
      ...Array(6).fill(UnitType.QUECHUA),
      ...Array(4).fill(UnitType.SLINGER),
      ...Array(3).fill(UnitType.CHAKANA_GUARD),
      ...Array(3).fill(UnitType.ANTIS_WARRIOR),
    ],
  },
  [CivilizationType.MAYA]: {
    type: CivilizationType.MAYA,
    name: 'Ciudades-Estado Mayas',
    emoji: '🌿',
    color: 0x20b040,
    accentColor: 0x107828,
    description: 'Las ciudades-estado mayas, guerreros de la selva y ciencias avanzadas.',
    units: [UNIT_DEFS[UnitType.SPEARMAN], UNIT_DEFS[UnitType.ARCHER], UNIT_DEFS[UnitType.AHAU_WARRIOR], UNIT_DEFS[UnitType.BALAM_JAGUAR], UNIT_DEFS[UnitType.WAR_CANOE], UNIT_DEFS[UnitType.SHAMAN], UNIT_DEFS[UnitType.OFFICER], UNIT_DEFS[UnitType.DRUMMER]],
    startUnits: [
      ...Array(6).fill(UnitType.SPEARMAN),
      ...Array(4).fill(UnitType.ARCHER),
      ...Array(3).fill(UnitType.AHAU_WARRIOR),
      ...Array(3).fill(UnitType.BALAM_JAGUAR),
    ],
  },
  [CivilizationType.CONQUISTADOR]: {
    type: CivilizationType.CONQUISTADOR,
    name: 'Conquistadores',
    emoji: '⚔️',
    color: 0xcc2020,
    accentColor: 0x901010,
    description: 'Soldados europeos con tecnología superior: acero, pólvora y caballos.',
    units: [UNIT_DEFS[UnitType.SOLDIER], UNIT_DEFS[UnitType.ARQUEBUSIER], UNIT_DEFS[UnitType.CAVALRY], UNIT_DEFS[UnitType.CANNON], UNIT_DEFS[UnitType.BRIGANTINE], UNIT_DEFS[UnitType.GALLEON], UNIT_DEFS[UnitType.MISSIONARY], UNIT_DEFS[UnitType.OFFICER], UNIT_DEFS[UnitType.DRUMMER]],
    startUnits: [
      ...Array(5).fill(UnitType.SOLDIER),
      ...Array(4).fill(UnitType.ARQUEBUSIER),
      ...Array(4).fill(UnitType.CAVALRY),
      ...Array(2).fill(UnitType.CANNON),
    ],
  },
  [CivilizationType.MAPUCHE]: {
    type: CivilizationType.MAPUCHE,
    name: 'Nación Mapuche',
    emoji: '🌋',
    color: 0x3a7bd5,
    accentColor: 0x2255a0,
    description: 'El pueblo indómito del Wallmapu: 300 años resistiendo a los imperios con guerrilla y picas.',
    units: [UNIT_DEFS[UnitType.WEICHAFE], UNIT_DEFS[UnitType.LANCERO_MAPUCHE], UNIT_DEFS[UnitType.BOLEADORA], UNIT_DEFS[UnitType.TOQUI], UNIT_DEFS[UnitType.CANOE], UNIT_DEFS[UnitType.WAR_CANOE], UNIT_DEFS[UnitType.SHAMAN], UNIT_DEFS[UnitType.OFFICER], UNIT_DEFS[UnitType.DRUMMER]],
    startUnits: [
      ...Array(6).fill(UnitType.WEICHAFE),
      ...Array(4).fill(UnitType.LANCERO_MAPUCHE),
      ...Array(4).fill(UnitType.BOLEADORA),
      ...Array(2).fill(UnitType.TOQUI),
    ],
  },
};

export function getUnitDef(type: UnitType): UnitDef {
  return UNIT_DEFS[type];
}
