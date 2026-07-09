<script lang="ts">
  import { onMount } from 'svelte';
  import ActiveFocus from './lib/components/ActiveFocus.svelte';
  import AppHeader from './lib/components/AppHeader.svelte';
  import BoardLayer from './lib/components/BoardLayer.svelte';
  import EffectSelectorBanner from './lib/components/EffectSelectorBanner.svelte';
  import EndGamePrompt from './lib/components/EndGamePrompt.svelte';
  import EvalGraph from './lib/components/EvalGraph.svelte';
  import ViewportAnimationLayer from './lib/components/ViewportAnimationLayer.svelte';
  import RevealSessionLayer from './lib/components/RevealSessionLayer.svelte';
  import GameBoard from './lib/components/GameBoard.svelte';
  import GameStatus from './lib/components/GameStatus.svelte';
  import Hand from './lib/components/Hand.svelte';
  import ImportScreen from './lib/components/ImportScreen.svelte';
  import LogPanel from './lib/components/LogPanel.svelte';
  import PlayerPanel from './lib/components/PlayerPanel.svelte';
  import PromptGallery from './lib/components/prompt-gallery/PromptGallery.svelte';
  import PromptDock from './lib/components/prompts/PromptDock.svelte';
  import PromptHost from './lib/components/prompts/PromptHost.svelte';
  import ReplayTimeline from './lib/components/ReplayTimeline.svelte';
  import TableShell from './lib/components/TableShell.svelte';
  import Toolbar from './lib/components/Toolbar.svelte';
  import ZoneViewer from './lib/components/ZoneViewer.svelte';
  import { localGameApi, type PlayerControl } from './lib/game/httpClient';
  import { formatCabtDeckList } from './lib/game/deckImport';
  import { labelFor } from './lib/game/labels';
  import { replayFollowPlayerForPosition } from './lib/game/replayFollow';
  import cardRows from './lib/cabt/cardData.generated.json';
  import {
    boardDecisionOptions,
    boardOptionForSlot,
    boardTargetDecisionOptions,
    boardTargetPickForSlot,
    endTurnOption,
    handOptionForSlot,
    isMainDecision,
    optionsForHandCard,
    playableHandIndexes,
    sameBoardRef,
    slotRef,
    stadiumOption,
  } from './lib/game/decisions';
  import { commitPick, observeDecision, pickTally, runProgress, type EffectRun } from './lib/game/effectSelector';
  import { loadAgentOptions, loadGameLogs, type AgentOption, type GameLogEntry } from './lib/home/catalog';
  import { kaggleEpisodeReplayUrl, type KaggleEpisodeDay, type KaggleEpisodeSummary } from './lib/kaggle/episodes';
  import type { ActionTimelineEvent, BoardSlotRef, DecisionOptionView, PokemonSlotView, PlayerView } from './lib/game/types';
  import { deckImportStore } from './state/deckImport.svelte';
  import { evalStore } from './state/eval.svelte';
  import { gameStore } from './state/game.svelte';
  import { gameSessionStore } from './state/gameSession.svelte';
  import { replayStore } from './state/replay.svelte';
  import { selectionStore } from './state/selection.svelte';
  import { viewSettingsStore } from './state/viewSettings.svelte';
  import { visualAssetsStore } from './state/visualAssets.svelte';
  import { zoneViewerStore } from './state/zoneViewer.svelte';

  type HomeMode = 'play' | 'logs';

  let showPromptGallery = initialSearchParam('view') === 'prompt-gallery';
  const initialReplayMode = initialSearchParam('view') === 'replay';
  let homeMode = $state<HomeMode>(initialReplayMode ? 'logs' : 'play');
  let lastKaggleDaySlug = $state(initialSearchParam('kaggleDay'));
  let lastKaggleEpisodeId = $state(initialSearchParam('kaggleEpisode'));
  let agents = $state<AgentOption[]>([]);
  let gameLogs = $state<GameLogEntry[]>([]);
  let player1Control = $state<PlayerControl>('self');
  let player2Control = $state<PlayerControl>('agent');
  let player1AgentId = $state('');
  let player2AgentId = $state('');
  let player1DeckSource = $state('import');
  let player2DeckSource = $state('import');
  let lastLoadedPlayer1DeckSource = $state('');
  let lastLoadedPlayer2DeckSource = $state('');
  let player1DeckLoading = $state(false);
  let player2DeckLoading = $state(false);
  let catalogBusy = $state(false);
  let catalogError = $state('');
  let savingReplay = $state(false);
  let saveReplayMessage = $state('');
  let saveReplayError = $state('');
  let replayMode = $derived(homeMode === 'logs' && !!replayStore.replay);
  let game = $derived(replayMode ? replayStore.currentView : gameStore.game);
  let animationScopeKey = $derived(replayMode
    ? `replay-${replayStore.stepIndex}-${replayStore.animationPhaseIndex}`
    : `live-${game?.actionTimeline?.at(-1)?.id ?? 0}`);
  // Live playback steps carry exactly their own events; the interactive view
  // that lands afterwards carries the cumulative timeline for the log panel,
  // which must not re-enter the animation layers.
  let animationEvents = $derived(replayMode || gameStore.playingSequence
    ? (game?.actionTimeline ?? [])
    : []);
  let animationStepEvents = $derived(replayMode
    ? (replayStore.currentStep?.actionTimeline ?? [])
    : animationEvents);
  // Live turn boundary for the animation layers: stale claims/sprites are
  // released when the turn counter advances. Constant in replay.
  let animationTurnKey = $derived(replayMode ? 'replay' : `turn-${game?.turn ?? 0}`);
  // Live scope-end boundary for the animation layers: bumps on every applied
  // view (including the settled interactive one), so held sprites release the
  // moment the next authoritative view lands. Ignored in replay (scope key drives).
  let animationApplySignal = $derived(gameStore.liveApplyGeneration);
  let finalEvolutionEvents = $derived(replayMode ? replayFinalEvolutionEvents() : []);
  let error = $derived(homeMode === 'logs' ? replayStore.error : gameStore.error);
  let busy = $derived(replayMode ? replayStore.loading : gameStore.busy);
  let sessionBusy = $derived(replayMode ? replayStore.loading : busy);
  let resolvingPrompt = $derived(gameStore.resolvingPrompt);
  let playingSequence = $derived(gameStore.playingSequence);
  let commandBusy = $derived(sessionBusy || resolvingPrompt || playingSequence);
  let selectedHand = $derived(selectionStore.selectedHand);
  let draggingHand = $derived(selectionStore.draggingHand);
  let focusedSlot = $derived(selectionStore.focusedSlot);
  let followActive = $derived(viewSettingsStore.followActive);
  let viewIndex = $derived(viewSettingsStore.viewIndex);
  let boardTilt = $derived(viewSettingsStore.boardTilt);
  let boardPerspective = $derived(viewSettingsStore.boardPerspective);
  let boardScaleY = $derived(viewSettingsStore.boardScaleY);
  let boardLift = $derived(viewSettingsStore.boardLift);
  let debugZones = $derived(viewSettingsStore.debugZones);
  let showLogs = $derived(viewSettingsStore.showLogs);
  let theme = $derived(viewSettingsStore.theme);
  let themePreference = $derived(viewSettingsStore.themePreference);
  let selectedPlayer1Agent = $derived(agents.find((agent) => agent.id === player1AgentId));
  let selectedPlayer2Agent = $derived(agents.find((agent) => agent.id === player2AgentId));
  let selectedPlayer1Deck = $derived(agents.find((agent) => agent.id === player1DeckSource && agent.deckUrl));
  let selectedPlayer2Deck = $derived(agents.find((agent) => agent.id === player2DeckSource && agent.deckUrl));
  onMount(() => {
    const stopThemeSync = viewSettingsStore.startThemeSync();
    if (initialSearchParam('debug') === 'clickability') {
      void import('./lib/debug/clickabilityProbe').then(({ startClickabilityProbe }) => startClickabilityProbe());
    }
    if (initialSearchParam('debug') === 'hidden') {
      void import('./lib/debug/hiddenCountReadout').then(({ startHiddenCountReadout }) => startHiddenCountReadout());
    }
    void visualAssetsStore.loadConfiguredManifest();
    void refreshCatalog();
    if (initialReplayMode) {
      void replayStore.loadSaved();
    }
    return stopThemeSync;
  });
  $effect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themePreference = themePreference;
    document.documentElement.style.colorScheme = theme;
  });
  $effect(() => {
    document.body.classList.toggle('prompt-gallery-page', showPromptGallery);
    document.body.classList.toggle('logs-home-page', !showPromptGallery && homeMode === 'logs' && !game);
    return () => {
      document.body.classList.remove('prompt-gallery-page');
      document.body.classList.remove('logs-home-page');
    };
  });
  // Locked agents (deck-specific bots) always play their paired deck; anyDeck
  // agents get it as a default when first selected but the picker stays free.
  let player1DefaultedAgentId = $state('');
  let player2DefaultedAgentId = $state('');
  $effect(() => {
    if (player1Control !== 'agent' || !selectedPlayer1Agent?.deckUrl) {
      return;
    }
    if (selectedPlayer1Agent.anyDeck) {
      if (player1DefaultedAgentId !== selectedPlayer1Agent.id) {
        player1DefaultedAgentId = selectedPlayer1Agent.id;
        player1DeckSource = selectedPlayer1Agent.id;
      }
    } else if (player1DeckSource !== selectedPlayer1Agent.id) {
      player1DeckSource = selectedPlayer1Agent.id;
    }
  });
  $effect(() => {
    if (player2Control !== 'agent' || !selectedPlayer2Agent?.deckUrl) {
      return;
    }
    if (selectedPlayer2Agent.anyDeck) {
      if (player2DefaultedAgentId !== selectedPlayer2Agent.id) {
        player2DefaultedAgentId = selectedPlayer2Agent.id;
        player2DeckSource = selectedPlayer2Agent.id;
      }
    } else if (player2DeckSource !== selectedPlayer2Agent.id) {
      player2DeckSource = selectedPlayer2Agent.id;
    }
  });
  $effect(() => {
    const deckUrl = selectedPlayer1Deck?.deckUrl ?? '';
    if (player1DeckSource === 'import' || !deckUrl) {
      lastLoadedPlayer1DeckSource = '';
      return;
    }
    if (player1DeckSource === lastLoadedPlayer1DeckSource) {
      return;
    }
    void loadSelectedDeck(deckUrl, player1DeckSource, 0);
  });
  $effect(() => {
    const deckUrl = selectedPlayer2Deck?.deckUrl ?? '';
    if (player2DeckSource === 'import' || !deckUrl) {
      lastLoadedPlayer2DeckSource = '';
      return;
    }
    if (player2DeckSource === lastLoadedPlayer2DeckSource) {
      return;
    }
    void loadSelectedDeck(deckUrl, player2DeckSource, 1);
  });
  let zoneViewerOpen = $derived(zoneViewerStore.open);
  let zoneViewerTitle = $derived(zoneViewerStore.title);
  let zoneViewerFaceDown = $derived(zoneViewerStore.faceDown);
  let zoneViewerIsStadium = $derived(zoneViewerStore.zone === 'stadium');
  let bottomPlayer = $derived(game?.players[viewIndex] ?? game?.players[0]);
  let topPlayer = $derived(game?.players.find((player) => player.index !== bottomPlayer?.index));

  // The engine's current decision is the whole interaction contract. It is
  // held at response level (gameStore.decision) so rapid sequential selects
  // (damage counter placement) stay clickable while the previous placement's
  // step still animates.
  let decision = $derived(replayMode ? undefined : gameStore.decision);
  let decisionSeatIsSelf = $derived(!!decision && isSelfControlled(decision.seat));
  let mainDecision = $derived(isMainDecision(decision) && decisionSeatIsSelf ? decision : undefined);
  let boardDecision = $derived(decisionSeatIsSelf ? boardDecisionOptions(decision) : []);
  // Product options (evolve: hand card × board target) answer by clicking
  // the TARGET; identical faces with different consequences never reach a
  // flat dialog unlabeled.
  let boardTargetDecision = $derived(
    decisionSeatIsSelf && !boardDecision.length ? boardTargetDecisionOptions(decision) : [],
  );
  let boardAnswerable = $derived(boardDecision.length > 0 || boardTargetDecision.length > 0);
  // The generic dialog can complete any select; board clicking is layered on
  // top of it. `preferListFallback` lets the player drop back to the dialog
  // for a board-shaped select (it stays on for the rest of the run).
  let preferListFallback = $state(false);
  let dialogDecision = $derived(
    decision && decision.kind !== 'main' && decisionSeatIsSelf && (!boardAnswerable || preferListFallback)
      ? decision
      : undefined,
  );
  $effect(() => {
    if (!boardAnswerable) {
      preferListFallback = false;
    }
  });

  // Countdown effect run (damage counter placement, energy payment): tracks
  // committed picks so targets wear chips and the banner shows progress.
  let effectRun = $state<EffectRun | null>(null);
  // The board slot just answered with, lit as confirmed until the engine's
  // next decision lands.
  let pendingPickSlot = $state<BoardSlotRef | null>(null);
  let effectProgress = $derived(runProgress(effectRun));
  let actingPlayerIndex = $derived(decision?.seat ?? game?.activePlayerIndex ?? 0);
  let actingPlayerIsSelf = $derived(isSelfControlled(actingPlayerIndex));
  let modeLabel = $derived((game?.seats ?? []).map((seat) => controlLabel(seat.control)).join(' vs '));
  let promptDockMode = $derived<'default' | 'search'>(dialogDecision?.kind === 'choose-cards' ? 'search' : 'default');

  // Clear stale hand selection and fold the decision into the effect run
  // whenever the engine moves to a new decision.
  let lastDecisionSeq = $state(-1);
  $effect(() => {
    const seq = decision?.seq ?? -1;
    if (seq !== lastDecisionSeq) {
      lastDecisionSeq = seq;
      selectionStore.setSelectedHand(null);
      effectRun = observeDecision(effectRun, decision);
      pendingPickSlot = null;
    }
  });

  function replayFinalEvolutionEvents(): ActionTimelineEvent[] {
    const step = replayStore.currentStep;
    const phases = step?.animationPhases ?? [];
    if (!step || replayStore.animationPhaseIndex < phases.length) {
      return [];
    }
    const evolvePhaseIndex = phases.findIndex((phase) => phase.key.startsWith('Evolve:'));
    if (evolvePhaseIndex === -1 || phases.length > evolvePhaseIndex + 1) {
      return [];
    }
    return step.actionTimeline?.filter((event) => event.kind === 'Evolve') ?? [];
  }

  $effect(() => {
    if (game && (followActive || actingPlayerIsSelf) && !replayMode && !playingSequence) {
      viewSettingsStore.followPlayer(actingPlayerIndex);
    }
  });
  $effect(() => {
    if (!replayMode || !followActive) {
      return;
    }
    const playerIndex = replayFollowPlayerForPosition(replayStore.replay?.steps, replayStore.stepIndex);
    if (playerIndex !== undefined) {
      viewSettingsStore.followPlayer(playerIndex);
    }
  });
  // Live eval bar: re-score MY seat's win probability each time a new
  // interactive decision settles (never mid-animation). copycat-v1-20m reads
  // the bottom seat's own observation; the engine server holds it and proxies
  // to the eval sidecar. Read-only — a missing sidecar just leaves the bar off.
  $effect(() => {
    const seq = gameStore.decision?.seq;
    const settling = gameStore.playingSequence;
    const seat = viewIndex;
    if (replayMode || !gameStore.game || settling || seq === undefined) {
      return;
    }
    void evalStore.refreshLive(seat);
  });
  // Replay eval graph: batch-score the whole episode from the tracked seat's
  // view once a replay loads (or when the viewer switches sides). The frames +
  // decks come from the loaded replay JSON; the value curve drives both the
  // graph and the scrub-time bar.
  $effect(() => {
    if (!replayMode || !replayStore.replay) {
      return;
    }
    const frames = replayStore.observationFrames;
    const seat = viewIndex;
    void evalStore.loadReplayCurve(frames, seat, replayStore.decks[seat] ?? []);
  });
  let replayStateIndex = $derived(replayStore.currentStep?.stateIndex ?? 0);
  let showEvalBar = $derived(replayMode ? evalStore.replayCurve.length > 0 : evalStore.live);
  let evalBarPWin = $derived(replayMode ? evalStore.pWinAtState(replayStateIndex) : evalStore.pWin);
  let gameFinished = $derived(game?.phase === 7);
  let winnerName = $derived(
    game?.winner === 0 || game?.winner === 1
      ? game.players[game.winner]?.name
      : undefined,
  );
  let gameResultLabel = $derived(
    game?.winner === 3
      ? 'Draw'
      : winnerName
        ? `${winnerName} wins`
        : gameFinished
          ? 'Game finished'
          : '',
  );
  let selectedHandOptions = $derived(selectedHand
    ? optionsForHandCard(mainDecision, selectedHand.playerIndex, selectedHand.handIndex)
    : []);
  let draggingHandOptions = $derived(draggingHand
    ? optionsForHandCard(mainDecision, draggingHand.playerIndex, draggingHand.handIndex)
    : []);
  let viewedCards = $derived(zoneViewerStore.cardsFor(game));
  let focusedPlayer = $derived(focusedSlot && game ? game.players[focusedSlot.ownerIndex] : undefined);
  let focusedCanAct = $derived(!!focusedPlayer && canAct(focusedPlayer.index));
  let canPlayOnBoard = $derived(!commandBusy && !gameFinished
    && !!untargetedOptionFor(selectedHandOptions.length ? selectedHandOptions : draggingHandOptions));

  $effect(() => {
    if (dialogDecision || gameFinished) {
      selectionStore.clearFocus();
    }
  });

  async function startGame() {
    if (!(await ensureSelectedDecksLoaded())) {
      return;
    }
    const decks = deckImportStore.parseLocalGameDecks();
    if (!decks.ok) {
      gameStore.setError(decks.error);
      return;
    }

    selectionStore.setSelectedHand(null);
    resetSaveReplayStatus();
    replayStore.clear();
    homeMode = 'play';
    await gameSessionStore.run(() =>
      localGameApi.start(decks.player1Cards, decks.player2Cards, {
        player1Control,
        player2Control,
        player1AgentId,
        player2AgentId,
      }),
    );
  }

  async function refreshCatalog() {
    catalogBusy = true;
    catalogError = '';
    try {
      const [nextAgents, nextLogs] = await Promise.all([loadAgentOptions(), loadGameLogs()]);
      agents = nextAgents;
      gameLogs = nextLogs;
      if (!player1AgentId || !nextAgents.some((agent) => agent.id === player1AgentId)) {
        player1AgentId = nextAgents[0]?.id ?? '';
      }
      if (!player2AgentId || !nextAgents.some((agent) => agent.id === player2AgentId)) {
        player2AgentId = nextAgents[0]?.id ?? '';
      }
      if (player1DeckSource !== 'import' && !nextAgents.some((agent) => agent.id === player1DeckSource && agent.deckUrl)) {
        player1DeckSource = 'import';
      }
      if (player2DeckSource !== 'import' && !nextAgents.some((agent) => agent.id === player2DeckSource && agent.deckUrl)) {
        player2DeckSource = 'import';
      }
    } catch (error) {
      catalogError = error instanceof Error ? error.message : String(error);
    } finally {
      catalogBusy = false;
    }
  }

  async function ensureSelectedDecksLoaded() {
    const player1Source = forcedDeckSource(player1Control, selectedPlayer1Agent, player1DeckSource);
    const player2Source = forcedDeckSource(player2Control, selectedPlayer2Agent, player2DeckSource);
    player1DeckSource = player1Source;
    player2DeckSource = player2Source;
    const player1Loaded = await ensureDeckLoaded(player1Source, 0);
    const player2Loaded = await ensureDeckLoaded(player2Source, 1);
    return player1Loaded && player2Loaded;
  }

  async function ensureDeckLoaded(deckSource: string, playerIndex: number) {
    if (deckSource === 'import') {
      return true;
    }
    const lastLoaded = playerIndex === 0 ? lastLoadedPlayer1DeckSource : lastLoadedPlayer2DeckSource;
    if (lastLoaded === deckSource) {
      return true;
    }
    const deckUrl = agents.find((agent) => agent.id === deckSource)?.deckUrl;
    if (!deckUrl) {
      return true;
    }
    return loadSelectedDeck(deckUrl, deckSource, playerIndex);
  }

  function forcedDeckSource(control: PlayerControl, agent: AgentOption | undefined, deckSource: string) {
    return control === 'agent' && agent?.deckUrl && !agent.anyDeck ? agent.id : deckSource;
  }

  async function loadSelectedDeck(deckUrl: string, deckSource: string, playerIndex: number) {
    if (playerIndex === 0) {
      player1DeckLoading = true;
    } else {
      player2DeckLoading = true;
    }
    try {
      const response = await fetch(deckUrl);
      if (!response.ok) {
        throw new Error(`${deckUrl}: ${response.status}`);
      }
      const deckText = formatCabtDeckList(await response.text(), cardRows);
      if (playerIndex === 0) {
        deckImportStore.deck1Text = deckText;
        lastLoadedPlayer1DeckSource = deckSource;
      } else {
        deckImportStore.deck2Text = deckText;
        lastLoadedPlayer2DeckSource = deckSource;
      }
      return true;
    } catch (error) {
      catalogError = error instanceof Error ? error.message : String(error);
      return false;
    } finally {
      if (playerIndex === 0) {
        player1DeckLoading = false;
      } else {
        player2DeckLoading = false;
      }
    }
  }

  async function loadGameLog(log: GameLogEntry) {
    gameSessionStore.reset();
    resetSaveReplayStatus();
    zoneViewerStore.close();
    viewSettingsStore.resetView();
    lastKaggleDaySlug = '';
    lastKaggleEpisodeId = '';
    homeMode = 'logs';
    replaceReplayUrl(log.file || log.id);
    await replayStore.loadSaved(log.file || log.id);
  }

  async function loadKaggleEpisode(day: KaggleEpisodeDay, episode: KaggleEpisodeSummary) {
    const replayUrl = kaggleEpisodeReplayUrl(day.slug, episode.episodeId);
    gameSessionStore.reset();
    resetSaveReplayStatus();
    zoneViewerStore.close();
    viewSettingsStore.resetView();
    lastKaggleDaySlug = day.slug;
    lastKaggleEpisodeId = episode.episodeId;
    homeMode = 'logs';
    replaceKaggleReplayUrl(day, episode, replayUrl);
    await replayStore.loadUrl(replayUrl);
  }

  async function saveReplay() {
    if (savingReplay) {
      return;
    }
    savingReplay = true;
    saveReplayMessage = '';
    saveReplayError = '';
    try {
      const response = await localGameApi.saveReplay();
      if (!response.ok) {
        throw new Error(response.error ?? 'Unable to save match.');
      }
      saveReplayMessage = response.file ? `Saved to Game Logs as ${response.file}.` : 'Saved to Game Logs.';
      await refreshCatalog();
    } catch (error) {
      saveReplayError = error instanceof Error ? error.message : String(error);
    } finally {
      savingReplay = false;
    }
  }

  // Answer the current decision with engine option indexes. Playback of the
  // previous answer's steps does not block the next click — the server's seq
  // echo rejects anything genuinely stale.
  async function selectDecision(indexes: number[], viaDialog = false) {
    const currentDecision = decision;
    if (!currentDecision || gameStore.busy || resolvingPrompt) {
      return;
    }
    effectRun = commitPick(effectRun, currentDecision, indexes);
    const answered = indexes.length === 1
      ? currentDecision.options.find((option) => option.index === indexes[0])
      : undefined;
    pendingPickSlot = answered?.board ?? answered?.boardTarget ?? null;
    const send = () => localGameApi.select(currentDecision.seq, indexes);
    await (viaDialog ? gameSessionStore.resolve(send) : gameSessionStore.run(send));
  }

  function selectDecisionOption(index: number) {
    void selectDecision([index]);
  }

  function untargetedOptionFor(options: DecisionOptionView[]): DecisionOptionView | undefined {
    return options.find((option) => !option.boardTarget);
  }

  function playableIndexesFor(player: PlayerView): number[] {
    return playableHandIndexes(mainDecision, player.index);
  }

  function selectHandCard(playerIndex: number, handIndex: number) {
    if (!canAct(playerIndex) || !optionsForHandCard(mainDecision, playerIndex, handIndex).length) {
      return;
    }
    selectionStore.toggleSelectedHand({ playerIndex, handIndex });
    selectionStore.clearFocus();
  }

  function onHandDrag(playerIndex: number, handIndex: number, event: DragEvent) {
    if (!canAct(playerIndex) || !optionsForHandCard(mainDecision, playerIndex, handIndex).length) {
      return;
    }
    selectionStore.startDragging({ playerIndex, handIndex });
    event.dataTransfer?.setData('text/plain', `${playerIndex}:${handIndex}`);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  function clearDragState() {
    selectionStore.clearDragging();
  }

  // The option a click/drop on this slot would select, if any.
  function slotOption(slot: PokemonSlotView): DecisionOptionView | undefined {
    const board = boardOptionForSlot(decisionSeatIsSelf ? decision : undefined, slotRef(slot));
    if (board) {
      return board;
    }
    const target = targetPickForSlot(slot);
    if (target && target !== 'ambiguous') {
      return target;
    }
    const hand = selectedHand ?? draggingHand;
    if (!hand || !canAct(hand.playerIndex)) {
      return undefined;
    }
    return handOptionForSlot(mainDecision, hand.playerIndex, hand.handIndex, slotRef(slot));
  }

  function targetPickForSlot(slot: PokemonSlotView) {
    return boardTargetPickForSlot(decisionSeatIsSelf ? decision : undefined, slotRef(slot));
  }

  function clickSlot(slot: PokemonSlotView) {
    const option = slotOption(slot);
    if (option) {
      selectDecisionOption(option.index);
      return;
    }

    // Distinct cards competing for this target — the dialog carries the
    // labeled choice.
    if (targetPickForSlot(slot) === 'ambiguous') {
      preferListFallback = true;
      return;
    }

    if (canPlayOnBoard && selectedHand) {
      playSelectedToBoard();
      return;
    }

    if (!slot.empty && slot.pokemon) {
      selectionStore.focusSlot(slot);
    }
  }

  function allowDrop(event: DragEvent, slot: PokemonSlotView) {
    if (slotOption(slot)) {
      event.preventDefault();
    }
  }

  function dropToSlot(slot: PokemonSlotView, event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    const option = slotOption(slot);
    clearDragState();
    if (option) {
      selectDecisionOption(option.index);
    }
  }

  function allowBoardPlayDrop(event: DragEvent) {
    if (canPlayOnBoard) {
      event.preventDefault();
    }
  }

  function dropToBoardPlay(event: DragEvent) {
    if (!canPlayOnBoard) {
      return;
    }
    event.preventDefault();
    const options = draggingHandOptions.length ? draggingHandOptions : selectedHandOptions;
    clearDragState();
    const option = untargetedOptionFor(options);
    if (option) {
      selectDecisionOption(option.index);
    }
  }

  function clickBoardPlay(event: MouseEvent) {
    if (!canPlayOnBoard) {
      return;
    }
    event.preventDefault();
    playSelectedToBoard();
  }

  function playSelectedToBoard() {
    const option = untargetedOptionFor(selectedHandOptions);
    if (option) {
      selectionStore.setSelectedHand(null);
      selectDecisionOption(option.index);
    }
  }

  // Bench-area drop for untargeted plays (the engine places basics itself).
  function benchAreaOption(player: PlayerView): DecisionOptionView | undefined {
    const hand = selectedHand ?? draggingHand;
    if (!hand || hand.playerIndex !== player.index || !canAct(player.index)) {
      return undefined;
    }
    const options = optionsForHandCard(mainDecision, hand.playerIndex, hand.handIndex);
    const untargeted = untargetedOptionFor(options);
    return untargeted?.card?.superType === 'Pokemon' ? untargeted : undefined;
  }

  function canPlayToBenchArea(player: PlayerView) {
    return !!benchAreaOption(player);
  }

  function playToBenchArea(player: PlayerView) {
    const option = benchAreaOption(player);
    if (option) {
      selectionStore.setSelectedHand(null);
      selectDecisionOption(option.index);
    }
  }

  function allowBenchDrop(event: DragEvent, player: PlayerView) {
    if (canPlayToBenchArea(player)) {
      event.preventDefault();
    }
  }

  function dropToBenchArea(player: PlayerView, event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    clearDragState();
    playToBenchArea(player);
  }

  function isPlayableTarget(slot: PokemonSlotView) {
    const hand = selectedHand ?? draggingHand;
    if (!hand) {
      return false;
    }
    return !!handOptionForSlot(mainDecision, hand.playerIndex, hand.handIndex, slotRef(slot));
  }

  function isBoardPromptSelectable(slot: PokemonSlotView) {
    return !!boardOptionForSlot(decisionSeatIsSelf ? decision : undefined, slotRef(slot))
      || !!targetPickForSlot(slot);
  }

  function isBoardPromptSelected(slot: PokemonSlotView) {
    return !!pendingPickSlot && sameBoardRef(pendingPickSlot, slotRef(slot));
  }

  function boardPickTally(slot: PokemonSlotView) {
    return pickTally(effectRun, slotRef(slot));
  }

  async function passTurn() {
    const option = endTurnOption(mainDecision);
    if (option) {
      await selectDecision([option.index]);
    }
  }

  async function useStadium() {
    const option = stadiumOption(mainDecision);
    if (!option) {
      return;
    }
    zoneViewerStore.close();
    await selectDecision([option.index]);
  }

  function switchSides() {
    viewSettingsStore.switchToPlayer(topPlayer?.index ?? 0);
  }

  function resetGame() {
    if (replayMode) {
      replayStore.clear();
      evalStore.clearReplay();
      resetSaveReplayStatus();
      zoneViewerStore.close();
      viewSettingsStore.resetView();
      homeMode = 'logs';
      if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('view') === 'replay') {
        window.history.replaceState({}, '', window.location.pathname);
      }
      return;
    }
    gameSessionStore.reset();
    evalStore.reset();
    resetSaveReplayStatus();
    zoneViewerStore.close();
    viewSettingsStore.resetView();
  }

  function resetSaveReplayStatus() {
    saveReplayMessage = '';
    saveReplayError = '';
    savingReplay = false;
  }

  function showZone(
    playerIndex: number,
    zone: 'discard' | 'lostZone' | 'stadium' | 'playZone',
    title: string,
    faceDown = false,
  ) {
    zoneViewerStore.show(playerIndex, zone, title, faceDown);
  }

  function canAct(playerIndex: number) {
    return !commandBusy
      && !replayMode
      && !gameFinished
      && !!mainDecision
      && mainDecision.seat === playerIndex;
  }

  function isSelfControlled(playerIndex: number | undefined) {
    if (playerIndex !== 0 && playerIndex !== 1) {
      return false;
    }
    return game?.seats?.[playerIndex]?.control === 'self';
  }

  function controlLabel(control: PlayerControl) {
    return control === 'agent' ? 'Agent' : 'Self';
  }

  function initialSearchParam(name: string): string {
    return typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get(name) ?? '';
  }

  function replaceKaggleReplayUrl(day: KaggleEpisodeDay, episode: KaggleEpisodeSummary, replayUrl: string) {
    if (typeof window === 'undefined') {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    params.set('view', 'replay');
    params.set('kaggleDay', day.slug);
    params.set('kaggleEpisode', episode.episodeId);
    params.set('replayUrl', replayUrl);
    params.delete('replay');
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}${window.location.hash}`);
  }

  function replaceReplayUrl(replayId: string) {
    if (typeof window === 'undefined') {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    params.set('view', 'replay');
    params.set('replay', replayId);
    params.delete('replayUrl');
    params.delete('kaggleDay');
    params.delete('kaggleEpisode');
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}${window.location.hash}`);
  }
</script>

{#if showPromptGallery}
  <PromptGallery />
{:else}
<main>
  {#if replayMode && !game}
    <AppHeader />
    <section class="replay-loading-screen">
      <div class="replay-loading-panel">
        <strong>{replayStore.loading ? 'Loading replay' : 'Replay unavailable'}</strong>
        <span>{replayStore.loading ? 'Preparing CABT replay frames.' : labelFor(error || 'Unable to load replay.')}</span>
      </div>
    </section>
  {:else if !game}
    <AppHeader />

      <ImportScreen
        {homeMode}
        bind:deck1Text={deckImportStore.deck1Text}
        bind:deck2Text={deckImportStore.deck2Text}
        bind:player1Control
        bind:player2Control
        bind:player1AgentId
        bind:player2AgentId
        bind:player1DeckSource
        bind:player2DeckSource
        {agents}
        {gameLogs}
        player1DeckLocked={player1DeckSource !== 'import'}
        player2DeckLocked={player2DeckSource !== 'import'}
        player1AgentHasPairedDeck={player1Control === 'agent' && !!selectedPlayer1Agent?.deckUrl && !selectedPlayer1Agent.anyDeck}
        player2AgentHasPairedDeck={player2Control === 'agent' && !!selectedPlayer2Agent?.deckUrl && !selectedPlayer2Agent.anyDeck}
        busy={sessionBusy || player1DeckLoading || player2DeckLoading}
        {catalogBusy}
        {error}
        {catalogError}
        kaggleSelectedSlug={lastKaggleDaySlug}
        kaggleSelectedEpisodeId={lastKaggleEpisodeId}
        setHomeMode={(nextMode) => {
          homeMode = nextMode;
          if (nextMode === 'logs') {
            gameStore.reset();
          } else {
            replayStore.clear();
          }
        }}
        startGame={startGame}
        {loadGameLog}
        {loadKaggleEpisode}
        refreshCatalog={() => void refreshCatalog()}
      />
  {:else if bottomPlayer && topPlayer}
    <TableShell {debugZones} {replayMode}>
      <GameStatus
        phaseLabel={game.phaseLabel}
        turn={game.turn}
        activePlayerName={game.players[actingPlayerIndex]?.name}
        resultLabel={gameResultLabel}
        modeLabel={replayMode ? '' : modeLabel}
        {gameFinished}
      />

      <Toolbar
        bind:boardTilt={viewSettingsStore.boardTilt}
        bind:boardPerspective={viewSettingsStore.boardPerspective}
        bind:boardScaleY={viewSettingsStore.boardScaleY}
        bind:boardLift={viewSettingsStore.boardLift}
        bind:followActive={viewSettingsStore.followActive}
        bind:debugZones={viewSettingsStore.debugZones}
        bind:showLogs={viewSettingsStore.showLogs}
        bind:animateActions={viewSettingsStore.animateActions}
        bind:showCardImages={viewSettingsStore.showCardImages}
        bind:actionStepDelayMs={viewSettingsStore.actionStepDelayMs}
        bind:themePreference={viewSettingsStore.themePreference}
        busy={commandBusy}
        promptActive={replayMode || !!dialogDecision || boardAnswerable}
        {gameFinished}
        {error}
        resetPerspective={() => viewSettingsStore.resetPerspective()}
        {passTurn}
        {switchSides}
        switchDisabled={!replayMode && actingPlayerIsSelf}
        {resetGame}
        resetLabel={replayMode ? 'Exit replay' : 'Change decks'}
      />

      {#if replayMode && replayStore.replay && replayStore.currentStep}
        <ReplayTimeline
          replay={replayStore.replay}
          step={replayStore.currentStep}
          displayLabel={replayStore.currentDisplayLabel}
          stepIndex={replayStore.stepIndex}
          copiedForkPoint={replayStore.copiedForkPoint}
          isPlaying={replayStore.isPlaying}
          setStep={(index) => replayStore.setStep(index)}
          setStateIndex={(index) => replayStore.setStateIndex(index)}
          previousStep={() => replayStore.previousStep()}
          nextStep={() => replayStore.nextStep()}
          firstStep={() => replayStore.firstStep()}
          lastStep={() => replayStore.lastStep()}
          togglePlayback={() => replayStore.togglePlayback()}
          backToReplayHome={resetGame}
          copyForkPoint={() => void replayStore.copyForkPoint()}
        />
        <div class="eval-graph-dock">
          <EvalGraph
            points={evalStore.replayCurve}
            stateCount={replayStore.replay.stateCount}
            currentStateIndex={replayStateIndex}
            seek={(index) => replayStore.setStateIndex(index)}
            myName={bottomPlayer?.name ?? 'You'}
            loading={evalStore.replayLoading}
          />
        </div>
      {/if}

      {#if gameFinished && !replayMode}
        <EndGamePrompt
          resultLabel={gameResultLabel}
          turn={game.turn}
          onconfirm={resetGame}
          onsave={() => void saveReplay()}
          saveDisabled={savingReplay || !!saveReplayMessage}
          saveMessage={saveReplayMessage}
          saveError={saveReplayError}
          saving={savingReplay}
        />
      {/if}

      {#if boardAnswerable && decision && !preferListFallback}
        <EffectSelectorBanner
          message={decision.message}
          placed={effectProgress?.placed}
          total={effectProgress?.total}
          kind={effectRun?.remainingKind}
          onShowList={() => (preferListFallback = true)}
        />
      {:else if dialogDecision}
        <PromptDock mode={promptDockMode}>
          {#key dialogDecision.seq}
            <PromptHost
              decision={dialogDecision}
              resolving={resolvingPrompt}
              onselect={(indexes) => void selectDecision(indexes, true)}
            />
          {/key}
        </PromptDock>
      {/if}

      <BoardLayer>
        <!-- Panels are keyed by player.index and rendered in a stable order, so
             the follow-active seat flip is a pure CSS reposition (side class)
             over the SAME Hand instance — the hand's card elements survive the
             flip instead of every card unmounting/reloading (M2). Both panels
             are position:absolute and never overlap, so grouping them here does
             not change layout or their stacking under the fixed anim layers. -->
        {#each game.players as panelPlayer (panelPlayer.index)}
          {@const isBottom = panelPlayer.index === bottomPlayer.index}
          <PlayerPanel side={isBottom ? 'bottom' : 'top'}>
            <Hand
              player={panelPlayer}
              selectedHand={selectedHand}
              disabled={!canAct(panelPlayer.index)}
              playableIndexes={playableIndexesFor(panelPlayer)}
              concealed={isBottom ? (!replayMode && !isSelfControlled(panelPlayer.index)) : true}
              onSelect={selectHandCard}
              onDrag={onHandDrag}
              onDragEnd={clearDragState}
            />
          </PlayerPanel>
        {/each}

        <GameBoard
          {topPlayer}
          {bottomPlayer}
          {canPlayToBenchArea}
          canPlaceSetupBench={() => false}
          {playToBenchArea}
          placeSetupBench={() => {}}
          {allowBenchDrop}
          {dropToBenchArea}
          {isPlayableTarget}
          {isBoardPromptSelectable}
          {isBoardPromptSelected}
          {boardPickTally}
          boardPickKind={effectRun?.remainingKind}
          {clickSlot}
          {allowDrop}
          {dropToSlot}
          canPlaceSetupActive={() => false}
          placeSetupActive={() => {}}
          {showZone}
          {canPlayOnBoard}
          {clickBoardPlay}
          {allowBoardPlayDrop}
          {dropToBoardPlay}
          {boardTilt}
          {boardPerspective}
          {boardScaleY}
          {boardLift}
          animationEvents={animationEvents}
          {animationScopeKey}
          {animationTurnKey}
          animationApplySignal={animationApplySignal}
          evolutionChromeEvents={finalEvolutionEvents}
          {replayMode}
          {showEvalBar}
          evalPWin={evalBarPWin}
          evalMyName={bottomPlayer?.name ?? 'You'}
          evalOpponentName={topPlayer?.name ?? 'Opponent'}
        />

        <RevealSessionLayer
          events={animationEvents}
          stepEvents={animationStepEvents}
          scopeKey={animationScopeKey}
          turnKey={animationTurnKey}
          {replayMode}
          players={game.players}
        />

        <ViewportAnimationLayer
          events={animationEvents}
          stepEvents={animationStepEvents}
          scopeKey={animationScopeKey}
          turnKey={animationTurnKey}
          applySignal={animationApplySignal}
          {replayMode}
          players={game.players}
        />

        {#if focusedSlot}
          <ActiveFocus
            slot={focusedSlot}
            availableActions={focusedPlayer?.availableActions}
            busy={sessionBusy}
            promptActive={!!dialogDecision || boardAnswerable}
            canAct={focusedCanAct}
            close={() => {
              selectionStore.clearFocus();
            }}
            selectOption={(index) => {
              selectionStore.clearFocus();
              selectDecisionOption(index);
            }}
          />
        {/if}

        {#if showLogs}
          <LogPanel logs={game.logs} timeline={game.actionTimeline} />
        {/if}

        <ZoneViewer
          open={zoneViewerOpen}
          title={zoneViewerTitle}
          cards={viewedCards}
          faceDown={zoneViewerFaceDown}
          actionLabel={zoneViewerIsStadium && viewedCards.length && stadiumOption(mainDecision) ? 'Use stadium' : ''}
          actionDisabled={sessionBusy || !!dialogDecision || gameFinished || replayMode}
          actionTitle="Use this stadium's once-per-turn effect"
          onAction={useStadium}
          close={() => zoneViewerStore.close()}
        />
      </BoardLayer>
    </TableShell>
  {:else}
    <AppHeader />
    <section class="replay-loading-screen">
      <div class="replay-loading-panel">
        <strong>Unable to start game</strong>
        <span>{labelFor(error || game.logs.at(-1)?.message || 'The engine returned an invalid pre-game state.')}</span>
        <button type="button" onclick={resetGame}>Change decks</button>
      </div>
    </section>
  {/if}
</main>
{/if}

<style>
  .replay-loading-screen {
    min-height: 100vh;
    display: grid;
    align-content: center;
    justify-content: center;
    padding: 72px 24px 24px;
  }

  .replay-loading-panel {
    display: grid;
    gap: 8px;
    width: min(420px, calc(100vw - 32px));
    padding: 16px;
    border-radius: 8px;
    border: 1px solid rgba(26, 31, 39, 0.16);
    background: #f7f8fa;
    color: #1d232b;
    box-shadow: 0 12px 32px rgba(12, 15, 19, 0.18);
  }

  .replay-loading-panel strong {
    font-size: 14px;
  }

  .replay-loading-panel span {
    color: #566272;
    font-size: 13px;
  }

  /* Eval curve strip, seated in the reserved band just above the replay
     scrubber dock (TableShell's --replay-eval-h keeps the board clear of it). */
  .eval-graph-dock {
    position: absolute;
    left: 0;
    right: var(--board-right-rail);
    bottom: var(--replay-dock-h, 48px);
    height: var(--replay-eval-h, 64px);
    z-index: 11;
    padding: 2px 16px;
    background: var(--surface-toolbar-bg);
    border-top: 1px solid var(--surface-toolbar-border);
  }

</style>
