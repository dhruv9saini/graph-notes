import {
  Bodies,
  Body,
  Composite,
  Constraint,
  Engine,
  Events,
  Query,
  Runner,
  Sleeping,
  Vector,
} from "matter-js";
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_GRAPH_PHYSICS, loadGraphPhysicsConfig } from "../config";
import { matchesAnyChord } from "../shortcuts";
import type { ShortcutsConfig } from "../shortcutsConfig";
import { DEFAULT_SHORTCUTS_CONFIG } from "../shortcutsConfig";
import type { CanvasTheme } from "../themeConfig";
import { DEFAULT_THEME } from "../themeConfig";
import type { Note, NoteId, NotePosition } from "../types";

type GraphCanvasProps = {
  notes: Note[];
  selectedId?: NoteId;
  reservedRightPx?: number;
  onSelect: (id: NoteId | undefined) => void;
  onPositionChange: (id: NoteId, pos: NotePosition) => void;
  onPositionsChange?: (positions: Map<NoteId, NotePosition>) => void;
  onCreate: (connectToId: NoteId | undefined, spawnAt?: NotePosition) => void;
  onDelete: (id: NoteId) => void;
  onContextMenu?: (menu: { kind: "canvas"; clientX: number; clientY: number } | { kind: "note"; id: NoteId; clientX: number; clientY: number }) => void;
  shortcuts?: ShortcutsConfig["canvas"];
  theme?: CanvasTheme;
};

type NodeVisual = {
  width: number;
  height: number;
  lines: string[];
};

type NoteBody = Body & { noteId?: NoteId };

type Interaction =
  | { mode: "idle" }
  | { mode: "panning"; origin: { x: number; y: number }; start: { x: number; y: number } }
  | {
      mode: "dragging";
      id: NoteId;
      body: NoteBody;
      start: { x: number; y: number };
      grabOffset: { x: number; y: number };
      wasStatic: boolean;
      moved: boolean;
    };

const LINE_HEIGHT = 20;
const PADDING = 14;
const MIN_WIDTH = 120;
const MAX_WIDTH = 240;
const FONT = "16px 'Space Grotesk', 'DM Sans', sans-serif";
const IDLE_FREEZE_MS = 2000;
const IDLE_PERSIST_MS = 2000;
const STABLE_PERSIST_MS = 900;
const PERSIST_THROTTLE_MS = 1000;
const LONG_PRESS_MS = 520;
const LONG_PRESS_MOVE_PX = 14;
const DOUBLE_TAP_MS = 380;
const DOUBLE_TAP_MOVE_PX = 28;

// Physics constants live in `notes-config.toml` (loaded at runtime via the web config endpoint).

function buildComponents(notes: Note[]): NoteId[][] {
  const components: NoteId[][] = [];
  const adj = new Map<NoteId, NoteId[]>();
  notes.forEach((n) => adj.set(n.id, n.links));
  const seen = new Set<NoteId>();

  for (const note of notes) {
    if (seen.has(note.id)) continue;
    const queue = [note.id];
    const comp: NoteId[] = [];
    seen.add(note.id);
    while (queue.length) {
      const id = queue.shift()!;
      comp.push(id);
      const neighbors = adj.get(id) || [];
      neighbors.forEach((n) => {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      });
    }
    components.push(comp);
  }
  return components;
}

function roundRect(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.beginPath();
  ctx.moveTo(-width / 2, -height / 2);
  ctx.lineTo(width / 2, -height / 2);
  ctx.lineTo(width / 2, height / 2);
  ctx.lineTo(-width / 2, height / 2);
  ctx.closePath();
}

function useMeasureContextValue() {
  const [ctx] = useState<CanvasRenderingContext2D | null>(() => {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (context) {
      context.font = FONT;
    }
    return context;
  });
  return ctx;
}

function measureTitle(title: string, ctx: CanvasRenderingContext2D | null): NodeVisual {
  const words = title.trim().length ? title.trim().split(/\s+/) : ["Untitled"];
  const metrics = ctx
    ? words.map((w) => ctx.measureText(w).width)
    : words.map((w) => w.length * 8);
  const minByWords = Math.max(MIN_WIDTH, Math.max(...metrics) + PADDING * 2);
  const candidates: NodeVisual[] = [];
  for (let w = minByWords; w <= MAX_WIDTH; w += 10) {
    const lines: string[] = [];
    let line = "";
    words.forEach((word, idx) => {
      const test = line ? `${line} ${word}` : word;
      const width = ctx ? ctx.measureText(test).width : test.length * 8;
      if (width + PADDING * 2 <= w) {
        line = test;
      } else {
        if (line) lines.push(line);
        line = word;
      }
      if (idx === words.length - 1) lines.push(line);
    });
    const height = lines.length * LINE_HEIGHT + PADDING * 2 + 20; // add id text row
    candidates.push({ width: w, height, lines });
  }
  candidates.sort((a, b) => 2 * (a.width + a.height) - 2 * (b.width + b.height));
  return candidates[0];
}

function normalizeAngleRadians(angle: number): number {
  let a = angle;
  while (a <= -Math.PI) a += Math.PI * 2;
  while (a > Math.PI) a -= Math.PI * 2;
  return a;
}

function linkAngleKey(from: NoteId, to: NoteId): string {
  return `${from}->${to}`;
}

function segmentsCross(a: Vector, b: Vector, c: Vector, d: Vector): boolean {
  const ccw = (p: Vector, q: Vector, r: Vector) =>
    (r.y - p.y) * (q.x - p.x) > (q.y - p.y) * (r.x - p.x);
  return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
}

function positionsDiffer(
  a: Map<NoteId, NotePosition>,
  b: Map<NoteId, NotePosition>,
  eps = 0.5
): boolean {
  if (a.size !== b.size) return true;
  for (const [id, pa] of a.entries()) {
    const pb = b.get(id);
    if (!pb) return true;
    if (Math.abs(pa.x - pb.x) > eps || Math.abs(pa.y - pb.y) > eps) return true;
  }
  return false;
}

function setIncidentLinkAnglesBothWays(
  id: NoteId,
  notes: Note[],
  bodies: Map<NoteId, NoteBody>,
  angles: Map<string, number>
) {
  const note = notes.find((n) => n.id === id);
  if (!note) return;
  note.links.forEach((peerId) => {
    if (peerId === id) return;
    const a = bodies.get(id);
    const b = bodies.get(peerId);
    if (!a || !b) return;
    angles.set(linkAngleKey(id, peerId), Math.atan2(b.position.y - a.position.y, b.position.x - a.position.x));
    angles.set(linkAngleKey(peerId, id), Math.atan2(a.position.y - b.position.y, a.position.x - b.position.x));
  });
}

const GraphCanvas = forwardRef<HTMLCanvasElement, GraphCanvasProps>(function GraphCanvas(
  {
    notes,
    selectedId,
    reservedRightPx = 0,
    onSelect,
    onPositionChange,
    onPositionsChange,
    onCreate,
    onDelete,
    onContextMenu,
    shortcuts = DEFAULT_SHORTCUTS_CONFIG.canvas,
    theme = DEFAULT_THEME.canvas,
  },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const runnerRef = useRef<Runner | null>(null);
  const nodesRef = useRef<Map<NoteId, NoteBody>>(new Map());
  const anchorSetRef = useRef<Set<NoteId>>(new Set());
  const visualsRef = useRef<Map<NoteId, NodeVisual>>(new Map());
  const contentByIdRef = useRef<Map<NoteId, boolean>>(new Map());
  const notesRef = useRef<Note[]>([]);
  const selectedRef = useRef<NoteId | undefined>(selectedId);
  const positionsRef = useRef<Map<NoteId, NotePosition>>(new Map());
  const linkAnglesRef = useRef<Map<string, number>>(new Map());
  const draggingIdRef = useRef<NoteId | null>(null);
  const interactionRef = useRef<Interaction>({ mode: "idle" });
  const activePointerIdRef = useRef<number | null>(null);
  const pointerPositionsRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const lastPointerWorldRef = useRef<NotePosition | null>(null);
  const pinchRef = useRef<{
    startDist: number;
    startZoom: number;
    startPan: { x: number; y: number };
    startWorld: { x: number; y: number };
    origin: { x: number; y: number };
  } | null>(null);
  const hasUserInteractedRef = useRef(false);
  const lastInteractionMsRef = useRef<number | null>(null);
  const isFrozenRef = useRef(false);
  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const canvasClientSizeRef = useRef({ width: 0, height: 0 });
  const hasUserViewManipulationRef = useRef(false);
  const hasCenteredInitialViewRef = useRef(false);
  const reservedRightPxRef = useRef(reservedRightPx);
  const prevReservedRightPxRef = useRef<number | null>(null);
  const onPositionsChangeRef = useRef(onPositionsChange);
  const positionsDirtyRef = useRef(false);
  const lastPersistedPositionsRef = useRef<Map<NoteId, NotePosition>>(new Map());
  const settledSinceMsRef = useRef<number | null>(null);
  const lastPersistAttemptMsRef = useRef(0);
  const lastDriftCheckMsRef = useRef(0);
  const hasCrossingRef = useRef(false);
  const onSelectRef = useRef(onSelect);
  const onPositionChangeRef = useRef(onPositionChange);
  const onCreateRef = useRef(onCreate);
  const onDeleteRef = useRef(onDelete);
  const onContextMenuRef = useRef<GraphCanvasProps["onContextMenu"]>(undefined);
  const shortcutsRef = useRef(shortcuts);
  const themeRef = useRef(theme);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressRef = useRef<{
    pointerId: number;
    startClient: { x: number; y: number };
    kind: "canvas" | "note";
    noteId?: NoteId;
    fired: boolean;
  } | null>(null);
  const tapDownRef = useRef<{
    pointerId: number;
    startClient: { x: number; y: number };
    kind: "canvas" | "note";
    moved: boolean;
  } | null>(null);
  const lastTapRef = useRef<{ atMs: number; client: { x: number; y: number }; onEmptyCanvas: boolean } | null>(null);
  const [physicsConfig, setPhysicsConfig] = useState(DEFAULT_GRAPH_PHYSICS);
  const measureCtx = useMeasureContextValue();

  const wakeAllBodies = useCallback(() => {
    nodesRef.current.forEach((body) => {
      const id = body.noteId;
      if (id !== undefined && anchorSetRef.current.has(id)) return;
      if (body.isStatic) Body.setStatic(body, false);
      Sleeping.set(body, false);
      Body.setVelocity(body, { x: 0, y: 0 });
      Body.setAngularVelocity(body, 0);
    });
  }, []);

  const noteInteraction = useCallback(
    (now: number) => {
      hasUserInteractedRef.current = true;
      lastInteractionMsRef.current = now;
      if (isFrozenRef.current) {
        wakeAllBodies();
        isFrozenRef.current = false;
      }
    },
    [wakeAllBodies]
  );

  const freezeAllBodies = useCallback(() => {
    nodesRef.current.forEach((body) => {
      const id = body.noteId;
      if (id !== undefined && anchorSetRef.current.has(id)) return;
      if (!body.isStatic) Body.setStatic(body, true);
      Body.setVelocity(body, { x: 0, y: 0 });
      Body.setAngularVelocity(body, 0);
      Sleeping.set(body, true);
    });
    isFrozenRef.current = true;
  }, []);

  const centerOnPrimaryAnchorIfNeeded = useCallback(() => {
    if (hasCenteredInitialViewRef.current) return;
    if (hasUserViewManipulationRef.current) return;
    const { width, height } = canvasClientSizeRef.current;
    if (width <= 0 || height <= 0) return;
    const anchors = anchorSetRef.current;
    if (anchors.size === 0) return;
    const primaryAnchorId = Math.min(...Array.from(anchors.values()));
    const anchorBody = nodesRef.current.get(primaryAnchorId);
    if (!anchorBody) return;

    const zoom = Number.isFinite(zoomRef.current) && zoomRef.current > 0 ? zoomRef.current : 1;
    panRef.current = { x: -anchorBody.position.x * zoom, y: -anchorBody.position.y * zoom };
    hasCenteredInitialViewRef.current = true;
  }, []);

  useEffect(() => {
    let active = true;
    loadGraphPhysicsConfig()
      .then((cfg) => {
        if (active) setPhysicsConfig(cfg);
      })
      .catch(() => {
        // ignore; defaults already set
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    reservedRightPxRef.current = reservedRightPx;
    const prev = prevReservedRightPxRef.current;
    if (prev !== null) {
      // Keep the current view stable in client pixels when the reserved right area changes
      // (e.g. resizing the editor overlay).
      const dx = (reservedRightPx - prev) / 2;
      panRef.current = { x: panRef.current.x + dx, y: panRef.current.y };
      // If a pan gesture is active, keep its stored origin consistent with the adjusted pan.
      // Otherwise the next pointermove would overwrite `panRef` and cause a visible jump.
      const interaction = interactionRef.current;
      if (interaction.mode === "panning") {
        interaction.origin = { x: interaction.origin.x + dx, y: interaction.origin.y };
      }
    }
    prevReservedRightPxRef.current = reservedRightPx;
  }, [reservedRightPx]);

  useEffect(() => {
    onPositionsChangeRef.current = onPositionsChange;
  }, [onPositionsChange]);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    onPositionChangeRef.current = onPositionChange;
  }, [onPositionChange]);

  useEffect(() => {
    onCreateRef.current = onCreate;
  }, [onCreate]);

  useEffect(() => {
    onDeleteRef.current = onDelete;
  }, [onDelete]);

  useEffect(() => {
    onContextMenuRef.current = onContextMenu;
  }, [onContextMenu]);

  useEffect(() => {
    shortcutsRef.current = shortcuts;
  }, [shortcuts]);

  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  const visuals = useMemo(() => {
    const map = new Map<NoteId, NodeVisual>();
    notes.forEach((note) => {
      map.set(note.id, measureTitle(note.title, measureCtx));
    });
    return map;
  }, [notes, measureCtx]);

  useEffect(() => {
    visualsRef.current = visuals;
  }, [visuals]);

  const contentById = useMemo(() => {
    const map = new Map<NoteId, boolean>();
    notes.forEach((note) => {
      map.set(note.id, note.body.trim().length > 0);
    });
    return map;
  }, [notes]);

  useEffect(() => {
    contentByIdRef.current = contentById;
  }, [contentById]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      canvasClientSizeRef.current = { width: rect.width, height: rect.height };
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      centerOnPrimaryAnchorIfNeeded();
    };
    resize();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", resize);
      return () => window.removeEventListener("resize", resize);
    }
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [centerOnPrimaryAnchorIfNeeded]);

  useEffect(() => {
    // capture last positions before rebuilding
    nodesRef.current.forEach((body, id) => {
      positionsRef.current.set(id, { x: body.position.x, y: body.position.y });
    });

    const engine = Engine.create({ gravity: { x: 0, y: 0 }, enableSleeping: true });
    const runner = Runner.create();
    engineRef.current = engine;
    runnerRef.current = runner;
    const bodies: Body[] = [];
    const constraints: Constraint[] = [];
    const {
      repelSoftForce,
      repelCloseStrength,
      repelPadding,
      repelMaxForce,
      springDamping,
      springStiffnessExt,
      springLength,
      linkAngleStiffness,
      linkAngleMaxForce,
    } = physicsConfig;
    const edgeCrossPush = Math.min(12, Math.max(2, repelMaxForce * 20));

    const components = buildComponents(notes);
    const anchors = new Set<NoteId>();
    components.forEach((group) => {
      const anchor = Math.min(...group);
      anchors.add(anchor);
    });
    anchorSetRef.current = anchors;

    const bodyMap = new Map<NoteId, NoteBody>();
    const initialPersistedPositions = new Map<NoteId, NotePosition>();
    notes.forEach((note) => {
      const visual = visuals.get(note.id) || { width: MIN_WIDTH, height: 80, lines: [] };
      const stored =
        positionsRef.current.get(note.id) ||
        note.position || { x: (Math.random() - 0.5) * 200, y: (Math.random() - 0.5) * 200 };
      initialPersistedPositions.set(note.id, { x: stored.x, y: stored.y });
      const body = Bodies.rectangle(stored.x, stored.y, visual.width, visual.height, {
        chamfer: { radius: 0 },
        frictionAir: 0.08,
        restitution: 0.5,
        inertia: Infinity,
        isStatic: anchors.has(note.id),
      }) as NoteBody;
      body.noteId = note.id;
      bodyMap.set(note.id, body);
      bodies.push(body);
    });
    lastPersistedPositionsRef.current = initialPersistedPositions;
    positionsDirtyRef.current = false;
    settledSinceMsRef.current = null;
    isFrozenRef.current = false;

    const addedPairs = new Set<string>();
    const edgePairs: Array<[NoteId, NoteId]> = [];
    notes.forEach((note) => {
      note.links.forEach((linkId) => {
        if (linkId === note.id) return;
        const key = note.id < linkId ? `${note.id}-${linkId}` : `${linkId}-${note.id}`;
        if (addedPairs.has(key)) return;
        const bodyA = bodyMap.get(note.id);
        const bodyB = bodyMap.get(linkId);
        if (!bodyA || !bodyB) return;
        const constraint = Constraint.create({
          bodyA,
          bodyB,
          stiffness: springStiffnessExt,
          damping: springDamping,
          length: springLength,
          render: { visible: false },
        });
        constraints.push(constraint);
        edgePairs.push([note.id, linkId]);
        addedPairs.add(key);
      });
    });

    // Keep "rest angles" for links (per directed endpoint). New links seed from current layout.
    {
      const known = linkAnglesRef.current;
      const active = new Set<string>();
      notes.forEach((note) => {
        note.links.forEach((linkId) => {
          if (linkId === note.id) return;
          const key = linkAngleKey(note.id, linkId);
          active.add(key);
          if (known.has(key)) return;
          const a = bodyMap.get(note.id);
          const b = bodyMap.get(linkId);
          if (!a || !b) return;
          const angle = Math.atan2(b.position.y - a.position.y, b.position.x - a.position.x);
          known.set(key, angle);
        });
      });
      // Prune stale edges so the map doesn't grow forever.
      for (const k of known.keys()) {
        if (!active.has(k)) known.delete(k);
      }
    }

    Composite.add(engine.world, [...bodies, ...constraints]);

    const handleBeforeUpdate = () => {
      const bodyList = Array.from(bodyMap.values());
      let anyAwake = false;
      for (const b of bodyList) {
        if (!b.isStatic && !b.isSleeping) {
          anyAwake = true;
          break;
        }
      }
      if (anyAwake) {
        for (let i = 0; i < bodyList.length; i++) {
          for (let j = i + 1; j < bodyList.length; j++) {
            const a = bodyList[i];
            const b = bodyList[j];
            if (a.isStatic && b.isStatic) continue;
            if (a.isSleeping && b.isSleeping) continue;
            const delta = Vector.sub(a.position, b.position);
            const distRaw = Vector.magnitude(delta);
            const dist = Math.max(distRaw, 1e-3);

            const aw = a.bounds.max.x - a.bounds.min.x;
            const ah = a.bounds.max.y - a.bounds.min.y;
            const bw = b.bounds.max.x - b.bounds.min.x;
            const bh = b.bounds.max.y - b.bounds.min.y;
            const ra = 0.5 * Math.hypot(aw, ah);
            const rb = 0.5 * Math.hypot(bw, bh);
            const desired = ra + rb + repelPadding;

            let forceMagnitude = repelSoftForce / (dist * dist);
            if (distRaw < desired) {
              forceMagnitude += repelCloseStrength * (desired - distRaw);
            }
            forceMagnitude = Math.min(forceMagnitude, repelMaxForce);

            let dir = Vector.normalise(delta);
            if (!Number.isFinite(dir.x) || !Number.isFinite(dir.y) || (dir.x === 0 && dir.y === 0)) {
              dir = Vector.normalise({ x: Math.random() - 0.5, y: Math.random() - 0.5 });
            }
            const force = Vector.mult(dir, forceMagnitude);
            Body.applyForce(a, a.position, force);
            Body.applyForce(b, b.position, Vector.neg(force));
          }
        }

        // Link angle memory: each endpoint prefers the direction it was last left pointing at.
        const angleMap = linkAnglesRef.current;
        notes.forEach((note) => {
          note.links.forEach((linkId) => {
            // While dragging a node, don't apply angle forces for edges incident to it.
            const draggingId = draggingIdRef.current;
            if (draggingId !== null && (note.id === draggingId || linkId === draggingId)) return;

            const a = bodyMap.get(note.id);
            const b = bodyMap.get(linkId);
            if (!a || !b) return;
            if (a.isSleeping && b.isSleeping) return;
            const key = linkAngleKey(note.id, linkId);
            const desired = angleMap.get(key);
            if (desired === undefined) return;

            const dx = b.position.x - a.position.x;
            const dy = b.position.y - a.position.y;
            const dist = Math.max(Math.hypot(dx, dy), 1e-3);
            const current = Math.atan2(dy, dx);
            const diff = normalizeAngleRadians(current - desired);
            if (!Number.isFinite(diff) || Math.abs(diff) < 1e-4) return;

            const perp = { x: -dy / dist, y: dx / dist };
            let mag = -linkAngleStiffness * diff * dist;
            if (!Number.isFinite(mag)) return;
            mag = Math.max(-linkAngleMaxForce, Math.min(linkAngleMaxForce, mag));
            const f = Vector.mult(perp, mag);
            Body.applyForce(b, b.position, f);
            Body.applyForce(a, a.position, Vector.neg(f));
          });
        });
      }

      let anyCrossing = false;
      if (edgePairs.length > 1) {
        const draggingId = draggingIdRef.current;
        for (let i = 0; i < edgePairs.length; i++) {
          const [aId, bId] = edgePairs[i];
          if (draggingId !== null && (aId === draggingId || bId === draggingId)) continue;
          const a = bodyMap.get(aId);
          const b = bodyMap.get(bId);
          if (!a || !b) continue;
          for (let j = i + 1; j < edgePairs.length; j++) {
            const [cId, dId] = edgePairs[j];
            if (aId === cId || aId === dId || bId === cId || bId === dId) continue;
            if (draggingId !== null && (cId === draggingId || dId === draggingId)) continue;
            const c = bodyMap.get(cId);
            const d = bodyMap.get(dId);
            if (!c || !d) continue;
            if (!segmentsCross(a.position, b.position, c.position, d.position)) continue;
            anyCrossing = true;

            const midAB = { x: (a.position.x + b.position.x) / 2, y: (a.position.y + b.position.y) / 2 };
            const midCD = { x: (c.position.x + d.position.x) / 2, y: (c.position.y + d.position.y) / 2 };
            let dir = Vector.sub(midAB, midCD);
            if (!Number.isFinite(dir.x) || !Number.isFinite(dir.y) || (dir.x === 0 && dir.y === 0)) {
              const base = Vector.sub(b.position, a.position);
              dir = { x: -base.y, y: base.x };
            }
            dir = Vector.normalise(dir);
            if (!Number.isFinite(dir.x) || !Number.isFinite(dir.y)) continue;
            const push = Vector.mult(dir, edgeCrossPush);

            if (!a.isStatic) {
              Sleeping.set(a, false);
              Body.translate(a, push);
            }
            if (!b.isStatic) {
              Sleeping.set(b, false);
              Body.translate(b, push);
            }
            if (!c.isStatic) {
              Sleeping.set(c, false);
              Body.translate(c, Vector.neg(push));
            }
            if (!d.isStatic) {
              Sleeping.set(d, false);
              Body.translate(d, Vector.neg(push));
            }
          }
        }
      }
      hasCrossingRef.current = anyCrossing;
      if (anyCrossing) {
        isFrozenRef.current = false;
        positionsDirtyRef.current = true;
        settledSinceMsRef.current = null;
      }
    };

    const handleAfterUpdate = () => {
      const cb = onPositionsChangeRef.current;
      if (!cb) return;

      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (lastInteractionMsRef.current === null) {
        lastInteractionMsRef.current = now;
      }
      let maxSpeed = 0;
      let maxAngular = 0;
      for (const b of bodyMap.values()) {
        if (b.isStatic) continue;
        const speed = Math.hypot(b.velocity.x, b.velocity.y);
        if (speed > maxSpeed) maxSpeed = speed;
        const ang = Math.abs(b.angularVelocity);
        if (ang > maxAngular) maxAngular = ang;
      }

      const collectPositions = () => {
        const positions = new Map<NoteId, NotePosition>();
        notesRef.current.forEach((n) => {
          const body = nodesRef.current.get(n.id);
          if (!body) return;
          positions.set(n.id, { x: body.position.x, y: body.position.y });
        });
        return positions;
      };

      const persistPositionsIfChanged = (positions: Map<NoteId, NotePosition>) => {
        if (positions.size === 0) return false;
        if (!positionsDiffer(positions, lastPersistedPositionsRef.current)) return false;
        lastPersistedPositionsRef.current = new Map(positions);
        positionsRef.current = new Map(positions);
        lastPersistAttemptMsRef.current = now;
        positionsDirtyRef.current = false;
        settledSinceMsRef.current = null;
        cb(positions);
        return true;
      };

      if (typeof window !== "undefined" && (window as { __notesDebug?: boolean }).__notesDebug) {
        (window as { __notesDebugPositions?: Array<{ id: NoteId; x: number; y: number }> }).__notesDebugPositions =
          Array.from(collectPositions()).map(([id, pos]) => ({ id, x: pos.x, y: pos.y }));
      }

      if (!positionsDirtyRef.current && now - lastDriftCheckMsRef.current >= 500) {
        lastDriftCheckMsRef.current = now;
        const positions = collectPositions();
        if (positions.size > 0 && positionsDiffer(positions, lastPersistedPositionsRef.current)) {
          positionsDirtyRef.current = true;
          settledSinceMsRef.current = null;
        }
      }

      const hasCrossing = hasCrossingRef.current;
      const stable = !hasCrossing && maxSpeed < 0.12 && maxAngular < 0.12;
      if (!stable) {
        positionsDirtyRef.current = true;
        settledSinceMsRef.current = null;
      } else if (positionsDirtyRef.current) {
        if (settledSinceMsRef.current === null) {
          settledSinceMsRef.current = now;
        } else if (now - settledSinceMsRef.current >= STABLE_PERSIST_MS) {
          if (now - lastPersistAttemptMsRef.current >= PERSIST_THROTTLE_MS) {
            const positions = collectPositions();
            persistPositionsIfChanged(positions);
          }
        }
      }

      const interactionActive =
        interactionRef.current.mode !== "idle" ||
        activePointerIdRef.current !== null ||
        draggingIdRef.current !== null;
      const lastInteraction = lastInteractionMsRef.current;
      const idleForMs = lastInteraction === null ? 0 : now - lastInteraction;
      if (
        !hasCrossing &&
        idleForMs >= IDLE_PERSIST_MS &&
        now - lastPersistAttemptMsRef.current >= IDLE_PERSIST_MS
      ) {
        const positions = collectPositions();
        persistPositionsIfChanged(positions);
      }
      if (
        !hasCrossingRef.current &&
        !isFrozenRef.current &&
        !interactionActive &&
        lastInteraction !== null &&
        now - lastInteraction >= IDLE_FREEZE_MS
      ) {
        freezeAllBodies();
      }
    };

    Events.on(engine, "beforeUpdate", handleBeforeUpdate);
    Events.on(engine, "afterUpdate", handleAfterUpdate);

    nodesRef.current = bodyMap;
    const shouldStartFrozen = !hasUserInteractedRef.current;
    if (shouldStartFrozen) {
      freezeAllBodies();
    }
    centerOnPrimaryAnchorIfNeeded();
    Runner.run(runner, engine);

    return () => {
      Runner.stop(runner);
      Events.off(engine, "beforeUpdate", handleBeforeUpdate);
      Events.off(engine, "afterUpdate", handleAfterUpdate);
      Composite.clear(engine.world, false);
      Engine.clear(engine);
    };
  }, [
    notes,
    visuals,
    physicsConfig,
    centerOnPrimaryAnchorIfNeeded,
    freezeAllBodies,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let frame = 0;
    const draw = () => {
      const colors = themeRef.current;
      const dpr = window.devicePixelRatio || 1;
      const zoom = Number.isFinite(zoomRef.current) && zoomRef.current > 0 ? zoomRef.current : 1;
      const pan = panRef.current;
      const size = canvasClientSizeRef.current;
      const reservedRight = Math.max(0, reservedRightPxRef.current);
      const centerX = (size.width - reservedRight) / 2;
      const centerY = size.height / 2;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = colors.backgroundFill;
      ctx.fillRect(0, 0, size.width, size.height);
      ctx.translate(centerX + pan.x, centerY + pan.y);
      ctx.scale(zoom, zoom);

      // grid
      ctx.save();
      ctx.strokeStyle = colors.gridStroke;
      ctx.lineWidth = 1 / zoom;
      const step = 120;
      const left = (-centerX - pan.x) / zoom;
      const right = ((size.width - centerX) - pan.x) / zoom;
      const top = (-centerY - pan.y) / zoom;
      const bottom = ((size.height - centerY) - pan.y) / zoom;
      const startX = Math.floor(left / step) * step;
      const endX = Math.ceil(right / step) * step;
      const startY = Math.floor(top / step) * step;
      const endY = Math.ceil(bottom / step) * step;

      for (let x = startX; x <= endX; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, startY);
        ctx.lineTo(x, endY);
        ctx.stroke();
      }
      for (let y = startY; y <= endY; y += step) {
        ctx.beginPath();
        ctx.moveTo(startX, y);
        ctx.lineTo(endX, y);
        ctx.stroke();
      }
      ctx.restore();

      // links
      ctx.strokeStyle = colors.linkStroke;
      ctx.lineWidth = 2 / zoom;
      notesRef.current.forEach((note) => {
        note.links.forEach((linkId) => {
          if (note.id < linkId) {
            const a = nodesRef.current.get(note.id);
            const b = nodesRef.current.get(linkId);
            if (!a || !b) return;
            ctx.beginPath();
            ctx.moveTo(a.position.x, a.position.y);
            ctx.lineTo(b.position.x, b.position.y);
            ctx.stroke();
          }
        });
      });

      // nodes
      ctx.font = FONT;
      notesRef.current.forEach((note) => {
        const body = nodesRef.current.get(note.id);
        const visual = visualsRef.current.get(note.id);
        if (!body || !visual) return;
        const isSelected = selectedRef.current === note.id;
        const isAnchor = anchorSetRef.current.has(note.id);
        const hasContent = contentByIdRef.current.get(note.id) ?? false;
        const isEmpty = !hasContent;

        const nodeX = Math.round(body.position.x);
        const nodeY = Math.round(body.position.y);

        ctx.save();
        ctx.translate(nodeX, nodeY);
        roundRect(ctx, visual.width, visual.height);
        ctx.fillStyle = isSelected
          ? colors.nodeFillSelected
          : isAnchor
            ? colors.nodeFillAnchor
            : isEmpty
              ? colors.nodeFillEmpty
              : colors.nodeFill;
        ctx.fill();
        ctx.strokeStyle = isSelected ? colors.nodeStrokeSelected : colors.nodeStroke;
        ctx.lineWidth = 2 / zoom;
        ctx.stroke();

        // number text (no background)
        ctx.fillStyle = isSelected ? colors.nodeTextSelected : colors.nodeText;
        ctx.textBaseline = "top";
        ctx.textAlign = "left";
        ctx.font = "12px 'Space Grotesk', 'DM Sans', sans-serif";
        const idX = Math.round(-visual.width / 2 + PADDING);
        const idY = Math.round(-visual.height / 2 + PADDING - 2);
        ctx.fillText(`#${note.id}`, idX, idY);

        ctx.fillStyle = isSelected ? colors.nodeTextSelected : colors.nodeText;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.font = FONT;
        const startY = -visual.height / 2 + PADDING + 18;
        visual.lines.forEach((line, idx) => {
          const textX = Math.round(-visual.width / 2 + PADDING);
          const textY = Math.round(startY + idx * LINE_HEIGHT);
          ctx.fillText(line, textX, textY);
        });

        ctx.restore();
      });

      ctx.restore();
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [canvasRef]);

  useEffect(() => {
    // Selection can change via global shortcuts (e.g. Escape) without pointer events.
    // No-op: physics is always running; selection changes shouldn't affect layout.
  }, [selectedId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const clearLongPress = () => {
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      longPressRef.current = null;
    };

    const triggerContextMenu = (payload: { kind: "canvas"; clientX: number; clientY: number } | { kind: "note"; id: NoteId; clientX: number; clientY: number }) => {
      const cb = onContextMenuRef.current;
      if (!cb) return;
      cb(payload);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (matchesAnyChord(event, shortcutsRef.current.deleteSelected)) {
        const id = selectedRef.current;
        if (id === undefined) return;
        event.preventDefault();
        onDeleteRef.current(id);
        return;
      }
      if (!matchesAnyChord(event, shortcutsRef.current.createNote)) return;
      event.preventDefault();
      noteInteraction(typeof performance !== "undefined" ? performance.now() : Date.now());
      const selected = selectedRef.current;
      const spawnAt =
        lastPointerWorldRef.current ??
        (() => {
          const zoom = Number.isFinite(zoomRef.current) && zoomRef.current > 0 ? zoomRef.current : 1;
          return {
            x: -panRef.current.x / zoom,
            y: -panRef.current.y / zoom,
          };
        })();
      onCreateRef.current(selected, spawnAt);
    };

    const getWorldPoint = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      // Keep client size in sync even if ResizeObserver lags (also avoids bad drag saves).
      if (rect.width > 0 && rect.height > 0) {
        canvasClientSizeRef.current = { width: rect.width, height: rect.height };
      }
      const size = canvasClientSizeRef.current;
      const reservedRight = Math.max(0, reservedRightPxRef.current);
      const centerX = (size.width - reservedRight) / 2;
      const centerY = size.height / 2;
      const x = clientX - rect.left - centerX - panRef.current.x;
      const y = clientY - rect.top - centerY - panRef.current.y;
      return {
        x: x / zoomRef.current,
        y: y / zoomRef.current,
      };
    };

    const pickBody = (point: { x: number; y: number }): NoteBody | null => {
      const bodies = Array.from(nodesRef.current.values());
      const found = Query.point(bodies, point) as NoteBody[];
      return found[0] || null;
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      canvas.focus();
      pointerPositionsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const pointerCount = pointerPositionsRef.current.size;
      activePointerIdRef.current = pointerCount === 1 ? event.pointerId : null;
      noteInteraction(typeof performance !== "undefined" ? performance.now() : Date.now());
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // ignore; best-effort (e.g. unsupported environments)
      }
      if (pointerCount >= 2) {
        const positions = Array.from(pointerPositionsRef.current.values());
        const a = positions[0];
        const b = positions[1];
        if (a && b) {
          const rect = canvas.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            canvasClientSizeRef.current = { width: rect.width, height: rect.height };
          }
          const size = canvasClientSizeRef.current;
          const reservedRight = Math.max(0, reservedRightPxRef.current);
          const originX = (size.width - reservedRight) / 2;
          const originY = size.height / 2;
          const centerX = (a.x + b.x) / 2;
          const centerY = (a.y + b.y) / 2;
          const startZoom = Number.isFinite(zoomRef.current) && zoomRef.current > 0 ? zoomRef.current : 1;
          const startWorldX = (centerX - rect.left - originX - panRef.current.x) / startZoom;
          const startWorldY = (centerY - rect.top - originY - panRef.current.y) / startZoom;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          pinchRef.current = {
            startDist: Math.max(1, Math.hypot(dx, dy)),
            startZoom,
            startPan: { ...panRef.current },
            startWorld: { x: startWorldX, y: startWorldY },
            origin: { x: originX, y: originY },
          };
          if (interactionRef.current.mode === "dragging") {
            const { body, wasStatic } = interactionRef.current;
            if (body.isStatic !== wasStatic) Body.setStatic(body, wasStatic);
            draggingIdRef.current = null;
          }
          interactionRef.current = { mode: "idle" };
          hasUserViewManipulationRef.current = true;
          return;
        }
      }
      const world = getWorldPoint(event.clientX, event.clientY);
      lastPointerWorldRef.current = world;
      const body = pickBody(world);
      const pointerType = event.pointerType;
      const isTouchLike = pointerType === "touch" || pointerType === "pen";

      if (isTouchLike && pointerCount === 1) {
        tapDownRef.current = {
          pointerId: event.pointerId,
          startClient: { x: event.clientX, y: event.clientY },
          kind: body?.noteId !== undefined ? "note" : "canvas",
          moved: false,
        };
      } else {
        tapDownRef.current = null;
      }

      // Long press context menu (mobile/webview).
      // We schedule this before setting up drag/pan interaction so the user can hold without moving.
      if (isTouchLike && pointerCount === 1) {
        clearLongPress();
        const noteId = body?.noteId;
        if (noteId !== undefined) {
          longPressRef.current = {
            pointerId: event.pointerId,
            startClient: { x: event.clientX, y: event.clientY },
            kind: "note",
            noteId,
            fired: false,
          };
        } else {
          longPressRef.current = {
            pointerId: event.pointerId,
            startClient: { x: event.clientX, y: event.clientY },
            kind: "canvas",
            fired: false,
          };
        }
        longPressTimerRef.current = window.setTimeout(() => {
          const lp = longPressRef.current;
          if (!lp) return;
          lp.fired = true;
          // Cancel any interaction so the menu doesn't fight panning/dragging.
          const interaction = interactionRef.current;
          if (interaction.mode === "dragging") {
            const { body: draggedBody, wasStatic } = interaction;
            if (draggedBody.isStatic !== wasStatic) Body.setStatic(draggedBody, wasStatic);
          }
          activePointerIdRef.current = null;
          draggingIdRef.current = null;
          interactionRef.current = { mode: "idle" };
          if (lp.kind === "note" && lp.noteId !== undefined) {
            triggerContextMenu({ kind: "note", id: lp.noteId, clientX: lp.startClient.x, clientY: lp.startClient.y });
          } else {
            triggerContextMenu({ kind: "canvas", clientX: lp.startClient.x, clientY: lp.startClient.y });
          }
        }, LONG_PRESS_MS);
      }

      if (body) {
        const id = body.noteId;
        if (id === undefined) {
          activePointerIdRef.current = null;
          try {
            canvas.releasePointerCapture(event.pointerId);
          } catch {
            // ignore
          }
          return;
        }
        Sleeping.set(body, false);
        onSelectRef.current(id);
        selectedRef.current = id;
        draggingIdRef.current = id;
        const wasStatic = body.isStatic;
        if (!wasStatic) {
          Body.setStatic(body, true);
        }
        Body.setVelocity(body, { x: 0, y: 0 });
        Body.setAngularVelocity(body, 0);
        // Reset angle memory for incident links so dragging doesn't "snap back".
        setIncidentLinkAnglesBothWays(id, notesRef.current, nodesRef.current, linkAnglesRef.current);
        interactionRef.current = {
          mode: "dragging",
          id,
          body,
          start: world,
          grabOffset: { x: body.position.x - world.x, y: body.position.y - world.y },
          wasStatic,
          moved: false,
        };
        positionsDirtyRef.current = true;
        settledSinceMsRef.current = null;
      } else {
        onSelectRef.current(undefined);
        selectedRef.current = undefined;
        interactionRef.current = {
          mode: "panning",
          origin: { ...panRef.current },
          start: { x: event.clientX, y: event.clientY },
        };
      }
    };

    const handleCanvasPointerMove = (event: PointerEvent) => {
      lastPointerWorldRef.current = getWorldPoint(event.clientX, event.clientY);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (pointerPositionsRef.current.has(event.pointerId)) {
        pointerPositionsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }

      const lp = longPressRef.current;
      if (lp && lp.pointerId === event.pointerId && !lp.fired) {
        const dx = event.clientX - lp.startClient.x;
        const dy = event.clientY - lp.startClient.y;
        if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_PX) {
          clearLongPress();
        }
      }

      const tap = tapDownRef.current;
      if (tap && tap.pointerId === event.pointerId && !tap.moved) {
        const dx = event.clientX - tap.startClient.x;
        const dy = event.clientY - tap.startClient.y;
        if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_PX) {
          tap.moved = true;
          clearLongPress();
        }
      }

      if (pointerPositionsRef.current.size >= 2 && pinchRef.current) {
        const positions = Array.from(pointerPositionsRef.current.values());
        const a = positions[0];
        const b = positions[1];
        if (a && b) {
          const rect = canvas.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            canvasClientSizeRef.current = { width: rect.width, height: rect.height };
          }
          const centerX = (a.x + b.x) / 2;
          const centerY = (a.y + b.y) / 2;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.max(1, Math.hypot(dx, dy));
          const pinch = pinchRef.current;
          const scale = dist / pinch.startDist;
          const nextZoom = Math.min(2.2, Math.max(0.4, pinch.startZoom * scale));
          const originX = pinch.origin.x;
          const originY = pinch.origin.y;
          const nextPanX = centerX - rect.left - originX - pinch.startWorld.x * nextZoom;
          const nextPanY = centerY - rect.top - originY - pinch.startWorld.y * nextZoom;
          zoomRef.current = nextZoom;
          panRef.current = { x: nextPanX, y: nextPanY };
          hasUserViewManipulationRef.current = true;
          noteInteraction(typeof performance !== "undefined" ? performance.now() : Date.now());
        }
        return;
      }
      if (activePointerIdRef.current !== event.pointerId) return;
      // If we missed `pointerup` for any reason, don't keep panning/dragging forever.
      if (event.pointerType === "mouse" && (event.buttons & 1) === 0) {
        try {
          canvas.releasePointerCapture(event.pointerId);
        } catch {
          // ignore
        }
        activePointerIdRef.current = null;
        draggingIdRef.current = null;
        interactionRef.current = { mode: "idle" };
        return;
      }
      const mode = interactionRef.current;
      if (mode.mode === "dragging") {
        const world = getWorldPoint(event.clientX, event.clientY);
        if (!mode.moved && Math.hypot(world.x - mode.start.x, world.y - mode.start.y) < 4) return;
        if (!mode.moved) {
          mode.moved = true;
          clearLongPress();
          hasUserViewManipulationRef.current = true;
        }
        noteInteraction(typeof performance !== "undefined" ? performance.now() : Date.now());
        const next = { x: world.x + mode.grabOffset.x, y: world.y + mode.grabOffset.y };
        Body.setPosition(mode.body, next);
        Body.setVelocity(mode.body, { x: 0, y: 0 });
        Body.setAngularVelocity(mode.body, 0);
      } else if (mode.mode === "panning") {
        const dx = event.clientX - mode.start.x;
        const dy = event.clientY - mode.start.y;
        if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_PX) clearLongPress();
        hasUserViewManipulationRef.current = true;
        noteInteraction(typeof performance !== "undefined" ? performance.now() : Date.now());
        panRef.current = { x: mode.origin.x + dx, y: mode.origin.y + dy };
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      pointerPositionsRef.current.delete(event.pointerId);
      if (pinchRef.current && pointerPositionsRef.current.size < 2) {
        pinchRef.current = null;
      }
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch {
        // ignore
      }

      const lp = longPressRef.current;
      const longPressFired = !!(lp && lp.pointerId === event.pointerId && lp.fired);
      clearLongPress();
      if (longPressFired) {
        // Don't treat this as a tap/click.
        activePointerIdRef.current = null;
        draggingIdRef.current = null;
        interactionRef.current = { mode: "idle" };
        return;
      }

      if (activePointerIdRef.current === null) return;
      if (event.pointerId !== activePointerIdRef.current) return;
      activePointerIdRef.current = null;
      const mode = interactionRef.current;
      if (mode.mode === "dragging") {
        interactionRef.current = { mode: "idle" };
        Body.setVelocity(mode.body, { x: 0, y: 0 });
        Body.setAngularVelocity(mode.body, 0);
        draggingIdRef.current = null;
        const body = mode.body;
        const id = body.noteId;
        if (mode.moved && id !== undefined) {
          onPositionChangeRef.current(id, { x: body.position.x, y: body.position.y });
          positionsRef.current.set(id, { x: body.position.x, y: body.position.y });
          // Finalize incident link angles at drop.
          setIncidentLinkAnglesBothWays(id, notesRef.current, nodesRef.current, linkAnglesRef.current);
          positionsDirtyRef.current = true;
        }
        if (body.isStatic !== mode.wasStatic) Body.setStatic(body, mode.wasStatic);
      } else {
        draggingIdRef.current = null;
        interactionRef.current = { mode: "idle" };
      }
      if (positionsDirtyRef.current) {
        settledSinceMsRef.current = null;
      }

      const tap = tapDownRef.current;
      const pointerType = event.pointerType;
      const isTouchLike = pointerType === "touch" || pointerType === "pen";
      if (
        isTouchLike &&
        tap &&
        tap.pointerId === event.pointerId &&
        tap.kind === "canvas" &&
        !tap.moved &&
        pointerPositionsRef.current.size === 0
      ) {
        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
        const prev = lastTapRef.current;
        if (
          prev &&
          prev.onEmptyCanvas &&
          now - prev.atMs <= DOUBLE_TAP_MS &&
          Math.hypot(event.clientX - prev.client.x, event.clientY - prev.client.y) <= DOUBLE_TAP_MOVE_PX
        ) {
          lastTapRef.current = null;
          noteInteraction(now);
          const spawnAt = getWorldPoint(event.clientX, event.clientY);
          onCreateRef.current(undefined, spawnAt);
        } else {
          lastTapRef.current = { atMs: now, client: { x: event.clientX, y: event.clientY }, onEmptyCanvas: true };
        }
      }
      if (tap && tap.pointerId === event.pointerId) {
        tapDownRef.current = null;
      }
    };

    const handleContextMenu = (event: Event) => {
      event.preventDefault();
    };

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      hasUserViewManipulationRef.current = true;
      noteInteraction(typeof performance !== "undefined" ? performance.now() : Date.now());
      const delta = Math.sign(event.deltaY) * 0.1;
      const nextZoom = Math.min(2.2, Math.max(0.4, zoomRef.current * (1 - delta)));
      const rect = canvas.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        canvasClientSizeRef.current = { width: rect.width, height: rect.height };
      }
      const size = canvasClientSizeRef.current;
      const reservedRight = Math.max(0, reservedRightPxRef.current);
      const originX = (size.width - reservedRight) / 2;
      const originY = size.height / 2;
      const centerX = event.clientX - rect.left - originX - panRef.current.x;
      const centerY = event.clientY - rect.top - originY - panRef.current.y;
      const scale = nextZoom / zoomRef.current;
      panRef.current = {
        x: panRef.current.x + centerX * (1 - scale),
        y: panRef.current.y + centerY * (1 - scale),
      };
      zoomRef.current = nextZoom;
    };

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handleCanvasPointerMove);
    canvas.addEventListener("keydown", handleKeyDown);
    canvas.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    canvas.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handleCanvasPointerMove);
      canvas.removeEventListener("keydown", handleKeyDown);
      canvas.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      canvas.removeEventListener("wheel", handleWheel);
      clearLongPress();
    };
  }, [noteInteraction]);

  const setCanvasRef = (el: HTMLCanvasElement | null) => {
    canvasRef.current = el;
    if (!ref) return;
    if (typeof ref === "function") ref(el);
    else (ref as import("react").MutableRefObject<HTMLCanvasElement | null>).current = el;
  };

  return <canvas ref={setCanvasRef} className="graph-canvas" tabIndex={0} />;
});

export default GraphCanvas;
