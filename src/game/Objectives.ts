import type { Game } from './Game';
import { BuildingType } from './buildings';

export enum ObjectiveType {
  ELIMINATE_ENEMY = 'ELIMINATE_ENEMY',
  CONTROL_TERRITORY = 'CONTROL_TERRITORY',
  REACH_POPULATION = 'REACH_POPULATION',
  RESEARCH_TECH = 'RESEARCH_TECH',
  SURVIVE_TIME = 'SURVIVE_TIME',
  BUILD_WONDERS = 'BUILD_WONDERS',
  CAPTURE_VILLAGES = 'CAPTURE_VILLAGES',
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
  /** IDs of objectives that just completed this frame — consumed by main.ts for notifications. */
  newlyCompleted: ObjectiveType[] = [];

  constructor(game: Game) {
    this.generateObjectives(game);
  }

  private generateObjectives(_game: Game) {
    this.objectives.push({
      type: ObjectiveType.ELIMINATE_ENEMY,
      title: 'Elimina a todos los enemigos',
      description: 'Destruye todas las unidades enemigas y sus asentamientos',
      target: 3,
      progress: 0,
      completed: false,
    });

    this.objectives.push({
      type: ObjectiveType.REACH_POPULATION,
      title: 'Expande tu imperio',
      description: 'Alcanza 40 unidades',
      target: 40,
      progress: 0,
      completed: false,
    });

    this.objectives.push({
      type: ObjectiveType.CONTROL_TERRITORY,
      title: 'Domina regiones',
      description: 'Controla 15 edificios en diferentes regiones',
      target: 15,
      progress: 0,
      completed: false,
    });

    this.objectives.push({
      type: ObjectiveType.CAPTURE_VILLAGES,
      title: 'Controla aldeas',
      description: 'Captura 3 aldeas neutrales',
      target: 3,
      progress: 0,
      completed: false,
    });

    this.objectives.push({
      type: ObjectiveType.BUILD_WONDERS,
      title: 'Gran Maravilla',
      description: 'Construye una Gran Maravilla',
      target: 1,
      progress: 0,
      completed: false,
    });
  }

  update(game: Game) {
    this.newlyCompleted = [];
    const player = game.humanPlayer;

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
        case ObjectiveType.CAPTURE_VILLAGES:
          obj.progress = game.allBuildings.filter(
            b => b.type === BuildingType.VILLAGE && b.playerId === player.id && b.isAlive(),
          ).length;
          break;
        case ObjectiveType.BUILD_WONDERS:
          obj.progress = game.allBuildings.filter(
            b => b.type === BuildingType.WONDER && b.playerId === player.id && b.isComplete(),
          ).length;
          break;
      }

      if (obj.progress >= obj.target) {
        obj.completed = true;
        this.newlyCompleted.push(obj.type);
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
