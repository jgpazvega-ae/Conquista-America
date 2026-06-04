import type { Player } from './Player';
import type { Game } from './Game';

export interface EconomyStats {
  foodProduction: number;
  goldProduction: number;
  stoneProduction: number;
  foodConsumption: number;
  goldConsumption: number;
  stoneConsumption: number;
  netProduction: { food: number; gold: number; stone: number };
}

export class EconomyManager {
  private stats: Map<number, EconomyStats> = new Map();
  private lastUpdate = 0;
  private updateInterval = 5.0; // seconds

  update(dt: number, game: Game) {
    this.lastUpdate += dt;
    if (this.lastUpdate < this.updateInterval) return;
    this.lastUpdate = 0;

    for (const player of game.players) {
      const stats = this.calculateStats(player, game);
      this.stats.set(player.id, stats);

      // Auto-apply resource generation
      if (!player.isHuman) {
        // AI gets slight resource bonus
        player.resources.food += stats.netProduction.food * 0.1;
        player.resources.gold += stats.netProduction.gold * 0.1;
        player.resources.stone += stats.netProduction.stone * 0.1;
      }
    }
  }

  private calculateStats(player: Player, game: Game): EconomyStats {
    let foodProd = 50; // base
    let goldProd = 30;
    let stoneProd = 40;

    // Count workers and their efficiency
    const playerWorkers = game.allWorkers.filter(w => w.playerId === player.id);
    foodProd += playerWorkers.length * 15;
    goldProd += (playerWorkers.length / 2) * 20;
    stoneProd += playerWorkers.length * 18;

    // Count buildings and their bonuses
    for (const building of game.allBuildings) {
      if (building.playerId !== player.id || !building.isComplete()) continue;

      if (building.type === 'STOREHOUSE') {
        foodProd += 30;
        goldProd += 20;
        stoneProd += 35;
      } else if (building.type === 'SETTLEMENT') {
        foodProd += 50;
      } else if (building.type === 'FORGE') {
        goldProd += 40;
      }
    }

    // Unit consumption
    const unitCount = player.aliveUnits.length;
    const foodConsumption = unitCount * 1.5;
    const goldConsumption = unitCount * 0.5;
    const stoneConsumption = 0;

    return {
      foodProduction: foodProd,
      goldProduction: goldProd,
      stoneProduction: stoneProd,
      foodConsumption,
      goldConsumption,
      stoneConsumption,
      netProduction: {
        food: foodProd - foodConsumption,
        gold: goldProd - goldConsumption,
        stone: stoneProd - stoneConsumption,
      },
    };
  }

  getStats(playerId: number): EconomyStats | undefined {
    return this.stats.get(playerId);
  }
}
