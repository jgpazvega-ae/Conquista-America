import { CivilizationType } from './types';
import type { Unit } from './Unit';

export enum PowerType {
  AZTEC_SACRIFICE = 'AZTEC_SACRIFICE',          // Sacrifica unidad para +50 oro
  INCA_UNITY = 'INCA_UNITY',                    // Todas las unidades ganan +20% stats por 30s
  MAYA_PROPHECY = 'MAYA_PROPHECY',              // Revela posición de enemigos por 20s
  CONQUISTADOR_CONQUISTADOR = 'CONQUISTADOR_CONQUISTADOR', // Conquistadores ganan +100% daño vs civs nativas
}

export interface PowerDef {
  type: PowerType;
  name: string;
  emoji: string;
  cooldownSeconds: number;
  description: string;
  apply: (unit?: Unit) => void;
}

export const CIV_POWERS: Record<CivilizationType, PowerType> = {
  [CivilizationType.AZTEC]: PowerType.AZTEC_SACRIFICE,
  [CivilizationType.INCA]: PowerType.INCA_UNITY,
  [CivilizationType.MAYA]: PowerType.MAYA_PROPHECY,
  [CivilizationType.CONQUISTADOR]: PowerType.CONQUISTADOR_CONQUISTADOR,
};

export interface CivPowerState {
  cooldown: number;
  maxCooldown: number;
  active: boolean;
  activeTimer: number;
}
