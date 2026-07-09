import { CivilizationType } from '../game/types';
import { CIVILIZATIONS } from '../game/civilizations';
import { CIV_COLORS, CIV_NAMES, CIV_EMOJIS } from '../game/constants';
import type { SaveSystem } from '../game/SaveSystem';
import { SCENARIOS } from '../game/Scenarios';
import type { ScenarioDef } from '../game/Scenarios';

function hex(n: number | undefined): string {
  return '#' + (n ?? 0x888888).toString(16).padStart(6, '0');
}

// A session/profile from an older build may carry a civType that no longer exists.
// Coerce anything unknown back to a valid civilization so rendering never crashes.
function validCiv(civ: CivilizationType | undefined): CivilizationType {
  return civ != null && CIV_COLORS[civ] !== undefined ? civ : CivilizationType.AZTEC;
}

const CIV_DESCRIPTIONS: Record<CivilizationType, string> = {
  [CivilizationType.AZTEC]: `El poderoso Imperio Mexica dominó Mesoamérica desde Tenochtitlán. Sus guerreros Águila y Jaguar eran temidos en toda la región. Practica la guerra florida para capturar enemigos y ofrecerlos a los dioses.`,
  [CivilizationType.INCA]: `El Tawantinsuyu, el vasto Imperio Inca, se extendía por toda la cordillera de los Andes desde Ecuador hasta Chile. Su sistema de caminos, los quipus y su organización militar eran legendarios.`,
  [CivilizationType.MAYA]: `Las ciudades-estado mayas florecieron en Yucatán y Centroamérica con avanzados conocimientos en astronomía, matemáticas y escritura. Sus guerreros son expertos en el terreno selvático.`,
  [CivilizationType.CONQUISTADOR]: `Los soldados españoles y portugueses llegaron al Nuevo Mundo con una ventaja tecnológica decisiva: acero toledano, arcabuces, cañones y caballos. Su objetivo: el oro y la gloria.`,
};

const CIV_BONUSES: Record<CivilizationType, string[]> = {
  [CivilizationType.AZTEC]: [
    '🦅 Guerreros Águila +30% velocidad',
    '⚡ Ataque inicial más agresivo',
    '🔱 Tecnología: Élite Jaguar (+50% daño)',
  ],
  [CivilizationType.INCA]: [
    '🌄 Honderos +35% rango de ataque',
    '🛣️ Tecnología: Caminos (+30% movimiento)',
    '🛡️ Chakana Guard: mejor defensa del juego',
  ],
  [CivilizationType.MAYA]: [
    '🌿 Arqueros más precisos que cualquier otro',
    '⭐ Tecnología: Astronomía (+2 visión)',
    '👑 Guerrero Ahau inspira a unidades cercanas',
  ],
  [CivilizationType.CONQUISTADOR]: [
    '💥 Arcabuceros: +40% daño con Pólvora',
    '🐎 Caballería: la unidad más rápida del juego',
    '💣 Cañones: destrozan edificios y defensa',
  ],
};

const CIV_DIFFICULTY: Record<CivilizationType, string> = {
  [CivilizationType.AZTEC]: 'Intermedio',
  [CivilizationType.INCA]:  'Difícil',
  [CivilizationType.MAYA]:  'Fácil',
  [CivilizationType.CONQUISTADOR]: 'Muy Difícil',
};

const CIV_PLAYSTYLE: Record<CivilizationType, string> = {
  [CivilizationType.AZTEC]: 'Agresivo / Rush',
  [CivilizationType.INCA]:  'Balanceado / Económico',
  [CivilizationType.MAYA]:  'Ranged / Táctico',
  [CivilizationType.CONQUISTADOR]: 'Tecnológico / Control',
};

export type Difficulty = 'easy' | 'normal' | 'hard';

export class CivSelectScreen {
  private el: HTMLElement;
  private saveSystem: SaveSystem;
  private selected: CivilizationType = CivilizationType.AZTEC;
  private _difficulty: Difficulty = 'normal';
  private _numAI = 3;
  private onStart: ((civ: CivilizationType) => void) | null = null;
  private onStartScenario: ((scenario: ScenarioDef) => void) | null = null;

  constructor(saveSystem: SaveSystem) {
    this.saveSystem = saveSystem;
    this.el = document.getElementById('civ-select-screen')!;
    this.build();
    this.buildScenarios();
    this.bind();
  }

  getDifficulty(): Difficulty { return this._difficulty; }
  getNumAI(): number { return this._numAI; }

  setOnStart(cb: (civ: CivilizationType) => void) { this.onStart = cb; }
  setOnStartScenario(cb: (scenario: ScenarioDef) => void) { this.onStartScenario = cb; }

  /** Historical scenario buttons in the footer (AC campaign style). */
  private buildScenarios() {
    const row = this.el.querySelector('#scenario-row');
    if (!row) return;
    for (const sc of SCENARIOS) {
      const btn = document.createElement('button');
      btn.className = 'diff-btn';
      btn.textContent = `${sc.emoji} ${sc.name} (${sc.year})`;
      btn.title = sc.description;
      btn.addEventListener('click', () => this.onStartScenario?.(sc));
      row.appendChild(btn);
    }
  }

  show(preferredCiv?: CivilizationType) {
    preferredCiv = validCiv(preferredCiv);
    this.el.classList.remove('hidden');
    this.selectCiv(preferredCiv ?? CivilizationType.AZTEC);
  }

  hide() { this.el.classList.add('hidden'); }

  private build() {
    const grid = this.el.querySelector('#civ-grid')!;
    const civs = [
      CivilizationType.AZTEC,
      CivilizationType.INCA,
      CivilizationType.MAYA,
      CivilizationType.CONQUISTADOR,
    ];

    grid.innerHTML = '';
    civs.forEach(civ => {
      const color = CIV_COLORS[civ];
      const card = document.createElement('div');
      card.className = 'civ-card';
      card.dataset.civ = civ;
      card.style.setProperty('--civ-color', hex(color));
      card.innerHTML = `
        <div class="civ-card-glow"></div>
        <div class="civ-emoji">${CIV_EMOJIS[civ]}</div>
        <div class="civ-card-name">${CIV_NAMES[civ]}</div>
        <div class="civ-card-playstyle">${CIV_PLAYSTYLE[civ]}</div>
        <div class="civ-card-difficulty diff-${CIV_DIFFICULTY[civ].replace(' ', '').toLowerCase()}">${CIV_DIFFICULTY[civ]}</div>
      `;
      grid.appendChild(card);
    });
  }

  private bind() {
    // Civ card clicks
    this.el.querySelector('#civ-grid')!.addEventListener('click', e => {
      const card = (e.target as HTMLElement).closest('.civ-card') as HTMLElement | null;
      if (card?.dataset.civ) this.selectCiv(card.dataset.civ as CivilizationType);
    });

    // Difficulty buttons
    this.el.querySelectorAll('.diff-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._difficulty = (btn as HTMLElement).dataset.diff as Difficulty;
        this.el.querySelectorAll('.diff-btn').forEach(b => b.classList.toggle('diff-selected', b === btn));
      });
    });

    // Enemy count buttons
    this.el.querySelectorAll('.enemy-count-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._numAI = parseInt((btn as HTMLElement).dataset.count ?? '3', 10);
        this.el.querySelectorAll('.enemy-count-btn').forEach(b =>
          b.classList.toggle('diff-selected', b === btn),
        );
      });
    });

    // Start button
    this.el.querySelector('#start-game-btn')!.addEventListener('click', () => {
      this.saveSystem.updateCivPreference(this.selected);
      this.onStart?.(this.selected);
    });

    // Back button
    this.el.querySelector('#civ-back-btn')!.addEventListener('click', () => {
      this.hide();
    });
  }

  private selectCiv(civ: CivilizationType) {
    civ = validCiv(civ);
    this.selected = civ;

    // Update card selection
    this.el.querySelectorAll('.civ-card').forEach(c => {
      (c as HTMLElement).classList.toggle('selected', (c as HTMLElement).dataset.civ === civ);
    });

    // Update detail panel
    const color = CIV_COLORS[civ];
    const def   = CIVILIZATIONS[civ];

    const panel = this.el.querySelector('#civ-detail')!;
    panel.querySelector('#detail-emoji')!.textContent  = CIV_EMOJIS[civ];
    panel.querySelector('#detail-name')!.textContent   = CIV_NAMES[civ];
    (panel.querySelector('#detail-name') as HTMLElement).style.color = hex(color);
    panel.querySelector('#detail-desc')!.textContent   = CIV_DESCRIPTIONS[civ];
    panel.querySelector('#detail-style')!.textContent  = CIV_PLAYSTYLE[civ];
    panel.querySelector('#detail-diff')!.textContent   = CIV_DIFFICULTY[civ];

    const bonusList = panel.querySelector('#detail-bonuses')!;
    bonusList.innerHTML = CIV_BONUSES[civ].map(b =>
      `<li>${b}</li>`
    ).join('');

    const unitsList = panel.querySelector('#detail-units')!;
    unitsList.innerHTML = def.units.map(u =>
      `<div class="unit-chip" style="border-color:${hex(color)}44">
        <span class="unit-emoji">${u.emoji}</span>
        <span class="unit-name">${u.name}</span>
        <span class="unit-type">${u.isRanged ? 'Ranged' : u.isCavalry ? 'Caballería' : 'Melee'}</span>
      </div>`
    ).join('');

    // Update start button color
    const startBtn = this.el.querySelector('#start-game-btn') as HTMLElement;
    startBtn.style.background = `linear-gradient(135deg, ${hex(color)}, ${hex(Math.max(0, color - 0x223300))})`;
  }
}
