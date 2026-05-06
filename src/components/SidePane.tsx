import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { formatLinks, parseLinks } from "../api";
import type { Note } from "../types";
import { matchesAnyChord } from "../shortcuts";
import type { ShortcutsConfig, SidebarTabTarget } from "../shortcutsConfig";
import ToastMarkdownEditor, {
  type MarkdownEditorHandle,
  type MarkdownEditorView,
} from "./ToastMarkdownEditor";

type SidePaneProps = {
  note?: Note;
  saveState: "idle" | "saving" | "error";
  statusTitle?: string;
  onStatusClick?: () => void;
  view: MarkdownEditorView;
  onViewChange: (view: MarkdownEditorView) => void;
  onChange: (patch: Partial<Note>) => void;
  shortcuts: ShortcutsConfig["sidebar"];
  autoFocusId?: number | null;
  onAutoFocusDone?: () => void;
};

const DEBOUNCE_MS = 220;

const SidePane = forwardRef<HTMLElement, SidePaneProps>(function SidePane(
  {
    note,
    onChange,
    saveState,
    statusTitle,
    onStatusClick,
    view,
    onViewChange,
    shortcuts,
    autoFocusId,
    onAutoFocusDone,
  }: SidePaneProps,
  ref
) {
  const [title, setTitle] = useState(note?.title ?? "");
  const [body, setBody] = useState(note?.body ?? "");
  const [linksInput, setLinksInput] = useState(
    note ? formatLinks(note.links) : ""
  );
  const rootRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const linksRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<MarkdownEditorHandle | null>(null);

  useImperativeHandle(ref, () => rootRef.current as HTMLElement, []);

  const tabOrder = useMemo(() => shortcuts.tabOrder, [shortcuts.tabOrder]);

  const hasChanges = useCallback(() => {
    if (!note) return false;
    const parsed = parseLinks(linksInput);
    const sameLinks =
      parsed.length === note.links.length &&
      parsed.every((v, idx) => v === note.links[idx]);
    return title !== note.title || body !== note.body || !sameLinks;
  }, [note, title, body, linksInput]);

  useEffect(() => {
    if (!note) return;
    setTitle(note.title ?? "");
    setBody(note.body ?? "");
    setLinksInput(formatLinks(note.links));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id]);

  useEffect(() => {
    if (!note) return;
    if (!autoFocusId || autoFocusId !== note.id) return;
    const raf = window.requestAnimationFrame(() => {
      titleRef.current?.focus();
      onAutoFocusDone?.();
    });
    return () => window.cancelAnimationFrame(raf);
  }, [note, autoFocusId, onAutoFocusDone]);

  useEffect(() => {
    if (!note) return;
    if (!hasChanges()) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      const parsed = parseLinks(linksInput);
      onChange({ title, body, links: parsed });
    }, DEBOUNCE_MS);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [title, body, linksInput, note, onChange, hasChanges]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const handleGesture = (event: Event) => {
      event.preventDefault();
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches.length < 2) return;
      event.preventDefault();
    };

    root.addEventListener("gesturestart", handleGesture, { passive: false });
    root.addEventListener("gesturechange", handleGesture, { passive: false });
    root.addEventListener("gestureend", handleGesture, { passive: false });
    root.addEventListener("touchmove", handleTouchMove, { passive: false });

    return () => {
      root.removeEventListener("gesturestart", handleGesture);
      root.removeEventListener("gesturechange", handleGesture);
      root.removeEventListener("gestureend", handleGesture);
      root.removeEventListener("touchmove", handleTouchMove);
    };
  }, []);

  const handleStatusClick = () => {
    if (!onStatusClick) return;
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (note && hasChanges()) {
      const parsed = parseLinks(linksInput);
      onChange({ title, body, links: parsed });
    }
    onStatusClick();
  };

  if (!note) {
    return (
      <aside ref={rootRef} className="side-pane empty">
        <p>Click a node to edit.</p>
      </aside>
    );
  }

  const focusTarget = (target: SidebarTabTarget) => {
    if (target === "title") titleRef.current?.focus();
    if (target === "links") linksRef.current?.focus();
    if (target === "markdown") editorRef.current?.focus();
  };

  const getActiveTarget = (): SidebarTabTarget | null => {
    const active = document.activeElement as Element | null;
    if (!active) return null;
    if (titleRef.current && (active === titleRef.current || titleRef.current.contains(active))) return "title";
    if (linksRef.current && (active === linksRef.current || linksRef.current.contains(active))) return "links";
    const editorRoot = editorRef.current?.getRoot();
    if (editorRoot && editorRoot.contains(active)) return "markdown";
    return null;
  };

  const moveFocus = (dir: 1 | -1, current: SidebarTabTarget) => {
    if (!tabOrder.length) return;
    const start = tabOrder.indexOf(current);
    const idx = start === -1 ? 0 : start;
    const nextRaw = idx + dir;
    const next =
      nextRaw < 0
        ? shortcuts.tabCycle
          ? tabOrder[tabOrder.length - 1]
          : tabOrder[0]
        : nextRaw >= tabOrder.length
          ? shortcuts.tabCycle
            ? tabOrder[0]
            : tabOrder[tabOrder.length - 1]
          : tabOrder[nextRaw];
    focusTarget(next);
  };

  const handleKeyDownCapture = (event: import("react").KeyboardEvent) => {
    const native = event.nativeEvent;
    if (native.ctrlKey || native.altKey || native.metaKey) return;
    const current = getActiveTarget();
    if (!current) return;

    if (matchesAnyChord(native, shortcuts.focusNext)) {
      if (!shortcuts.tabCycle && current === tabOrder[tabOrder.length - 1]) return;
      event.preventDefault();
      event.stopPropagation();
      moveFocus(1, current);
      return;
    }
    if (matchesAnyChord(native, shortcuts.focusPrev)) {
      if (!shortcuts.tabCycle && current === tabOrder[0]) return;
      event.preventDefault();
      event.stopPropagation();
      moveFocus(-1, current);
    }
  };

  return (
    <aside ref={rootRef} className="side-pane" onKeyDownCapture={handleKeyDownCapture}>
      <div className="title-row">
        <input
          id="title"
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
        />
        <button
          type="button"
          className="status-dot"
          data-state={saveState}
          title={statusTitle ?? saveState}
          aria-label="Sync notes to GitHub"
          onClick={handleStatusClick}
          disabled={!onStatusClick}
        />
      </div>

      <div className="divider" aria-hidden="true" />

      <div className="body-pane">
        <div className="label-row">
          <span className="row-spacer" />
          <div className="editor-controls" aria-label="Editor controls">
            <div className="segmented">
              <button
                type="button"
                className={view === "edit" ? "active" : ""}
                onClick={() => onViewChange("edit")}
                title="Editor only"
              >
                Edit
              </button>
              <button
                type="button"
                className={view === "split" ? "active" : ""}
                onClick={() => onViewChange("split")}
                title="Split view"
              >
                Split
              </button>
              <button
                type="button"
                className={view === "preview" ? "active" : ""}
                onClick={() => onViewChange("preview")}
                title="Preview only"
              >
                Preview
              </button>
            </div>
          </div>
        </div>

        <ToastMarkdownEditor
          ref={editorRef}
          value={body}
          onChange={setBody}
          view={view}
        />
      </div>

      <div className="divider" aria-hidden="true" />

      <div className="links-row">
        <input
          id="links"
          ref={linksRef}
          value={linksInput}
          onChange={(e) => setLinksInput(e.target.value)}
          placeholder="Links"
        />
      </div>
    </aside>
  );
});

export default SidePane;
