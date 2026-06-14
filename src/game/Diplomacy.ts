import { CivilizationType } from './types';

export enum AllianceType {
  ENEMY = 'ENEMY',
  NEUTRAL = 'NEUTRAL',
  ALLY = 'ALLY',
}

export interface DiplomacyProposal {
  fromPlayerId: number;
  toPlayerId: number;
  proposedRelation: AllianceType;
  goldBribe: number;
}

export class DiplomacyManager {
  private relations = new Map<string, AllianceType>();

  setRelation(civA: number, civB: number, type: AllianceType) {
    const key = this.key(civA, civB);
    this.relations.set(key, type);
  }

  getRelation(civA: number, civB: number): AllianceType {
    const key = this.key(civA, civB);
    return this.relations.get(key) ?? AllianceType.ENEMY;
  }

  isEnemy(civA: number, civB: number): boolean {
    return this.getRelation(civA, civB) === AllianceType.ENEMY;
  }

  isAlly(civA: number, civB: number): boolean {
    return this.getRelation(civA, civB) === AllianceType.ALLY;
  }

  getAllRelations(playerId: number, totalPlayers: number): { targetId: number; relation: AllianceType }[] {
    const result: { targetId: number; relation: AllianceType }[] = [];
    for (let i = 0; i < totalPlayers; i++) {
      if (i === playerId) continue;
      result.push({ targetId: i, relation: this.getRelation(playerId, i) });
    }
    return result;
  }

  /**
   * Evaluate whether an AI player would accept a diplomatic proposal.
   * Returns true if accepted.
   * @param aiStrength 0..1 — relative military strength of the AI (1 = strong)
   * @param aiGold current gold reserves of the AI player
   */
  evaluateAIAcceptance(
    proposal: DiplomacyProposal,
    aiStrength: number,
    _aiGold: number,
  ): boolean {
    const rng = Math.random();
    if (proposal.proposedRelation === AllianceType.NEUTRAL) {
      // Accept ceasefire more readily when weak, or with a large bribe
      const bribeBonus = Math.min(0.4, proposal.goldBribe / 200);
      const weakBonus  = aiStrength < 0.4 ? 0.35 : 0;
      return rng < 0.30 + bribeBonus + weakBonus;
    } else if (proposal.proposedRelation === AllianceType.ALLY) {
      // Alliance requires significant bribe or AI is in trouble
      const bribeBonus = Math.min(0.3, proposal.goldBribe / 300);
      const weakBonus  = aiStrength < 0.3 ? 0.30 : 0;
      return rng < 0.15 + bribeBonus + weakBonus;
    } else {
      // Declaring war — always accepted (declaring war is always "accepted" by the target)
      return true;
    }
  }

  private key(a: number, b: number): string {
    return a < b ? `${a}-${b}` : `${b}-${a}`;
  }

  init() {
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        this.setRelation(i, j, AllianceType.ENEMY);
      }
    }
  }
}

export function civEmoji(civ: CivilizationType): string {
  switch (civ) {
    case CivilizationType.AZTEC:        return '🦅';
    case CivilizationType.MAYA:         return '🔭';
    case CivilizationType.INCA:         return '🌄';
    case CivilizationType.CONQUISTADOR: return '⚔️';
  }
}
