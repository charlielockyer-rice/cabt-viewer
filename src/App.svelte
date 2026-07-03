<script lang="ts">
  import { onMount } from 'svelte';
  import ActiveFocus from './lib/components/ActiveFocus.svelte';
  import AbilityAnimation from './lib/components/AbilityAnimation.svelte';
  import AppHeader from './lib/components/AppHeader.svelte';
  import AttackAnimation from './lib/components/AttackAnimation.svelte';
  import BoardLayer from './lib/components/BoardLayer.svelte';
  import BoardPromptStrip from './lib/components/prompts/BoardPromptStrip.svelte';
  import EndGamePrompt from './lib/components/EndGamePrompt.svelte';
  import DeckDrawAnimation from './lib/components/DeckDrawAnimation.svelte';
  import DeckPrizeAnimation from './lib/components/DeckPrizeAnimation.svelte';
  import DeckRevealAnimation from './lib/components/DeckRevealAnimation.svelte';
  import HandPlayAnimation from './lib/components/HandPlayAnimation.svelte';
  import HandResetAnimation from './lib/components/HandResetAnimation.svelte';
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
  import SetupDock from './lib/components/SetupDock.svelte';
  import TableShell from './lib/components/TableShell.svelte';
  import Toolbar from './lib/components/Toolbar.svelte';
  import ZoneViewer from './lib/components/ZoneViewer.svelte';
  import type { GameCommandApi } from './lib/game/gameApi';
  import { localGameApi, type PlayerControl } from './lib/game/httpClient';
  import { formatCabtDeckList } from './lib/game/deckImport';
  import { labelFor } from './lib/game/labels';
  import { replayFollowPlayerForPosition } from './lib/game/replayFollow';
  import cardRows from './lib/cabt/cardData.generated.json';
  import type { BoardInteractionStrategy } from './lib/game/boardInteraction';
  import {
    canPlayCardToBoardArea,
    canPlayCardToPlayArea,
    canPlayCardToSlot,
    canPlayerAct,
    canRetreatToSlot,
    playableBenchSlot,
    type BoardPlayAreaContext,
  } from './lib/game/playTargets';
  import { benchSlotsFor, previewAttachEnergySlot, previewSlot } from './lib/game/preview';
  import {
    autoResolvablePromptResult,
    extractPromptCards,
    promptBlockedIndexes,
    promptInstanceKey,
    promptOptions,
    shouldAutoResolvePrompt,
  } from './lib/game/prompts';
  import { getSetupPromptUiState, promptLimit, setupPromptResult } from './lib/game/setupPrompt';
  import { getAttachPromptTargets, getBoardPromptTargets, sameTarget, targetForPromptSlot } from './lib/game/targets';
  import { createChoosePokemonStrategy } from './lib/game/strategies/choosePokemonStrategy';
  import { createDamageTransferStrategy } from './lib/game/strategies/damageTransferStrategy';
  import { createPutDamageStrategy } from './lib/game/strategies/putDamageStrategy';
  import { loadAgentOptions, loadGameLogs, type AgentOption, type GameLogEntry } from './lib/home/catalog';
  import { kaggleEpisodeReplayUrl, type KaggleEpisodeDay, type KaggleEpisodeSummary } from './lib/kaggle/episodes';
  import {
    SlotType,
    targetFor,
    type CardTarget,
    type CardView,
    type ActionTimelineEvent,
    type GameView,
    type PlayerView,
    type PokemonSlotView,
    type PromptView,
  } from './lib/game/types';
  import { deckImportStore } from './state/deckImport.svelte';
  import { gameStore } from './state/game.svelte';
  import { gameSessionStore } from './state/gameSession.svelte';
  import { promptLifecycleStore } from './state/promptLifecycle.svelte';
  import { damageTransferStore } from './state/damageTransfer.svelte';
  import { promptSelectionStore } from './state/promptSelection.svelte';
  import { replayStore } from './state/replay.svelte';
  import {
    canAssignAttachTarget,
    isAttachEnergyAvailable as isAttachEnergyAvailableModel,
  } from './state/promptSelectionModel';
  import { selectionStore } from './state/selection.svelte';
  import { setupSelectionStore } from './state/setupSelection.svelte';
  import {
    canPlaceSetupActive as canPlaceSetupActiveModel,
    canPlaceSetupBench as canPlaceSetupBenchModel,
    isSetupStartable as isSetupStartableModel,
    type SetupPlacementContext,
  } from './state/setupSelectionModel';
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
  let activePlayerControls = $state<[PlayerControl, PlayerControl]>(['self', 'agent']);
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
  let animationStepEvents = $derived(replayMode
    ? (replayStore.currentStep?.actionTimeline ?? [])
    : (game?.actionTimeline ?? []));
  let finalEvolutionEvents = $derived(replayMode ? replayFinalEvolutionEvents() : []);
  let error = $derived(homeMode === 'logs' ? replayStore.error : gameStore.error);
  let busy = $derived(replayMode ? replayStore.loading : gameStore.busy);
  let sessionBusy = $derived(replayMode ? replayStore.loading : busy);
  let commandApi = $derived<GameCommandApi>(localGameApi);
  let resolvingPrompt = $derived(gameStore.resolvingPrompt);
  let playingSequence = $derived(gameStore.playingSequence);
  let commandBusy = $derived(sessionBusy || resolvingPrompt || playingSequence);
  let selectedHand = $derived(selectionStore.selectedHand);
  let draggingHand = $derived(selectionStore.draggingHand);
  let focusedSlot = $derived(selectionStore.focusedSlot);
  let setupActiveIndex = $derived(setupSelectionStore.activeIndex);
  let setupBenchIndexes = $derived(setupSelectionStore.benchIndexes);
  let attachPromptEnergyIndex = $derived(promptSelectionStore.activeAttachEnergyIndex);
  let attachPromptAssignments = $derived(promptSelectionStore.attachAssignments);
  let followActive = $derived(viewSettingsStore.followActive);
  let autoConfirmPrompts = $derived(viewSettingsStore.autoConfirmPrompts);
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
  $effect(() => {
    if (player1Control === 'agent' && selectedPlayer1Agent?.deckUrl && player1DeckSource !== selectedPlayer1Agent.id) {
      player1DeckSource = selectedPlayer1Agent.id;
    }
  });
  $effect(() => {
    if (player2Control === 'agent' && selectedPlayer2Agent?.deckUrl && player2DeckSource !== selectedPlayer2Agent.id) {
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
  let activePlayer = $derived(game?.players[game.activePlayerIndex]);
  let bottomPlayer = $derived(game?.players[viewIndex] ?? game?.players[0]);
  let topPlayer = $derived(game?.players.find((player) => player.index !== bottomPlayer?.index));
  let currentPrompt = $derived(replayMode ? null : game?.prompts[0]);
  let actingPlayerIndex = $derived(currentPrompt?.playerIndex ?? game?.activePlayerIndex ?? 0);
  let actingPlayerIsSelf = $derived(activePlayerControls[actingPlayerIndex] === 'self');
  let modeLabel = $derived(`${controlLabel(activePlayerControls[0])} vs ${controlLabel(activePlayerControls[1])}`);
  let boardTargetPrompt = $derived(currentPrompt?.className === 'ChoosePokemonPrompt' ? currentPrompt : null);
  let attachPrompt = $derived(currentPrompt?.className === 'AttachEnergyPrompt' ? currentPrompt : null);
  let damagePrompt = $derived(currentPrompt?.className === 'PutDamagePrompt' ? currentPrompt : null);
  let attachPromptCards = $derived(attachPrompt ? extractPromptCards(attachPrompt.fields) : []);
  let attachPromptMin = $derived(normalizePromptLimit(promptOptions(attachPrompt).min, 0));
  let attachPromptMax = $derived(normalizePromptLimit(promptOptions(attachPrompt).max, attachPromptCards.length || 1));
  let attachPromptTargets = $derived(attachPrompt && game ? getAttachPromptTargets(game, attachPrompt) : []);
  let damagePromptTargets = $derived(damagePrompt && game ? getBoardPromptTargets(game, damagePrompt) : []);
  let damagePromptInstanceKey = $derived(promptInstanceKey(damagePrompt));
  let lastDamagePromptInstanceKey = $state('');
  $effect(() => {
    promptSelectionStore.pruneAttachAssignments(attachPromptCards, attachPromptTargets, attachPromptMax);
  });
  $effect(() => {
    promptSelectionStore.clearUnavailableAttachEnergy(isAttachEnergyAvailable);
  });
  $effect(() => {
    promptSelectionStore.pruneDamagePlacements(damagePromptTargets);
  });
  $effect(() => {
    if (damagePromptInstanceKey !== lastDamagePromptInstanceKey) {
      promptSelectionStore.resetDamagePlacements();
      lastDamagePromptInstanceKey = damagePromptInstanceKey;
    }
  });

  let transferPrompt = $derived(
    currentPrompt?.className === 'MoveDamagePrompt' || currentPrompt?.className === 'RemoveDamagePrompt'
      ? currentPrompt
      : null,
  );
  let transferPromptInstanceKey = $derived(promptInstanceKey(transferPrompt));
  let lastTransferPromptInstanceKey = $state('');
  $effect(() => {
    if (transferPromptInstanceKey !== lastTransferPromptInstanceKey) {
      damageTransferStore.reset();
      lastTransferPromptInstanceKey = transferPromptInstanceKey;
    }
  });
  let boardTargetPromptInstanceKey = $derived(promptInstanceKey(boardTargetPrompt));
  let lastBoardTargetPromptInstanceKey = $state('');
  $effect(() => {
    if (boardTargetPromptInstanceKey !== lastBoardTargetPromptInstanceKey) {
      promptSelectionStore.resetBoardTargets();
      lastBoardTargetPromptInstanceKey = boardTargetPromptInstanceKey;
    }
  });
  let boardStrategy = $derived<BoardInteractionStrategy | null>(
    game && currentPrompt ? createBoardStrategy(game, currentPrompt) : null,
  );

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
    if (!boardStrategy || !game) {
      return;
    }
    window.addEventListener('click', clickBoardPromptSlotAtPoint, true);
    return () => {
      window.removeEventListener('click', clickBoardPromptSlotAtPoint, true);
    };
  });
  let autoResolvePromptResult = $derived(autoResolvablePromptResult(currentPrompt, game));
  let autoResolvePrompt = $derived(
    shouldAutoResolvePrompt(currentPrompt, autoConfirmPrompts, autoResolvePromptResult, !actingPlayerIsSelf),
  );
  let setupPrompt = $derived(
    currentPrompt?.className === 'ChooseCardsPrompt' && currentPrompt.message === 'CHOOSE_STARTING_POKEMONS'
      ? currentPrompt
      : null,
  );
  let setupPlayer = $derived(setupPrompt && game ? game.players[setupPrompt.playerIndex] : undefined);
  let setupBlockedIndexes = $derived(new Set<number>(promptBlockedIndexes(setupPrompt)));
  let setupUi = $derived(getSetupPromptUiState(promptOptions(setupPrompt), setupPlayer, setupActiveIndex));
  let setupMinSelections = $derived(setupUi.minSelections);
  let setupMaxSelections = $derived(setupUi.maxSelections);
  let setupHasEngineActive = $derived(setupUi.hasEngineActive);
  let setupNeedsActive = $derived(!!setupPrompt && setupUi.needsActive);
  let setupCanConfirm = $derived(!!setupPrompt && setupUi.canConfirm);
  let setupPlayableIndexes = $derived(setupPlayer
    ? setupPlayer.hand
        .map((card, index) => ({ card, index }))
        .filter(({ card, index }) => isSetupStartable(card, index))
        .map(({ index }) => index)
    : []);
  let setupPlacedIndexes = $derived(setupSelectionStore.placedIndexes);
  let setupSelectedIndex = $derived(
    selectedHand && setupPrompt?.playerIndex === selectedHand.playerIndex && setupPlayableIndexes.includes(selectedHand.handIndex)
      ? selectedHand.handIndex
      : undefined,
  );
  let setupPlacementContext = $derived<SetupPlacementContext>({
    promptPlayerIndex: setupPrompt?.playerIndex,
    selectedHandIndex: setupSelectedIndex,
    hasEngineActive: setupHasEngineActive,
    activeIndex: setupActiveIndex,
    benchIndexes: setupBenchIndexes,
    minSelections: setupMinSelections,
    benchCapacity: setupUi.benchCapacity,
  });

  function resetPerspective() {
    viewSettingsStore.resetPerspective();
  }

  function createBoardStrategy(currentGame: GameView, prompt: PromptView) {
    if (prompt.className === 'PutDamagePrompt') {
      return createPutDamageStrategy({
        game: currentGame,
        prompt,
        store: promptSelectionStore,
        resolve: (value) => void resolvePrompt(value),
      });
    }
    if (prompt.className === 'MoveDamagePrompt' || prompt.className === 'RemoveDamagePrompt') {
      return createDamageTransferStrategy({
        game: currentGame,
        prompt,
        store: damageTransferStore,
        resolve: (value) => void resolvePrompt(value),
      });
    }
    if (prompt.className === 'ChoosePokemonPrompt') {
      return createChoosePokemonStrategy({
        game: currentGame,
        prompt,
        store: promptSelectionStore,
        resolve: (value) => void resolvePrompt(value),
      });
    }
    return null;
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
  let currentPromptDockMode = $derived<'default' | 'search' | 'attachEnergy'>(
    currentPrompt?.className === 'ChooseCardsPrompt'
      ? 'search'
      : currentPrompt?.className === 'AttachEnergyPrompt'
        ? 'attachEnergy'
        : 'default',
  );
  let retreatSource = $state<PokemonSlotView | null>(null);
  let selectedCard = $derived(selectedHand && game ? game.players[selectedHand.playerIndex]?.hand[selectedHand.handIndex] : undefined);
  let draggingCard = $derived(draggingHand && game ? game.players[draggingHand.playerIndex]?.hand[draggingHand.handIndex] : undefined);
  let viewedCards = $derived(zoneViewerStore.cardsFor(game));
  let focusedPlayer = $derived(focusedSlot && game ? game.players[focusedSlot.ownerIndex] : undefined);
  let focusedIsActive = $derived(focusedSlot?.slot === 'active');
  let focusedCanAct = $derived(!!focusedPlayer && canAct(focusedPlayer.index));
  let focusedBenchTargets = $derived(focusedPlayer?.bench.filter((slot) => !slot.empty) ?? []);
  let topActiveSlot = $derived(topPlayer
    ? previewAttachEnergySlot(
        previewSlot(
          topPlayer.active,
          topPlayer.index === setupPrompt?.playerIndex && setupActiveIndex !== null ? topPlayer.hand[setupActiveIndex] : undefined,
        ),
        attachPrompt,
        attachPromptAssignments,
        attachPromptCards,
      )
    : undefined);
  let bottomActiveSlot = $derived(bottomPlayer
    ? previewAttachEnergySlot(
        previewSlot(
          bottomPlayer.active,
          bottomPlayer.index === setupPrompt?.playerIndex && setupActiveIndex !== null ? bottomPlayer.hand[setupActiveIndex] : undefined,
        ),
        attachPrompt,
        attachPromptAssignments,
        attachPromptCards,
      )
    : undefined);
  let topBenchSlots = $derived(topPlayer
    ? benchSlotsFor(topPlayer, setupPrompt, setupBenchIndexes).map((slot) =>
        previewAttachEnergySlot(slot, attachPrompt, attachPromptAssignments, attachPromptCards),
      )
    : []);
  let bottomBenchSlots = $derived(bottomPlayer
    ? benchSlotsFor(bottomPlayer, setupPrompt, setupBenchIndexes).map((slot) =>
        previewAttachEnergySlot(slot, attachPrompt, attachPromptAssignments, attachPromptCards),
      )
    : []);
  let canPlayOnBoard = $derived(
    !commandBusy && !!bottomPlayer &&
    canPlayCardToBoardArea({
      selected: selectedCard,
      selectedPlayerIndex: selectedHand?.playerIndex,
      dragging: draggingCard,
      draggingPlayerIndex: draggingHand?.playerIndex,
      activePlayerIndex: game?.activePlayerIndex,
      hasPrompt: !!currentPrompt,
      finished: gameFinished,
      inSetup: !!setupPrompt,
    } satisfies BoardPlayAreaContext),
  );
  $effect(() => {
    if (currentPrompt || gameFinished) {
      selectionStore.clearFocus();
    }
  });
  $effect(() => {
    if (retreatSource && !canAct(retreatSource.ownerIndex)) {
      retreatSource = null;
    }
  });
  $effect(() => {
    if (promptLifecycleStore.shouldAutoConfirm(currentPrompt, autoResolvePrompt, resolvingPrompt)) {
      void resolvePrompt(autoResolvePromptResult);
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
    activePlayerControls = [player1Control, player2Control];
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
    return control === 'agent' && agent?.deckUrl ? agent.id : deckSource;
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
    activePlayerControls = ['self', 'self'];
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
    activePlayerControls = ['self', 'self'];
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

  async function playToTarget(target: CardTarget) {
    const handSelection = selectedHand;
    if (!handSelection || !game || !canAct(handSelection.playerIndex)) {
      return;
    }
    selectionStore.setSelectedHand(null);
    selectionStore.clearDragging();
    await gameSessionStore.run(() => commandApi.playCard(handSelection.playerIndex, handSelection.handIndex, target));
  }

  function playToSlot(slot: PokemonSlotView) {
    if (!isPlayableTarget(slot)) {
      return;
    }
    void playToTarget(slot.target);
  }

  function clickSlot(slot: PokemonSlotView) {
    if (attachPrompt && isBoardPromptSelectable(slot)) {
      assignAttachPromptTarget(slot);
      return;
    }

    if (dispatchBoardClick(slot)) {
      return;
    }

    if (canPlaceSetupActive(slot)) {
      placeSetupActive();
      return;
    }

    if (setupPrompt && slot.ownerIndex === setupPrompt.playerIndex && !selectedHand) {
      if (slot.slot === 'active' && setupActiveIndex !== null) {
        removeSetupIndex(setupActiveIndex);
        return;
      }
      if (slot.slot === 'bench' && setupBenchIndexes[slot.index] !== undefined) {
        removeSetupIndex(setupBenchIndexes[slot.index]);
        return;
      }
    }

    if (isPlayableTarget(slot)) {
      playToSlot(slot);
      return;
    }

    if (canPlayOnBoard) {
      playSelectedToBoard();
      return;
    }

    if (!slot.empty && slot.pokemon) {
      selectionStore.focusSlot(slot);
    }
  }

  async function attack(name: string) {
    if (!game || !focusedPlayer || !focusedIsActive || !focusedCanAct) return;
    await gameSessionStore.run(() => commandApi.attack(focusedPlayer!.index, name));
  }

  async function useAbility(name: string, target: CardTarget) {
    if (!game || !focusedPlayer || !focusedCanAct) return;
    await gameSessionStore.run(() => commandApi.useAbility(focusedPlayer!.index, name, target));
  }

  async function useStadium() {
    if (!game || !activePlayer || !canAct(activePlayer.index)) return;
    zoneViewerStore.close();
    await gameSessionStore.run(() => commandApi.useStadium(activePlayer.index));
  }

  async function concede() {
    if (!game || !activePlayer || commandBusy || gameFinished) return;
    await gameSessionStore.run(() => commandApi.concede(game.activePlayerIndex));
  }

  async function passTurn() {
    if (!game || !activePlayer || !canAct(activePlayer.index)) return;
    await gameSessionStore.run(() => commandApi.passTurn(game.activePlayerIndex));
  }

  async function retreat(to: number) {
    const playerIndex = retreatSource?.ownerIndex ?? game?.activePlayerIndex;
    if (!game || playerIndex === undefined || !canAct(playerIndex)) return;
    retreatSource = null;
    await gameSessionStore.run(() => commandApi.retreat(playerIndex, to));
  }

  function canRetreatToSelectedTarget(slot: PokemonSlotView) {
    if (!game || !retreatSource || slot.slot !== 'bench' || slot.empty || slot.ownerIndex !== retreatSource.ownerIndex) {
      return false;
    }
    if (!canAct(retreatSource.ownerIndex)) {
      return false;
    }
    const retreatAction = game.players[retreatSource.ownerIndex]?.availableActions?.active?.retreat;
    if (retreatAction) {
      return retreatAction.targets.includes(slot.index);
    }
    return canRetreatToSlot(retreatSource, slot);
  }

  function startRetreatSelection() {
    if (!focusedSlot || focusedSlot.slot !== 'active' || !canAct(focusedSlot.ownerIndex)) {
      return;
    }
    retreatSource = focusedSlot;
    selectionStore.clearFocus();
  }

  async function resolvePrompt(value: unknown) {
    if (!currentPrompt) return;
    if (currentPrompt.fields.playbackOnly === true) {
      gameStore.confirmPlaybackPrompt();
      return;
    }
    await gameSessionStore.resolve(() => commandApi.resolvePrompt(currentPrompt.id, value));
  }

  function selectHandCard(playerIndex: number, handIndex: number) {
    if (!isSelfControlled(playerIndex)) {
      return;
    }
    if (setupPrompt && playerIndex === setupPrompt.playerIndex) {
      if (!isSetupStartable(game?.players[playerIndex]?.hand[handIndex], handIndex)) {
        return;
      }
      selectionStore.toggleSelectedHand({ playerIndex, handIndex });
      selectionStore.clearFocus();
      return;
    }

    if (!canAct(playerIndex)) {
      return;
    }
    selectionStore.toggleSelectedHand({ playerIndex, handIndex });
    selectionStore.clearFocus();
  }

  function onHandDrag(playerIndex: number, handIndex: number, event: DragEvent) {
    if (!isSelfControlled(playerIndex)) {
      return;
    }
    if (setupPrompt && playerIndex === setupPrompt.playerIndex) {
      if (!isSetupStartable(game?.players[playerIndex]?.hand[handIndex], handIndex)) {
        return;
      }
    } else if (!canAct(playerIndex)) {
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

  function allowDrop(event: DragEvent, slot: PokemonSlotView) {
    if (isPlayableTarget(slot) || canPlaceSetupActive(slot) || (attachPrompt && isBoardPromptSelectable(slot))) {
      event.preventDefault();
    }
  }

  function allowBoardPlayDrop(event: DragEvent) {
    if (canPlayOnBoard) {
      event.preventDefault();
    }
  }

  function allowBenchDrop(event: DragEvent, player: PlayerView) {
    if (canPlayToBenchArea(player) || canPlaceSetupBench(player)) {
      event.preventDefault();
    }
  }

  function switchSides() {
    viewSettingsStore.switchToPlayer(topPlayer?.index ?? 0);
  }

  function resetGame() {
    if (replayMode) {
      replayStore.clear();
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
    resetSaveReplayStatus();
    zoneViewerStore.close();
    viewSettingsStore.resetView();
    activePlayerControls = [player1Control, player2Control];
  }

  function resetSaveReplayStatus() {
    saveReplayMessage = '';
    saveReplayError = '';
    savingReplay = false;
  }

  function dropToSlot(slot: PokemonSlotView, event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    clearDragState();
    if (attachPrompt && isBoardPromptSelectable(slot)) {
      assignAttachPromptTarget(slot);
      return;
    }
    if (canPlaceSetupActive(slot)) {
      placeSetupActive();
      return;
    }
    if (isPlayableTarget(slot)) {
      playToSlot(slot);
      return;
    }
  }

  function dropToBoardPlay(event: DragEvent) {
    if (!canPlayOnBoard) {
      return;
    }
    event.preventDefault();
    clearDragState();
    playSelectedToBoard();
  }

  function clickBoardPlay(event: MouseEvent) {
    if (!canPlayOnBoard) {
      return;
    }
    event.preventDefault();
    playSelectedToBoard();
  }

  function dropToBenchArea(player: PlayerView, event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    clearDragState();
    if (canPlaceSetupBench(player)) {
      placeSetupBench();
      return;
    }
    playToBenchArea(player);
  }

  function isPlayableTarget(slot: PokemonSlotView) {
    if (setupPrompt) {
      return false;
    }
    return canPlayCardToSlot(selectedCard, selectedHand?.playerIndex, slot);
  }

  function benchAreaTarget(player: PlayerView) {
    return playableBenchSlot(player, selectedCard, selectedHand?.playerIndex, !!setupPrompt);
  }

  function canPlayToBenchArea(player: PlayerView) {
    if (setupPrompt) {
      return false;
    }
    return !!benchAreaTarget(player);
  }

  function playToBenchArea(player: PlayerView) {
    const target = benchAreaTarget(player);
    if (!target) {
      return;
    }
    playToSlot(target);
  }

  function canPlayToArea(player: PlayerView) {
    if (setupPrompt) {
      return false;
    }
    return canAct(player.index) && canPlayCardToPlayArea(selectedCard, selectedHand?.playerIndex);
  }

  function playSelectedToBoard() {
    if (!game || !activePlayer || !canPlayToArea(activePlayer)) {
      return;
    }
    void playToTarget(targetFor(game.activePlayerIndex, game.activePlayerIndex, SlotType.ACTIVE));
  }

  function showZone(
    playerIndex: number,
    zone: 'discard' | 'lostZone' | 'stadium' | 'playZone',
    title: string,
    faceDown = false,
  ) {
    zoneViewerStore.show(playerIndex, zone, title, faceDown);
  }

  function normalizePromptLimit(value: unknown, fallback: number) {
    return promptLimit(value, fallback);
  }

  function canAct(playerIndex: number) {
    if (commandBusy) {
      return false;
    }
    if (replayMode) {
      return false;
    }
    if (!isSelfControlled(playerIndex)) {
      return false;
    }
    return canPlayerAct({
      playerIndex,
      activePlayerIndex: game?.activePlayerIndex,
      hasPrompt: !!currentPrompt,
      finished: gameFinished,
    });
  }

  function isSelfControlled(playerIndex: number | undefined) {
    return playerIndex === 0 || playerIndex === 1 ? activePlayerControls[playerIndex] === 'self' : false;
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

  function isAttachEnergyAvailable(index: number) {
    const blocked = new Set<number>(promptBlockedIndexes(attachPrompt));
    return isAttachEnergyAvailableModel(index, [...blocked], attachPromptAssignments);
  }

  function canAssignAttachPromptTarget(target: CardTarget, energyIndex = attachPromptEnergyIndex) {
    if (!attachPrompt) {
      return false;
    }
    return canAssignAttachTarget(
      target,
      energyIndex,
      attachPromptAssignments,
      attachPromptTargets,
      attachPromptMax,
      promptOptions(attachPrompt),
      isAttachEnergyAvailable,
    );
  }

  function isBoardPromptSelectable(slot: PokemonSlotView) {
    if (attachPrompt) {
      if (slot.empty) {
        return false;
      }
      const target = targetForPromptSlot(attachPrompt, slot);
      return canAssignAttachPromptTarget(target);
    }
    if (!currentPrompt && canRetreatToSelectedTarget(slot)) {
      return true;
    }
    if (!boardStrategy || !currentPrompt || slot.empty) {
      return false;
    }
    return boardStrategy.isEligible(targetForPromptSlot(currentPrompt, slot));
  }

  function isBoardPromptSelected(slot: PokemonSlotView) {
    if (!currentPrompt && retreatSource) {
      return slot.slot === 'active' && slot.ownerIndex === retreatSource.ownerIndex;
    }
    if (attachPrompt) {
      if (slot.empty) {
        return false;
      }
      const target = targetForPromptSlot(attachPrompt, slot);
      return attachPromptAssignments.some((assignment) => sameTarget(assignment.target, target));
    }
    if (!boardStrategy || !currentPrompt || slot.empty) {
      return false;
    }
    return boardStrategy.isSelected(targetForPromptSlot(currentPrompt, slot));
  }

  function boardSlotDelta(slot: PokemonSlotView) {
    if (!boardStrategy || !currentPrompt || slot.empty) {
      return 0;
    }
    return boardStrategy.deltaFor(targetForPromptSlot(currentPrompt, slot));
  }

  function dispatchBoardClick(slot: PokemonSlotView) {
    if (!currentPrompt && retreatSource) {
      if (canRetreatToSelectedTarget(slot)) {
        void retreat(slot.index);
        return true;
      }
      retreatSource = null;
      return false;
    }
    if (!boardStrategy || !currentPrompt || slot.empty) {
      return false;
    }
    const target = targetForPromptSlot(currentPrompt, slot);
    if (!boardStrategy.isEligible(target)) {
      return false;
    }
    boardStrategy.activate(target);
    return true;
  }

  function clickBoardPromptSlotAtPoint(event: MouseEvent) {
    if (!boardStrategy || resolvingPrompt) {
      return;
    }
    if (event.target instanceof Element && event.target.closest('.prompt-dock, .prompt-strip')) {
      return;
    }
    const slot = boardPromptSlotAtPoint(event.clientX, event.clientY);
    if (!slot || !dispatchBoardClick(slot)) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function boardPromptSlotAtPoint(x: number, y: number) {
    const slotElement = document.elementsFromPoint(x, y).find((element) =>
      element instanceof HTMLElement
        && element.classList.contains('board-slot')
        && element.classList.contains('prompt-selectable'),
    );
    return slotElement instanceof HTMLElement ? boardSlotFromElement(slotElement) : null;
  }

  function boardSlotFromElement(element: HTMLElement): PokemonSlotView | null {
    if (!game) {
      return null;
    }
    const ownerIndex = Number(element.dataset.ownerIndex);
    const slotKind = element.dataset.slotKind;
    const slotIndex = Number(element.dataset.slotIndex);
    const player = game.players.find((item) => item.index === ownerIndex);
    if (!player || !Number.isFinite(slotIndex)) {
      return null;
    }
    if (slotKind === 'active') {
      return player.active;
    }
    if (slotKind === 'bench') {
      return player.bench.find((slot) => slot.index === slotIndex) ?? null;
    }
    return null;
  }

  function assignAttachPromptTarget(slot: PokemonSlotView) {
    if (!attachPrompt || attachPromptEnergyIndex === null || !isBoardPromptSelectable(slot)) {
      return;
    }
    const target = targetForPromptSlot(attachPrompt, slot);
    promptSelectionStore.assignAttachTarget(target, attachPromptMax);
  }

  function selectAttachPromptEnergy(index: number | null) {
    promptSelectionStore.toggleAttachEnergy(index);
  }

  function removeAttachPromptAssignment(index: number) {
    promptSelectionStore.removeAttachAssignment(index);
  }

  function resetAttachPromptAssignments() {
    promptSelectionStore.resetAttachAssignments();
  }

  function isSetupStartable(card: CardView | undefined, handIndex: number) {
    return isSetupStartableModel(card, handIndex, setupBlockedIndexes, !!setupPrompt);
  }

  function selectedSetupHandIndex() {
    return setupPlacementContext.selectedHandIndex;
  }

  function canPlaceSetupActive(slot: PokemonSlotView) {
    return canPlaceSetupActiveModel(slot, setupPlacementContext);
  }

  function placeSetupActive() {
    const handIndex = selectedSetupHandIndex();
    if (handIndex === undefined) {
      return;
    }
    setupSelectionStore.placeActive(handIndex);
    selectionStore.setSelectedHand(null);
  }

  function canPlaceSetupBench(player: PlayerView) {
    return canPlaceSetupBenchModel(player, setupPlacementContext);
  }

  function placeSetupBench() {
    const handIndex = selectedSetupHandIndex();
    if (handIndex === undefined || !setupPlayer || !canPlaceSetupBench(setupPlayer)) {
      return;
    }
    setupSelectionStore.placeBench(handIndex);
    selectionStore.setSelectedHand(null);
  }

  function removeSetupIndex(handIndex: number) {
    setupSelectionStore.remove(handIndex);
  }

  async function confirmSetupPokemon() {
    if (!setupPrompt || !setupCanConfirm) {
      return;
    }
    await resolvePrompt(setupPromptResult(setupHasEngineActive, setupActiveIndex, setupBenchIndexes));
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
        player1AgentHasPairedDeck={player1Control === 'agent' && !!selectedPlayer1Agent?.deckUrl}
        player2AgentHasPairedDeck={player2Control === 'agent' && !!selectedPlayer2Agent?.deckUrl}
        busy={sessionBusy || player1DeckLoading || player2DeckLoading}
        {catalogBusy}
        {error}
        {catalogError}
        kaggleSelectedSlug={lastKaggleDaySlug}
        kaggleSelectedEpisodeId={lastKaggleEpisodeId}
        setHomeMode={(nextMode) => {
          homeMode = nextMode;
          if (nextMode === 'logs') {
            activePlayerControls = ['self', 'self'];
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
        activePlayerName={activePlayer?.name}
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
        bind:autoConfirmPrompts={viewSettingsStore.autoConfirmPrompts}
        bind:debugZones={viewSettingsStore.debugZones}
        bind:showLogs={viewSettingsStore.showLogs}
        bind:animateActions={viewSettingsStore.animateActions}
        bind:showCardImages={viewSettingsStore.showCardImages}
        bind:actionStepDelayMs={viewSettingsStore.actionStepDelayMs}
        bind:themePreference={viewSettingsStore.themePreference}
        busy={commandBusy}
        promptActive={replayMode || !!currentPrompt}
        {gameFinished}
        {error}
        {resetPerspective}
        {passTurn}
        {concede}
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

      {#if setupPrompt}
        <SetupDock
          needsActive={setupNeedsActive}
          canConfirm={setupCanConfirm}
          resolving={resolvingPrompt}
          confirm={confirmSetupPokemon}
        />
      {:else if boardStrategy}
        <BoardPromptStrip strategy={boardStrategy} resolving={resolvingPrompt} />
      {:else if currentPrompt && !autoResolvePrompt}
        <PromptDock mode={currentPromptDockMode}>
          {#key promptInstanceKey(currentPrompt)}
            <PromptHost
              game={game}
              prompt={currentPrompt}
              resolving={currentPrompt.fields.playbackOnly === true ? false : resolvingPrompt}
              activeAttachEnergyIndex={attachPromptEnergyIndex}
              attachAssignments={attachPromptAssignments}
              onresolve={resolvePrompt}
              onattachEnergySelect={selectAttachPromptEnergy}
              onattachEnergyUnassign={removeAttachPromptAssignment}
              onattachEnergyReset={resetAttachPromptAssignments}
            />
          {/key}
        </PromptDock>
      {/if}

      <BoardLayer>
        <PlayerPanel side="top">
          <Hand
            player={topPlayer}
            selectedHand={selectedHand}
            disabled={!isSelfControlled(topPlayer.index) || (!canAct(topPlayer.index) && setupPrompt?.playerIndex !== topPlayer.index)}
            dimDisabled={!replayMode}
            playableIndexes={setupPrompt?.playerIndex === topPlayer.index ? setupPlayableIndexes : []}
            placedIndexes={setupPrompt?.playerIndex === topPlayer.index ? setupPlacedIndexes : []}
            concealed
            onSelect={selectHandCard}
            onDrag={onHandDrag}
            onDragEnd={clearDragState}
          />
        </PlayerPanel>

        <GameBoard
          {topPlayer}
          {bottomPlayer}
          {topBenchSlots}
          {bottomBenchSlots}
          {topActiveSlot}
          {bottomActiveSlot}
          {canPlayToBenchArea}
          {canPlaceSetupBench}
          {playToBenchArea}
          {placeSetupBench}
          {allowBenchDrop}
          {dropToBenchArea}
          {isPlayableTarget}
          {isBoardPromptSelectable}
          {isBoardPromptSelected}
          {boardSlotDelta}
          {clickSlot}
          {allowDrop}
          {dropToSlot}
          {canPlaceSetupActive}
          {placeSetupActive}
          {showZone}
          {canPlayOnBoard}
          {clickBoardPlay}
          {allowBoardPlayDrop}
          {dropToBoardPlay}
          {boardTilt}
          {boardPerspective}
          {boardScaleY}
          {boardLift}
          animationEvents={game.actionTimeline ?? []}
          {animationScopeKey}
          evolutionChromeEvents={finalEvolutionEvents}
          {replayMode}
        />

        <DeckDrawAnimation
          events={game.actionTimeline ?? []}
          scopeKey={animationScopeKey}
          {replayMode}
        />

        <DeckRevealAnimation
          events={game.actionTimeline ?? []}
          scopeKey={animationScopeKey}
          {replayMode}
        />

        <DeckPrizeAnimation
          events={game.actionTimeline ?? []}
          scopeKey={animationScopeKey}
          {replayMode}
          animatePlacements={false}
        />

        <HandPlayAnimation
          events={game.actionTimeline ?? []}
          scopeKey={animationScopeKey}
          {replayMode}
        />

        <HandResetAnimation
          events={game.actionTimeline ?? []}
          scopeKey={animationScopeKey}
          {replayMode}
        />

        <AbilityAnimation
          events={game.actionTimeline ?? []}
          scopeKey={animationScopeKey}
          {replayMode}
        />

        <AttackAnimation
          events={game.actionTimeline ?? []}
          stepEvents={animationStepEvents}
          scopeKey={animationScopeKey}
          {replayMode}
        />

        <PlayerPanel side="bottom">
          <Hand
            player={bottomPlayer}
            selectedHand={selectedHand}
            disabled={!isSelfControlled(bottomPlayer.index) || (!canAct(bottomPlayer.index) && setupPrompt?.playerIndex !== bottomPlayer.index)}
            dimDisabled={!replayMode}
            playableIndexes={setupPrompt?.playerIndex === bottomPlayer.index ? setupPlayableIndexes : []}
            placedIndexes={setupPrompt?.playerIndex === bottomPlayer.index ? setupPlacedIndexes : []}
            concealed={!replayMode && !isSelfControlled(bottomPlayer.index)}
            onSelect={selectHandCard}
            onDrag={onHandDrag}
            onDragEnd={clearDragState}
          />
        </PlayerPanel>

        {#if focusedSlot}
          <ActiveFocus
            slot={focusedSlot}
            availableActions={focusedPlayer?.availableActions}
            benchTargets={focusedBenchTargets}
            busy={sessionBusy}
            promptActive={!!currentPrompt}
            canAct={focusedCanAct}
            {canRetreatToSlot}
            close={() => {
              selectionStore.clearFocus();
            }}
            {useAbility}
            {attack}
            startRetreat={startRetreatSelection}
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
          actionLabel={zoneViewerIsStadium && viewedCards.length ? 'Use stadium' : ''}
          actionDisabled={sessionBusy || !!currentPrompt || gameFinished || replayMode}
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

</style>
