import type { EngineResponse } from '../lib/game/types';
import { gameStore } from './game.svelte';
import { selectionStore } from './selection.svelte';

class GameSessionStore {
  async run(command: () => Promise<EngineResponse>) {
    const response = await gameStore.run(command);
    this.afterCommand(response);
    return response;
  }

  async resolve(command: () => Promise<EngineResponse>) {
    const response = await gameStore.resolve(command);
    this.afterCommand(response);
    return response;
  }

  reset() {
    gameStore.reset();
    selectionStore.clearAll();
  }

  private afterCommand(response: EngineResponse) {
    if (response.ok) {
      selectionStore.setSelectedHand(null);
    }
  }
}

export const gameSessionStore = new GameSessionStore();
