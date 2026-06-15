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
  KILL_MILESTONE = 'KILL_MILESTONE',
  TRAIN_ARMY = 'TRAIN_ARMY',
}

export interface ObjectiveReward {
  food?: number;
  gold?: number;
  stone?: number;
  wood?: number;
}

export interface Objective {
  type: ObjectiveType;
  title: string;
  description: string;
  target: number;
  progress: number;
  completed: boolean;
  reward?: ObjectiveReward;
}

export class ObjectiveSystem {
  objectives: Objective[] = [];
  /** Objectives that just completed this frame — consumed by main.ts for notifications + rewards. */
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
      reward: { food: 150, gold: 80 },
    });

    this.objectives.push({
      type: ObjectiveType.CONTROL_TERRITORY,
      title: 'Domina regiones',
      description: 'Controla 15 edificios en diferentes regiones',
      target: 15,
      progress: 0,
      completed: false,
      reward: { food: 100, stone: 100 },
    });

    this.objectives.push({
      type: ObjectiveType.CAPTURE_VILLAGES,
      title: 'Controla aldeas',
      description: 'Captura 3 aldeas neutrales',
      target: 3,
      progress: 0,
      completed: false,
      reward: { gold: 120 },
    });

    this.objectives.push({
      type: ObjectiveType.BUILD_WONDERS,
      title: 'Gran Maravilla',
      description: 'Construye una Gran Maravilla',
      target: 1,
      progress: 0,
      completed: false,
    });

    this.objectives.push({
      type: ObjectiveType.RESEARCH_TECH,
      title: 'Avance tecnológico',
      description: 'Investiga 3 tecnologías',
      target: 3,
      progress: 0,
      completed: false,
      reward: { gold: 100, food: 80 },
    });

    this.objectives.push({
      type: ObjectiveType.KILL_MILESTONE,
      title: 'Primera victoria militar',
      description: 'Elimina 25 unidades enemigas',
      target: 25,
      progress: 0,
      completed: false,
      reward: { food: 200, gold: 50 },
    });

    this.objectives.push({
      type: ObjectiveType.TRAIN_ARMY,
      title: 'Forja tu ejército',
      description: 'Entrena 20 unidades militares',
      target: 20,
      progress: 0,
      completed: false,
      reward: { stone: 150, wood: 150 },
    });

    this.objectives.push({
      type: ObjectiveType.SURVIVE_TIME,
      title: 'Resistencia histórica',
      description: 'Sobrevive 10 minutos con al menos un asentamiento en pie',
      target: 600,
      progress: 0,
      completed: false,
      reward: { food: 200, stone: 100 },
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
        case ObjectiveType.RESEARCH_TECH:
          obj.progress = player.techs.completedCount;
          break;
        case ObjectiveType.KILL_MILESTONE:
          obj.progress = game.killsByPlayer.get(player.id) ?? 0;
          break;
        case ObjectiveType.TRAIN_ARMY:
          obj.progress = Math.min(obj.target, player.aliveUnits.filter(u => !u.isHero).length);
          break;
        case ObjectiveType.SURVIVE_TIME:
          // Only count time while the human player still has a settlement standing
          if (game.allBuildings.some(b => b.playerId === player.id && b.type === BuildingType.SETTLEMENT && b.isAlive())) {
            obj.progress = Math.min(obj.target, Math.floor(game.gameTime));
          }
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
