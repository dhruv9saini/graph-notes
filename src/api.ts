import type { Note, NoteId } from "./types";
import { buildApiUrl } from "./apiBase";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(buildApiUrl(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json() as Promise<T>;
}

export async function fetchNotes(): Promise<Note[]> {
  return requestJson<Note[]>("/api/notes");
}

export async function createNote(
  options?: { connectToId?: NoteId; spawnAt?: { x: number; y: number } }
): Promise<{ note: Note; notes: Note[] }> {
  const payload: Record<string, unknown> = {};
  if (options?.connectToId !== undefined && Number.isFinite(options.connectToId)) {
    payload.connectToId = options.connectToId;
  }
  if (options?.spawnAt && Number.isFinite(options.spawnAt.x) && Number.isFinite(options.spawnAt.y)) {
    payload.spawnAt = { x: options.spawnAt.x, y: options.spawnAt.y };
  }
  const body = Object.keys(payload).length > 0 ? payload : {};
  return requestJson<{ note: Note; notes: Note[] }>("/api/notes", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateNote(
  id: NoteId,
  payload: Partial<Omit<Note, "id">>
): Promise<{ note: Note; notes: Note[] }> {
  return requestJson<{ note: Note; notes: Note[] }>(`/api/notes/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function replaceNotes(notes: Note[]): Promise<Note[]> {
  return requestJson<Note[]>("/api/notes", {
    method: "PUT",
    body: JSON.stringify({ notes }),
  });
}

export async function updateNotePositions(
  positions: Array<{ id: NoteId; x: number; y: number }>
): Promise<Note[]> {
  return requestJson<Note[]>("/api/notes/positions", {
    method: "POST",
    body: JSON.stringify({ positions }),
  });
}

export async function gitSync(): Promise<{
  ok: true;
  didCommit: boolean;
  commitMessage: string;
  commitSha: string | null;
}> {
  return requestJson<{
    ok: true;
    didCommit: boolean;
    commitMessage: string;
    commitSha: string | null;
  }>("/api/git-sync", { method: "POST" });
}

export async function resetNotesToOrigin(): Promise<Note[]> {
  return requestJson<Note[]>("/api/notes/reset-from-origin", { method: "POST" });
}

export function parseLinks(input: string): number[] {
  const ids = (input.match(/\d+/g) || []).map((v) => Number(v));
  const unique = Array.from(new Set(ids)).filter((n) => Number.isFinite(n));
  unique.sort((a, b) => a - b);
  return unique;
}

export function formatLinks(links: number[]): string {
  return links.join(", ");
}
