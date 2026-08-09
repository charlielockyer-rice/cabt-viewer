import { replayUrlAtState } from '../game/replayLocation';

// `cabt-clip-v1` is a fixed contract shared with the Python writer in
// agent-lab. A clip is a small agent-authored tour: a few curated positions
// across one or more replays, each with commentary, so a reviewer can read
// "what happened / what was the alternative" in one sitting.
//
// Forward compatibility rule: an item kind this viewer does not know must not
// take the clip down. Unknown kinds parse into `unsupported` and render as an
// inert row, so a clip written by a newer writer still opens here.
export const clipSchemaVersion = 'cabt-clip-v1';

export type ClipLineRole = 'played' | 'policy' | 'search' | 'alternative';

export type ClipCompareLine = {
  label: string;
  note?: string;
  optionIndexes?: number[];
  role?: ClipLineRole;
};

export type ClipNoteItem = {
  kind: 'note';
  markdown: string;
};

export type ClipPositionItem = {
  kind: 'position';
  replay: string;
  state: number;
  caption?: string;
  exact?: boolean;
  focusOptions?: number[];
};

export type ClipCompareItem = {
  kind: 'compare';
  replay: string;
  state: number;
  caption?: string;
  exact?: boolean;
  focusOptions?: number[];
  lines: ClipCompareLine[];
};

// An item kind this build does not implement. `kind` is kept so the panel can
// name what it skipped.
export type ClipUnsupportedItem = {
  kind: 'unsupported';
  originalKind: string;
};

export type ClipItem = ClipNoteItem | ClipPositionItem | ClipCompareItem | ClipUnsupportedItem;

export type Clip = {
  schema: typeof clipSchemaVersion;
  title: string;
  created: string;
  author?: string;
  summary?: string;
  items: ClipItem[];
};

export type ClipManifestEntry = {
  file: string;
  title: string;
  created?: string;
  author?: string;
  items?: number;
  summary?: string;
};

export type ClipManifest = {
  clips: ClipManifestEntry[];
};

export const clipManifestUrl = '/cabt-artifacts/viewer-clips/manifest.json';

const clipLineRoles: ClipLineRole[] = ['played', 'policy', 'search', 'alternative'];

export function parseClip(input: unknown): Clip {
  const root = requireObject(input, 'clip');
  if (root.schema !== clipSchemaVersion) {
    throw new Error(
      `clip.schema must be "${clipSchemaVersion}" (got ${describe(root.schema)})`,
    );
  }
  const rawItems = root.items;
  if (!Array.isArray(rawItems)) {
    throw new Error(`clip.items must be an array (got ${describe(rawItems)})`);
  }
  const author = optionalText(root.author, 'clip.author');
  const summary = optionalText(root.summary, 'clip.summary');
  return {
    schema: clipSchemaVersion,
    title: requireText(root.title, 'clip.title'),
    created: requireText(root.created, 'clip.created'),
    ...(author === undefined ? {} : { author }),
    ...(summary === undefined ? {} : { summary }),
    items: rawItems.map((item, index) => parseItem(item, `clip.items[${index}]`)),
  };
}

// Where an item's `replay` ref resolves to. Absolute refs are used verbatim,
// `gamebank:<id>` goes to the game-bank replay endpoint, and a bare name is an
// agent-lab artifact served under /cabt-artifacts.
export function clipReplayCandidates(ref: string): string[] {
  const trimmed = ref.trim();
  if (!trimmed) {
    throw new Error('clip replay ref is empty');
  }
  if (trimmed.startsWith('/') || /^https?:\/\//i.test(trimmed)) {
    return [trimmed];
  }
  if (trimmed.startsWith('gamebank:')) {
    const id = trimmed.slice('gamebank:'.length);
    if (!id) {
      throw new Error(`clip replay ref "${ref}" is missing a game-bank id`);
    }
    return [`/game-bank/replays/${encodeURIComponent(id)}`];
  }
  return [`/cabt-artifacts/${encodePath(trimmed)}`];
}

// Where the clip document itself is fetched from. Same absolute/artifact split
// as replay refs; manifest entries are artifact-relative ("viewer-clips/x.json").
export function clipUrl(fileRef: string): string {
  const trimmed = fileRef.trim();
  if (!trimmed) {
    throw new Error('clip ref is empty');
  }
  if (trimmed.startsWith('/') || /^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `/cabt-artifacts/${encodePath(trimmed)}`;
}

// Deep link that opens a clip in the viewer, preserving the current origin and
// dropping any replay position left over from another mode.
export function clipViewerUrl(baseHref: string, fileRef: string): string {
  const url = new URL(baseHref);
  url.search = '';
  url.searchParams.set('view', 'clip');
  url.searchParams.set('clip', fileRef);
  return url.toString();
}

// "Open full replay" for one item: plain replay mode on that item's replay, at
// that item's state, in the item's detail mode.
export function clipReplayViewerUrl(
  baseHref: string,
  item: ClipPositionItem | ClipCompareItem,
): string {
  const url = new URL(baseHref);
  url.search = '';
  url.searchParams.set('view', 'replay');
  url.searchParams.set('replayUrl', clipReplayCandidates(item.replay)[0]);
  if (item.exact) {
    url.searchParams.set('detail', 'exact');
  }
  return replayUrlAtState(url.toString(), item.state);
}

export async function loadClipManifest(fetcher: typeof fetch = fetch): Promise<ClipManifest> {
  const response = await fetcher(clipManifestUrl);
  if (!response.ok) {
    throw new Error(`${clipManifestUrl}: ${response.status}`);
  }
  return parseClipManifest(await response.json());
}

export function parseClipManifest(input: unknown): ClipManifest {
  const clips = (input as { clips?: unknown })?.clips;
  if (!Array.isArray(clips)) {
    return { clips: [] };
  }
  return {
    clips: clips.flatMap((entry) => {
      const value = entry as Partial<ClipManifestEntry> | null;
      if (!value || typeof value.file !== 'string' || !value.file) {
        return [];
      }
      return [{
        file: value.file,
        title: typeof value.title === 'string' && value.title ? value.title : value.file,
        ...(typeof value.created === 'string' ? { created: value.created } : {}),
        ...(typeof value.author === 'string' ? { author: value.author } : {}),
        ...(typeof value.items === 'number' && Number.isFinite(value.items)
          ? { items: value.items }
          : {}),
        ...(typeof value.summary === 'string' ? { summary: value.summary } : {}),
      }];
    }),
  };
}

function parseItem(input: unknown, path: string): ClipItem {
  const item = requireObject(input, path);
  const kind = item.kind;
  if (typeof kind !== 'string' || !kind) {
    throw new Error(`${path}.kind must be a non-empty string (got ${describe(kind)})`);
  }
  if (kind === 'note') {
    return { kind: 'note', markdown: requireText(item.markdown, `${path}.markdown`) };
  }
  if (kind === 'position' || kind === 'compare') {
    const caption = optionalText(item.caption, `${path}.caption`);
    const exact = optionalFlag(item.exact, `${path}.exact`);
    const focusOptions = optionalIndexes(item.focusOptions, `${path}.focusOptions`);
    const position: ClipPositionItem = {
      kind: 'position',
      replay: requireText(item.replay, `${path}.replay`),
      state: requireIndex(item.state, `${path}.state`),
      ...(caption === undefined ? {} : { caption }),
      ...(exact === undefined ? {} : { exact }),
      ...(focusOptions === undefined ? {} : { focusOptions }),
    };
    if (kind === 'position') {
      return position;
    }
    const lines = item.lines;
    if (!Array.isArray(lines)) {
      throw new Error(`${path}.lines must be an array (got ${describe(lines)})`);
    }
    return {
      ...position,
      kind: 'compare',
      lines: lines.map((line, index) => parseCompareLine(line, `${path}.lines[${index}]`)),
    };
  }
  return { kind: 'unsupported', originalKind: kind };
}

function parseCompareLine(input: unknown, path: string): ClipCompareLine {
  const line = requireObject(input, path);
  const note = optionalText(line.note, `${path}.note`);
  const optionIndexes = optionalIndexes(line.optionIndexes, `${path}.optionIndexes`);
  return {
    label: requireText(line.label, `${path}.label`),
    ...(note === undefined ? {} : { note }),
    ...(optionIndexes === undefined ? {} : { optionIndexes }),
    // `role` is a display-only tag. A value this build does not know is
    // dropped rather than rejected, for the same reason unknown item kinds
    // degrade: a newer writer must not break an older viewer.
    ...(clipLineRoles.includes(line.role as ClipLineRole)
      ? { role: line.role as ClipLineRole }
      : {}),
  };
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object (got ${describe(value)})`);
  }
  return value as Record<string, unknown>;
}

function requireText(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${path} must be a non-empty string (got ${describe(value)})`);
  }
  return value;
}

function requireIndex(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${path} must be a non-negative integer (got ${describe(value)})`);
  }
  return value;
}

function optionalText(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(`${path} must be a string (got ${describe(value)})`);
  }
  return value;
}

function optionalFlag(value: unknown, path: string): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw new Error(`${path} must be a boolean (got ${describe(value)})`);
  }
  return value;
}

function optionalIndexes(value: unknown, path: string): number[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array of option indexes (got ${describe(value)})`);
  }
  return value.map((entry, index) => requireIndex(entry, `${path}[${index}]`));
}

function describe(value: unknown): string {
  if (value === undefined) {
    return 'undefined';
  }
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'an array';
  }
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

function encodePath(path: string): string {
  return path.split('/').map((part) => encodeURIComponent(part)).join('/');
}
