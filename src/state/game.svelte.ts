import { animationActivity } from '../lib/anim/activity';
import type { DecisionView, EngineResponse, GameView } from '../lib/game/types';
import { viewSettingsStore } from './viewSettings.svelte';

// Upper bound on waiting for the animation layers between sequence views, so
// a stuck destination poll can never deadlock live playback.
const maxStepWaitMs = 5000;

class GameStore {
  game = $state<GameView | null>(null);
  // Monotonic counter bumped on EVERY live view application (each playback
  // step, the settled interactive view, error/cancellation, reset). The
  // animation layers release the previous scope's held sprites when it changes
  // — a deterministic "next-view-applied" boundary that replaces the live
  // destination poll, so live gets replay's hold-to-boundary handoff.
  liveApplyGeneration = $state(0);
  // The current engine decision, held at response level so it survives
  // playback: sequence step views carry no decision, but rapid sequential
  // selects (damage counter placement) must stay clickable while the
  // previous placement's step still animates. The server's seq echo rejects
  // anything genuinely stale.
  decision = $state<DecisionView | undefined>(undefined);
  error = $state('');
  busy = $state(false);
  resolvingPrompt = $state(false);
  playingSequence = $state(false);
  // When the current gameplay request was dispatched (null when idle). The
  // opponent's agent runs inside this in-flight request, so its age is the
  // honest, agent-agnostic "awaiting the opponent's reply" signal the thinking
  // indicator reads — a slow (search-backed) agent simply keeps it pending
  // longer. Not tied to any specific agent.
  commandInFlightSince = $state<number | null>(null);
  private generation = 0;
  // Sequence playbacks from overlapping commands must not interleave their
  // view updates; each apply waits for the previous one to finish.
  private applyQueue: Promise<unknown> = Promise.resolve();

  get gameFinished() {
    return this.game?.phase === 7;
  }

  setError(message: string) {
    this.error = message;
  }

  // Every live view application goes through here so liveApplyGeneration bumps
  // exactly once per applied view — the animation layers' scope-end boundary.
  private setGame(view: GameView | null) {
    this.game = view;
    this.liveApplyGeneration += 1;
  }

  reset() {
    this.generation += 1;
    this.setGame(null);
    this.decision = undefined;
    this.error = '';
    this.busy = false;
    this.resolvingPrompt = false;
    this.playingSequence = false;
    this.commandInFlightSince = null;
  }

  // `busy` covers only the request round-trip; playback is `playingSequence`.
  async run(command: () => Promise<EngineResponse>) {
    const generation = this.generation;
    this.commandInFlightSince ??= Date.now();
    this.busy = true;
    let response: EngineResponse;
    try {
      response = await command();
    } finally {
      if (generation === this.generation) {
        this.busy = false;
        if (!this.resolvingPrompt) {
          this.commandInFlightSince = null;
        }
      }
    }
    return await this.apply(response, generation);
  }

  async resolve(command: () => Promise<EngineResponse>) {
    const generation = this.generation;
    this.commandInFlightSince ??= Date.now();
    this.resolvingPrompt = true;
    let response: EngineResponse;
    try {
      response = await command();
    } finally {
      if (generation === this.generation) {
        this.resolvingPrompt = false;
        if (!this.busy) {
          this.commandInFlightSince = null;
        }
      }
    }
    return await this.apply(response, generation);
  }

  async apply(response: EngineResponse, generation = this.generation) {
    if (generation === this.generation && response.ok) {
      // Expose the fresh decision immediately: the player may answer it while
      // this response's steps are still animating.
      this.decision = response.view.decision;
    }
    const run = this.applyQueue.then(() => this.applyNow(response, generation));
    this.applyQueue = run.catch(() => {});
    return await run;
  }

  private async applyNow(response: EngineResponse, generation: number) {
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
            this.setGame(view);
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
      this.setGame(response.view);
      this.error = '';
      return response;
    }

    this.error = response.error;
    if (response.view) {
      this.setGame(response.view);
      this.decision = response.view.decision;
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
