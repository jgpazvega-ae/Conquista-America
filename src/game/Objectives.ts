import type { Game } from './Game';
import type { Player } from './Player';

export enum ObjectiveType {
  ELIMINATE_ENEMY = 'ELIMINATE_ENEMY',
  CONTROL_TERRITORY = 'CONTROL_TERRITORY',
  REACH_POPULATION = 'REACH_POPULATION',
  RESEARCH_TECH = 'RESEARCH_TECH',
  SURVIVE_TIME = 'SURVIVE_TIME',
  BUILD_WONDERS = 'BUILD_WONDERS',
}

export interface Objective {
  type: ObjectiveType;
  title: string;
  description: string;
  target: number;
  progress: number;
  completed: boolean;
}

export class ObjectiveSystem {
  objectives: Objective[] = [];

  constructor(game: Game) {
    this.generateObjectives(game);
  }

  private generateObjectives(game: Game) {
    // Objective 1: Eliminate all enemies
    this.objectives.push({
      type: ObjectiveType.ELIMINATE_ENEMY,
      title: 'Elimina a todos los enemigos',
      description: 'Destruye todas las unidades enemigas y sus asentamientos',
      target: 3, // 3 civs to eliminate
      progress: 0,
      completed: false,
    });

    // Objective 2: Reach population
    this.objectives.push({
      type: ObjectiveType.REACH_POPULATION,
      title: 'Expande tu imperio',
      description: 'Alcanza 40 unidades',
      target: 40,
      progress: 0,
      completed: false,
    });

    // Objective 3: Control territory
    this.objectives.push({
      type: ObjectiveType.CONTROL_TERRITORY,
      title: 'Domina regiones',
      description: 'Controla 15 edificios en diferentes regiones',
      target: 15,
      progress: 0,
      completed: false,
    });
  }

  update(game: Game) {
    const player = game.humanPlayer;

    // Update objective progress
    for (const obj of this.objectives) {
      if (obj.completed) continue;

      switch (obj.type) {
        case ObjectiveType.ELIMINATE_ENEMY:
          obj.progress = game.players.filter(p => p.id !== player.id && p.isDefeated()).length;
          break;

        case ObjectiveType.REACH_POPULATION:
          obj.progress = player.aliveUnits.length;
          break;

        case ObjectiveType.CONTROL_TERRITORY:
          obj.progress = game.allBuildings.filter(b => b.playerId === player.id && b.isComplete()).length;
          break;
      }

      if (obj.progress >= obj.target) {
        obj.completed = true;
      }
    }
  }

  getProgress(): number {
    const completed = this.objectives.filter(o => o.completed).length;
    return (completed / this.objectives.length) * 100;
  }

  allCompleted(): boolean {
    return this.objectives.every(o => o.completed);
  }
}
