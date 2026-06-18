import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { CabtDemoController, cabtObservationToGameView, type CabtDataMaps } from '../lib/cabt/demoEngine';
import { CabtAreaType, CabtOptionType, type CabtAttack, type CabtCardData, type CabtObservation, type CabtOption } from '../lib/cabt/types';
import rawCardRows from '../lib/cabt/cardData.generated.json';
import type { CardTarget, EngineResponse, LogView } from '../lib/game/types';
import { PlayerType, SlotType } from '../lib/game/types';
import type { ReplayLoadResponse } from '../lib/game/replay';

type Command = {
  type: string;
  payload?: any;
};

type BridgeResponse = {
  ok: boolean;
  id: number;
  error?: string;
  traceback?: string;
  observation?: CabtObservation;
  cards?: CabtCardData[];
  attacks?: CabtAttack[];
};

type PendingBridgeCall = {
  resolve: (value: BridgeResponse) => void;
  reject: (error: Error) => void;
};

type PendingRetreatTarget = {
  playerIndex: number;
  benchIndex: number;
};

type AgentManifest = {
  agents?: Array<{
    id: string;
    path?: string;
    deckUrl?: string;
  }>;
};

const CARD_ROWS = rawCardRows as Array<{
  id: number;
  name: string;
  set: string;
  setNumber: string;
}>;
const CARD_ROWS_BY_ID = new Map<number, (typeof CARD_ROWS)[number]>();
for (const row of CARD_ROWS) {
  if (!CARD_ROWS_BY_ID.has(row.id)) {
    CARD_ROWS_BY_ID.set(row.id, row);
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(__dirname, '..', '..');
const WORKSPACE_ROOT = path.resolve(FRONTEND_ROOT, '..');
const BRIDGE_PATH = path.join(FRONTEND_ROOT, 'src', 'engine', 'cabt_bridge.py');

export class LocalEngineController {
  private readonly demo = new CabtDemoController();
  private readonly bridge: CabtBridgeClient;
  private observation: CabtObservation | null = null;
  private dataMaps: CabtDataMaps = { cardData: {}, attacks: {} };
  private logs: LogView[] = [];
  private logId = 1;
  private sessionId = '';
  private pendingRetreatTarget: PendingRetreatTarget | null = null;

  constructor() {
    this.bridge = new CabtBridgeClient(() => this.invalidateSession('CABT bridge exited.'));
  }

  async handle(command: Command): Promise<EngineResponse> {
    if (process.env.CABT_ENGINE_MODE === 'demo') {
      return this.demo.handle(command);
    }

    try {
      if (command.type !== 'startGame') {
        this.assertSession(command.payload);
      }
      switch (command.type) {
        case 'startGame':
          return await this.start(command.payload);
        case 'state':
          return this.viewResponse();
        case 'playCard':
          return await this.selectMatchingOption((option) => this.matchesPlayCardOption(option, command.payload));
        case 'attack':
          return await this.selectMatchingOption((option) => this.matchesAttackOption(option, command.payload));
        case 'useAbility':
          return await this.selectMatchingOption((option) => this.matchesAbilityOption(option, command.payload));
        case 'useStadium':
          return await this.selectMatchingOption((option) => option.area === CabtAreaType.STADIUM);
        case 'concede':
          return { ok: false, error: 'Concede is not exposed by the CABT native engine.', view: this.view() };
        case 'retreat':
          return await this.retreat(command.payload);
        case 'passTurn':
          return await this.selectMatchingOption((option) => option.type === CabtOptionType.END);
        case 'resolvePrompt':
          return await this.applySelection(this.normalizePromptSelection(command.payload?.result));
        default:
          return { ok: false, error: `Unsupported command: ${command.type}`, view: this.view() };
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        view: this.view(),
      };
    }
  }

  listReplays() {
    return {
      ok: true,
      replays: [],
    };
  }

  loadReplay(_id?: string): ReplayLoadResponse {
    return { ok: false, error: 'Replay loading is not wired for the CABT adapter yet.' };
  }

  loadReplayData(_replayData?: string, _name?: string): ReplayLoadResponse {
    return { ok: false, error: 'Replay loading is not wired for the CABT adapter yet.' };
  }

  close(): void {
    this.bridge.close();
    this.invalidateSession('CABT bridge closed.');
  }

  private async start(payload: any): Promise<EngineResponse> {
    const player1Deck = resolveDeck(payload?.player1?.deck ?? [], 'Your deck');
    const player2Deck = resolveDeck(payload?.player2?.deck ?? [], 'AI opponent deck');
    const agentPath = agentPathForId(payload?.player2?.agentId);
    this.bridge.stop();
    this.sessionId = createSessionId();
    this.pendingRetreatTarget = null;
    const response = await this.bridge.request({
      command: 'start',
      deck0: player1Deck,
      deck1: player2Deck,
      agentPath,
    }, { allowStart: true });
    this.applyBridgeResponse(response);
    this.logs = [{ id: this.logId++, message: `Started real CABT match${agentPath ? ` against ${agentPath}` : ''}.` }];
    return this.viewResponse();
  }

  private async retreat(payload: any): Promise<EngineResponse> {
    const playerIndex = typeof payload?.playerIndex === 'number' ? payload.playerIndex : 0;
    this.pendingRetreatTarget = {
      playerIndex,
      benchIndex: payload?.to,
    };
    const response = await this.selectMatchingOption((option) => option.type === CabtOptionType.RETREAT);
    if (!response.ok) {
      this.pendingRetreatTarget = null;
    }
    return response;
  }

  private async selectMatchingOption(predicate: (option: CabtOption) => boolean): Promise<EngineResponse> {
    const select = this.observation?.select;
    if (!select) {
      throw new Error('No CABT selection is currently available.');
    }
    const index = select.option.findIndex(predicate);
    if (index < 0) {
      throw new Error('That action is not currently legal in the CABT engine.');
    }
    return this.applySelection([index]);
  }

  private async applySelection(selection: number[]): Promise<EngineResponse> {
    const select = this.observation?.select;
    if (!select) {
      throw new Error('No CABT selection is currently available.');
    }
    if (selection.length < select.minCount || selection.length > select.maxCount) {
      throw new Error(`Selection must contain ${select.minCount}-${select.maxCount} option(s).`);
    }
    const response = await this.bridge.request({
      command: 'select',
      selection,
    });
    this.applyBridgeResponse(response);
    await this.applyPendingRetreatTarget();
    return this.viewResponse();
  }

  private async applyPendingRetreatTarget(): Promise<void> {
    if (!this.pendingRetreatTarget || this.observation?.current?.yourIndex !== this.pendingRetreatTarget.playerIndex) {
      return;
    }
    const targetIndex = this.findPendingRetreatTargetOption();
    if (targetIndex < 0) {
      return;
    }

    this.pendingRetreatTarget = null;
    const response = await this.bridge.request({
      command: 'select',
      selection: [targetIndex],
    });
    this.applyBridgeResponse(response);
  }

  private findPendingRetreatTargetOption(): number {
    const select = this.observation?.select;
    const target = this.pendingRetreatTarget;
    if (!select || !target) {
      return -1;
    }
    return select.option.findIndex((option) =>
      option.area === CabtAreaType.BENCH
      && option.index === target.benchIndex
      && (option.playerIndex === undefined || option.playerIndex === null || option.playerIndex === target.playerIndex));
  }

  private applyBridgeResponse(response: BridgeResponse): void {
    if (!response.ok) {
      throw new Error(response.traceback ? `${response.error}\n${response.traceback}` : (response.error ?? 'CABT bridge failed.'));
    }
    this.observation = response.observation ?? null;
    if (response.cards && response.attacks) {
      this.dataMaps = {
        cardData: Object.fromEntries(response.cards.map((card) => [card.cardId, enrichCardData(card)])),
        attacks: Object.fromEntries(response.attacks.map((attack) => [attack.attackId, attack])),
      };
    }
  }

  private viewResponse(): EngineResponse {
    return { ok: true, view: this.view(), sessionId: this.sessionId || undefined };
  }

  private view() {
    return cabtObservationToGameView(this.observation, this.logs, this.dataMaps);
  }

  private matchesPlayCardOption(option: CabtOption, payload: any): boolean {
    const typeMatches = option.type === CabtOptionType.PLAY || option.type === CabtOptionType.ATTACH || option.type === CabtOptionType.EVOLVE;
    if (!typeMatches || !this.matchesHandSource(option, payload)) {
      return false;
    }

    if (!this.optionHasInPlayTarget(option)) {
      return true;
    }

    const target = targetToCabt(payload?.playerIndex, payload?.target);
    return option.inPlayArea === target.area
      && option.inPlayIndex === target.index
      && (option.playerIndex === undefined || option.playerIndex === null || option.playerIndex === target.playerIndex);
  }

  private matchesAttackOption(option: CabtOption, payload: any): boolean {
    if (option.type !== CabtOptionType.ATTACK || !option.attackId) {
      return false;
    }
    return this.dataMaps.attacks[option.attackId]?.name === payload?.attack;
  }

  private matchesAbilityOption(option: CabtOption, payload: any): boolean {
    if (option.type !== CabtOptionType.ABILITY) {
      return false;
    }

    const target = targetToCabt(payload?.playerIndex, payload?.target);
    if (option.area !== undefined && option.area !== null && option.area !== target.area) {
      return false;
    }
    if (option.index !== undefined && option.index !== null && option.index !== target.index) {
      return false;
    }
    if (option.playerIndex !== undefined && option.playerIndex !== null && option.playerIndex !== target.playerIndex) {
      return false;
    }

    const abilityName = this.abilityNameForOption(option, target.playerIndex);
    return !abilityName || abilityName === payload?.ability;
  }

  private matchesHandSource(option: CabtOption, payload: any): boolean {
    return option.index === payload?.handIndex
      && (option.area === undefined || option.area === null || option.area === CabtAreaType.HAND)
      && (option.playerIndex === undefined || option.playerIndex === null || option.playerIndex === payload?.playerIndex);
  }

  private optionHasInPlayTarget(option: CabtOption): boolean {
    return option.inPlayArea !== undefined
      && option.inPlayArea !== null
      && option.inPlayIndex !== undefined
      && option.inPlayIndex !== null;
  }

  private abilityNameForOption(option: CabtOption, defaultPlayerIndex: number): string | undefined {
    const cardId = option.cardId ?? this.cardIdForOption(option, defaultPlayerIndex);
    return cardId === undefined ? undefined : this.dataMaps.cardData[cardId]?.skills?.[0]?.name;
  }

  private cardIdForOption(option: CabtOption, defaultPlayerIndex: number): number | undefined {
    if (option.index === undefined || option.index === null) {
      return undefined;
    }
    const playerIndex = option.playerIndex ?? defaultPlayerIndex;
    const player = this.observation?.current?.players[playerIndex];
    if (!player) {
      return undefined;
    }
    if (option.area === CabtAreaType.ACTIVE) {
      return player.active[option.index]?.id;
    }
    if (option.area === CabtAreaType.BENCH) {
      return player.bench[option.index]?.id;
    }
    if (option.area === CabtAreaType.HAND) {
      return player.hand?.[option.index]?.id;
    }
    return undefined;
  }

  private normalizePromptSelection(result: unknown): number[] {
    if (result === null || result === undefined || result === true) {
      return [];
    }
    if (typeof result === 'number') {
      return [result];
    }
    if (Array.isArray(result) && result.every((item) => typeof item === 'number')) {
      return result;
    }
    throw new Error('This CABT prompt expects option index selections.');
  }

  private assertSession(payload?: any): void {
    if (!this.sessionId) {
      throw new Error('No active CABT session. Start a new game.');
    }
    const payloadSessionId = payload?.sessionId;
    if (typeof payloadSessionId !== 'string' || !payloadSessionId) {
      throw new Error('CABT session id is required. Start a new game.');
    }
    if (payloadSessionId !== this.sessionId) {
      throw new Error('CABT session expired. Start a new game.');
    }
  }

  private invalidateSession(message: string): void {
    this.sessionId = '';
    this.observation = null;
    this.pendingRetreatTarget = null;
    this.logs = [...this.logs, { id: this.logId++, message }];
  }
}

class CabtBridgeClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingBridgeCall>();
  private stderr = '';
  private generation = 0;

  constructor(private readonly onExit: () => void) {}

  async request(payload: Record<string, unknown>, options: { allowStart?: boolean } = {}): Promise<BridgeResponse> {
    await this.ensureStarted(!!options.allowStart);
    const child = this.child;
    if (!child) {
      throw new Error('CABT session expired. Start a new game.');
    }

    const id = this.nextId++;
    const message = { id, ...payload };
    const response = new Promise<BridgeResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    child.stdin.write(`${JSON.stringify(message)}\n`);
    return response;
  }

  close(): void {
    const child = this.child;
    if (!child) {
      return;
    }
    this.generation += 1;
    this.child = null;
    this.rejectPending(new Error('CABT bridge was closed.'));
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
    child.kill('SIGKILL');
  }

  stop(): void {
    this.close();
  }

  private async ensureStarted(allowStart: boolean): Promise<void> {
    if (this.child && !this.child.killed) {
      return;
    }
    if (!allowStart) {
      return;
    }

    const { command, args } = bridgeProcessCommand();
    const generation = this.generation;
    this.stderr = '';
    const child = spawn(command, args, {
      cwd: WORKSPACE_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;

    const stdout = readline.createInterface({ input: child.stdout });
    stdout.on('line', (line) => this.handleLine(line));
    child.stderr.on('data', (chunk) => {
      this.stderr += String(chunk);
      if (this.stderr.length > 12000) {
        this.stderr = this.stderr.slice(-12000);
      }
    });
    child.on('exit', (code, signal) => {
      if (this.child !== child || this.generation !== generation) {
        return;
      }
      const error = new Error(`CABT bridge exited (${code ?? signal}).${this.stderr ? `\n${this.stderr}` : ''}`);
      this.rejectPending(error);
      this.child = null;
      this.onExit();
    });
  }

  private handleLine(line: string): void {
    const response = JSON.parse(line) as BridgeResponse;
    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }
    this.pending.delete(response.id);
    pending.resolve(response);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function bridgeProcessCommand(): { command: string; args: string[] } {
  if (process.env.CABT_ENGINE_MODE === 'native' || process.platform === 'linux') {
    return { command: process.env.PYTHON ?? 'python3', args: [BRIDGE_PATH] };
  }
  const dockerBridgePath = `/workspace/${toPosixPath(path.relative(WORKSPACE_ROOT, BRIDGE_PATH))}`;
  const sampleSubmissionDir = process.env.CABT_SAMPLE_SUBMISSION_DIR
    ? path.resolve(process.env.CABT_SAMPLE_SUBMISSION_DIR)
    : '';
  const sampleSubmissionArgs = sampleSubmissionDir
    ? [
        '-v',
        `${sampleSubmissionDir}:/cabt-sample-submission:ro`,
        '-e',
        'CABT_SAMPLE_SUBMISSION_DIR=/cabt-sample-submission',
      ]
    : [];
  return {
    command: 'docker',
    args: [
      'run',
      '--rm',
      '-i',
      '--platform',
      'linux/amd64',
      '-v',
      `${WORKSPACE_ROOT}:/workspace`,
      ...sampleSubmissionArgs,
      '-w',
      '/workspace',
      process.env.CABT_DOCKER_IMAGE ?? 'python:3.11-slim',
      'python',
      dockerBridgePath,
    ],
  };
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

function createSessionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function resolveDeck(cards: unknown[], label: string): number[] {
  const ids = cards.map((card, index) => resolveCardId(card, `${label} card ${index + 1}`));
  if (ids.length !== 60) {
    throw new Error(`${label} must contain exactly 60 cards, found ${ids.length}.`);
  }
  return ids;
}

function resolveCardId(card: unknown, label: string): number {
  if (typeof card === 'number' && Number.isInteger(card)) {
    return card;
  }
  if (typeof card !== 'string') {
    throw new Error(`${label}: expected card name or id.`);
  }
  if (/^\d+$/.test(card.trim())) {
    return Number(card.trim());
  }

  const tokens = card.trim().split(/\s+/);
  const set = tokens.at(-1);
  const name = normalizeCardName(tokens.slice(0, -1).join(' '));
  const candidates = uniqueCardRows().filter((row) => row.set === set && normalizeCardName(row.name) === name);
  if (candidates.length === 1) {
    return candidates[0].id;
  }
  if (candidates.length > 1) {
    throw new Error(`${label}: ${card} matches multiple CABT card IDs.`);
  }
  throw new Error(`${label}: could not resolve "${card}" to a CABT card ID.`);
}

function enrichCardData(card: CabtCardData): CabtCardData {
  const row = CARD_ROWS_BY_ID.get(card.cardId);
  if (!row) {
    return card;
  }
  return {
    ...card,
    set: row.set,
    setNumber: row.setNumber,
  };
}

function uniqueCardRows() {
  return [...CARD_ROWS_BY_ID.values()];
}

function normalizeCardName(name: string): string {
  const withoutAccents = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const normalized = withoutAccents.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
  const energy = /^([a-z]+) energy$/.exec(normalized);
  if (!energy) {
    return normalized;
  }
  const energySymbols: Record<string, string> = {
    grass: 'g',
    fire: 'r',
    water: 'w',
    lightning: 'l',
    psychic: 'p',
    fighting: 'f',
    darkness: 'd',
    metal: 'm',
  };
  return energySymbols[energy[1]] ? `basic {${energySymbols[energy[1]]}} energy` : normalized;
}

function agentPathForId(agentId: string | undefined): string | undefined {
  if (!agentId) {
    return undefined;
  }
  const manifestPath = path.join(FRONTEND_ROOT, 'public', 'agents', 'agents.json');
  if (!fs.existsSync(manifestPath)) {
    return undefined;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as AgentManifest;
  return manifest.agents?.find((agent) => agent.id === agentId)?.path;
}

function targetToCabt(actorIndex: number, target: CardTarget): { playerIndex: number; area: number; index: number } {
  const playerIndex = target.player === PlayerType.BOTTOM_PLAYER ? actorIndex : 1 - actorIndex;
  return {
    playerIndex,
    area: target.slot === SlotType.BENCH ? CabtAreaType.BENCH : CabtAreaType.ACTIVE,
    index: target.index,
  };
}
