import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { cabtObservationToGameView, projectDecision, type CabtDataMaps } from '../lib/cabt/cabtProjection';
import { stepAnimationPhases } from '../lib/cabt/cabtReplay';
import { cabtLogsToTimeline } from '../lib/cabt/logFormat';
import { LiveObservationNormalizer, logsWithSynthesizedAnnounce } from './liveSteps';
import { workspaceAgentPath } from './workspaceAgents';
import {
  type CabtAttack,
  type CabtCardData,
  type CabtObservation,
} from '../lib/cabt/types';
import rawCardRows from '../lib/cabt/cardData.generated.json';
import type { ActionTimelineEvent, EngineResponse, GameView, LogView, SeatView } from '../lib/game/types';

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
  autoSteps?: CabtObservation[];
  autoActions?: Array<number[] | null>;
  cards?: CabtCardData[];
  attacks?: CabtAttack[];
};

type PendingBridgeCall = {
  resolve: (value: BridgeResponse) => void;
  reject: (error: Error) => void;
};

type PlayerControl = 'self' | 'agent';

type SaveReplayResponse = {
  ok: boolean;
  file?: string;
  id?: string;
  error?: string;
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

const BRIDGE_TIMEOUT_MS = Math.max(1000, Number(process.env.CABT_BRIDGE_TIMEOUT_MS ?? 120_000));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(__dirname, '..', '..');
const WORKSPACE_ROOT = path.resolve(FRONTEND_ROOT, '..');
const BRIDGE_PATH = path.join(FRONTEND_ROOT, 'src', 'engine', 'cabt_bridge.py');
const GAME_LOGS_DIR = path.join(FRONTEND_ROOT, 'public', 'game-logs');
const GAME_LOGS_MANIFEST = path.join(GAME_LOGS_DIR, 'logs.json');

export class LocalEngineController {
  private readonly bridge: CabtBridgeClient;
  private observation: CabtObservation | null = null;
  private dataMaps: CabtDataMaps = { cardData: {}, attacks: {} };
  private logs: LogView[] = [];
  private logId = 1;
  private actionTimeline: ActionTimelineEvent[] = [];
  private timelineId = 1;
  private normalizer = new LiveObservationNormalizer();
  private lastNewLogs: Array<Record<string, unknown>> = [];
  private pendingSequence: GameView[] = [];
  private sessionId = '';
  private decisionSeq = 0;
  private replayFrames: CabtObservation[] = [];
  private replayPlayerLabels: [string, string] = ['Player 1', 'Player 2'];
  private replayModeLabel = 'Self vs Agent';
  private playerControls: [PlayerControl, PlayerControl] = ['self', 'agent'];

  constructor() {
    this.bridge = new CabtBridgeClient(() => this.invalidateSession('CABT bridge exited.'));
  }

  async handle(command: Command): Promise<EngineResponse> {
    try {
      if (command.type !== 'startGame') {
        this.assertSession(command.payload);
      }
      switch (command.type) {
        case 'startGame':
          return await this.start(command.payload);
        case 'state':
          return this.viewResponse();
        case 'select':
          return await this.select(command.payload);
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

  saveReplay(): SaveReplayResponse {
    if (!this.replayFrames.length) {
      return { ok: false, error: 'No local match is available to save.' };
    }
    const finalFrame = this.replayFrames.at(-1);
    const winner = finalFrame?.current?.result;
    const created = new Date();
    const stamp = compactIsoTimestamp(created);
    const id = `local-${stamp}`;
    const file = `${id}.json`;
    const name = `Local ${this.replayModeLabel} ${created.toLocaleString()}`;
    const replay = {
      visualize: this.replayFrames,
      environment: {
        id,
        title: name,
        info: {
          TeamNames: this.replayPlayerLabels,
        },
      },
    };

    fs.mkdirSync(GAME_LOGS_DIR, { recursive: true });
    fs.writeFileSync(path.join(GAME_LOGS_DIR, file), `${JSON.stringify(replay)}\n`);
    writeGameLogManifest({
      id,
      name,
      file,
      createdAt: created.toISOString(),
      players: this.replayPlayerLabels,
      description: `Saved local ${this.replayModeLabel} match${typeof winner === 'number' && winner >= 0 ? `, result ${winner}` : ''}.`,
    });
    return { ok: true, id, file };
  }

  close(): void {
    this.bridge.close();
    this.invalidateSession('CABT bridge closed.');
  }

  private async start(payload: any): Promise<EngineResponse> {
    const playerControls = normalizePlayerControls(payload);
    const player1Deck = resolveDeck(payload?.player1?.deck ?? [], 'Your deck');
    const player2Deck = resolveDeck(payload?.player2?.deck ?? [], 'Player 2 deck');
    const agentPaths = [
      playerControls[0] === 'agent' ? agentPathForId(payload?.player1?.agentId) : undefined,
      playerControls[1] === 'agent' ? agentPathForId(payload?.player2?.agentId) : undefined,
    ];
    this.bridge.stop();
    this.sessionId = createSessionId();
    this.decisionSeq = 0;
    this.actionTimeline = [];
    this.timelineId = 1;
    this.normalizer = new LiveObservationNormalizer(concealedSeats(playerControls));
    this.lastNewLogs = [];
    this.pendingSequence = [];
    this.replayFrames = [];
    this.playerControls = playerControls;
    this.replayModeLabel = `${controlLabel(playerControls[0])} vs ${controlLabel(playerControls[1])}`;
    this.replayPlayerLabels = [
      payload?.player1?.name ?? 'Player 1',
      payload?.player2?.name ?? 'Player 2',
    ];
    this.logs = [{
      id: this.logId++,
      message: `Started real CABT match (${this.replayModeLabel}).`,
    }];
    const response = await this.bridge.request({
      command: 'start',
      deck0: player1Deck,
      deck1: player2Deck,
      agentPaths,
      agentControlled: playerControls.map((control) => control === 'agent'),
    }, { allowStart: true });
    this.applyBridgeResponse(response);
    return this.viewResponse();
  }

  // The one gameplay command: answer the engine's current select with option
  // indexes. `seq` must match the decision the client saw, so a selection can
  // never land on a select it wasn't made for.
  private async select(payload: any): Promise<EngineResponse> {
    const select = this.observation?.select;
    if (!select) {
      throw new Error('No CABT decision is currently available.');
    }
    if (payload?.seq !== this.decisionSeq) {
      throw new Error('That decision is no longer current.');
    }
    const indexes = payload?.indexes;
    if (!Array.isArray(indexes)
      || !indexes.every((index) => Number.isInteger(index) && index >= 0 && index < select.option.length)) {
      throw new Error('Decision option indexes are required.');
    }
    if (indexes.length < select.minCount || indexes.length > select.maxCount) {
      throw new Error(`Selection must contain ${select.minCount}-${select.maxCount} option(s).`);
    }
    const response = await this.bridge.request({
      command: 'select',
      selection: indexes,
    });
    this.applyBridgeResponse(response);
    return this.viewResponse();
  }

  private applyBridgeResponse(response: BridgeResponse): void {
    if (!response.ok) {
      throw new Error(response.traceback ? `${response.error}\n${response.traceback}` : (response.error ?? 'CABT bridge failed.'));
    }
    if (response.cards && response.attacks) {
      this.dataMaps = {
        cardData: Object.fromEntries(response.cards.map((card) => [card.cardId, enrichCardData(card)])),
        attacks: Object.fromEntries(response.attacks.map((attack) => [attack.attackId, attack])),
      };
    }
    this.pendingSequence = [...this.pendingSequence, ...this.appendSteps(response)];
    if (!response.observation) {
      this.observation = null;
    }
    // Every applied engine step invalidates whatever decision came before it.
    this.decisionSeq += 1;
  }

  private viewResponse(): EngineResponse {
    const sequence = this.pendingSequence;
    this.pendingSequence = [];
    return {
      ok: true,
      view: this.view(),
      sequence: sequence.length ? sequence : undefined,
      sessionId: this.sessionId || undefined,
    };
  }

  private view(): GameView {
    const view = cabtObservationToGameView(this.observation, this.logs, this.dataMaps, this.actionTimeline);
    return {
      ...view,
      decision: this.observation ? projectDecision(this.observation, this.decisionSeq, this.dataMaps) : undefined,
      seats: this.seats(),
    };
  }

  private seats(): SeatView[] {
    return this.playerControls.map((control, index) => ({
      control,
      name: this.replayPlayerLabels[index] ?? `Player ${index + 1}`,
    }));
  }

  // Live playback steps, shaped like replay's: each observation contributes
  // exactly its own canonical events against the board state at that
  // observation (seat-stabilized by the normalizer). Steps carry no prompts —
  // they are history frames; only the final interactive view prompts.
  private appendSteps(response: BridgeResponse): GameView[] {
    const observations = response.autoSteps?.length ? response.autoSteps : response.observation ? [response.observation] : [];
    const actions = response.autoActions ?? [];
    const steps: GameView[] = [];
    let previous = this.observation;
    for (let index = 0; index < observations.length; index += 1) {
      const { observation, newLogs } = this.normalizer.push(observations[index]);
      const previousObservation = previous;
      // The engine never logs ability usage; synthesize it from the selection
      // that produced this observation (and from a triggered attach), same as
      // replay's logsWithSynthesizedAbility.
      const stepLogs = logsWithSynthesizedAnnounce(previousObservation, actions[index] ?? null, this.lastNewLogs, newLogs, this.dataMaps);
      previous = observation;
      this.lastNewLogs = newLogs;
      this.observation = observation;
      this.replayFrames.push(observation);
      if (!stepLogs.length) {
        continue;
      }
      // The engine resolves whole effects instantly; the player must watch
      // them happen. Replay's phase machinery splits the batch into typed
      // animation phases, each carrying the view of the world BEFORE that
      // phase resolves (pre-draw hands for both seats, the dying Pokemon
      // still standing for its knock-out, both switchers at their source
      // slots for a retreat). One live step per phase.
      const step = this.buildStep(observation, stepLogs);
      const previousView = previousObservation
        ? {
            ...cabtObservationToGameView(previousObservation, this.logs, this.dataMaps, []),
            seats: this.seats(),
          }
        : undefined;
      const phases = previousView
        ? stepAnimationPhases(previousView, step, step.actionTimeline ?? [])
        : undefined;
      if (phases?.length) {
        for (const phase of phases) {
          steps.push({ ...phase.view, seats: this.seats() });
        }
      } else {
        steps.push(step);
      }
    }
    return steps;
  }

  // Steps are history frames: projected without a decision, so playback
  // never renders an interactive affordance. They carry seats like the
  // interactive view does — hand concealment reads them.
  private buildStep(observation: CabtObservation, stepLogs: Array<Record<string, unknown>>): GameView {
    const result = cabtLogsToTimeline(stepLogs, { nextId: this.timelineId });
    this.timelineId = result.nextId;
    this.actionTimeline = [...this.actionTimeline, ...result.events].slice(-200);
    for (const event of result.events) {
      this.logs = [...this.logs, { id: this.logId++, message: event.message }];
    }
    return {
      ...cabtObservationToGameView(observation, this.logs, this.dataMaps, result.events),
      seats: this.seats(),
    };
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
    this.decisionSeq = 0;
    this.actionTimeline = [];
    this.timelineId = 1;
    this.normalizer = new LiveObservationNormalizer();
    this.lastNewLogs = [];
    this.pendingSequence = [];
    this.replayFrames = [];
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
      // A wedged engine or lost response must surface as an error instead of
      // an HTTP request that hangs forever.
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error(`CABT bridge did not respond within ${BRIDGE_TIMEOUT_MS}ms.`));
        }
      }, BRIDGE_TIMEOUT_MS);
      timer.unref?.();
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
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
    let response: BridgeResponse;
    try {
      response = JSON.parse(line) as BridgeResponse;
    } catch {
      // Agents that print to stdout would otherwise corrupt the protocol.
      process.stderr.write(`[cabt-bridge] ignoring non-JSON output: ${line.slice(0, 200)}\n`);
      return;
    }
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
  if (useNativeBridge()) {
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

// Native (local Python) vs Docker selection. Native on Linux, when explicitly
// asked (CABT_ENGINE_MODE=native), or on macOS when a native libcg.dylib is
// present in the sample submission — the compiled arm64 engine runs far faster
// than the Linux library through Docker. Docker stays the macOS fallback when
// no dylib is present; CABT_ENGINE_MODE=docker forces it even when one is.
function useNativeBridge(): boolean {
  if (process.env.CABT_ENGINE_MODE === 'docker') {
    return false;
  }
  if (process.env.CABT_ENGINE_MODE === 'native' || process.platform === 'linux') {
    return true;
  }
  return process.platform === 'darwin' && hasNativeMacLibrary();
}

function hasNativeMacLibrary(): boolean {
  const sampleSubmissionDir = process.env.CABT_SAMPLE_SUBMISSION_DIR
    ? path.resolve(process.env.CABT_SAMPLE_SUBMISSION_DIR)
    : path.join(FRONTEND_ROOT, 'sample_submission');
  return fs.existsSync(path.join(sampleSubmissionDir, 'cg', 'libcg.dylib'));
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

function createSessionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizePlayerControls(payload: any): [PlayerControl, PlayerControl] {
  const player1Control = payload?.player1?.control === 'agent' ? 'agent' : 'self';
  if (payload?.player2?.control === 'self' || payload?.manualOpponent || payload?.player2?.manualOpponent) {
    return [player1Control, 'self'];
  }
  return [player1Control, 'agent'];
}

// Agent seats' hidden information (their draws) is downgraded to the
// opponent-facing encoding when a human is playing; a pure agent-vs-agent
// game keeps the omniscient spectator view.
function concealedSeats(playerControls: [PlayerControl, PlayerControl]): Set<number> {
  if (!playerControls.includes('self')) {
    return new Set();
  }
  return new Set(playerControls.flatMap((control, seat) => (control === 'agent' ? [seat] : [])));
}

function controlLabel(control: PlayerControl): string {
  return control === 'agent' ? 'Agent' : 'Self';
}

function compactIsoTimestamp(date: Date): string {
  return date.toISOString().replace(/\D/g, '').slice(0, 14);
}

function writeGameLogManifest(entry: {
  id: string;
  name: string;
  file: string;
  createdAt: string;
  players: string[];
  description: string;
}): void {
  const manifest = readGameLogManifest();
  const logs = Array.isArray(manifest.logs) ? manifest.logs.filter((item: any) => item?.id !== entry.id) : [];
  manifest.logs = [entry, ...logs];
  fs.writeFileSync(GAME_LOGS_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
}

function readGameLogManifest(): { logs: unknown[] } {
  if (!fs.existsSync(GAME_LOGS_MANIFEST)) {
    return { logs: [] };
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(GAME_LOGS_MANIFEST, 'utf8'));
    return manifest && typeof manifest === 'object' && Array.isArray(manifest.logs) ? manifest : { logs: [] };
  } catch {
    return { logs: [] };
  }
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
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as AgentManifest;
    const bundled = manifest.agents?.find((agent) => agent.id === agentId)?.path;
    if (bundled) {
      return bundled;
    }
  }
  return workspaceAgentPath(agentId);
}
