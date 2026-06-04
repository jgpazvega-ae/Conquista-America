import type { Building } from '../game/Building';
import type { Player } from '../game/Player';
import { CIVILIZATIONS } from '../game/civilizations';
import { TRAIN_COSTS } from '../game/unitProduction';
import type { UnitType } from '../game/types';
import { BuildingType } from '../game/buildings';
import { BUILDING_DEFS } from '../game/buildingDefs';

const BUILDABLE: BuildingType[] = [
  BuildingType.BARRACKS,
  BuildingType.WATCHTOWER,
  BuildingType.STOREHOUSE,
  BuildingType.TEMPLE,
  BuildingType.FORGE,
];

export class ProductionPanel {
  private el:       HTMLElement;
  private building: Building | null = null;
  private player:   Player   | null = null;
  private tab:      'train' | 'build' = 'train';

  onTrain:  ((unitType: UnitType) => void)       | null = null;
  onBuild:  ((type: BuildingType) => void)       | null = null;
  onCancel: (() => void)                         | null = null;

  constructor() {
    this.el = document.getElementById('production-panel')!;
    document.getElementById('prod-close')?.addEventListener('click', () => this.hide());
    document.getElementById('prod-tab-train')?.addEventListener('click', () => this.switchTab('train'));
    document.getElementById('prod-tab-build')?.addEventListener('click', () => this.switchTab('build'));
  }

  show(building: Building, player: Player) {
    this.building = building;
    this.player   = player;
    this.tab      = 'train';
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

  private switchTab(tab: 'train' | 'build') {
    this.tab = tab;
    this.render();
  }

  private render() {
    const b = this.building!;
    const p = this.player!;
    const civDef = CIVILIZATIONS[p.civType];

    const nameEl = document.getElementById('prod-building-name')!;
    nameEl.textContent = `${civDef.emoji} ${civDef.name}`;

    // Tab state
    document.getElementById('prod-tab-train')?.classList.toggle('active', this.tab === 'train');
    document.getElementById('prod-tab-build')?.classList.toggle('active', this.tab === 'build');

    const trainSection = document.getElementById('prod-train-section')!;
    const buildSection = document.getElementById('prod-build-section')!;

    if (this.tab === 'train') {
      trainSection.classList.remove('hidden');
      buildSection.classList.add('hidden');
      this.renderTrainList(b, p, civDef);
      this.renderQueue();
    } else {
      trainSection.classList.add('hidden');
      buildSection.classList.remove('hidden');
      this.renderBuildList(p);
    }
  }

  private renderTrainList(b: Building, p: Player, civDef: any) {
    const listEl = document.getElementById('prod-unit-list')!;
    listEl.innerHTML = '';

    for (const unitDef of (civDef as any).units) {
      const cost = TRAIN_COSTS[unitDef.type as UnitType];
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
        btn.addEventListener('click', () => this.onTrain?.(unitDef.type as UnitType));
      }
      listEl.appendChild(btn);
    }
  }

  private renderBuildList(p: Player) {
    const listEl = document.getElementById('prod-build-list')!;
    listEl.innerHTML = '';

    for (const btype of BUILDABLE) {
      const def = BUILDING_DEFS[btype];
      const canAfford = p.resources.food >= def.cost.food &&
                        p.resources.gold >= def.cost.gold &&
                        p.resources.stone >= def.cost.stone;

      const btn = document.createElement('button');
      btn.className = 'prod-unit-btn' + (canAfford ? '' : ' disabled');
      btn.title = def.description;
      btn.innerHTML = `
        <span class="prod-unit-icon">${def.emoji}</span>
        <div class="prod-unit-info">
          <div class="prod-unit-name">${def.name}</div>
          <div class="prod-unit-cost">
            🌽${def.cost.food} ⚜️${def.cost.gold} 🪨${def.cost.stone}
          </div>
        </div>
      `;
      if (canAfford) {
        btn.addEventListener('click', () => this.onBuild?.(btype));
      }
      listEl.appendChild(btn);
    }
  }

  renderQueue() {
    if (!this.building || this.tab !== 'train') return;
    const b = this.building;

    const qEl = document.getElementById('prod-queue')!;
    qEl.innerHTML = '';
    for (let i = 0; i < b.MAX_QUEUE; i++) {
      const slot = document.createElement('div');
      slot.className = 'prod-queue-slot';
      if (i < b.productionQueue.length) {
        const item = b.productionQueue[i];
        const civDef = CIVILIZATIONS[this.player!.civType];
        const unitDef = (civDef as any).units.find((u: any) => u.type === item.unitType);
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
