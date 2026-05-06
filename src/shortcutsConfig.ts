import { loadAppConfig } from "./appConfig";
import type { KeyChord } from "./shortcuts";

export type SidebarTabTarget = "title" | "markdown" | "links";

export type ShortcutsConfig = {
  sidebar: {
    tabOrder: SidebarTabTarget[];
    tabCycle: boolean;
    focusNext: KeyChord[];
    focusPrev: KeyChord[];
  };
  global: {
    escapeToCanvas: KeyChord[];
    clearSelection: KeyChord[];
  };
  canvas: {
    createNote: KeyChord[];
    deleteSelected: KeyChord[];
  };
};

export const DEFAULT_SHORTCUTS_CONFIG: ShortcutsConfig = {
  sidebar: {
    tabOrder: ["title", "markdown", "links"],
    tabCycle: true,
    focusNext: [{ key: "Tab", shift: false }],
    focusPrev: [{ key: "Tab", shift: true }],
  },
  global: {
    escapeToCanvas: [{ key: "Escape" }],
    clearSelection: [{ key: "Escape" }],
  },
  canvas: {
    createNote: [{ key: "+" }, { code: "NumpadAdd" }, { code: "Equal", shift: true }],
    deleteSelected: [{ key: "Delete" }, { key: "Backspace" }],
  },
};

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function asBoolean(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return undefined;
}

function sanitizeChord(v: unknown): KeyChord | null {
  const obj = asRecord(v);
  const chord: KeyChord = {};
  if (typeof obj.key === "string") chord.key = obj.key;
  if (typeof obj.code === "string") chord.code = obj.code;
  const shift = asBoolean(obj.shift);
  const ctrl = asBoolean(obj.ctrl);
  const alt = asBoolean(obj.alt);
  const meta = asBoolean(obj.meta);
  if (shift !== undefined) chord.shift = shift;
  if (ctrl !== undefined) chord.ctrl = ctrl;
  if (alt !== undefined) chord.alt = alt;
  if (meta !== undefined) chord.meta = meta;
  if (!chord.key && !chord.code) return null;
  return chord;
}

function sanitizeChordList(v: unknown, fallback: KeyChord[]): KeyChord[] {
  if (!Array.isArray(v)) return fallback;
  const out: KeyChord[] = [];
  for (const item of v) {
    const chord = sanitizeChord(item);
    if (chord) out.push(chord);
  }
  return out.length ? out : fallback;
}

function sanitizeTabOrder(v: unknown, fallback: SidebarTabTarget[]): SidebarTabTarget[] {
  if (!Array.isArray(v)) return fallback;
  const allowed = new Set<SidebarTabTarget>(["title", "markdown", "links"]);
  const out = v.filter((x): x is SidebarTabTarget => typeof x === "string" && allowed.has(x as SidebarTabTarget));
  const uniq = Array.from(new Set(out));
  return uniq.length ? uniq : fallback;
}

function sanitizeShortcutsConfig(input: unknown): ShortcutsConfig {
  const obj = asRecord(input);
  const d = DEFAULT_SHORTCUTS_CONFIG;

  const sidebar = asRecord(obj.sidebar);
  const global = asRecord(obj.global);
  const canvas = asRecord(obj.canvas);

  return {
    sidebar: {
      tabOrder: sanitizeTabOrder(sidebar.tabOrder, d.sidebar.tabOrder),
      tabCycle: asBoolean(sidebar.tabCycle) ?? d.sidebar.tabCycle,
      focusNext: sanitizeChordList(sidebar.focusNext, d.sidebar.focusNext),
      focusPrev: sanitizeChordList(sidebar.focusPrev, d.sidebar.focusPrev),
    },
    global: {
      escapeToCanvas: sanitizeChordList(global.escapeToCanvas, d.global.escapeToCanvas),
      clearSelection: sanitizeChordList(global.clearSelection, d.global.clearSelection),
    },
    canvas: {
      createNote: sanitizeChordList(canvas.createNote, d.canvas.createNote),
      deleteSelected: sanitizeChordList(canvas.deleteSelected, d.canvas.deleteSelected),
    },
  };
}

let cachedShortcuts: ShortcutsConfig | null = null;

export async function loadShortcutsConfig(): Promise<ShortcutsConfig> {
  if (cachedShortcuts) return cachedShortcuts;
  try {
    const cfg = await loadAppConfig();
    const top = cfg && typeof cfg === "object" ? (cfg as Record<string, unknown>) : {};
    cachedShortcuts = sanitizeShortcutsConfig(top.shortcuts);
    return cachedShortcuts;
  } catch {
    cachedShortcuts = DEFAULT_SHORTCUTS_CONFIG;
    return cachedShortcuts;
  }
}
