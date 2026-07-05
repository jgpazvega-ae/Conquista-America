import type { Player } from './Player';
import type { Game } from './Game';
import { BuildingType } from './buildings';

export interface EconomyStats {
  foodProduction: number;
  goldProduction: number;
  stoneProduction: number;
  woodProduction: number;
  foodConsumption: number;
  goldConsumption: number;
  stoneConsumption: number;
  netProduction: { food: number; gold: number; stone: number; wood: number };
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

      // Apply passive income; cap at 2000 to avoid runaway accumulation
      const rate = player.isHuman ? 0.25 : 0.35; // AI slight advantage for difficulty
      const cap  = 2000;
      player.resources.food  = Math.min(cap, Math.max(0, player.resources.food  + stats.netProduction.food  * rate));
      player.resources.gold  = Math.min(cap, Math.max(0, player.resources.gold  + stats.netProduction.gold  * rate));
      player.resources.stone = Math.min(cap, Math.max(0, player.resources.stone + stats.netProduction.stone * rate));
      player.resources.wood  = Math.min(cap, Math.max(0, (player.resources.wood ?? 0) + stats.netProduction.wood * rate));

      // Forge smelting (AC style): each Forge burns charcoal and smelts ore every cycle —
      // 4🪵 → 2⚫ and 4🪨 → 2🔩. Only runs while powder stocks are low (<300) so the
      // Forge never drains the building economy once the arsenal is full.
      const forges = game.allBuildings.filter(
        b => b.playerId === player.id && (b.type as string) === 'FORGE' && b.isComplete(),
      ).length;
      for (let i = 0; i < forges; i++) {
        if ((player.resources.coal ?? 0) < 300 && (player.resources.wood ?? 0) >= 4) {
          player.resources.wood -= 4;
          player.resources.coal = (player.resources.coal ?? 0) + 2;
        }
        if ((player.resources.iron ?? 0) < 300 && player.resources.stone >= 4) {
          player.resources.stone -= 4;
          player.resources.iron = (player.resources.iron ?? 0) + 2;
        }
      }
    }
  }

  private calculateStats(player: Player, game: Game): EconomyStats {
    let foodProd  = 50; // base
    let goldProd  = 30;
    let stoneProd = 40;
    let woodProd  = 20;

    // Count workers by task for per-resource attribution
    const playerWorkers = game.allWorkers.filter(w => w.playerId === player.id);
    const gatheringFood  = playerWorkers.filter(w => (w.task as string).includes('FOOD')).length;
    const gatheringGold  = playerWorkers.filter(w => (w.task as string).includes('GOLD')).length;
    const gatheringStone = playerWorkers.filter(w => (w.task as string).includes('STONE')).length;
    const gatheringWood  = playerWorkers.filter(w => (w.task as string).includes('WOOD')).length;
    const allGathering   = playerWorkers.length;
    foodProd  += gatheringFood  * 25 + (allGathering - gatheringFood)  * 5;
    goldProd  += gatheringGold  * 30 + (allGathering - gatheringGold)  * 5;
    stoneProd += gatheringStone * 28 + (allGathering - gatheringStone) * 5;
    woodProd  += gatheringWood  * 22 + (allGathering - gatheringWood)  * 3;

    // Count buildings and their bonuses
    for (const building of game.allBuildings) {
      if (building.playerId !== player.id || !building.isComplete()) continue;

      switch (building.type as string) {
        case 'STOREHOUSE': foodProd += 30; goldProd += 20; stoneProd += 35; woodProd += 15; break;
        case 'SETTLEMENT': foodProd += 50; break;
        case 'FARM':       foodProd += 50; break; // milpa/chacra — passive crop production
        case 'FORGE':      goldProd += 40; break;
        case 'MARKET':     goldProd += 10; break; // market adds passive gold (5/30s × 5s interval = ~0.83, show as 10 for legibility)
        case 'HARBOR':     woodProd += 10; break; // harbor enables naval timber trade
      }
    }

    // Trade routes: pairs of Storehouses within 10 tiles (max 2 active routes)
    const stores = game.allBuildings.filter(b => b.playerId === player.id && b.isComplete() && b.type === BuildingType.STOREHOUSE);
    let routes = 0;
    for (let i = 0; i < stores.length && routes < 2; i++) {
      for (let j = i + 1; j < stores.length && routes < 2; j++) {
        const d = Math.sqrt((stores[i].col - stores[j].col) ** 2 + (stores[i].row - stores[j].row) ** 2);
        if (d <= 10) routes++;
      }
    }
    goldProd += routes * 20;

    // Unit consumption
    const unitCount = player.aliveUnits.length;
    const foodConsumption  = unitCount * 1.5;
    const goldConsumption  = unitCount * 0.5;
    const stoneConsumption = 0;
    const woodConsumption  = 0;

    return {
      foodProduction: foodProd,
      goldProduction: goldProd,
      stoneProduction: stoneProd,
      woodProduction: woodProd,
      foodConsumption,
      goldConsumption,
      stoneConsumption,
      netProduction: {
        food:  foodProd  - foodConsumption,
        gold:  goldProd  - goldConsumption,
        stone: stoneProd - stoneConsumption,
        wood:  woodProd  - woodConsumption,
      },
    };
  }

  getStats(playerId: number): EconomyStats | undefined {
    return this.stats.get(playerId);
  }
}
