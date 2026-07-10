import fs from 'node:fs';
import http from 'node:http';
import { LocalEngineController } from './localEngine';
import { workspaceAgentDeckFile, workspaceAgentOptions } from './workspaceAgents';
import { workspaceDeckCsvFile, workspaceDeckOptions } from './workspaceDecks';

const port = Number(process.env.LOCAL_ENGINE_PORT ?? 8095);
const host = process.env.LOCAL_ENGINE_HOST ?? '127.0.0.1';
const controller = new LocalEngineController();

function readBody(req: http.IncomingMessage, maxBytes = 1_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/local-engine/health') {
    writeJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/local-engine/agents') {
    try {
      writeJson(res, 200, { agents: workspaceAgentOptions() });
    } catch (error) {
      writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/local-engine/agent-decks/')) {
    const id = decodeURIComponent(url.pathname.slice('/local-engine/agent-decks/'.length));
    const deckFile = workspaceAgentDeckFile(id);
    if (!deckFile || !fs.existsSync(deckFile)) {
      writeJson(res, 404, { ok: false, error: `No deck for agent ${id}` });
      return;
    }
    const csv = fs.readFileSync(deckFile, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Length': Buffer.byteLength(csv) });
    res.end(csv);
    return;
  }

  // Deck catalog (all Limitless archetypes + Kaggle decks), decoupled from
  // agents. The picker lists these; a deck's CSV is served by id below.
  if (req.method === 'GET' && url.pathname === '/local-engine/decks') {
    try {
      writeJson(res, 200, { decks: workspaceDeckOptions() });
    } catch (error) {
      writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/local-engine/deck-csv/')) {
    const id = decodeURIComponent(url.pathname.slice('/local-engine/deck-csv/'.length));
    const deckFile = workspaceDeckCsvFile(id);
    if (!deckFile || !fs.existsSync(deckFile)) {
      writeJson(res, 404, { ok: false, error: `No deck ${id}` });
      return;
    }
    const csv = fs.readFileSync(deckFile, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Length': Buffer.byteLength(csv) });
    res.end(csv);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/local-engine/save-replay') {
    const response = controller.saveReplay();
    writeJson(res, response.ok ? 200 : 400, response);
    return;
  }

  // Live eval bar: win probability for one seat at the current interactive
  // position. Read-only and advisory — proxied to the eval sidecar; a missing
  // sidecar returns pWin=null and the bar hides itself.
  if (req.method === 'POST' && url.pathname === '/local-engine/eval') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      writeJson(res, 200, await controller.evaluate(Number(body?.seat ?? 0)));
    } catch (error) {
      writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  // Replay eval graph: batch value curve over an episode's frames. Frames carry
  // full observations, so allow a larger body than the gameplay routes.
  if (req.method === 'POST' && url.pathname === '/local-engine/eval-replay') {
    try {
      const body = JSON.parse((await readBody(req, 64_000_000)) || '{}');
      writeJson(res, 200, await controller.evaluateReplay(body?.frames ?? [], Number(body?.seat ?? 0), body?.deck ?? []));
    } catch (error) {
      writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (req.method !== 'POST' || url.pathname !== '/local-engine') {
    writeJson(res, 404, { ok: false, error: 'Not found' });
    return;
  }

  try {
    const raw = await readBody(req);
    const command = raw ? JSON.parse(raw) : { type: 'state' };
    const response = await controller.handle(command);
    writeJson(res, response.ok ? 200 : 400, response);
  } catch (error) {
    writeJson(res, 400, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(port, host, () => {
  process.stdout.write(`[cabt-local-engine] listening on http://${host}:${port}\n`);
});
