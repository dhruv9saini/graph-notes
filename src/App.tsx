import { Capacitor } from "@capacitor/core";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import "./App.css";
import { API_BASE_OVERRIDE_KEY } from "./apiBase";
import { fetchNotes, gitSync, replaceNotes, resetNotesToOrigin } from "./api";
import GraphCanvas from "./components/GraphCanvas";
import SidePane from "./components/SidePane";
import { matchesAnyChord } from "./shortcuts";
import { DEFAULT_SHORTCUTS_CONFIG, loadShortcutsConfig } from "./shortcutsConfig";
import { DEFAULT_THEME, loadThemeConfig } from "./themeConfig";
import type { Note, NotePosition } from "./types";
import { DEFAULT_UI_CONFIG, loadUiConfig } from "./uiConfig";

const SIDE_WIDTH_KEY = "notes:layout:sideWidthPx";
const MOBILE_SIDE_HEIGHT_KEY = "notes:layout:mobileSideHeightPx";
const EDITOR_VIEW_KEY = "notes:editorView";
const NOTES_CACHE_KEY = "notes:cache:v1";
const NOTES_PENDING_SYNC_KEY = "notes:sync:pending";

const MIN_PANE_PX = 260;
const DEFAULT_SIDE_WIDTH_PX = DEFAULT_UI_CONFIG.sideWidthPx;
const MOBILE_BREAKPOINT_PX = 960;
const MIN_MOBILE_PANE_PX = 220;
const REMOTE_SAVE_DEBOUNCE_MS = 260;

const OFFLINE_SEED_NOTE: Note = {
  id: 1,
  title: "First note",
  body: "Start linking notes by their numbers.",
  links: [],
  position: { x: 0, y: 0 },
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sanitizePosition(pos?: NotePosition | null): NotePosition {
  if (pos && isFiniteNumber(pos.x) && isFiniteNumber(pos.y)) {
    return { x: pos.x, y: pos.y };
  }
  return { x: 0, y: 0 };
}

function normalizeNotes(input: Note[]): Note[] {
  const byId = new Map<number, Note>();
  for (const note of input) {
    if (!isFiniteNumber(note.id)) continue;
    const id = Math.max(1, Math.round(note.id));
    byId.set(id, {
      id,
      title: typeof note.title === "string" && note.title.trim().length > 0 ? note.title : "Untitled",
      body: typeof note.body === "string" ? note.body : "",
      links: Array.isArray(note.links) ? note.links.filter(isFiniteNumber).map((n) => Math.round(n)) : [],
      position: sanitizePosition(note.position),
    });
  }

  const ids = new Set(byId.keys());
  const linksById = new Map<number, Set<number>>();

  for (const [id, note] of byId.entries()) {
    const links = new Set<number>();
    for (const peerId of note.links) {
      if (peerId !== id && ids.has(peerId)) links.add(peerId);
    }
    linksById.set(id, links);
  }

  for (const [id, peers] of linksById.entries()) {
    for (const peerId of peers) {
      const peerSet = linksById.get(peerId);
      if (peerSet) peerSet.add(id);
    }
  }

  return Array.from(byId.keys())
    .sort((a, b) => a - b)
    .map((id) => {
      const note = byId.get(id)!;
      const links = Array.from(linksById.get(id) ?? []).sort((a, b) => a - b);
      return {
        ...note,
        links,
        position: sanitizePosition(note.position),
      };
    });
}

function cloneNotes(notes: Note[]): Note[] {
  return notes.map((note) => ({
    ...note,
    links: [...note.links],
    position: note.position ? { ...note.position } : undefined,
  }));
}

function readCachedNotes(): Note[] | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(NOTES_CACHE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Note[];
    if (!Array.isArray(parsed)) return null;
    const normalized = normalizeNotes(parsed);
    return normalized.length > 0 ? normalized : null;
  } catch {
    return null;
  }
}

function writeCachedNotes(notes: Note[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(NOTES_CACHE_KEY, JSON.stringify(notes));
}

function readPendingSyncFlag(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(NOTES_PENDING_SYNC_KEY) === "1";
}

function writePendingSyncFlag(value: boolean) {
  if (typeof window === "undefined") return;
  if (value) {
    window.localStorage.setItem(NOTES_PENDING_SYNC_KEY, "1");
  } else {
    window.localStorage.removeItem(NOTES_PENDING_SYNC_KEY);
  }
}

function chooseSelectedId(previous: number | undefined, notes: Note[]): number | undefined {
  if (previous !== undefined && notes.some((note) => note.id === previous)) return previous;
  return notes[0]?.id;
}

function collectFinitePositions(notes: Note[]): NotePosition[] {
  return notes
    .map((note) => note.position)
    .filter((position): position is NotePosition => !!position && isFiniteNumber(position.x) && isFiniteNumber(position.y));
}

function median(values: number[]): number | null {
  const nums = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  if (nums.length % 2 === 1) return nums[mid] ?? null;
  return (nums[mid - 1] + nums[mid]) / 2;
}

function computeSpawnCenter(notes: Note[]): NotePosition {
  const positions = collectFinitePositions(notes);
  const mx = median(positions.map((position) => position.x));
  const my = median(positions.map((position) => position.y));
  if (mx !== null && my !== null) return { x: mx, y: my };
  return { x: 0, y: 0 };
}

function computeSpawnPosition(notes: Note[], connectToId?: number, spawnAt?: NotePosition): NotePosition {
  if (spawnAt && isFiniteNumber(spawnAt.x) && isFiniteNumber(spawnAt.y)) {
    return { x: spawnAt.x, y: spawnAt.y };
  }

  const center = computeSpawnCenter(notes);
  const connectTo = connectToId !== undefined ? notes.find((note) => note.id === connectToId) : undefined;
  const base = connectTo?.position ? sanitizePosition(connectTo.position) : center;

  const existing = collectFinitePositions(notes);
  const minDistSq = 180 * 180;

  for (let index = 0; index < 24; index += 1) {
    const radius = connectTo ? 220 + (Math.random() - 0.5) * 120 : 120 + (Math.random() - 0.5) * 160;
    const angle = Math.random() * Math.PI * 2;
    const candidate = {
      x: base.x + Math.cos(angle) * radius,
      y: base.y + Math.sin(angle) * radius,
    };
    const collision = existing.some((position) => {
      const dx = position.x - candidate.x;
      const dy = position.y - candidate.y;
      return dx * dx + dy * dy < minDistSq;
    });
    if (!collision) return candidate;
  }

  return {
    x: base.x + (Math.random() - 0.5) * 240,
    y: base.y + (Math.random() - 0.5) * 240,
  };
}

function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedId, setSelectedId] = useState<number | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "error">("idle");
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "error">("idle");
  const [focusTitleId, setFocusTitleId] = useState<number | null>(null);
  const [hasPendingSync, setHasPendingSync] = useState(() => readPendingSyncFlag());
  const [isOnline, setIsOnline] = useState(() => {
    if (typeof navigator === "undefined") return true;
    return navigator.onLine;
  });
  const [editorView, setEditorView] = useState<"edit" | "split" | "preview">(() => {
    if (typeof window === "undefined") return "edit";
    const raw = window.localStorage.getItem(EDITOR_VIEW_KEY);
    return raw === "split" || raw === "preview" || raw === "edit" ? raw : "edit";
  });
  const [ui, setUi] = useState(DEFAULT_UI_CONFIG);
  const [shortcuts, setShortcuts] = useState(DEFAULT_SHORTCUTS_CONFIG);
  const [theme, setTheme] = useState(DEFAULT_THEME);
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`).matches;
  });

  const isNativeApp = Capacitor.isNativePlatform();
  const showCanvasAddButton = isMobile || isNativeApp;
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const [contextMenu, setContextMenu] = useState<
    | { kind: "canvas"; x: number; y: number }
    | { kind: "note"; id: number; x: number; y: number }
    | null
  >(null);

  const workspaceRef = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sidePaneRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ startX: number; startSideWidth: number } | null>(null);
  const mobileDragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  const notesRef = useRef<Note[]>([]);
  const localVersionRef = useRef(0);
  const isOnlineRef = useRef(isOnline);
  const hasPendingSyncRef = useRef(hasPendingSync);

  const persistTimerRef = useRef<number | null>(null);
  const persistQueuedRef = useRef(false);
  const persistRunningRef = useRef(false);
  const syncInFlightRef = useRef(false);

  const apiWritesRef = useRef<Promise<void>>(Promise.resolve());
  const lastWriteErrorRef = useRef<unknown>(null);

  const [sideWidthPx, setSideWidthPx] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_SIDE_WIDTH_PX;
    const raw = window.localStorage.getItem(SIDE_WIDTH_KEY);
    const parsed = raw ? Number(raw) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : DEFAULT_UI_CONFIG.sideWidthPx;
  });
  const sideWidthRef = useRef(sideWidthPx);
  const [mobileSideHeightPx, setMobileSideHeightPx] = useState<number>(() => {
    if (typeof window === "undefined") return 360;
    const raw = window.localStorage.getItem(MOBILE_SIDE_HEIGHT_KEY);
    const parsed = raw ? Number(raw) : Number.NaN;
    if (Number.isFinite(parsed)) return parsed;
    const base = Math.round(Math.min(520, window.innerHeight * 0.55));
    return Math.max(MIN_MOBILE_PANE_PX, base);
  });
  const mobileSideHeightRef = useRef(mobileSideHeightPx);

  useEffect(() => {
    sideWidthRef.current = sideWidthPx;
  }, [sideWidthPx]);

  useEffect(() => {
    mobileSideHeightRef.current = mobileSideHeightPx;
  }, [mobileSideHeightPx]);

  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  useEffect(() => {
    isOnlineRef.current = isOnline;
  }, [isOnline]);

  useEffect(() => {
    hasPendingSyncRef.current = hasPendingSync;
  }, [hasPendingSync]);

  const setPendingSync = useCallback((pending: boolean) => {
    writePendingSyncFlag(pending);
    setHasPendingSync(pending);
  }, []);

  const clearStorageAndReload = useCallback(async () => {
    try {
      await resetNotesToOrigin();
    } catch (err) {
      setError(`Could not reset from origin/master: ${err}`);
      return;
    }
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(NOTES_CACHE_KEY);
      window.localStorage.removeItem(NOTES_PENDING_SYNC_KEY);
      window.localStorage.removeItem(API_BASE_OVERRIDE_KEY);
      window.localStorage.removeItem(SIDE_WIDTH_KEY);
      window.localStorage.removeItem(MOBILE_SIDE_HEIGHT_KEY);
      window.localStorage.removeItem(EDITOR_VIEW_KEY);
    } catch {
      // ignore
    }
    window.location.reload();
  }, []);

  const trackApiWrite = useCallback(function trackApiWrite<T>(promise: Promise<T>): Promise<T> {
    apiWritesRef.current = apiWritesRef.current
      .then(() => promise)
      .then(
        () => {
          // tracked
        },
        (err) => {
          lastWriteErrorRef.current = err;
        }
      );
    return promise;
  }, []);

  const runRemotePersist = useCallback(async () => {
    if (!isOnlineRef.current) return;
    if (persistRunningRef.current) return;

    persistRunningRef.current = true;
    try {
      while (persistQueuedRef.current && isOnlineRef.current) {
        persistQueuedRef.current = false;
        const snapshot = cloneNotes(notesRef.current);
        const snapshotVersion = localVersionRef.current;
        setSaveState("saving");

        try {
          await trackApiWrite(replaceNotes(snapshot).then(() => undefined));
          if (snapshotVersion === localVersionRef.current) {
            setPendingSync(false);
            setSaveState("idle");
          } else {
            persistQueuedRef.current = true;
          }
        } catch (err) {
          setPendingSync(true);
          setSaveState("error");
          if (!isOnlineRef.current) {
            setError("Offline: changes are saved locally and will sync when connection returns.");
          } else {
            setError(`Remote save failed: ${err}`);
          }
          break;
        }
      }
    } finally {
      persistRunningRef.current = false;
    }
  }, [setPendingSync, trackApiWrite]);

  const scheduleRemotePersist = useCallback(
    (immediate = false) => {
      persistQueuedRef.current = true;
      setPendingSync(true);

      if (!isOnlineRef.current) {
        setSaveState("idle");
        return;
      }

      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }

      if (immediate) {
        void runRemotePersist();
        return;
      }

      persistTimerRef.current = window.setTimeout(() => {
        persistTimerRef.current = null;
        void runRemotePersist();
      }, REMOTE_SAVE_DEBOUNCE_MS);
    },
    [runRemotePersist, setPendingSync]
  );

  const syncPendingAfterReconnect = useCallback(async () => {
    if (syncInFlightRef.current) return;
    if (!isOnlineRef.current) return;
    if (!hasPendingSyncRef.current) return;

    syncInFlightRef.current = true;
    setSyncState("syncing");
    lastWriteErrorRef.current = null;

    try {
      persistQueuedRef.current = true;
      await runRemotePersist();
      await apiWritesRef.current;
      if (lastWriteErrorRef.current) throw lastWriteErrorRef.current;
      if (hasPendingSyncRef.current) {
        throw new Error("Notes API still unavailable; pending changes remain local");
      }
      await gitSync();
      setSyncState("idle");
      setError(null);
    } catch (err) {
      setError(`Reconnect sync failed: ${err}`);
      setSyncState("error");
      window.setTimeout(() => setSyncState("idle"), 4000);
    } finally {
      syncInFlightRef.current = false;
    }
  }, [runRemotePersist]);

  const commitLocalNotes = useCallback(
    (nextInput: Note[], queueRemoteSave = true) => {
      const next = normalizeNotes(nextInput);
      notesRef.current = next;
      setNotes(next);
      writeCachedNotes(next);

      if (queueRemoteSave) {
        localVersionRef.current += 1;
        scheduleRemotePersist();
      } else {
        setSaveState("idle");
      }

      return next;
    },
    [scheduleRemotePersist]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`);
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(EDITOR_VIEW_KEY, editorView);
  }, [editorView]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleOnline = () => {
      setIsOnline(true);
      void syncPendingAfterReconnect();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [syncPendingAfterReconnect]);

  useEffect(() => {
    let active = true;
    loadUiConfig()
      .then((cfg) => {
        if (!active) return;
        setUi(cfg);
        if (window.localStorage.getItem(SIDE_WIDTH_KEY)) return;
        setSideWidthPx(cfg.sideWidthPx);
        sideWidthRef.current = cfg.sideWidthPx;
      })
      .catch(() => {
        // ignore
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    loadShortcutsConfig()
      .then((cfg) => {
        if (active) setShortcuts(cfg);
      })
      .catch(() => {
        // ignore
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    loadThemeConfig()
      .then((cfg) => {
        if (active) setTheme(cfg);
      })
      .catch(() => {
        // ignore
      });
    return () => {
      active = false;
    };
  }, []);

  const appStyle = useMemo(() => {
    const titleHeightPx = isMobile ? ui.mobileTitleHeightPx : ui.titleHeightPx;
    const titleFontPx = isMobile ? ui.mobileTitleFontPx : ui.titleFontPx;
    return {
      ["--splitter-v" as const]: `${ui.splitterPx}px`,
      ["--side-pad" as const]: `${ui.sidePaddingPx}px`,
      ["--title-h" as const]: `${titleHeightPx}px`,
      ["--links-h" as const]: `${ui.linksHeightPx}px`,
      ["--title-font" as const]: `${titleFontPx}px`,
      ["--links-font" as const]: `${ui.linksFontPx}px`,
      ["--editor-font" as const]: `${ui.editorFontPx}px`,
      ["--theme-page-background" as const]: theme.pageBackground,
      ["--theme-page-text" as const]: theme.pageText,
      ["--theme-workspace-background" as const]: theme.workspaceBackground,
      ["--theme-canvas-wrap-background" as const]: theme.canvasWrapBackground,
      ["--theme-splitter-background" as const]: theme.splitterBackground,
      ["--theme-splitter-hover-background" as const]: theme.splitterHoverBackground,
      ["--theme-side-pane-background" as const]: theme.sidePaneBackground,
      ["--theme-side-pane-empty-text" as const]: theme.sidePaneEmptyText,
      ["--theme-divider-background" as const]: theme.dividerBackground,
      ["--theme-input-text" as const]: theme.inputText,
      ["--theme-input-underline" as const]: theme.inputUnderline,
      ["--theme-input-underline-focus" as const]: theme.inputUnderlineFocus,
      ["--theme-segmented-text" as const]: theme.segmentedText,
      ["--theme-segmented-hover-background" as const]: theme.segmentedHoverBackground,
      ["--theme-segmented-active-text" as const]: theme.segmentedActiveText,
      ["--theme-segmented-active-underline" as const]: theme.segmentedActiveUnderline,
      ["--theme-editor-link" as const]: theme.editorLink,
      ["--theme-editor-preview-divider" as const]: theme.editorPreviewDivider,
      ["--theme-status-dot-border" as const]: theme.statusDotBorder,
      ["--theme-status-dot-idle" as const]: theme.statusDotIdle,
      ["--theme-status-dot-saving" as const]: theme.statusDotSaving,
      ["--theme-status-dot-error" as const]: theme.statusDotError,
      ["--theme-banner-background" as const]: theme.bannerBackground,
      ["--theme-banner-border" as const]: theme.bannerBorder,
      ["--theme-banner-text" as const]: theme.bannerText,
      ["--theme-banner-shadow" as const]: theme.bannerShadow,
      ["--theme-banner-success-border" as const]: theme.bannerSuccessBorder,
      ["--theme-banner-success-text" as const]: theme.bannerSuccessText,
      ["--theme-banner-error-border" as const]: theme.bannerErrorBorder,
      ["--theme-banner-error-text" as const]: theme.bannerErrorText,
      ["--mobile-side-height" as const]: `${mobileSideHeightPx}px`,
    } as CSSProperties;
  }, [isMobile, mobileSideHeightPx, theme, ui]);

  useEffect(() => {
    let active = true;
    const cached = readCachedNotes();

    if (cached && cached.length > 0) {
      notesRef.current = cached;
      setNotes(cached);
      setSelectedId((prev) => chooseSelectedId(prev, cached));
      setLoading(false);
    }

    (async () => {
      try {
        const fetched = normalizeNotes(await fetchNotes());
        if (!active) return;

        const shouldKeepLocal = hasPendingSyncRef.current && !!cached?.length;
        if (!shouldKeepLocal) {
          notesRef.current = fetched;
          setNotes(fetched);
          writeCachedNotes(fetched);
          setSelectedId((prev) => chooseSelectedId(prev, fetched));
          setError(null);
        }

        if (hasPendingSyncRef.current && isOnlineRef.current) {
          void syncPendingAfterReconnect();
        }
      } catch (err) {
        if (!active) return;
        if (cached && cached.length > 0) {
          setError("Using locally cached notes while offline.");
        } else {
          const seeded = normalizeNotes([OFFLINE_SEED_NOTE]);
          notesRef.current = seeded;
          setNotes(seeded);
          writeCachedNotes(seeded);
          setSelectedId(seeded[0]?.id);
          localVersionRef.current += 1;
          setPendingSync(true);
          scheduleRemotePersist();
          setError(`Failed to reach API, using offline note: ${err}`);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [scheduleRemotePersist, setPendingSync, syncPendingAfterReconnect]);

  useEffect(() => {
    return () => {
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current);
      }
    };
  }, []);

  const selectedNote = useMemo(() => notes.find((note) => note.id === selectedId), [notes, selectedId]);

  const handleAddNoteConnected = (connectToId?: number, spawnAt?: NotePosition) => {
    const current = notesRef.current;
    const connectToExists =
      connectToId !== undefined && Number.isFinite(connectToId)
        ? current.some((note) => note.id === connectToId)
        : false;
    const connectTo = connectToExists ? connectToId : undefined;

    const nextId = current.reduce((max, note) => Math.max(max, note.id), 0) + 1;
    const newNote: Note = {
      id: nextId,
      title: `New note ${nextId}`,
      body: "",
      links: connectTo !== undefined ? [connectTo] : [],
      position: computeSpawnPosition(current, connectTo, spawnAt),
    };

    const next = commitLocalNotes([...current, newNote], true);
    setSelectedId(chooseSelectedId(newNote.id, next));
    setFocusTitleId(newNote.id);
    setError(null);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const activeEl = document.activeElement as Element | null;
      const inSidebar = !!(sidePaneRef.current && activeEl && sidePaneRef.current.contains(activeEl));

      if (inSidebar && matchesAnyChord(event, shortcuts.global.escapeToCanvas)) {
        event.preventDefault();
        event.stopPropagation();
        canvasRef.current?.focus();
        return;
      }

      if (!inSidebar && selectedId !== undefined && matchesAnyChord(event, shortcuts.global.clearSelection)) {
        event.preventDefault();
        event.stopPropagation();
        setSelectedId(undefined);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [selectedId, shortcuts.global.clearSelection, shortcuts.global.escapeToCanvas]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const close = () => setContextMenu(null);
    const handlePointerDown = (event: PointerEvent) => {
      const menu = contextMenu;
      if (!menu) return;
      const target = event.target as Element | null;
      if (target && target.closest(".context-menu")) return;
      close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const bufferRef = { value: "" };
    let timer: number | null = null;

    const reset = () => {
      bufferRef.value = "";
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (selectedId !== undefined) return;
      if (contextMenu) return;

      const activeEl = document.activeElement as HTMLElement | null;
      const isTypingField =
        !!activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          activeEl.isContentEditable ||
          (sidePaneRef.current ? sidePaneRef.current.contains(activeEl) : false));
      if (isTypingField) return;

      const k = event.key;
      if (k.length !== 1 || !/[a-zA-Z]/.test(k)) return;

      bufferRef.value = `${bufferRef.value}${k.toLowerCase()}`.slice(-5);
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(reset, 900);

      if (bufferRef.value.endsWith("clear")) {
        event.preventDefault();
        reset();
        void clearStorageAndReload();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [clearStorageAndReload, contextMenu, selectedId]);

  const handleDeleteNote = (id: number) => {
    const current = notesRef.current;
    const next = commitLocalNotes(current.filter((note) => note.id !== id), true);
    if (selectedId === id) {
      setSelectedId(chooseSelectedId(undefined, next));
    }
  };

  const handleUpdateNote = (id: number, patch: Partial<Note>) => {
    setSaveState("saving");
    const current = notesRef.current;
    const next = current.map((note) => (note.id === id ? { ...note, ...patch } : note));
    commitLocalNotes(next, true);
  };

  const handlePositionChange = (id: number, position: NotePosition) => {
    const current = notesRef.current;
    const next = current.map((note) => (note.id === id ? { ...note, position } : note));
    commitLocalNotes(next, true);
  };

  const handlePositionsChange = (positions: Map<number, NotePosition>) => {
    const current = notesRef.current;
    const next = current.map((note) => {
      const updated = positions.get(note.id);
      return updated ? { ...note, position: updated } : note;
    });
    commitLocalNotes(next, true);
  };

  const clampSideWidth = (nextPx: number) => {
    const container = workspaceRef.current;
    const total = container?.getBoundingClientRect().width ?? 0;
    if (!total) return Math.max(MIN_PANE_PX, nextPx);
    const maxSide = Math.max(MIN_PANE_PX, total - MIN_PANE_PX);
    return Math.min(Math.max(MIN_PANE_PX, nextPx), maxSide);
  };

  const clampMobileSideHeight = (nextPx: number) => {
    const container = workspaceRef.current;
    const total = container?.getBoundingClientRect().height ?? window.innerHeight ?? 0;
    const maxHeight = Math.max(MIN_MOBILE_PANE_PX, Math.floor(total * 0.85));
    return Math.min(Math.max(MIN_MOBILE_PANE_PX, nextPx), maxHeight);
  };

  useEffect(() => {
    const el = workspaceRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      setSideWidthPx((prev) => {
        const next = clampSideWidth(prev);
        sideWidthRef.current = next;
        return next;
      });
      if (isMobile) {
        setMobileSideHeightPx((prev) => {
          const next = clampMobileSideHeight(prev);
          mobileSideHeightRef.current = next;
          return next;
        });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isMobile]);

  const handleWorkspaceSplitterDown = (event: import("react").PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragRef.current = { startX: event.clientX, startSideWidth: sideWidthPx };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const handleWorkspaceSplitterMove = (event: import("react").PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const next = clampSideWidth(drag.startSideWidth - dx);
    sideWidthRef.current = next;
    setSideWidthPx(next);
  };

  const handleWorkspaceSplitterUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    window.localStorage.setItem(SIDE_WIDTH_KEY, String(sideWidthRef.current));
  };

  const handleMobileSplitterDown = (event: import("react").PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    mobileDragRef.current = { startY: event.clientY, startHeight: mobileSideHeightPx };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const handleMobileSplitterMove = (event: import("react").PointerEvent<HTMLDivElement>) => {
    const drag = mobileDragRef.current;
    if (!drag) return;
    const dy = drag.startY - event.clientY;
    const next = clampMobileSideHeight(drag.startHeight + dy);
    mobileSideHeightRef.current = next;
    setMobileSideHeightPx(next);
  };

  const handleMobileSplitterUp = () => {
    if (!mobileDragRef.current) return;
    mobileDragRef.current = null;
    window.localStorage.setItem(MOBILE_SIDE_HEIGHT_KEY, String(mobileSideHeightRef.current));
  };

  const handleGitSync = async () => {
    if (syncState === "syncing" || syncInFlightRef.current) return;

    syncInFlightRef.current = true;
    setSyncState("syncing");
    lastWriteErrorRef.current = null;

    try {
      if (hasPendingSyncRef.current) {
        persistQueuedRef.current = true;
        await runRemotePersist();
      }
      await apiWritesRef.current;
      if (lastWriteErrorRef.current) throw lastWriteErrorRef.current;
      if (hasPendingSyncRef.current) {
        throw new Error("Pending local changes are not synced yet");
      }
      await gitSync();
      setSyncState("idle");
      setError(null);
    } catch (err) {
      setError(`Git sync failed: ${err}`);
      setSyncState("error");
      window.setTimeout(() => setSyncState("idle"), 4000);
    } finally {
      syncInFlightRef.current = false;
    }
  };

  const statusDotState =
    syncState === "syncing"
      ? "saving"
      : syncState === "error"
        ? "error"
        : saveState;
  const statusDotTitle =
    syncState === "syncing"
      ? "Syncing notes to GitHub…"
      : syncState === "error"
        ? "Git sync failed (see banner)"
        : hasPendingSync
          ? "Local changes pending sync"
          : "Click to sync notes to GitHub";

  return (
    <div className="app-shell" style={appStyle}>
      <main className="workspace" ref={workspaceRef}>
        <div className="canvas-wrap" ref={canvasWrapRef}>
          {showCanvasAddButton && (
            <button
              type="button"
              className="canvas-add-note"
              aria-label="Add note"
              onClick={() => handleAddNoteConnected(selectedId)}
            >
              +
            </button>
          )}
          {contextMenu && (
            <div
              className="context-menu"
              style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
              role="menu"
            >
              {contextMenu.kind === "canvas" && (
                <button type="button" onClick={() => void clearStorageAndReload()}>
                  Clear storage
                </button>
              )}
              {contextMenu.kind === "note" && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setContextMenu(null);
                      handleAddNoteConnected(contextMenu.id);
                    }}
                  >
                    Add connected note
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setContextMenu(null);
                      handleDeleteNote(contextMenu.id);
                    }}
                  >
                    Delete note
                  </button>
                </>
              )}
            </div>
          )}
          <GraphCanvas
            ref={canvasRef}
            notes={notes}
            selectedId={selectedId}
            reservedRightPx={selectedNote ? sideWidthPx + ui.splitterPx : 0}
            onSelect={setSelectedId}
            onPositionChange={handlePositionChange}
            onPositionsChange={handlePositionsChange}
            onCreate={(connectToId, spawnAt) => handleAddNoteConnected(connectToId, spawnAt)}
            onDelete={(id) => handleDeleteNote(id)}
            onContextMenu={(menu) => {
              const wrap = canvasWrapRef.current;
              if (!wrap) return;
              const rect = wrap.getBoundingClientRect();
              const x = Math.max(10, Math.min(rect.width - 10, menu.clientX - rect.left));
              const y = Math.max(10, Math.min(rect.height - 10, menu.clientY - rect.top));
              setContextMenu(
                menu.kind === "canvas"
                  ? { kind: "canvas", x, y }
                  : { kind: "note", id: menu.id, x, y }
              );
            }}
            shortcuts={shortcuts.canvas}
            theme={theme.canvas}
          />
        </div>
        {selectedNote && (
          <>
            {!isMobile && (
              <div
                className="splitter splitter-vertical"
                role="separator"
                aria-orientation="vertical"
                tabIndex={0}
                style={{ right: `${sideWidthPx}px` }}
                onPointerDown={handleWorkspaceSplitterDown}
                onPointerMove={handleWorkspaceSplitterMove}
                onPointerUp={handleWorkspaceSplitterUp}
                onPointerCancel={handleWorkspaceSplitterUp}
              />
            )}
            <div className="side-wrap" style={{ width: sideWidthPx }}>
              {isMobile && (
                <div
                  className="splitter splitter-horizontal"
                  role="separator"
                  aria-orientation="horizontal"
                  tabIndex={0}
                  onPointerDown={handleMobileSplitterDown}
                  onPointerMove={handleMobileSplitterMove}
                  onPointerUp={handleMobileSplitterUp}
                  onPointerCancel={handleMobileSplitterUp}
                />
              )}
              <SidePane
                ref={sidePaneRef}
                note={selectedNote}
                saveState={statusDotState}
                statusTitle={statusDotTitle}
                onStatusClick={handleGitSync}
                view={editorView}
                onViewChange={setEditorView}
                autoFocusId={focusTitleId}
                onAutoFocusDone={() => setFocusTitleId(null)}
                shortcuts={shortcuts.sidebar}
                onChange={(patch) => selectedId !== undefined && handleUpdateNote(selectedId, patch)}
              />
            </div>
          </>
        )}
      </main>
      {loading && <div className="banner">Loading notes…</div>}
      {error && <div className="banner error">{error}</div>}
    </div>
  );
}

export default App;
