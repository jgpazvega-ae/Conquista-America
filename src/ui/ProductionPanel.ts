import type { Building } from '../game/Building';
import type { Player } from '../game/Player';
import { CIVILIZATIONS } from '../game/civilizations';
import { TRAIN_COSTS } from '../game/unitProduction';
import type { UnitType } from '../game/types';

export class ProductionPanel {
  private el:       HTMLElement;
  private building: Building | null = null;
  private player:   Player   | null = null;

  onTrain:  ((unitType: UnitType) => void) | null = null;
  onCancel: (() => void) | null = null;

  constructor() {
    this.el = document.getElementById('production-panel')!;
    document.getElementById('prod-close')?.addEventListener('click', () => this.hide());
  }

  show(building: Building, player: Player) {
    this.building = building;
    this.player   = player;
    this.render();
    this.el.classList.remove('hidden');
  }

  hide() {
    this.el.classList.add('hidden');
    this.building = null;
    this.player   = null;
  }

  refresh() {
    if (this.building && this.player) this.render();
  }

  private render() {
    const b = this.building!;
    const p = this.player!;
    const civDef = CIVILIZATIONS[p.civType];

    const nameEl = document.getElementById('prod-building-name')!;
    nameEl.textContent = `${civDef.emoji} ${civDef.name} — Asentamiento`;

    const listEl = document.getElementById('prod-unit-list')!;
    listEl.innerHTML = '';

    for (const unitDef of civDef.units) {
      const cost = TRAIN_COSTS[unitDef.type];
      if (!cost) continue;
      const canAfford = p.resources.food >= cost.food && p.resources.gold >= cost.gold && (p.resources.stone ?? 0) >= (cost.stone ?? 0);

      const btn = document.createElement('button');
      btn.className = 'prod-unit-btn' + (canAfford ? '' : ' disabled');
      btn.title = unitDef.description;
      btn.innerHTML = `
        <span class="prod-unit-icon">${unitDef.emoji}</span>
        <div class="prod-unit-info">
          <div class="prod-unit-name">${unitDef.name}</div>
          <div class="prod-unit-cost">
            🌽${cost.food} ⚜️${cost.gold}${cost.stone ? ` 🪨${cost.stone}` : ''}
          </div>
        </div>
      `;
      if (canAfford && b.productionQueue.length < b.MAX_QUEUE) {
        btn.addEventListener('click', () => {
          this.onTrain?.(unitDef.type);
        });
      }
      listEl.appendChild(btn);
    }

    this.renderQueue();
  }

  renderQueue() {
    if (!this.building) return;
    const b = this.building;

    const qEl = document.getElementById('prod-queue')!;
    qEl.innerHTML = '';
    for (let i = 0; i < b.MAX_QUEUE; i++) {
      const slot = document.createElement('div');
      slot.className = 'prod-queue-slot';
      if (i < b.productionQueue.length) {
        const item = b.productionQueue[i];
        const civDef = CIVILIZATIONS[this.player!.civType];
        const unitDef = civDef.units.find(u => u.type === item.unitType);
        slot.textContent = unitDef?.emoji ?? '?';
        slot.classList.add('filled');
        if (i === 0) slot.classList.add('active');
      }
      qEl.appendChild(slot);
    }

    const progWrap = document.getElementById('prod-progress-wrap')!;
    const progBar  = document.getElementById('prod-progress')!;
    if (b.productionQueue.length > 0) {
      progWrap.classList.remove('hidden');
      progBar.style.width = `${b.productionProgress * 100}%`;
    } else {
      progWrap.classList.add('hidden');
    }
  }
}
