import './styles.css';
import * as THREE from 'three';
import { Game } from './game/Game';
import { Renderer } from './engine/Renderer';
import { RTSCamera } from './engine/Camera';
import { InputHandler } from './engine/InputHandler';
import { HUD } from './ui/HUD';
import { MAP_COLS, MAP_ROWS, TILE_SIZE } from './game/constants';
import { CivilizationType } from './game/types';
import { CIV_COLORS } from './game/constants';

async function main() {
  const canvas  = document.getElementById('game-canvas') as HTMLCanvasElement;
  const renderer = new Renderer(canvas);
  const game     = new Game();
  const hud      = new HUD(game);
  const rtsCamera = new RTSCamera(renderer.camera);
  const input    = new InputHandler(renderer, game);

  // Update HUD when selection changes
  input.onSelectionChange = () => {
    hud.update(input.getSelectedUnits());
  };

  // Loading steps
  hud.setLoadingProgress(10);
  await frame();

  // Build terrain
  renderer.buildTerrain(game.map);
  hud.setLoadingProgress(50);
  await frame();

  // Add all units, buildings, workers, resources to scene
  for (const unit of game.getAllUnits()) {
    renderer.addUnit(unit);
  }
  for (const building of game.allBuildings) {
    renderer.addBuilding(building);
  }
  for (const worker of game.allWorkers) {
    renderer.addWorker(worker);
  }
  for (const node of game.resourceNodes) {
    renderer.addResourceNode(node);
  }
  hud.setLoadingProgress(80);
  await frame();

  // Build minimap
  hud.buildMinimap(game.map);
  hud.setLoadingProgress(100);
  await frame();

  // Pan camera to human player's starting units
  const humanUnits = game.humanPlayer.aliveUnits;
  if (humanUnits.length > 0) {
    const first = humanUnits[0];
    rtsCamera.panTo(first.worldX, first.worldZ);
  }

  hud.hideLoading();

  // Hide controls hint after 10s
  setTimeout(() => {
    const hint = document.getElementById('controls-hint');
    if (hint) hint.style.opacity = '0';
  }, 10_000);

  // Game loop
  const clock = new THREE.Clock();
  let lastDeadCount = 0;

  function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.1);

    game.update(dt);
    rtsCamera.update(dt);
    renderer.updateEffects(dt);

    // Show damage numbers and effects
    if (game.damageEvents.length > 0) {
      hud.showDamageNumbers(game.damageEvents);
      for (const evt of game.damageEvents) {
        renderer.effects.createHitEffect(evt.worldX, 0.5, evt.worldZ);
        if (evt.damage > 20) {
          renderer.effects.createExplosion(evt.worldX, 0.5, evt.worldZ, evt.damage / 40);
        }
      }
    }

    // Add newly spawned units if any (future expansion)
    const currentCount = game.getAllUnits().length;
    if (currentCount !== lastDeadCount) {
      lastDeadCount = currentCount;
    }

    hud.update(input.getSelectedUnits());
    renderer.render();
  }

  loop();
}

function frame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

main().catch(console.error);
