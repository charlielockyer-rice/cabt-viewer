// End-to-end live-play verification against the real CABT engine.
//
// Env-gated: runs only when CABT_SAMPLE_SUBMISSION_DIR points at the Kaggle
// sample_submission bundle (and PYTHON at an interpreter that can load it).
// Optionally CABT_PROBE_AGENT names an agent file for seat 1 (e.g. a model
// policy); seat 0 always uses the bridge's built-in first-legal player.
//
//   CABT_SAMPLE_SUBMISSION_DIR=... PYTHON=... npx vitest run liveBridge
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LiveObservationNormalizer } from './liveSteps';
import { LocalEngineController } from './localEngine';
import { cabtObservationToGameView } from '../lib/cabt/cabtProjection';
import { CabtLogType, type CabtObservation } from '../lib/cabt/types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(__dirname, '..', '..');
const BRIDGE_PATH = path.join(FRONTEND_ROOT, 'src', 'engine', 'cabt_bridge.py');
const DECK_PATH = path.join(FRONTEND_ROOT, 'public', 'agents', 'official-random-abomasnow', 'deck.csv');

const sampleSubmissionDir = process.env.CABT_SAMPLE_SUBMISSION_DIR ?? '';
const python = process.env.PYTHON ?? 'python3';
const probeAgent = process.env.CABT_PROBE_AGENT;
const enabled = !!sampleSubmissionDir && fs.existsSync(sampleSubmissionDir);

function readDeck(): number[] {
  return fs.readFileSync(DECK_PATH, 'utf8').split('\n').filter(Boolean).map(Number);
}

type BridgeSession = {
  request: (message: Record<string, unknown>) => Promise<any>;
  close: () => void;
};

function spawnBridge(): BridgeSession {
  const child = spawn(python, [BRIDGE_PATH], {
    env: { ...process.env, CABT_SAMPLE_SUBMISSION_DIR: sampleSubmissionDir },
  });
  const lines = readline.createInterface({ input: child.stdout });
  const pending: Array<(value: any) => void> = [];
  lines.on('line', (line) => {
    try {
      pending.shift()?.(JSON.parse(line));
    } catch {
      // Non-protocol output from agents; ignore like the controller does.
    }
  });
  return {
    request(message) {
      return new Promise((resolve) => {
        pending.push(resolve);
        child.stdin.write(`${JSON.stringify(message)}\n`);
      });
    },
    close() {
      child.kill('SIGKILL');
    },
  };
}

describe.skipIf(!enabled)('live pipeline against the real CABT engine', () => {
  it('normalizer emits each engine event exactly once with seat-stable hands', async () => {
    const bridge = spawnBridge();
    try {
      const deck = readDeck();
      const response = await bridge.request({
        id: 1,
        command: 'start',
        deck0: deck,
        deck1: deck,
        agentPaths: [null, probeAgent ?? null],
        agentControlled: [true, true],
      });
      expect(response.ok).toBe(true);
      const observations: CabtObservation[] = response.autoSteps;
      expect(observations.length).toBeGreaterThan(10);

      // Ground truth via the per-seat stream positions, independent of the
      // normalizer's implementation.
      const delivered = [0, 0];
      let canonicalTruth = 0;
      const normalizer = new LiveObservationNormalizer();
      let emitted = 0;
      for (const observation of observations) {
        const seat = observation.current!.yourIndex;
        const logs = observation.logs ?? [];
        const freshTruth = Math.max(0, delivered[seat] + logs.length - canonicalTruth);
        canonicalTruth = Math.max(canonicalTruth, delivered[seat] + logs.length);
        delivered[seat] += logs.length;

        const { observation: fixed, newLogs } = normalizer.push(observation);
        expect(newLogs).toHaveLength(freshTruth);
        emitted += newLogs.length;

        // Seat-stable perspective: both hands always materialized to
        // handCount, every card carrying a serial for animation anchors.
        for (const player of fixed.current!.players) {
          expect(player.hand).not.toBeNull();
          expect(player.hand!.length).toBe(player.handCount);
          for (const card of player.hand!) {
            expect(typeof card.serial).toBe('number');
          }
        }
      }
      expect(emitted).toBe(canonicalTruth);
      const totalDelivered = observations.reduce((sum, observation) => sum + (observation.logs?.length ?? 0), 0);
      // The engine delivers both seats' parallel streams; the canonical
      // stream must be well under the raw line count.
      expect(canonicalTruth).toBeLessThan(totalDelivered);
    } finally {
      bridge.close();
    }
  }, 120_000);

  it('controller plays a full agent-vs-agent game into coherent playback steps', async () => {
    process.env.CABT_ENGINE_MODE = 'native';
    // Optionally give seat 1 a real agent file via a throwaway workspace
    // manifest (the controller only resolves agents by id).
    let manifestFile: string | undefined;
    if (probeAgent) {
      manifestFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cabt-probe-')), 'agents.json');
      fs.writeFileSync(manifestFile, JSON.stringify({
        agents: [{ id: 'probe-agent', name: 'Probe agent', path: path.resolve(probeAgent) }],
      }));
      process.env.CABT_AGENTS_FILE = manifestFile;
    }
    const controller = new LocalEngineController();
    try {
      const deck = readDeck();
      const response = await controller.handle({
        type: 'startGame',
        payload: {
          player1: { name: 'First legal', deck, control: 'agent' },
          player2: { name: 'Probe', deck, control: 'agent', agentId: probeAgent ? 'probe-agent' : undefined },
        },
      });

      expect(response.ok).toBe(true);
      if (!response.ok) return;
      expect(response.view.phaseLabel).toBe('Finished');
      const sequence = response.sequence ?? [];
      expect(sequence.length).toBeGreaterThan(10);

      let lastEventId = 0;
      for (const step of sequence) {
        // History frames never prompt.
        expect(step.prompts).toEqual([]);
        const events = step.actionTimeline ?? [];
        // Every step animates something, exactly once: ids are fresh and
        // strictly increasing across the whole game.
        expect(events.length).toBeGreaterThan(0);
        for (const event of events) {
          expect(event.id).toBeGreaterThan(lastEventId);
          lastEventId = event.id;
        }
        // Seat-fixed views: two players, hands always materialized.
        expect(step.players).toHaveLength(2);
        for (const player of step.players) {
          for (const card of player.hand) {
            expect(typeof card.serial).toBe('number');
          }
        }
      }

      // Spectator (agent-vs-agent) keeps concrete draws; a game always draws.
      const drawEvents = sequence.flatMap((step) => (step.actionTimeline ?? []).filter((event) => event.kind === 'Draw'));
      expect(drawEvents.length).toBeGreaterThan(0);
    } finally {
      controller.close();
      delete process.env.CABT_ENGINE_MODE;
      if (manifestFile) {
        delete process.env.CABT_AGENTS_FILE;
        fs.rmSync(path.dirname(manifestFile), { recursive: true, force: true });
      }
    }
  }, 180_000);

  it('drives a full game through the select contract: decisions in, indexes out', async () => {
    process.env.CABT_ENGINE_MODE = 'native';
    const controller = new LocalEngineController();
    try {
      const deck = readDeck();
      let response = await controller.handle({
        type: 'startGame',
        payload: {
          player1: { name: 'Human A', deck, control: 'self' },
          player2: { name: 'Human B', deck, control: 'self' },
        },
      });
      expect(response.ok).toBe(true);
      if (!response.ok) return;
      const sessionId = response.sessionId!;
      expect(response.view.seats).toEqual([
        { control: 'self', name: 'Human A' },
        { control: 'self', name: 'Human B' },
      ]);

      let lastSeq = -1;
      for (let step = 0; step < 2000 && response.ok && response.view.phase !== 7; step += 1) {
        const decision = response.view.decision;
        expect(decision).toBeDefined();
        if (!decision) break;
        // Every decision is fresh — the seq advances with each engine step.
        expect(decision.seq).toBeGreaterThan(lastSeq);
        lastSeq = decision.seq;
        expect(decision.options.length).toBeGreaterThan(0);
        // First-legal play: the leading maxCount option indexes.
        const indexes = Array.from(
          { length: Math.min(decision.max, decision.options.length) },
          (_item, index) => index,
        );
        response = await controller.handle({
          type: 'select',
          payload: { sessionId, seq: decision.seq, indexes },
        });
        expect(response.ok).toBe(true);
      }

      expect(response.ok).toBe(true);
      if (!response.ok) return;
      expect(response.view.phase).toBe(7);
      expect(response.view.decision).toBeUndefined();
      expect([0, 1, 3]).toContain(response.view.winner);

      // A stale seq is rejected without touching the engine.
      const stale = await controller.handle({
        type: 'select',
        payload: { sessionId, seq: lastSeq, indexes: [0] },
      });
      expect(stale.ok).toBe(false);
    } finally {
      controller.close();
      delete process.env.CABT_ENGINE_MODE;
    }
  }, 300_000);

  it('conceals a human opponent seat: agent draws arrive downgraded', async () => {
    const bridge = spawnBridge();
    try {
      const deck = readDeck();
      const response = await bridge.request({
        id: 1,
        command: 'start',
        deck0: deck,
        deck1: deck,
        agentPaths: [null, probeAgent ?? null],
        agentControlled: [true, true],
      });
      expect(response.ok).toBe(true);
      // Human at seat 0, agent at seat 1 — replay the same stream through a
      // concealing normalizer.
      const normalizer = new LiveObservationNormalizer(new Set([1]));
      let concealedConcreteDraws = 0;
      let downgradedDraws = 0;
      for (const observation of response.autoSteps as CabtObservation[]) {
        for (const log of normalizer.push(observation).newLogs) {
          if (log.playerIndex !== 1) continue;
          if (log.type === CabtLogType.DRAW) concealedConcreteDraws += 1;
          if (log.type === CabtLogType.DRAW_REVERSE) downgradedDraws += 1;
        }
      }
      expect(concealedConcreteDraws).toBe(0);
      expect(downgradedDraws).toBeGreaterThan(0);
    } finally {
      bridge.close();
    }
  }, 120_000);
});

// Keep vitest happy when the suite is skipped for lack of an engine.
describe('live bridge integration harness', () => {
  it('declares its gating condition', () => {
    expect(typeof enabled).toBe('boolean');
  });
});

// The projection used by the steps must accept the normalizer's output; a
// smoke assertion here keeps the pairing honest even in gated environments.
describe('normalizer/projection pairing', () => {
  it('projects a normalized observation without prompts into a renderable view', () => {
    const normalizer = new LiveObservationNormalizer();
    const observation: CabtObservation = {
      select: null,
      logs: [],
      current: {
        turn: 1,
        turnActionCount: 0,
        yourIndex: 0,
        firstPlayer: 0,
        supporterPlayed: false,
        stadiumPlayed: false,
        energyAttached: false,
        retreated: false,
        result: -1,
        stadium: [],
        looking: null,
        players: [
          {
            active: [null], bench: [], benchMax: 5, deckCount: 40, discard: [], prize: [],
            handCount: 2, hand: [{ id: 5, serial: 1, playerIndex: 0 }, { id: 6, serial: 2, playerIndex: 0 }],
            poisoned: false, burned: false, asleep: false, paralyzed: false, confused: false,
          },
          {
            active: [null], bench: [], benchMax: 5, deckCount: 40, discard: [], prize: [],
            handCount: 3, hand: null,
            poisoned: false, burned: false, asleep: false, paralyzed: false, confused: false,
          },
        ],
      },
    };

    const { observation: fixed } = normalizer.push(observation);
    const view = cabtObservationToGameView(fixed, [], { cardData: {}, attacks: {} }, []);

    expect(view.ready).toBe(true);
    expect(view.players[1].hand).toHaveLength(3);
    expect(view.players[1].hand.every((card) => typeof card.serial === 'number')).toBe(true);
    expect(view.players[1].hand.every((card) => card.name === 'Card')).toBe(true);
  });
});
