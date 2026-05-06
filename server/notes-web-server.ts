import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as TOML from "@iarna/toml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const DIST_DIR = path.join(REPO_ROOT, "dist");
const DEFAULT_CONFIG_PATH = path.join(REPO_ROOT, "notes-config.toml");

const NOTES_DIR = path.join(REPO_ROOT, "notes-data");
const LEGACY_NOTES_DIRS = [path.join(os.homedir(), "notes"), path.join(os.homedir(), ".notes")];
const NOTES_FILE = path.join(NOTES_DIR, "notes.toml");
const LEGACY_NOTES_FILE = path.join(NOTES_DIR, "notes.json");
const LEGACY_NOTES_FALLBACKS = LEGACY_NOTES_DIRS.map((dir) => path.join(dir, "notes.json"));
const NOTES_MD_DIR = path.join(NOTES_DIR, "notes");
const CONFIG_FILE = path.join(NOTES_DIR, "notes-config.toml");
const GITIGNORE_FILE = path.join(NOTES_DIR, ".gitignore");

const NOTE_SEED = {
  id: 1,
  title: "First note",
  body: "Start linking notes by their numbers.",
  links: [],
  position: { x: 0, y: 0 },
};

type NotePosition = { x: number; y: number };
type Note = {
  id: number;
  title: string;
  body: string;
  links: number[];
  position?: NotePosition;
};

type NotesFileIn = {
  notes?: Array<{
    id?: number;
    title?: string;
    links?: number[];
    position?: NotePosition;
  }>;
};

type LegacyNotesFile = {
  notes?: Array<{
    id?: number;
    title?: string;
    body?: string;
    links?: number[];
    position?: NotePosition;
  }>;
};

let notesLock: Promise<unknown> = Promise.resolve();
let legacyDirChecked = false;
const API_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Private-Network": "true",
};

async function migrateLegacyNotesDir() {
  if (legacyDirChecked) return;
  legacyDirChecked = true;
  if (existsSync(NOTES_DIR)) return;
  const legacyDir = LEGACY_NOTES_DIRS.find(
    (dir) => existsSync(dir) && path.resolve(dir) !== REPO_ROOT
  );
  if (!legacyDir) return;
  try {
    await fs.rename(legacyDir, NOTES_DIR);
  } catch (err) {
    console.error(`Failed to move ${legacyDir} to ${NOTES_DIR}: ${String(err)}`);
  }
}

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: API_CORS_HEADERS,
  });
}

function errorJson(message: string, status = 500) {
  return json({ error: message }, status);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sanitizePosition(pos?: NotePosition | null): NotePosition {
  if (pos && isFiniteNumber(pos.x) && isFiniteNumber(pos.y)) {
    return { x: pos.x, y: pos.y };
  }
  return { x: 0, y: 0 };
}

function sanitizeLinks(rawLinks: number[], existingIds: Set<number>, selfId: number): number[] {
  const unique = new Set<number>();
  for (const id of rawLinks) {
    if (id !== selfId && existingIds.has(id)) {
      unique.add(id);
    }
  }
  return Array.from(unique).sort((a, b) => a - b);
}

function enforceUndirected(notes: Note[]): Note[] {
  const idSet = new Set(notes.map((note) => note.id));
  const linkMap = new Map<number, Set<number>>();
  for (const note of notes) {
    const clean = sanitizeLinks(note.links ?? [], idSet, note.id);
    linkMap.set(note.id, new Set(clean));
  }
  for (const [id, peers] of linkMap.entries()) {
    for (const peerId of peers) {
      const peerSet = linkMap.get(peerId);
      if (peerSet) peerSet.add(id);
    }
  }
  return notes.map((note) => {
    const links = Array.from(linkMap.get(note.id) ?? []).sort((a, b) => a - b);
    return { ...note, links };
  });
}

function noteMarkdownPath(id: number) {
  return path.join(NOTES_MD_DIR, `${id}.md`);
}

function findLegacyNotesJson(): string | null {
  if (existsSync(LEGACY_NOTES_FILE)) return LEGACY_NOTES_FILE;
  for (const candidate of LEGACY_NOTES_FALLBACKS) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function parseNoteMarkdown(markdown: string, fallbackTitle: string): { title: string; body: string } {
  const lines = markdown.split(/\r?\n/);
  if (lines.length === 0) {
    return { title: fallbackTitle, body: "" };
  }
  const first = lines[0] ?? "";
  if (first.startsWith("# ")) {
    const rawTitle = first.slice(2).trim();
    let start = 1;
    if (start < lines.length && lines[start] === "") start += 1;
    const body = lines.slice(start).join("\n");
    return { title: rawTitle || fallbackTitle, body };
  }
  return { title: fallbackTitle, body: markdown };
}

async function writeNoteMarkdown(id: number, title: string, body: string) {
  const trimmed = title.trim();
  const safeTitle = (trimmed.length ? trimmed : "Untitled").replace(/[\r\n]/g, " ");
  const payload = `# ${safeTitle}\n\n${body}`;
  const mdPath = noteMarkdownPath(id);
  await writeAtomic(mdPath, payload);
}

async function writeAtomic(filePath: string, payload: string) {
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, payload);
  await fs.rename(tmpPath, filePath);
}

async function ensureNotesDirs() {
  await migrateLegacyNotesDir();
  await fs.mkdir(NOTES_DIR, { recursive: true });
  await fs.mkdir(NOTES_MD_DIR, { recursive: true });
}

async function ensureNotesGitignore() {
  const desired = ["# Notes Graph (generated)", "notes.json", "notes.json.tmp", "notes.toml.tmp", "*.tmp"];
  const existingRaw = existsSync(GITIGNORE_FILE) ? await fs.readFile(GITIGNORE_FILE, "utf8") : "";
  const existing = new Set(
    existingRaw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  );
  const missing = desired.filter((line) => !existing.has(line));
  if (missing.length === 0) return;
  let payload = existingRaw;
  if (payload.length > 0 && !payload.endsWith("\n")) payload += "\n";
  payload += `${missing.join("\n")}\n`;
  await fs.writeFile(GITIGNORE_FILE, payload);
}

async function ensureConfigFile() {
  if (existsSync(CONFIG_FILE)) return;
  await ensureNotesDirs();
  const raw = await fs.readFile(DEFAULT_CONFIG_PATH, "utf8");
  const payload = raw.endsWith("\n") ? raw : `${raw}\n`;
  await writeAtomic(CONFIG_FILE, payload);
}

async function ensureNotesFile() {
  await ensureNotesDirs();
  await ensureNotesGitignore();
  if (existsSync(NOTES_FILE)) return;

  const legacyPath = findLegacyNotesJson();
  if (legacyPath) {
    const legacyRaw = await fs.readFile(legacyPath, "utf8").catch(() => "");
    try {
      const parsed = JSON.parse(legacyRaw) as LegacyNotesFile;
      const meta = (parsed.notes ?? [])
        .map((note) => {
          if (!isFiniteNumber(note.id)) return null;
          return {
            id: note.id,
            title: note.title ?? "Untitled",
            links: note.links ?? [],
            position: sanitizePosition(note.position),
          };
        })
        .filter((note): note is NonNullable<typeof note> => !!note);
      if (meta.length > 0) {
        await writeNotesFile(meta);
        return;
      }
    } catch {
      // fall through to seed
    }
  }

  await persistNotes([NOTE_SEED], null);
}

function collectFinitePositions(notes: Note[]): NotePosition[] {
  return notes
    .map((note) => note.position)
    .filter((pos): pos is NotePosition => !!pos && isFiniteNumber(pos.x) && isFiniteNumber(pos.y));
}

function median(values: number[]): number | null {
  const nums = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  if (nums.length % 2 === 1) return nums[mid] ?? null;
  return (nums[mid - 1] + nums[mid]) / 2;
}

function computeSpawnCenter(notes: Note[]): NotePosition {
  const positions = collectFinitePositions(notes);
  const xs = positions.map((p) => p.x);
  const ys = positions.map((p) => p.y);
  const mx = median(xs);
  const my = median(ys);
  if (mx !== null && my !== null) return { x: mx, y: my };
  return { x: 0, y: 0 };
}

function computeSpawnPosition(
  notes: Note[],
  connectToId?: number,
  spawnAt?: NotePosition
): NotePosition {
  const center = computeSpawnCenter(notes);
  const connectTo = connectToId !== undefined ? notes.find((note) => note.id === connectToId) : undefined;
  const spawnAtValid = spawnAt && isFiniteNumber(spawnAt.x) && isFiniteNumber(spawnAt.y) ? spawnAt : undefined;
  if (spawnAtValid) return spawnAtValid;
  const base =
    connectTo?.position && isFiniteNumber(connectTo.position.x) && isFiniteNumber(connectTo.position.y)
      ? connectTo.position
      : center;

  const existing = collectFinitePositions(notes);
  const minDist = 180;
  const minDistSq = minDist * minDist;
  const tries = 24;

  let preferredAngle = Math.random() * Math.PI * 2;
  if (connectTo) {
    let vx = 0;
    let vy = 0;
    for (const neighborId of connectTo.links) {
      const neighbor = notes.find((note) => note.id === neighborId);
      const pos = neighbor?.position;
      if (pos && isFiniteNumber(pos.x) && isFiniteNumber(pos.y)) {
        vx += pos.x - base.x;
        vy += pos.y - base.y;
      }
    }
    if (Math.abs(vx) + Math.abs(vy) > 1e-6) {
      preferredAngle = Math.atan2(-vy, -vx);
    } else {
      preferredAngle = 0;
    }
  }

  for (let i = 0; i < tries; i += 1) {
    const r = connectTo ? 240 + (Math.random() - 0.5) * 120 : 120 + (Math.random() - 0.5) * 160;
    const jitter = connectTo ? 0.55 : Math.PI;
    const angle = preferredAngle + (Math.random() - 0.5) * 2 * jitter;
    const candidate = {
      x: base.x + Math.cos(angle) * r,
      y: base.y + Math.sin(angle) * r,
    };
    const ok = existing.every((p) => {
      const dx = p.x - candidate.x;
      const dy = p.y - candidate.y;
      return dx * dx + dy * dy >= minDistSq;
    });
    if (ok) return candidate;
  }

  return {
    x: base.x + (Math.random() - 0.5) * 240,
    y: base.y + (Math.random() - 0.5) * 240,
  };
}

async function writeNotesFile(notes: Array<{ id: number; title: string; links: number[]; position: NotePosition }>) {
  const payload = TOML.stringify({ notes });
  const normalized = payload.endsWith("\n") ? payload : `${payload}\n`;
  await writeAtomic(NOTES_FILE, normalized);
}

async function loadNotes(): Promise<Note[]> {
  await ensureNotesFile();
  const raw = await fs.readFile(NOTES_FILE, "utf8").catch(() => "");
  let parsed: NotesFileIn | null = null;
  if (raw.trim().length === 0) {
    parsed = { notes: [] };
  } else {
    try {
      parsed = TOML.parse(raw) as NotesFileIn;
    } catch {
      parsed = null;
    }
  }

  if (!parsed) {
    await persistNotes([NOTE_SEED], null);
    return [NOTE_SEED];
  }

  let notesMeta = parsed.notes ?? [];
  let legacyUsed = false;
  const legacyBodies = new Map<number, string>();

  const legacyPath = findLegacyNotesJson();
  if (notesMeta.length === 0 && legacyPath) {
    const legacyRaw = await fs.readFile(legacyPath, "utf8").catch(() => "");
    try {
      const legacyParsed = JSON.parse(legacyRaw) as LegacyNotesFile;
      const legacyNotes = legacyParsed.notes ?? [];
      if (legacyNotes.length > 0) {
        legacyUsed = true;
        notesMeta = legacyNotes
          .map((note) => {
            if (!isFiniteNumber(note.id)) return null;
            return {
              id: note.id,
              title: note.title ?? "Untitled",
              links: note.links ?? [],
              position: note.position,
            };
          })
          .filter((note): note is NonNullable<typeof note> => !!note);
        for (const note of legacyNotes) {
          if (isFiniteNumber(note.id) && typeof note.body === "string") {
            legacyBodies.set(note.id, note.body);
          }
        }
      }
    } catch {
      // ignore
    }
  }

  let migrated = false;
  const hydrated: Note[] = [];

  for (const meta of notesMeta) {
    if (!isFiniteNumber(meta.id)) continue;
    const id = meta.id;
    const title = meta.title ?? "Untitled";
    const links = meta.links ?? [];
    const position = sanitizePosition(meta.position ?? null);

    let body = "";
    let fileTitle = title;
    try {
      const markdown = await fs.readFile(noteMarkdownPath(id), "utf8");
      const parsedMd = parseNoteMarkdown(markdown, title);
      body = parsedMd.body;
      fileTitle = parsedMd.title;
    } catch {
      const legacyBody = legacyBodies.get(id);
      if (legacyBody !== undefined) body = legacyBody;
      await writeNoteMarkdown(id, title, body);
      migrated = true;
    }

    hydrated.push({
      id,
      title: fileTitle,
      body,
      links,
      position,
    });
  }

  if (migrated || legacyUsed) {
    await persistNotes(hydrated, new Set());
  }

  return enforceUndirected(hydrated);
}

async function persistNotes(notes: Note[], writeMarkdownIds: Set<number> | null): Promise<Note[]> {
  await ensureNotesDirs();
  await ensureNotesGitignore();
  const cleaned = enforceUndirected(notes).map((note) => ({
    ...note,
    title: note.title.trim().length ? note.title : "Untitled",
    position: sanitizePosition(note.position ?? null),
  }));

  if (writeMarkdownIds === null) {
    for (const note of cleaned) {
      await writeNoteMarkdown(note.id, note.title, note.body);
    }
  } else if (writeMarkdownIds.size > 0) {
    for (const note of cleaned) {
      if (writeMarkdownIds.has(note.id)) {
        await writeNoteMarkdown(note.id, note.title, note.body);
      }
    }
  }

  const meta = cleaned.map((note) => ({
    id: note.id,
    title: note.title,
    links: note.links,
    position: sanitizePosition(note.position ?? null),
  }));
  await writeNotesFile(meta);
  return cleaned;
}

async function withNotesLock<T>(action: () => Promise<T>): Promise<T> {
  const next = notesLock.then(action, action);
  notesLock = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

async function runCommand(cmd: string, args: string[], cwd: string, allowFailure = false) {
  const proc = Bun.spawn([cmd, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0 && !allowFailure) {
    const message = stderr.trim() || stdout.trim() || `${cmd} ${args.join(" ")} failed`;
    throw new Error(message);
  }
  return { stdout, stderr, exitCode };
}

async function gitSyncNotes() {
  await ensureNotesFile();
  await runCommand("git", ["add", "-A"], NOTES_DIR);

  const today = new Date().toISOString().slice(0, 10);
  let didCommit = false;
  let commitSha: string | null = null;

  const diff = await runCommand("git", ["diff", "--cached", "--quiet"], NOTES_DIR, true);
  if (diff.exitCode !== 0) {
    await runCommand("git", ["commit", "-m", today], NOTES_DIR);
    didCommit = true;
    const rev = await runCommand("git", ["rev-parse", "HEAD"], NOTES_DIR);
    commitSha = rev.stdout.trim() || null;
  }

  await runCommand("git", ["push", "-u", "origin", "HEAD"], NOTES_DIR);
  return { ok: true, didCommit, commitMessage: today, commitSha };
}

async function resetNotesFromOrigin() {
  await ensureNotesFile();
  await runCommand("git", ["fetch", "origin", "master"], NOTES_DIR);
  await runCommand("git", ["restore", "--source", "origin/master", "--worktree", "--staged", "."], NOTES_DIR);
  const notes = await loadNotes();
  return notes;
}

function parseArg(flag: string) {
  const idx = Bun.argv.indexOf(flag);
  if (idx === -1) return null;
  return Bun.argv[idx + 1] ?? null;
}

async function serveStatic(pathname: string) {
  if (!existsSync(DIST_DIR)) {
    return new Response("Missing dist/. Run bun run build:web first.", { status: 500 });
  }
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const fsPath = path.normalize(path.join(DIST_DIR, safePath));
  if (!fsPath.startsWith(DIST_DIR)) return new Response("Not found", { status: 404 });

  let candidate = fsPath;
  try {
    const stat = await fs.stat(candidate);
    if (stat.isDirectory()) {
      candidate = path.join(candidate, "index.html");
    }
  } catch {
    candidate = path.join(DIST_DIR, "index.html");
  }

  if (!existsSync(candidate)) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(Bun.file(candidate));
}

async function handleApi(req: Request) {
  try {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: API_CORS_HEADERS });
    }

    const url = new URL(req.url);
    const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/api/config") {
    await ensureConfigFile();
    const raw = await fs.readFile(CONFIG_FILE, "utf8").catch(() => "");
    try {
      const parsed = TOML.parse(raw);
      if (parsed && typeof parsed === "object") {
        return json(parsed);
      }
      return json({});
    } catch {
      return json({});
    }
  }

  if (req.method === "GET" && pathname === "/api/notes") {
    return withNotesLock(async () => json(await loadNotes()));
  }

  if (req.method === "POST" && pathname === "/api/notes") {
    const body = (await req.json().catch(() => ({}))) as {
      connectToId?: number;
      spawnAt?: NotePosition;
    };
    return withNotesLock(async () => {
      const notes = await loadNotes();
      const connectToId = isFiniteNumber(body.connectToId)
        ? notes.find((note) => note.id === body.connectToId)?.id
        : undefined;
      const spawnAt = body.spawnAt && isFiniteNumber(body.spawnAt.x) && isFiniteNumber(body.spawnAt.y)
        ? body.spawnAt
        : undefined;
      const nextId = notes.reduce((max, note) => Math.max(max, note.id), 0) + 1;
      const note: Note = {
        id: nextId,
        title: `New note ${nextId}`,
        body: "",
        links: connectToId !== undefined ? [connectToId] : [],
        position: computeSpawnPosition(notes, connectToId, spawnAt),
      };
      notes.push(note);
      const saved = await persistNotes(notes, new Set([note.id]));
      const normalized = saved.find((n) => n.id === note.id) ?? note;
      return json({ note: normalized, notes: saved });
    });
  }

  if (req.method === "POST" && pathname === "/api/notes/positions") {
    const body = (await req.json().catch(() => ({}))) as {
      positions?: Array<{ id: number; x: number; y: number }>;
    };
    return withNotesLock(async () => {
      const updates = new Map<number, NotePosition>();
      for (const pos of body.positions ?? []) {
        if (isFiniteNumber(pos.id) && isFiniteNumber(pos.x) && isFiniteNumber(pos.y)) {
          updates.set(pos.id, { x: pos.x, y: pos.y });
        }
      }
      const notes = await loadNotes();
      let changed = false;
      for (const note of notes) {
        const next = updates.get(note.id);
        if (!next) continue;
        if (!note.position || note.position.x !== next.x || note.position.y !== next.y) {
          note.position = { x: next.x, y: next.y };
          changed = true;
        }
      }
      if (!changed) return json(notes);
      const saved = await persistNotes(notes, new Set());
      return json(saved);
    });
  }

  if (req.method === "PUT" && pathname === "/api/notes") {
    const body = (await req.json().catch(() => ({}))) as { notes?: Note[] } | Note[];
    const incoming = Array.isArray(body) ? body : body.notes ?? [];
    return withNotesLock(async () => {
      const sanitized = incoming.map((note) => ({
        id: note.id,
        title: note.title?.trim().length ? note.title : "Untitled",
        body: note.body ?? "",
        links: note.links ?? [],
        position: sanitizePosition(note.position ?? null),
      }));
      const saved = await persistNotes(sanitized, null);
      return json(saved);
    });
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/notes/")) {
    const idRaw = pathname.slice("/api/notes/".length);
    const id = Number(idRaw);
    if (!Number.isFinite(id)) return errorJson("Invalid note id", 400);
    const payload = (await req.json().catch(() => ({}))) as Partial<Omit<Note, "id">>;
    return withNotesLock(async () => {
      const notes = await loadNotes();
      const idx = notes.findIndex((note) => note.id === id);
      if (idx === -1) return errorJson("Note not found", 404);
      const updated = { ...notes[idx] };
      let desiredLinks: number[] | null = null;
      const writeIds = new Set<number>();

      if (payload.title !== undefined) {
        updated.title = payload.title.trim().length ? payload.title : "Untitled";
        writeIds.add(id);
      }
      if (payload.body !== undefined) {
        updated.body = payload.body;
        writeIds.add(id);
      }
      if (payload.links !== undefined) {
        const existingIds = new Set(notes.map((note) => note.id));
        const sanitized = sanitizeLinks(payload.links, existingIds, id);
        updated.links = sanitized;
        desiredLinks = sanitized;
      }
      if (payload.position !== undefined) {
        if (isFiniteNumber(payload.position.x) && isFiniteNumber(payload.position.y)) {
          updated.position = { x: payload.position.x, y: payload.position.y };
        }
      }

      notes[idx] = updated;
      if (desiredLinks) {
        const desiredSet = new Set(desiredLinks);
        for (const note of notes) {
          if (note.id === id) continue;
          if (desiredSet.has(note.id)) {
            if (!note.links.includes(id)) note.links.push(id);
          } else {
            note.links = note.links.filter((linkId) => linkId !== id);
          }
        }
      }

      const saved = await persistNotes(notes, writeIds.size > 0 ? writeIds : new Set());
      const normalized = saved.find((note) => note.id === id) ?? updated;
      return json({ note: normalized, notes: saved });
    });
  }

  if (req.method === "POST" && pathname === "/api/git-sync") {
    try {
      const result = await gitSyncNotes();
      return json(result);
    } catch (err) {
      return errorJson(String(err));
    }
  }

  if (req.method === "POST" && pathname === "/api/notes/reset-from-origin") {
    try {
      return withNotesLock(async () => json(await resetNotesFromOrigin()));
    } catch (err) {
      return errorJson(String(err));
    }
  }

    return errorJson("Not found", 404);
  } catch (err) {
    return errorJson(String(err));
  }
}

const hostname = "0.0.0.0";
const portArg = parseArg("--port");
const desiredPort = Number(portArg ?? 43679);
if (!Number.isFinite(desiredPort) || desiredPort <= 0) {
  throw new Error(`Invalid port: ${portArg ?? ""}`);
}

let server: ReturnType<typeof Bun.serve>;
try {
  server = Bun.serve({
    hostname,
    port: desiredPort,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (url.pathname.startsWith("/api/")) {
        return handleApi(req);
      }
      return serveStatic(url.pathname);
    },
  });
} catch (err) {
  console.error(`Failed to bind ${hostname}:${desiredPort}: ${String(err)}`);
  process.exit(1);
}

const portFile = parseArg("--port-file");
const urlFile = parseArg("--url-file");
const port = server.port;

if (portFile) {
  await fs.writeFile(portFile, `${port}`);
}
if (urlFile) {
  await fs.writeFile(urlFile, `http://127.0.0.1:${port}`);
}

console.log(`Graph Notes web server listening on ${hostname}:${port}`);
