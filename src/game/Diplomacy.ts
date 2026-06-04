export enum AllianceType {
  ENEMY = 'ENEMY',
  NEUTRAL = 'NEUTRAL',
  ALLY = 'ALLY',
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

  private key(a: number, b: number): string {
    return a < b ? `${a}-${b}` : `${b}-${a}`;
  }

  init() {
    // All are enemies by default in this game
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        this.setRelation(i, j, AllianceType.ENEMY);
      }
    }
  }
}
