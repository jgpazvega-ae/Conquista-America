import { UnitType } from './types';

export type WeatherState = 'CLEAR' | 'RAIN' | 'STORM' | 'DROUGHT';

const BASE_DURATION: Record<WeatherState, number> = {
  CLEAR:   180,
  RAIN:    120,
  STORM:    60,
  DROUGHT: 150,
};

const TRANSITIONS: Record<WeatherState, WeatherState[]> = {
  CLEAR:   ['RAIN', 'DROUGHT', 'CLEAR', 'CLEAR'],  // CLEAR is most common
  RAIN:    ['CLEAR', 'STORM', 'RAIN'],
  STORM:   ['RAIN', 'CLEAR'],
  DROUGHT: ['CLEAR', 'CLEAR', 'DROUGHT'],
};

export const WEATHER_ICONS: Record<WeatherState, string> = {
  CLEAR:   '☀️',
  RAIN:    '🌧️',
  STORM:   '⛈️',
  DROUGHT: '🏜️',
};

export const WEATHER_NAMES: Record<WeatherState, string> = {
  CLEAR:   'Despejado',
  RAIN:    'Lluvia',
  STORM:   'Tormenta',
  DROUGHT: 'Sequía',
};

export const WEATHER_TIPS: Record<WeatherState, string> = {
  CLEAR:   '',
  RAIN:    'Lluvia — pólvora mojada: arcabuceros y cañones ×0.5 daño · barro: movimiento ×0.9',
  STORM:   'Tormenta — unidades a distancia ×0.6 daño · barro: movimiento ×0.8',
  DROUGHT: 'Sequía — riesgo de incendio ×2 · cosechas marchitas: recolección de comida ×0.7',
};

export class WeatherSystem {
  state: WeatherState = 'CLEAR';
  /** Next weather state — pre-picked so forecasts can be shown in advance. */
  nextState: WeatherState = 'CLEAR';
  /** Set to true once per transition when ≤30s remain — consumed by main.ts. */
  forecastFired = false;
  private _timer = 0;
  private _nextChange = BASE_DURATION.CLEAR + Math.random() * 60;

  constructor() {
    this.nextState = this._pickNext('CLEAR');
  }

  private _pickNext(current: WeatherState): WeatherState {
    const choices = TRANSITIONS[current];
    return choices[Math.floor(Math.random() * choices.length)];
  }

  /** Tick weather; returns new state name if weather just changed, else null. */
  update(dt: number): WeatherState | null {
    this._timer += dt;

    // Forecast: fire once when 30s remain before transition (and next state differs)
    if (!this.forecastFired && this._nextChange - this._timer <= 30 && this.nextState !== this.state) {
      this.forecastFired = true;
    }

    if (this._timer < this._nextChange) return null;

    this._timer = 0;
    this.state = this.nextState;
    this._nextChange = BASE_DURATION[this.state] + Math.random() * 60;
    this.nextState = this._pickNext(this.state);
    this.forecastFired = false;
    return this.state;
  }

  /** Damage multiplier for a given attacker unit type under current weather. */
  damageMultiplier(type: UnitType): number {
    if (this.state === 'RAIN') {
      if (type === UnitType.ARQUEBUSIER || type === UnitType.CANNON) return 0.5;
    }
    if (this.state === 'STORM') {
      const ranged = [UnitType.ARCHER, UnitType.ATLATL, UnitType.SLINGER, UnitType.ARQUEBUSIER, UnitType.CANNON];
      if (ranged.includes(type)) return 0.6;
    }
    return 1.0;
  }

  /** Multiplier applied to cannon/jungle burn chance. */
  get burnChanceMult(): number {
    if (this.state === 'RAIN' || this.state === 'STORM') return 0.0;
    if (this.state === 'DROUGHT') return 2.0;
    return 1.0;
  }

  /** Fraction of remaining game-time before the next weather transition (0-1). */
  get progress(): number {
    return Math.min(1, this._timer / this._nextChange);
  }
}
