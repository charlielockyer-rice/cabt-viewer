import { animationActivity } from '../lib/anim/activity';
import type { EngineResponse, GameView } from '../lib/game/types';
import { viewSettingsStore } from './viewSettings.svelte';

// Upper bound on waiting for the animation layers between sequence views, so
// a stuck destination poll can never deadlock live playback.
const maxStepWaitMs = 5000;

class GameStore {
  game = $state<GameView | null>(null);
  error = $state('');
  busy = $state(false);
  resolvingPrompt = $state(false);
  playingSequence = $state(false);
  private generation = 0;

  get currentPrompt() {
    return this.game?.prompts[0];
  }

  get gameFinished() {
    return this.game?.phase === 7;
  }

  setError(message: string) {
    this.error = message;
  }

  reset() {
    this.generation += 1;
    this.game = null;
    this.error = '';
    this.busy = false;
    this.resolvingPrompt = false;
    this.playingSequence = false;
  }

  async run(command: () => Promise<EngineResponse>) {
    const generation = this.generation;
    this.busy = true;
    try {
      return await this.apply(await command(), generation);
    } finally {
      if (generation === this.generation) {
        this.busy = false;
      }
    }
  }

  async resolve(command: () => Promise<EngineResponse>) {
    const generation = this.generation;
    this.resolvingPrompt = true;
    try {
      return await this.apply(await command(), generation);
    } finally {
      if (generation === this.generation) {
        this.resolvingPrompt = false;
      }
    }
  }

  async apply(response: EngineResponse, generation = this.generation) {
    if (generation !== this.generation) {
      return response;
    }
    if (response.ok) {
      if (response.sequence?.length && viewSettingsStore.animateActions) {
        this.playingSequence = true;
        try {
          // Don't let a new response's views land on top of animations still
          // running from the previous one.
          await animationActivity.waitForIdle(maxStepWaitMs);
          if (generation !== this.generation) {
            return response;
          }
          for (const view of response.sequence) {
            this.game = view;
            this.error = '';
            // Step ms is the minimum gap between views; after it, wait for
            // the animation layers to report idle so playback is strictly
            // sequential (the delay also gives their effects time to
            // schedule the batch and extend the busy window).
            await wait(clampedActionStepDelay());
            if (generation !== this.generation) {
              return response;
            }
            await animationActivity.waitForIdle(maxStepWaitMs);
            if (generation !== this.generation) {
              return response;
            }
          }
        } finally {
          if (generation === this.generation) {
            this.playingSequence = false;
          }
        }
      }
      if (generation !== this.generation) {
        return response;
      }
      this.game = response.view;
      this.error = '';
      return response;
    }

    this.error = response.error;
    if (response.view) {
      this.game = response.view;
    }
    return response;
  }
}

export const gameStore = new GameStore();

function clampedActionStepDelay() {
  return Math.min(2500, Math.max(50, Math.round(viewSettingsStore.actionStepDelayMs)));
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
