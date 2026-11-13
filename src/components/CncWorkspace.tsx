// The CNC workspace: draw an outline flat, with curves, over a reference image if you have
// one, set the stock thickness, and bring it into the model as a part. It covers the window
// on purpose: nothing in the model can change while a drawing is open, and it asks for no
// native permission beyond the file picker the app already has (ADR-0014).
//
// The drawing is in metres, y up. Everything here is edit state; the rules for what a drawing
// can become are in src/cnc/design.ts and tested there.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement, type WheelEvent as ReactWheelEvent } from "react";
import type { EditResult } from "../kernel/client";
import type { DocState, KernelOp } from "../kernel/types";
import { IMAGE_TYPES, pickFile } from "../io/files";
import { imageSize } from "../lib/imageSize";
import { toBase64 } from "../lib/looks";
import { formatLength, type UnitSystem } from "../lib/units";
import { parseVcb } from "../lib/vcb";
import {
  add2,
  alignOpposite,
  analyse,
  bendSegment,
  boundsOf,
  circleNodes,
  emptyDesign,
  insertNode,
  insideNodes,
  offsetPoint,
  sideOffset,
  mapPath,
  movePath,
  nearestOnPath,
  parseDesign,
  partOps,
  pathBounds,
  pathData,
  pointType,
  rectNodes,
  reflected,
  relaxAuto,
  roundCorner,
  setPointType,
  sub2,
  toggleSmooth,
  type CncDesign,
  type CncGuide,
  type CncNode,
  type CncPath,
  type PointType,
  type Pt,
} from "../cnc/design";
import { fitStroke } from "../cnc/fit";
import { snapAlong, snapPoint, type Snap, type SnapScene } from "../cnc/snap";
import { angleOf, dirOf, parsePolar, turnBetween } from "../cnc/polar";
import { arcNodes, bulgeForRadius, bulgeFromPoint, eraseSegments, joinEnds, offsetPath, offsetProblem, sideOf } from "../cnc/edit";
import { modeFor } from "../lib/entities";
import { platformText } from "../lib/keys";
import { ModifierTap } from "../lib/modifierTap";
import { FeedbackDialog } from "./FeedbackDialog";
import { actionForEvent, shortcutsFor, useShortcutsVersion } from "../lib/shortcuts";
import { startsValueEntry, type BuiltinToolId } from "../lib/tools";
import { parseScale } from "../tools/scale";
import { isTrackpadWheel } from "../viewport/navmath";
import { TOOL_GLYPHS } from "./glyphs";
import { useDialogFocus } from "./useDialogFocus";

type ToolName = "select" | "erase" | "node" | "pen" | "arc" | "rect" | "circle" | "curve" | "pencil" | "move" | "rotate" | "scale" | "offset" | "tape" | "image";

interface ToolSpec {
  id: ToolName;
  label: string;
  /** The model's tool this one stands in for: it takes that tool's key, as you have set it. */
  model?: BuiltinToolId;
  /** A key of the workspace's own, for tools the model does not have. */
  own?: string;
  hint: string;
  glyph: ReactElement;
  /** What the value box takes here; none: it is hidden. */
  value?: string;
}

const NODE_GLYPH = <path d="M5 3l14 9-6 1-3 6z" fill="currentColor" />;

/** Grouped as the model's rail is, with the same glyphs where the tool is the same. */
const TOOL_GROUPS: ToolSpec[][] = [
  [
    { id: "select", label: "Select", model: "select", hint: "Click a shape or a point. Drag for a window (left to right) or a crossing box (right to left). Shift adds, Ctrl toggles. Double-click a shape to edit its curves.", glyph: TOOL_GLYPHS.select },
    { id: "erase", label: "Erase", model: "erase", hint: "Click a line to erase it, or drag across several. A closed shape opens where a line goes. Reference lines erase too.", glyph: TOOL_GLYPHS.erase },
    { id: "node", label: "Points", own: "N", hint: "Drag a point or a handle, or drag a line to bend it. Alt (Option) on a handle moves one side only. Double-click a point to switch corner and curve; double-click a line to add a point.", glyph: NODE_GLYPH },
  ],
  [
    { id: "pen", label: "Line", model: "line", value: "Length", hint: "Click to start, then each corner; press and drag for a curve. Type a length and press Enter. Click the start to close. Lines that meet end to end join.", glyph: TOOL_GLYPHS.line },
    { id: "arc", label: "Arc", model: "arc", value: "Bulge", hint: "Click both ends, then the bulge. Type the bulge, or 12r for a radius.", glyph: TOOL_GLYPHS.arc },
    { id: "rect", label: "Rect", model: "rect", value: "Dimensions", hint: "Click two corners, or drag. Type 24,12 for an exact size.", glyph: TOOL_GLYPHS.rect },
    { id: "circle", label: "Circle", model: "circle", value: "Radius", hint: "Click the centre, then the radius, or drag. Type a radius and press Enter.", glyph: TOOL_GLYPHS.circle },
    { id: "curve", label: "Curve", own: "U", hint: "Click points and a smooth curve runs through them. Double-click, or Alt-click (Option), for a corner. Drag any point to reshape. Click the first point to close.", glyph: (<><path d="M3 17c4-12 8-12 9-5s5 7 9-5" /><circle cx="3" cy="17" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="21" cy="7" r="1.4" /></>) },
    { id: "pencil", label: "Pencil", own: "B", hint: "Draw freehand, and the stroke becomes editable curves. End where you started to close the shape.", glyph: (<><path d="M4 20l1-4L16 5l3 3L8 19z" /><path d="M14 7l3 3" /></>) },
  ],
  [
    { id: "move", label: "Move", model: "move", value: "Distance", hint: "Click, move, click (or drag). Type a distance. Tap Ctrl to copy, then type x3 for an array. Arrow keys lock across or up.", glyph: TOOL_GLYPHS.move },
    { id: "rotate", label: "Rotate", model: "rotate", value: "Angle", hint: "Click the centre, then where the angle starts, then where it ends. Type 90. Tap Ctrl to copy.", glyph: TOOL_GLYPHS.rotate },
    { id: "scale", label: "Scale", model: "scale", value: "Scale", hint: "Drag a grip of what is selected. Shift keeps the proportions; Ctrl scales about the centre. Type 2 for twice the size, or 24in for a size.", glyph: TOOL_GLYPHS.scale },
    { id: "offset", label: "Offset", model: "offset", value: "Distance", hint: "Click a shape, move in or out, and click. Type 3/4.", glyph: TOOL_GLYPHS.offset },
  ],
  [
    { id: "tape", label: "Tape", model: "tape", value: "Distance", hint: "Click a straight line or an axis, then move away and click, or type the distance, for a parallel reference line. Click two points for one through both. Tap Ctrl to measure only.", glyph: TOOL_GLYPHS.tape },
    { id: "image", label: "Image", own: "I", hint: "Drag the reference image to place it.", glyph: (<><rect x="3.5" y="5" width="17" height="14" rx="1" /><path d="M4 16l5-5 4 4 3-3 4 4" /><circle cx="15.5" cy="9" r="1.2" /></>) },
  ],
];
const TOOLS = TOOL_GROUPS.flat();

/** The key shown on a tool's button: the model's, as you have set it, or the workspace's own. */
function keyOf(t: ToolSpec): string {
  if (t.own) return t.own;
  const k = t.model ? shortcutsFor(t.model)[0] : undefined;
  return k === "Space" ? "␣" : (k ?? "");
}

/** The tool a key press picks: the model's keys first, so a key does here what it does there. */
function toolForKey(e: KeyboardEvent): ToolName | undefined {
  const action = actionForEvent(e);
  const mirror = action ? TOOLS.find((t) => t.model === action)?.id : undefined;
  if (mirror) return mirror;
  // A model key with no tool here (B is Paint there) is free for the workspace's own.
  if (e.metaKey || e.ctrlKey || e.altKey) return undefined;
  return TOOLS.find((t) => t.own && t.own.toLowerCase() === e.key.toLowerCase())?.id;
}

const HIT_PX = 9;
const MIN_ZOOM = 40;
const MAX_ZOOM = 60_000;
const IN = 0.0254;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_IMAGE_PX = 4096;

/** An angle as the protractor shows it: a tenth of a degree. */
const degrees = (d: number) => `${Math.round(d * 10) / 10}°`;
const POLAR_STEPS = [5, 10, 15, 22.5, 30, 45, 90];
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const metric = (u: UnitSystem) => u === "mm" || u === "cm" || u === "m";

/** Grid spacing that reads at this zoom. */
function gridStep(scale: number, units: UnitSystem): { minor: number; major: number } {
  const steps = metric(units) ? [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1] : [IN / 16, IN / 8, IN / 4, IN / 2, IN, 6 * IN, 12 * IN, 48 * IN];
  const minor = steps.find((s) => s * scale >= 14) ?? steps[steps.length - 1];
  const major = steps.find((s) => s > minor && s * scale >= 70) ?? minor * 4;
  return { minor, major };
}

interface View {
  cx: number;
  cy: number;
  scale: number;
}

interface NodeRef {
  path: number;
  node: number;
}

interface Selection {
  paths: number[];
  nodes: NodeRef[];
}

const NOTHING: Selection = { paths: [], nodes: [] };
const nodeKey = (r: NodeRef) => `${r.path}:${r.node}`;

type Box = { min: Pt; max: Pt };

/** The Tape, between clicks: pulling a reference line off a line, from a point, or measuring
 * square to a line. */
type Tape =
  | { mode: "guide"; base: Pt; dir: Pt; at: Pt; pressX: number; pressY: number }
  | { mode: "measure"; a: Pt; b: Pt | null; pressX: number; pressY: number }
  | { mode: "square"; base: Pt; dir: Pt; b: Pt | null; pressX: number; pressY: number };

/** What the Tape makes: reference lines, or measurements that add nothing (SketchUp's Tape
 * switches the same way, with a tap of Ctrl). */
type TapeMode = "reference" | "measure";
const TAPE_MODE_KEY = "sawhorse.cnc.tapeMode";
function storedTapeMode(): TapeMode {
  try {
    return localStorage.getItem(TAPE_MODE_KEY) === "measure" ? "measure" : "reference";
  } catch {
    return "reference";
  }
}

/** A gesture of the model's transform tools, or the Arc's clicks, between presses. */
type Gesture =
  | { kind: "move"; base: CncDesign; subject: Selection; from: Pt; to: Pt; press: Pt }
  | { kind: "rotate"; base: CncDesign; subject: Selection; centre: Pt; ref: Pt | null; angle: number }
  | { kind: "scale"; base: CncDesign; subject: Selection; box: Box; hx: number; hy: number; sx: number; sy: number; centre: boolean; press: Pt }
  | { kind: "offset"; base: CncDesign; source: CncPath; d: number }
  | { kind: "arc"; a: Pt; b: Pt | null; bulge: number };

/** The last transform done, which a typed value changes, or turns into an array after a copy. */
type Last =
  | { kind: "move"; base: CncDesign; subject: Selection; delta: Pt; copy: boolean; result: CncDesign }
  | { kind: "rotate"; base: CncDesign; subject: Selection; centre: Pt; angle: number; copy: boolean; result: CncDesign }
  | { kind: "scale"; base: CncDesign; subject: Selection; anchor: Pt; sx: number; sy: number; result: CncDesign }
  | { kind: "offset"; base: CncDesign; source: CncPath; d: number; result: CncDesign };

type Drag =
  | { kind: "pan"; x: number; y: number; view: View }
  | { kind: "select"; at: Pt; x: number; y: number; box: boolean }
  | { kind: "erase"; segs: Map<number, Set<number>>; guides: Set<number> }
  | { kind: "nodes"; starts: (NodeRef & { start: CncNode })[]; at: Pt }
  | { kind: "handle"; path: number; node: number; side: "in" | "out" }
  | { kind: "bend"; path: number; segment: number; t: number; start: CncPath; at: Pt }
  | { kind: "paths"; starts: CncPath[]; at: Pt }
  | { kind: "scale"; starts: CncPath[]; box: Box; hx: number; hy: number }
  | { kind: "marquee"; at: Pt; add: boolean }
  | { kind: "mirror" }
  | { kind: "guide"; id: number; start: Pt; at: Pt }
  | { kind: "image"; at: Pt; x: number; y: number }
  | { kind: "pen"; path: number; node: number; at: Pt; close?: boolean }
  | { kind: "pencil"; points: Pt[] }
  | { kind: "rect"; id: number; at: Pt; placing?: boolean }
  | { kind: "circle"; id: number; at: Pt; placing?: boolean };

const rotation = (c: Pt, angle: number) => {
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  return (p: Pt): Pt => [c[0] + (p[0] - c[0]) * cos - (p[1] - c[1]) * sin, c[1] + (p[0] - c[0]) * sin + (p[1] - c[1]) * cos];
};

/**
 * `fs` done to what is selected: shapes, or points of shapes. A copy leaves the originals and
 * adds one copy for each of `fs` (more than one is an array); points are never copied.
 */
function transformed(base: CncDesign, subject: Selection, fs: ((p: Pt) => Pt)[], copy: boolean): { design: CncDesign; made: number[] } {
  if (copy && subject.paths.length) {
    let id = base.nextId;
    const made: number[] = [];
    const copies: CncPath[] = [];
    for (const f of fs) {
      for (const p of base.paths.filter((x) => subject.paths.includes(x.id))) {
        made.push(id);
        copies.push({ ...mapPath(p, f), id: id++ });
      }
    }
    return { design: { ...base, nextId: id, paths: [...base.paths, ...copies] }, made };
  }
  const f = fs[0];
  const paths = base.paths.map((p) => {
    if (subject.paths.includes(p.id)) return mapPath(p, f);
    const picked = new Set(subject.nodes.filter((r) => r.path === p.id).map((r) => r.node));
    if (!picked.size) return p;
    return { ...p, nodes: p.nodes.map((n, i) => (picked.has(i) ? { ...n, p: f(n.p), ...(n.in ? { in: f(n.in) } : {}), ...(n.out ? { out: f(n.out) } : {}) } : n)) };
  });
  return { design: { ...base, paths }, made: [] };
}

/** Whether a shape lies wholly inside a box (a window) or touches it (a crossing box). */
function inBox(path: CncPath, box: Box, crossing: boolean): boolean {
  const b = boundsOf(path);
  if (!b) return false;
  if (!crossing) return b.min[0] >= box.min[0] && b.max[0] <= box.max[0] && b.min[1] >= box.min[1] && b.max[1] <= box.max[1];
  if (b.max[0] < box.min[0] || b.min[0] > box.max[0] || b.max[1] < box.min[1] || b.min[1] > box.max[1]) return false;
  const inside = (p: Pt) => p[0] >= box.min[0] && p[0] <= box.max[0] && p[1] >= box.min[1] && p[1] <= box.max[1];
  const samples = flattenAll(path);
  if (samples.some(inside)) return true;
  // A box drawn inside a shape's fill touches it too.
  return path.closed && insideNodes(path.nodes, [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2]);
}

function flattenAll(path: CncPath): Pt[] {
  const out: Pt[] = [];
  const n = path.nodes.length;
  const count = path.closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const a = path.nodes[i];
    const b = path.nodes[(i + 1) % n];
    for (let k = 0; k < 16; k++) {
      const t = k / 16;
      const s = 1 - t;
      const [p0, p1, p2, p3] = [a.p, a.out ?? a.p, b.in ?? b.p, b.p];
      out.push([s * s * s * p0[0] + 3 * s * s * t * p1[0] + 3 * s * t * t * p2[0] + t * t * t * p3[0], s * s * s * p0[1] + 3 * s * s * t * p1[1] + 3 * s * t * t * p2[1] + t * t * t * p3[1]]);
    }
  }
  if (path.nodes.length) out.push(path.nodes[path.nodes.length - 1].p);
  return out;
}

/** The SVG for one segment of a path. */
function segmentData(path: CncPath, i: number, at: (p: Pt) => Pt): string {
  const a = path.nodes[i];
  const b = path.nodes[(i + 1) % path.nodes.length];
  return pathData([{ p: a.p, ...(a.out ? { out: a.out } : {}) }, { p: b.p, ...(b.in ? { in: b.in } : {}) }], false, at);
}

const BOX_HANDLES: [number, number][] = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

function unionBounds(paths: CncPath[]): Box | null {
  let out: Box | null = null;
  for (const p of paths) {
    const b = boundsOf(p);
    if (!b) continue;
    out = out ? { min: [Math.min(out.min[0], b.min[0]), Math.min(out.min[1], b.min[1])], max: [Math.max(out.max[0], b.max[0]), Math.max(out.max[1], b.max[1])] } : b;
  }
  return out;
}

interface PendingImage {
  bytes: Uint8Array;
  mime: string;
  url: string;
}

export interface CncWorkspaceProps {
  state: DocState | null;
  units: UnitSystem;
  apply: (op: KernelOp, describe: (r: EditResult) => string) => Promise<EditResult | null>;
  lastError: () => string | null;
  imageHref: (path: string) => string | null;
  /** Parts are in the model: the workspace has closed, and they follow the cursor. */
  onPlaced: (objects: number[], text: string) => void;
  onClose: (text?: string) => void;
  /** The open model, for the feedback log's entry. */
  feedback: { file: string; edited: boolean };
}

function blank(units: UnitSystem, n: number): CncDesign {
  return emptyDesign(`Drawing ${n}`, metric(units) ? 0.018 : 0.75 * IN);
}

function outcomeObjects(r: EditResult): number[] {
  const o = r.outcome;
  if (o.kind === "object_created") return [o.object];
  if (o.kind === "batch") return o.outcomes.flatMap((x) => (x.kind === "object_created" ? [x.object] : []));
  return [];
}

export function CncWorkspace({ state, units, apply, lastError, imageHref, onPlaced, onClose, feedback }: CncWorkspaceProps) {
  const root = useDialogFocus();
  const board = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const saved = useMemo(() => (state?.cnc_drawings ?? []).flatMap((d) => {
    const design = parseDesign(d.json);
    return design ? [{ id: d.id, design }] : [];
  }), [state?.cnc_drawings]);
  const damaged = (state?.cnc_drawings?.length ?? 0) - saved.length;

  const nextDrawingId = useCallback(() => Math.max(0, ...(state?.cnc_drawings ?? []).map((d) => d.id)) + 1, [state?.cnc_drawings]);
  const [drawingId, setDrawingId] = useState<number>(() => saved[saved.length - 1]?.id ?? nextDrawingId());
  const [design, setDesignState] = useState<CncDesign>(() => saved[saved.length - 1]?.design ?? blank(units, 1));
  const [keptJson, setKeptJson] = useState<string | null>(() => (saved.length ? JSON.stringify(saved[saved.length - 1].design) : null));
  const designRef = useRef(design);
  designRef.current = design;
  const past = useRef<CncDesign[]>([]);
  const future = useRef<CncDesign[]>([]);
  const [, bump] = useState(0);

  const [tool, setToolState] = useState<ToolName>(design.paths.length ? "select" : "pen");
  const [selection, setSelection] = useState<Selection>(NOTHING);
  const [penPath, setPenPath] = useState<number | null>(null);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [snap, setSnap] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const [view, setView] = useState<View>({ cx: 0, cy: 0, scale: 1200 });
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [measuring, setMeasuring] = useState<{ a: Pt | null; b: Pt | null } | null>(null);
  const [measureText, setMeasureText] = useState("");
  const [busy, setBusy] = useState(false);
  const [guides, setGuides] = useState<{ x?: number; y?: number } | null>(null);
  const [marquee, setMarquee] = useState<(Box & { crossing?: boolean }) | null>(null);
  const [pencilLive, setPencilLive] = useState<Pt[] | null>(null);
  const [smoothing, setSmoothing] = useState(3);
  const [smart, setSmart] = useState(true);
  // The protractor, as AutoCAD's polar tracking: aims lock to whole steps of this many degrees.
  const [protractor, setProtractor] = useState(true);
  const [polarStep, setPolarStep] = useState(15);
  // Values typed and locked with Tab, as in AutoCAD's and Fusion's dynamic input.
  const [lockAngle, setLockAngle] = useState<number | null>(null);
  const [lockLength, setLockLength] = useState<number | null>(null);
  const [angleText, setAngleText] = useState<string | null>(null);
  const angleInput = useRef<HTMLInputElement>(null);
  const [shiftDown, setShiftDown] = useState(false);
  const [tapeMode, setTapeModeState] = useState<TapeMode>(storedTapeMode);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [hover, setHover] = useState<"node" | "line" | "first" | "handle" | "fill" | "box" | "reference" | null>(null);
  const [tape, setTape] = useState<Tape | null>(null);
  const [selectedGuide, setSelectedGuide] = useState<number | null>(null);
  const drag = useRef<Drag | null>(null);
  const [gesture, setGestureState] = useState<Gesture | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const setGesture = useCallback((g: Gesture | null) => {
    gestureRef.current = g;
    setGestureState(g);
  }, []);
  const [copy, setCopy] = useState(false);
  const last = useRef<Last | null>(null);
  const [axisLock, setAxisLock] = useState<"x" | "y" | null>(null);
  const [vcbText, setVcbText] = useState<string | null>(null);
  const vcbInput = useRef<HTMLInputElement>(null);
  const tapKey = useRef(new ModifierTap());
  const clip = useRef<CncPath[]>([]);
  const pressAt = useRef<Pt>([0, 0]);
  const [erasing, setErasing] = useState<{ segs: Map<number, Set<number>>; guides: Set<number> } | null>(null);
  // A key changed in Edit > Keyboard Shortcuts shows on the rail at once.
  useShortcutsVersion();
  /** An edit drag remembers the drawing on its first move, so a plain click is not an undo step. */
  const dragDirty = useRef(false);

  const fmt = useCallback((m: number) => formatLength(m, units), [units]);
  const analysis = useMemo(() => analyse(design), [design]);

  const toScreen = useCallback((p: Pt): Pt => [(p[0] - view.cx) * view.scale + size.w / 2, size.h / 2 - (p[1] - view.cy) * view.scale], [view, size]);
  const toWorld = useCallback((x: number, y: number): Pt => [(x - size.w / 2) / view.scale + view.cx, view.cy - (y - size.h / 2) / view.scale], [view, size]);

  // ---- history -------------------------------------------------------------------------

  const setDesign = useCallback((value: CncDesign) => {
    const next = value.paths.some((p) => p.nodes.some((n) => n.auto)) ? { ...value, paths: value.paths.map((p) => relaxAuto(p, value.mirrorX)) } : value;
    designRef.current = next;
    setDesignState(next);
  }, []);
  /** Remember the drawing as it stands, once, before an edit or at the start of a drag. */
  const checkpoint = useCallback(() => {
    past.current.push(designRef.current);
    if (past.current.length > 200) past.current.shift();
    future.current = [];
    bump((n) => n + 1);
  }, []);
  const commit = useCallback((next: CncDesign) => {
    checkpoint();
    setDesign(next);
  }, [checkpoint, setDesign]);
  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(designRef.current);
    setDesign(prev);
    setSelection(NOTHING);
    setPenPath(null);
    bump((n) => n + 1);
  }, [setDesign]);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(designRef.current);
    setDesign(next);
    setSelection(NOTHING);
    setPenPath(null);
    bump((n) => n + 1);
  }, [setDesign]);

  const updatePath = useCallback((id: number, f: (p: CncPath) => CncPath) => {
    const d = designRef.current;
    setDesign({ ...d, paths: d.paths.map((p) => (p.id === id ? f(p) : p)) });
  }, [setDesign]);

  // ---- the view ------------------------------------------------------------------------

  useLayoutEffect(() => {
    const el = board.current;
    if (!el) return;
    // The drawing stays where it is on screen when the board changes size (the hint below it
    // wrapping to a second line, the window resized): the board's top left corner holds still,
    // so a point picked before the change is still under the pointer after it.
    let was: { w: number; h: number } | null = null;
    const read = () => {
      const now = { w: el.clientWidth, h: el.clientHeight };
      const prev = was;
      was = now;
      setSize(now);
      if (!prev || (prev.w === now.w && prev.h === now.h)) return;
      setView((v) => ({ ...v, cx: v.cx + (now.w - prev.w) / (2 * v.scale), cy: v.cy - (now.h - prev.h) / (2 * v.scale) }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    const d = designRef.current;
    let lo: Pt = [Infinity, Infinity];
    let hi: Pt = [-Infinity, -Infinity];
    const grow = (p: Pt) => {
      lo = [Math.min(lo[0], p[0]), Math.min(lo[1], p[1])];
      hi = [Math.max(hi[0], p[0]), Math.max(hi[1], p[1])];
    };
    for (const p of d.paths) {
      const b = pathBounds(p.closed && p.nodes.length ? [...p.nodes, p.nodes[0]] : p.nodes);
      if (b) {
        grow(b.min);
        grow(b.max);
        if (d.mirrorX !== null) {
          grow([2 * d.mirrorX - b.min[0], b.min[1]]);
          grow([2 * d.mirrorX - b.max[0], b.max[1]]);
        }
      }
    }
    const r = d.reference;
    if (r) {
      grow([r.x, r.y]);
      grow([r.x + r.width, r.y + r.width * r.aspect]);
    }
    if (!Number.isFinite(lo[0])) return setView((v) => ({ ...v, cx: 0, cy: 0 }));
    const el = board.current;
    const w = el?.clientWidth ?? 800;
    const h = el?.clientHeight ?? 600;
    const span: Pt = [Math.max(hi[0] - lo[0], 0.05), Math.max(hi[1] - lo[1], 0.05)];
    setView({ cx: (lo[0] + hi[0]) / 2, cy: (lo[1] + hi[1]) / 2, scale: clamp(Math.min((w - 120) / span[0], (h - 120) / span[1]), MIN_ZOOM, MAX_ZOOM) });
  }, []);
  useEffect(fit, [fit, drawingId]);

  const onWheel = (e: ReactWheelEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (e.ctrlKey || e.metaKey || !isTrackpadWheel(e.deltaX, e.deltaY, e.deltaMode)) {
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const anchor = toWorld(x, y);
      const scale = clamp(view.scale * Math.exp(-e.deltaY * 0.01), MIN_ZOOM, MAX_ZOOM);
      setView({ scale, cx: anchor[0] - (x - size.w / 2) / scale, cy: anchor[1] + (y - size.h / 2) / scale });
      return;
    }
    setView((v) => ({ ...v, cx: v.cx + e.deltaX / v.scale, cy: v.cy - e.deltaY / v.scale }));
  };

  // A wheel handler React attaches is passive, and the page must not zoom under a pinch.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const stop = (e: WheelEvent) => e.preventDefault();
    el.addEventListener("wheel", stop, { passive: false });
    return () => el.removeEventListener("wheel", stop);
  }, []);

  // ---- snapping ------------------------------------------------------------------------

  /**
   * Where a point lands: square to the last point with Shift, on the grid, then on other
   * shapes' points or level with them (a guide shows which), then on the mirror line.
   */
  const sceneFor = useCallback((exclude?: Set<string>, polar?: SnapScene["polar"]): SnapScene => {
    const d = designRef.current;
    const points = d.paths.flatMap((path) => path.nodes.flatMap((n, i) => (exclude?.has(`${path.id}:${i}`) ? [] : [n.p])));
    return { points, guides: d.guides, mirrorX: d.mirrorX, grid: snap ? gridStep(view.scale, units).minor : null, smart, scale: view.scale, ...(polar ? { polar } : {}) };
  }, [smart, snap, units, view.scale]);

  const resolveSnap = useCallback((p: Pt, shiftFrom?: Pt | null, exclude?: Set<string>, polar?: SnapScene["polar"]): Snap => snapPoint(p, sceneFor(exclude, polar), shiftFrom), [sceneFor]);

  const snapped = useCallback((p: Pt, shiftFrom?: Pt | null, exclude?: Set<string>): Pt => {
    const r = resolveSnap(p, shiftFrom, exclude);
    setGuides(r.guide);
    return r.point;
  }, [resolveSnap]);

  /** Where the protractor sits: the Line's last point, or where the Tape's measurement starts. */
  const aimFrom = (): Pt | null => {
    if (tool === "pen" && penPath !== null) {
      const path = designRef.current.paths.find((x) => x.id === penPath);
      return path?.nodes[path.nodes.length - 1].p ?? null;
    }
    if (tool === "tape" && tape?.mode === "measure" && !tape.b) return tape.a;
    return null;
  };

  /** The next point from `aimFrom`: a locked angle or length holds, the protractor tracks. */
  const aim = (raw: Pt, shift: boolean): Snap => {
    const from = aimFrom();
    if (!from) return resolveSnap(raw);
    if (lockAngle !== null) {
      const u = dirOf(lockAngle);
      if (lockLength !== null) return { point: [from[0] + u[0] * lockLength, from[1] + u[1] * lockLength], guide: null };
      return snapAlong(raw, sceneFor(), from, u);
    }
    const r = resolveSnap(raw, shift ? from : null, undefined, protractor ? { from, step: polarStep } : undefined);
    if (lockLength === null) return r;
    const d = sub2(r.point, from);
    const l = Math.hypot(d[0], d[1]);
    if (l === 0) return r;
    return { point: [from[0] + (d[0] / l) * lockLength, from[1] + (d[1] / l) * lockLength], guide: null, ...(r.track ? { track: r.track } : {}) };
  };

  const aimed = (p: Pt, shift: boolean): Pt => {
    const r = aim(p, shift);
    setGuides(r.guide);
    return r.point;
  };

  const clearLocks = () => {
    setLockAngle(null);
    setLockLength(null);
    setAngleText(null);
  };

  // A new line, a new tool or a new measurement starts with nothing locked.
  useEffect(clearLocks, [tool, penPath, tape]);

  // ---- tools ---------------------------------------------------------------------------

  /** End the drawing tool's line; a line of one point is nothing. */
  const finishLine = useCallback(() => {
    if (penPath === null) return;
    const d = designRef.current;
    const p = d.paths.find((x) => x.id === penPath);
    if (p && p.nodes.length < 2) setDesign({ ...d, paths: d.paths.filter((x) => x.id !== penPath) });
    setPenPath(null);
  }, [penPath, setDesign]);

  const setTool = useCallback((t: ToolName) => {
    finishLine();
    if (gestureRef.current) {
      const g = gestureRef.current;
      if (g.kind !== "arc") setDesign(g.base);
      setGesture(null);
    }
    setVcbText(null);
    setCopy(false);
    setMeasuring(null);
    setTape(null);
    setGuides(null);
    // The last tool's message would read as this one's ("Rotate. Offset 1/2.").
    setNote(null);
    setToolState(t);
  }, [finishLine, setDesign, setGesture]);

  const pointerAt = (e: { clientX: number; clientY: number }): Pt => {
    const rect = svgRef.current!.getBoundingClientRect();
    return toWorld(e.clientX - rect.left, e.clientY - rect.top);
  };

  const nearPx = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]) * view.scale <= HIT_PX;

  /** Each selected point's handles, and the handles facing it on its neighbours. */
  const visibleHandles = useMemo(() => {
    const out: { path: number; node: number; side: "in" | "out"; at: Pt; from: Pt }[] = [];
    const seen = new Set<string>();
    const push = (path: number, node: number, side: "in" | "out", n: CncNode | undefined) => {
      const at = n?.[side];
      const key = `${path}:${node}:${side}`;
      if (!n || !at || seen.has(key)) return;
      seen.add(key);
      out.push({ path, node, side, at, from: n.p });
    };
    for (const ref of selection.nodes) {
      const path = design.paths.find((x) => x.id === ref.path);
      if (!path) continue;
      const n = path.nodes.length;
      push(ref.path, ref.node, "in", path.nodes[ref.node]);
      push(ref.path, ref.node, "out", path.nodes[ref.node]);
      if (path.closed || ref.node > 0) push(ref.path, (ref.node + n - 1) % n, "out", path.nodes[(ref.node + n - 1) % n]);
      if (path.closed || ref.node < n - 1) push(ref.path, (ref.node + 1) % n, "in", path.nodes[(ref.node + 1) % n]);
    }
    return out;
  }, [design.paths, selection.nodes]);

  const hitHandle = (p: Pt) => visibleHandles.find((h) => nearPx(h.at, p)) ?? null;

  const hitNode = (p: Pt): NodeRef | null => {
    for (let i = design.paths.length - 1; i >= 0; i--) {
      const path = design.paths[i];
      const k = path.nodes.findIndex((n) => nearPx(n.p, p));
      if (k >= 0) return { path: path.id, node: k };
    }
    return null;
  };

  const hitLine = (p: Pt): { path: number; segment: number; t: number } | null => {
    for (let i = design.paths.length - 1; i >= 0; i--) {
      const hit = nearestOnPath(design.paths[i], p);
      if (hit && hit.distance * view.scale <= HIT_PX) return { path: design.paths[i].id, segment: hit.segment, t: hit.t };
    }
    return null;
  };

  const hitFill = (p: Pt): number | null => {
    for (let i = design.paths.length - 1; i >= 0; i--) {
      if (design.paths[i].closed && insideNodes(design.paths[i].nodes, p)) return design.paths[i].id;
    }
    return null;
  };

  /** The straight thing under the cursor a reference line can run parallel to. */
  const hitReference = (p: Pt): { base: Pt; dir: Pt } | null => {
    const d = designRef.current;
    const reach = HIT_PX / view.scale;
    for (const g of d.guides) if (Math.abs(sideOffset(g.p, g.dir, p)) <= reach) return { base: g.p, dir: g.dir };
    const line = hitLine(p);
    if (line) {
      const path = d.paths.find((x) => x.id === line.path)!;
      const a = path.nodes[line.segment];
      const b = path.nodes[(line.segment + 1) % path.nodes.length];
      if (a.out || b.in) return null;
      const span = sub2(b.p, a.p);
      const length = Math.hypot(span[0], span[1]);
      return length > 0 ? { base: a.p, dir: [span[0] / length, span[1] / length] } : null;
    }
    if (d.mirrorX !== null && Math.abs(p[0] - d.mirrorX) <= reach) return { base: [d.mirrorX, 0], dir: [0, 1] };
    if (Math.abs(p[1]) <= reach) return { base: [0, 0], dir: [1, 0] };
    if (Math.abs(p[0]) <= reach) return { base: [0, 0], dir: [0, 1] };
    return null;
  };

  const hitGuide = (p: Pt): CncGuide | null => designRef.current.guides.find((g) => Math.abs(sideOffset(g.p, g.dir, p)) * view.scale <= HIT_PX - 3) ?? null;

  /** Put down a reference line, and leave the Tape ready for the next. */
  const addGuide = (p: Pt, dir: Pt) => {
    const d = designRef.current;
    commit({ ...d, nextId: d.nextId + 1, guides: [...d.guides, { id: d.nextId, p, dir }] });
    setTape(null);
  };

  const finishGuide = (t: Extract<Tape, { mode: "guide" }>, at: Pt) => {
    const off = sideOffset(t.base, t.dir, at);
    if (Math.abs(off) * view.scale < 2) return setNote({ text: "Move away from the line first, then click, or type the distance.", error: false });
    addGuide(offsetPoint(t.base, t.dir, off), t.dir);
    setNote({ text: `Reference line ${fmt(Math.abs(off))} from that line.`, error: false });
  };

  const finishMeasure = (t: Extract<Tape, { mode: "measure" }>, at: Pt, throughBoth: boolean) => {
    const span = sub2(at, t.a);
    const length = Math.hypot(span[0], span[1]);
    if (length * view.scale < 2) return;
    if (throughBoth) {
      addGuide(t.a, [span[0] / length, span[1] / length]);
      setNote({ text: `Reference line through those two points, ${fmt(length)} apart.`, error: false });
      return;
    }
    setTape({ ...t, b: at });
    setNote({ text: `${fmt(length)}: ${fmt(Math.abs(span[0]))} across, ${fmt(Math.abs(span[1]))} up.`, error: false });
  };

  /** Measure only, from a line: the distance square to it. Nothing is added. */
  const finishSquare = (t: Extract<Tape, { mode: "square" }>, at: Pt) => {
    const off = Math.abs(sideOffset(t.base, t.dir, at));
    if (off * view.scale < 2) return;
    setTape({ ...t, b: at });
    setNote({ text: `${fmt(off)} square to that line.`, error: false });
  };

  const setTapeMode = (m: TapeMode) => {
    setTapeModeState(m);
    setTape(null);
    try {
      localStorage.setItem(TAPE_MODE_KEY, m);
    } catch {
      // A private window keeps no settings; the choice lasts while the workspace is open.
    }
    setNote({ text: m === "measure" ? "Measure only: nothing is added. Tap Ctrl for reference lines." : "Reference lines. Tap Ctrl to measure only.", error: false });
  };

  /** Option (Alt) does the other mode's thing for one click. */
  const makesLines = (e: { altKey: boolean }) => (tapeMode === "reference") !== e.altKey;

  const pressTape = (p: Pt, e: ReactPointerEvent) => {
    if (tape?.mode === "guide") return finishGuide(tape, snapped(p));
    if (tape?.mode === "measure" && !tape.b) return finishMeasure(tape, aimed(p, e.shiftKey), makesLines(e));
    if (tape?.mode === "square" && !tape.b) return finishSquare(tape, snapped(p));
    const press = { pressX: e.clientX, pressY: e.clientY };
    // A point starts from that point; a straight line starts a parallel line, or a measurement
    // square to it when measuring only.
    const reference = hitNode(p) ? null : hitReference(p);
    if (reference && !makesLines(e)) {
      setTape({ mode: "square", base: reference.base, dir: reference.dir, b: null, ...press });
      return;
    }
    if (reference) {
      // Where it was pressed on the line: an angle to the line is turned about here.
      const t = (p[0] - reference.base[0]) * reference.dir[0] + (p[1] - reference.base[1]) * reference.dir[1];
      setTape({ mode: "guide", ...reference, at: [reference.base[0] + reference.dir[0] * t, reference.base[1] + reference.dir[1] * t], ...press });
    }
    else setTape({ mode: "measure", a: snapped(p), b: null, ...press });
  };

  const selectedPaths = useMemo(() => design.paths.filter((p) => selection.paths.includes(p.id)), [design.paths, selection.paths]);
  const selectedBox = useMemo(() => unionBounds(selectedPaths), [selectedPaths]);

  const hitBoxHandle = (p: Pt): [number, number] | null => {
    if (!selectedBox || tool !== "scale") return null;
    const { min, max } = selectedBox;
    for (const [hx, hy] of BOX_HANDLES) {
      const at: Pt = [(min[0] + max[0]) / 2 + (hx * (max[0] - min[0])) / 2, (min[1] + max[1]) / 2 + (hy * (max[1] - min[1])) / 2];
      if (nearPx(at, p)) return [hx, hy];
    }
    return null;
  };

  /** Pick up an open line where it ends, so drawing carries on from it. */
  const resumeLine = (p: Pt): boolean => {
    const d = designRef.current;
    const end = hitNode(p);
    const open = end && d.paths.find((x) => x.id === end.path && !x.closed && (end.node === 0 || end.node === x.nodes.length - 1));
    if (!end || !open) return false;
    if (end.node === 0 && open.nodes.length > 1) {
      const turned = open.nodes.map((n) => ({ ...n, ...(n.out ? { in: n.out } : { in: undefined }), ...(n.in ? { out: n.in } : { out: undefined }) })).map(({ in: i, out: o, ...rest }) => ({ ...rest, ...(i ? { in: i } : {}), ...(o ? { out: o } : {}) })).reverse();
      commit({ ...d, paths: d.paths.map((x) => (x.id === open.id ? { ...x, nodes: turned } : x)) });
    }
    setPenPath(open.id);
    return true;
  };

  const startLine = (first: CncNode) => {
    const d = designRef.current;
    const path: CncPath = { id: d.nextId, closed: false, nodes: [first] };
    commit({ ...d, nextId: d.nextId + 1, paths: [...d.paths, path] });
    setPenPath(path.id);
    setSelection(NOTHING);
    return path.id;
  };

  const closeLine = (id: number) => {
    const d = designRef.current;
    commit({ ...d, paths: d.paths.map((x) => (x.id === id ? { ...x, closed: true } : x)) });
    setPenPath(null);
    setSelection({ paths: [id], nodes: [] });
    setNote({ text: "The shape is closed.", error: false });
  };

  const beginNodeDrag = (refs: NodeRef[], at: Pt) => {
    const d = designRef.current;
    const starts = refs.flatMap((r) => {
      const start = d.paths.find((x) => x.id === r.path)?.nodes[r.node];
      return start ? [{ ...r, start }] : [];
    });
    dragDirty.current = true;
    drag.current = { kind: "nodes", starts, at };
  };

  const clickPen = (p: Pt, e: ReactPointerEvent) => {
    const d = designRef.current;
    const current = d.paths.find((x) => x.id === penPath);
    if (current) {
      if (current.nodes.length >= 2 && nearPx(current.nodes[0].p, p)) {
        closeLine(current.id);
        drag.current = { kind: "pen", path: current.id, node: 0, at: current.nodes[0].p, close: true };
        return;
      }
      const at = aimed(p, e.shiftKey);
      clearLocks();
      if (addPenPoint(current, at)) drag.current = { kind: "pen", path: current.id, node: current.nodes.length, at };
      return;
    }
    void d;
    if (resumeLine(p)) return;
    const at = snapped(p);
    const id = startLine({ p: at });
    drag.current = { kind: "pen", path: id, node: 0, at };
  };

  /** The Line's next point. Landing on the end of another line joins the two, as in the model,
   * and ends this line there. False: the line ended. */
  const addPenPoint = (current: CncPath, at: Pt): boolean => {
    const d = designRef.current;
    const added = d.paths.map((x) => (x.id === current.id ? { ...x, nodes: [...x.nodes, { p: at }] } : x));
    const joined = joinEnds(added, current.id);
    commit({ ...d, paths: joined.paths });
    if (!joined.joined && !joined.closed) return true;
    setPenPath(null);
    setSelection({ paths: [current.id], nodes: [] });
    setNote({ text: joined.closed ? "The lines meet: the shape is closed." : "Joined to the line there.", error: false });
    return false;
  };

  const clickCurve = (p: Pt, e: ReactPointerEvent) => {
    const d = designRef.current;
    const current = d.paths.find((x) => x.id === penPath);
    if (current) {
      if (current.nodes.length >= 3 && nearPx(current.nodes[0].p, p)) return closeLine(current.id);
      const on = current.nodes.findIndex((n) => nearPx(n.p, p));
      if (on >= 0) return beginNodeDrag([{ path: current.id, node: on }], p);
      const last = current.nodes[current.nodes.length - 1].p;
      const at = snapped(p, e.shiftKey ? last : null);
      commit({ ...d, paths: d.paths.map((x) => (x.id === current.id ? { ...x, nodes: [...x.nodes, e.altKey ? { p: at } : { p: at, auto: true }] } : x)) });
      beginNodeDrag([{ path: current.id, node: current.nodes.length }], p);
      dragDirty.current = false;
      return;
    }
    if (resumeLine(p)) return;
    const node = hitNode(p);
    if (node) {
      setSelection({ paths: [], nodes: [node] });
      return beginNodeDrag([node], p);
    }
    const line = hitLine(p);
    if (line) {
      commit({ ...d, paths: d.paths.map((x) => (x.id === line.path ? { ...x, nodes: (() => { const s = insertNode(x, line.segment, line.t).nodes; s[line.segment + 1] = { ...s[line.segment + 1], auto: true }; return s; })() } : x)) });
      beginNodeDrag([{ path: line.path, node: line.segment + 1 }], p);
      dragDirty.current = false;
      return;
    }
    const at = snapped(p);
    startLine(e.altKey ? { p: at } : { p: at, auto: true });
  };

  // ---- the model's transform tools: Move, Rotate, Scale, Offset ---------------------------

  /** What a transform acts on: the selection, or the shape under the cursor. */
  const subjectAt = (p: Pt): Selection | null => {
    if (selection.paths.length || selection.nodes.length) return selection;
    const id = hitLine(p)?.path ?? hitFill(p);
    if (id === null || id === undefined) return null;
    const picked = { paths: [id], nodes: [] };
    setSelection(picked);
    return picked;
  };

  const keysOf = (subject: Selection) => new Set([...subject.nodes.map(nodeKey), ...designRef.current.paths.filter((x) => subject.paths.includes(x.id)).flatMap((x) => x.nodes.map((_, i) => `${x.id}:${i}`))]);

  const lockDelta = (d: Pt): Pt => (axisLock === "x" ? [d[0], 0] : axisLock === "y" ? [0, d[1]] : d);

  const preview = (g: Gesture | null, copyNow = copy) => {
    if (!g) return;
    if (g.kind === "move") setDesign(transformed(g.base, g.subject, [(p) => add2(p, lockDelta(sub2(g.to, g.from)))], copyNow).design);
    else if (g.kind === "rotate") setDesign(transformed(g.base, g.subject, [rotation(g.centre, g.angle)], copyNow).design);
    else if (g.kind === "scale") {
      const anchor = scaleAnchor(g);
      setDesign(transformed(g.base, g.subject, [(p) => [anchor[0] + (p[0] - anchor[0]) * g.sx, anchor[1] + (p[1] - anchor[1]) * g.sy]], false).design);
    } else if (g.kind === "offset") {
      const base = g.base;
      setDesign(Math.abs(g.d) * view.scale < 1 ? base : { ...base, nextId: base.nextId + 1, paths: [...base.paths, { ...offsetPath(g.source, g.d), id: base.nextId }] });
    }
  };

  const scaleAnchor = (g: Extract<Gesture, { kind: "scale" }>): Pt => {
    const c: Pt = [(g.box.min[0] + g.box.max[0]) / 2, (g.box.min[1] + g.box.max[1]) / 2];
    const half: Pt = [(g.box.max[0] - g.box.min[0]) / 2, (g.box.max[1] - g.box.min[1]) / 2];
    return g.centre ? c : [c[0] - g.hx * half[0], c[1] - g.hy * half[1]];
  };

  const cancelGesture = useCallback(() => {
    const g = gestureRef.current;
    if (!g) return false;
    if (g.kind !== "arc") setDesign(g.base);
    setGesture(null);
    setAxisLock(null);
    return true;
  }, [setDesign]);

  /** Keep a transform: one undo step back to where it started. */
  const finishGesture = (g: Exclude<Gesture, { kind: "arc" }>, record: (result: CncDesign) => Last, made: number[] = []) => {
    const result = designRef.current;
    past.current.push(g.base);
    future.current = [];
    last.current = record(result);
    setGesture(null);
    setAxisLock(null);
    setCopy(false);
    if (made.length) setSelection({ paths: made, nodes: [] });
    bump((n) => n + 1);
  };

  const finishMove = (g: Extract<Gesture, { kind: "move" }>) => {
    const delta = lockDelta(sub2(g.to, g.from));
    if (Math.hypot(delta[0], delta[1]) * view.scale < 0.5) return cancelGesture();
    const { design: d, made } = transformed(g.base, g.subject, [(p) => add2(p, delta)], copy);
    setDesign(d);
    finishGesture(g, (result) => ({ kind: "move", base: g.base, subject: g.subject, delta, copy: copy && made.length > 0, result }), made);
    setNote({ text: `${made.length ? "Copied" : "Moved"} ${fmt(Math.hypot(delta[0], delta[1]))}.${made.length ? " Type x3 for three copies, or /3 to divide." : ""}`, error: false });
  };

  const finishRotate = (g: Extract<Gesture, { kind: "rotate" }>) => {
    if (Math.abs(g.angle) < 1e-9) return cancelGesture();
    const { design: d, made } = transformed(g.base, g.subject, [rotation(g.centre, g.angle)], copy);
    setDesign(d);
    finishGesture(g, (result) => ({ kind: "rotate", base: g.base, subject: g.subject, centre: g.centre, angle: g.angle, copy: copy && made.length > 0, result }), made);
    setNote({ text: `${made.length ? "Copied, turned" : "Turned"} ${Math.round(((g.angle * 180) / Math.PI) * 100) / 100}°.`, error: false });
  };

  const finishScale = (g: Extract<Gesture, { kind: "scale" }>) => {
    if (Math.abs(g.sx - 1) < 1e-9 && Math.abs(g.sy - 1) < 1e-9) return cancelGesture();
    preview(g);
    const anchor = scaleAnchor(g);
    finishGesture(g, (result) => ({ kind: "scale", base: g.base, subject: g.subject, anchor, sx: g.sx, sy: g.sy, result }));
    setNote({ text: g.sx === g.sy ? `Scaled ${Math.round(g.sx * 1000) / 1000} times.` : `Scaled ${Math.round(g.sx * 1000) / 1000} across and ${Math.round(g.sy * 1000) / 1000} up.`, error: false });
  };

  const finishOffset = (g: Extract<Gesture, { kind: "offset" }>) => {
    if (Math.abs(g.d) * view.scale < 1) return setNote({ text: "Move in or out from the shape first, or type the distance.", error: false });
    const out = offsetPath(g.source, g.d);
    const problem = offsetProblem(g.source, out);
    if (problem) return setNote({ text: problem, error: true });
    const id = g.base.nextId;
    setDesign({ ...g.base, nextId: id + 1, paths: [...g.base.paths, { ...out, id }] });
    finishGesture(g, (result) => ({ kind: "offset", base: g.base, source: g.source, d: g.d, result }), [id]);
    setNote({ text: `Offset ${fmt(Math.abs(g.d))}.`, error: false });
  };

  const finishArc = (a: Pt, b: Pt, bulge: number) => {
    const d = designRef.current;
    const id = d.nextId;
    const joined = joinEnds([...d.paths, { id, closed: false, nodes: arcNodes(a, b, bulge) }], id);
    commit({ ...d, nextId: id + 1, paths: joined.paths });
    setGesture(null);
    setSelection({ paths: [id], nodes: [] });
    setNote({ text: joined.closed ? "Arc drawn; the shape is closed." : joined.joined ? "Arc drawn, joined to the line there." : `Arc drawn, ${fmt(Math.abs(bulge))} bulge.`, error: false });
  };

  const pressMove = (p: Pt, e: ReactPointerEvent) => {
    const g = gestureRef.current;
    if (g?.kind === "move") return finishMove({ ...g, to: snapped(p, e.shiftKey ? g.from : null, keysOf(g.subject)) });
    const subject = subjectAt(p);
    if (!subject) return setNote({ text: "Click a shape to pick it up, or select shapes or points first.", error: false });
    // Picked up by its own corner, as in the model, so that corner is what lands where it is put.
    const from = snapped(p);
    setGesture({ kind: "move", base: designRef.current, subject, from, to: from, press: [e.clientX, e.clientY] });
  };

  const pressRotate = (p: Pt) => {
    const g = gestureRef.current;
    if (g?.kind === "rotate") {
      if (!g.ref) {
        // Nothing has turned yet: the shape's own corners are fair references.
        const ref = snapped(p);
        if (Math.hypot(ref[0] - g.centre[0], ref[1] - g.centre[1]) * view.scale < 4) return;
        return setGesture({ ...g, ref });
      }
      return finishRotate(g);
    }
    const subject = subjectAt(p);
    if (!subject) return setNote({ text: "Click on a shape for the centre, or select shapes or points first.", error: false });
    setGesture({ kind: "rotate", base: designRef.current, subject, centre: snapped(p), ref: null, angle: 0 });
  };

  const pressScale = (p: Pt, e: ReactPointerEvent) => {
    const g = gestureRef.current;
    if (g?.kind === "scale") return finishScale(g);
    const grip = hitBoxHandle(p);
    if (grip && selectedBox) {
      setGesture({ kind: "scale", base: designRef.current, subject: { paths: selection.paths, nodes: [] }, box: selectedBox, hx: grip[0], hy: grip[1], sx: 1, sy: 1, centre: e.metaKey || e.ctrlKey, press: [e.clientX, e.clientY] });
      return;
    }
    const id = hitLine(p)?.path ?? hitFill(p);
    setSelection(id === null || id === undefined ? NOTHING : { paths: [id], nodes: [] });
  };

  const pressOffset = (p: Pt) => {
    const g = gestureRef.current;
    if (g?.kind === "offset") return finishOffset(g);
    const d = designRef.current;
    const id = hitLine(p)?.path ?? hitFill(p) ?? (selection.paths.length === 1 ? selection.paths[0] : null);
    const source = id === null || id === undefined ? null : d.paths.find((x) => x.id === id);
    if (!source || source.nodes.length < 2) return setNote({ text: "Click a shape or a line to offset it.", error: false });
    setSelection({ paths: [source.id], nodes: [] });
    setGesture({ kind: "offset", base: d, source, d: 0 });
  };

  const pressArc = (p: Pt) => {
    const g = gestureRef.current;
    if (g?.kind !== "arc") return setGesture({ kind: "arc", a: snapped(p), b: null, bulge: 0 });
    if (!g.b) {
      const b = snapped(p, null);
      if (Math.hypot(b[0] - g.a[0], b[1] - g.a[1]) * view.scale < 4) return;
      return setGesture({ ...g, b });
    }
    finishArc(g.a, g.b, g.bulge);
  };

  // ---- Select and Erase, as in the model --------------------------------------------------

  const pressSelect = (p: Pt, e: ReactPointerEvent) => {
    const d = designRef.current;
    if (d.mirrorX !== null && Math.abs(p[0] - d.mirrorX) * view.scale <= HIT_PX - 4 && !hitLine(p)) {
      dragDirty.current = true;
      drag.current = { kind: "mirror" };
      return;
    }
    // A click or a box: decided when the button comes up, as the model's Select does.
    drag.current = { kind: "select", at: p, x: e.clientX, y: e.clientY, box: false };
  };

  const clickSelect = (p: Pt, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
    const mode = modeFor({ shift: e.shiftKey, ctrl: e.metaKey || e.ctrlKey });
    const near = (q: Pt) => Math.hypot(q[0] - p[0], q[1] - p[1]) * view.scale <= 6;
    let point: NodeRef | null = null;
    for (const path of designRef.current.paths) {
      const k = path.nodes.findIndex((n) => near(n.p));
      if (k >= 0) point = { path: path.id, node: k };
    }
    const id = point ? null : (hitLine(p)?.path ?? hitFill(p));
    const guide = point || (id !== null && id !== undefined) ? null : hitGuide(p);
    setSelectedGuide(guide ? guide.id : null);
    const apply = <T,>(now: T[], picked: T[], key: (x: T) => string): T[] => {
      if (mode === "replace") return picked;
      const keys = new Set(now.map(key));
      if (mode === "add") return [...now, ...picked.filter((x) => !keys.has(key(x)))];
      const flip = new Set(picked.map(key));
      return [...now.filter((x) => !flip.has(key(x))), ...picked.filter((x) => !keys.has(key(x)))];
    };
    const paths = apply(selection.paths, id !== null && id !== undefined ? [id] : [], String);
    const nodes = apply(selection.nodes, point ? [point] : [], nodeKey);
    setSelection({ paths: mode === "replace" && point ? [] : paths, nodes: mode === "replace" && !point ? [] : nodes });
    if (point) setNote({ text: "Selected a point. Move or Delete it, or press the Points key for its curve handles.", error: false });
  };

  const finishBox = (g: Extract<Drag, { kind: "select" }>, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
    const m = marquee;
    setMarquee(null);
    if (!m) return;
    const crossing = !!m.crossing;
    const hit = designRef.current.paths.filter((x) => inBox(x, m, crossing)).map((x) => x.id);
    const mode = modeFor({ shift: e.shiftKey, ctrl: e.metaKey || e.ctrlKey });
    const now = selection.paths;
    const paths = mode === "replace" ? hit : mode === "add" ? [...new Set([...now, ...hit])] : [...now.filter((x) => !hit.includes(x)), ...hit.filter((x) => !now.includes(x))];
    setSelection({ paths, nodes: [] });
    setSelectedGuide(null);
    setNote({ text: `${crossing ? "Crossing" : "Window"} selection: ${hit.length === 1 ? "1 shape" : `${hit.length} shapes`}.`, error: false });
    void g;
  };

  /** What the Eraser is over: a segment of a shape, or a reference line. */
  const eraseHit = (p: Pt, into: Extract<Drag, { kind: "erase" }>) => {
    const line = hitLine(p);
    if (line) {
      const set = into.segs.get(line.path) ?? new Set<number>();
      set.add(line.segment);
      into.segs.set(line.path, set);
    } else {
      const g = hitGuide(p);
      if (g) into.guides.add(g.id);
    }
    setErasing({ segs: new Map(into.segs), guides: new Set(into.guides) });
  };

  const finishErase = (g: Extract<Drag, { kind: "erase" }>) => {
    setErasing(null);
    if (!g.segs.size && !g.guides.size) return;
    const d = designRef.current;
    let next = d.nextId;
    const paths = d.paths.flatMap((path) => {
      const gone = g.segs.get(path.id);
      if (!gone) return [path];
      const pieces = eraseSegments(path, gone, next);
      next += Math.max(0, pieces.length - 1);
      return pieces;
    });
    commit({ ...d, nextId: next, paths, guides: d.guides.filter((x) => !g.guides.has(x.id)) });
    setSelection(NOTHING);
    const count = [...g.segs.values()].reduce((n, s) => n + s.size, 0) + g.guides.size;
    setNote({ text: count === 1 ? "Erased." : `Erased ${count}.`, error: false });
  };

  // ---- Points (the curve handles) --------------------------------------------------------

  const pressNode = (p: Pt, e: ReactPointerEvent) => {
    const d = designRef.current;
    const handle = hitHandle(p);
    if (handle) {
      dragDirty.current = true;
      drag.current = { kind: "handle", path: handle.path, node: handle.node, side: handle.side };
      return;
    }
    const node = hitNode(p);
    if (node) {
      const already = selection.nodes.some((r) => nodeKey(r) === nodeKey(node));
      const nodes = e.shiftKey ? (already ? selection.nodes.filter((r) => nodeKey(r) !== nodeKey(node)) : [...selection.nodes, node]) : already ? selection.nodes : [node];
      setSelection({ paths: [], nodes });
      // The point under the cursor leads, so it is the one that lands on the grid or a point.
      const lead = nodes.filter((r) => nodeKey(r) === nodeKey(node));
      if (nodes.length) beginNodeDrag([...lead, ...nodes.filter((r) => nodeKey(r) !== nodeKey(node))], p);
      return;
    }
    const line = hitLine(p);
    if (line) {
      setSelection({ paths: [line.path], nodes: [] });
      dragDirty.current = true;
      drag.current = { kind: "bend", path: line.path, segment: line.segment, t: line.t, start: d.paths.find((x) => x.id === line.path)!, at: p };
      return;
    }
    if (!e.shiftKey) setSelection(NOTHING);
    drag.current = { kind: "marquee", at: p, add: e.shiftKey };
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current!;
    svg.setPointerCapture(e.pointerId);
    tapKey.current.cancel();
    (document.activeElement as HTMLElement | null)?.blur?.();
    root.current?.focus({ preventScroll: true });
    setNote(null);
    setVcbText(null);
    // As in the model: the middle button and the right button pan.
    if (e.button === 1 || e.button === 2) {
      drag.current = { kind: "pan", x: e.clientX, y: e.clientY, view };
      return;
    }
    const p = pointerAt(e);
    if (measuring) {
      if (!measuring.a) setMeasuring({ a: snapped(p), b: null });
      else if (!measuring.b) setMeasuring({ ...measuring, b: snapped(p) });
      return;
    }
    const d = designRef.current;
    // A rectangle or circle placed by click, move, click ends at this click.
    const placing = drag.current;
    if (placing && (placing.kind === "rect" || placing.kind === "circle") && placing.placing) {
      drag.current = null;
      setSelection({ paths: [placing.id], nodes: [] });
      return;
    }
    // Cmd borrows the Points tool for a moment, as it does in the drawing programs.
    const active: ToolName = e.metaKey && (tool === "pen" || tool === "curve") ? "node" : tool;
    switch (active) {
      case "pen":
        return clickPen(p, e);
      case "curve":
        return clickCurve(p, e);
      case "arc":
        return pressArc(p);
      case "pencil":
        drag.current = { kind: "pencil", points: [p] };
        setPencilLive([p]);
        return;
      case "rect":
      case "circle": {
        const at = snapped(p);
        const id = d.nextId;
        commit({ ...d, nextId: id + 1, paths: [...d.paths, { id, closed: true, nodes: active === "rect" ? rectNodes(at, at) : circleNodes(at, 0) }] });
        drag.current = { kind: active, id, at };
        pressAt.current = [e.clientX, e.clientY];
        return;
      }
      case "image": {
        if (!d.reference) return setNote({ text: "Add a reference image first.", error: false });
        dragDirty.current = true;
        drag.current = { kind: "image", at: p, x: d.reference.x, y: d.reference.y };
        return;
      }
      case "tape":
        return pressTape(p, e);
      case "select":
        return pressSelect(p, e);
      case "erase": {
        const g: Extract<Drag, { kind: "erase" }> = { kind: "erase", segs: new Map(), guides: new Set() };
        drag.current = g;
        eraseHit(p, g);
        return;
      }
      case "node":
        return pressNode(p, e);
      case "move":
        return pressMove(p, e);
      case "rotate":
        return pressRotate(p);
      case "scale":
        return pressScale(p, e);
      case "offset":
        return pressOffset(p);
    }
  };

  const hoverAt = (p: Pt): typeof hover => {
    if (measuring) return null;
    if (tool === "select" || tool === "move" || tool === "rotate" || tool === "offset") return hitLine(p) || hitFill(p) !== null || (tool === "select" && hitGuide(p)) ? "fill" : null;
    if (tool === "scale") return hitBoxHandle(p) ? "box" : hitLine(p) || hitFill(p) !== null ? "fill" : null;
    if (tool === "erase") return hitLine(p) || hitGuide(p) ? "line" : null;
    if (tool === "tape") return !tape && !hitNode(p) && hitReference(p) ? "reference" : null;
    if (tool === "node") return hitHandle(p) ? "handle" : hitNode(p) ? "node" : hitLine(p) ? "line" : null;
    if (tool === "pen" || tool === "curve") {
      const current = design.paths.find((x) => x.id === penPath);
      if (current && current.nodes.length >= (tool === "pen" ? 2 : 3) && nearPx(current.nodes[0].p, p)) return "first";
      return null;
    }
    return null;
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const p = pointerAt(e);
    setCursor(p);
    if (e.shiftKey !== shiftDown) setShiftDown(e.shiftKey);
    const ge = gestureRef.current;
    if (ge) {
      if (ge.kind === "move") {
        const next = { ...ge, to: snapped(p, e.shiftKey ? ge.from : null, keysOf(ge.subject)) };
        setGesture(next);
        preview(next);
      } else if (ge.kind === "rotate" && ge.ref) {
        const q = snapped(p, null, keysOf(ge.subject));
        const u = sub2(ge.ref, ge.centre);
        const v = sub2(q, ge.centre);
        let angle = Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]);
        // The protractor's 15 degree ticks pull the angle, as they do in the model.
        const tick = Math.round(angle / (Math.PI / 12)) * (Math.PI / 12);
        if (Math.abs(angle - tick) < (2.5 * Math.PI) / 180) angle = tick;
        const next = { ...ge, angle };
        setGesture(next);
        preview(next);
      } else if (ge.kind === "rotate") snapped(p);
      else if (ge.kind === "scale") {
        const q = snapped(p, null, keysOf(ge.subject));
        const anchor = scaleAnchor({ ...ge, centre: e.metaKey || e.ctrlKey });
        const c: Pt = [(ge.box.min[0] + ge.box.max[0]) / 2, (ge.box.min[1] + ge.box.max[1]) / 2];
        const half: Pt = [(ge.box.max[0] - ge.box.min[0]) / 2, (ge.box.max[1] - ge.box.min[1]) / 2];
        const from: Pt = [c[0] + ge.hx * half[0], c[1] + ge.hy * half[1]];
        let sx = ge.hx && from[0] !== anchor[0] ? (q[0] - anchor[0]) / (from[0] - anchor[0]) : 1;
        let sy = ge.hy && from[1] !== anchor[1] ? (q[1] - anchor[1]) / (from[1] - anchor[1]) : 1;
        if (e.shiftKey) {
          const k = ge.hx && ge.hy ? Math.max(Math.abs(sx), Math.abs(sy)) : ge.hx ? sx : sy;
          sx = sy = k;
        }
        const next = { ...ge, sx, sy, centre: e.metaKey || e.ctrlKey };
        setGesture(next);
        preview(next);
      } else if (ge.kind === "offset") {
        const q = snapped(p, null, new Set(ge.source.nodes.map((_, i) => `${ge.source.id}:${i}`)));
        const next = { ...ge, d: sideOf(ge.source, q) };
        setGesture(next);
        preview(next);
      } else if (ge.kind === "arc") {
        const q = snapped(p);
        if (ge.b) setGesture({ ...ge, bulge: bulgeFromPoint(ge.a, ge.b, q) });
      }
      return;
    }
    const g = drag.current;
    if (!g) {
      setHover(hoverAt(p));
      // The guides show while aiming, before the click that uses them.
      if (aimFrom()) aimed(p, e.shiftKey);
      else if (penPath !== null || tool === "pen" || tool === "curve" || tool === "arc" || tool === "rect" || tool === "circle" || tool === "tape" || tool === "move" || tool === "rotate") snapped(p);
      return;
    }
    if (dragDirty.current) {
      checkpoint();
      dragDirty.current = false;
    }
    const d = designRef.current;
    switch (g.kind) {
      case "pan":
        setView({ ...g.view, cx: g.view.cx - (e.clientX - g.x) / g.view.scale, cy: g.view.cy + (e.clientY - g.y) / g.view.scale });
        return;
      case "select": {
        if (!g.box && Math.hypot(e.clientX - g.x, e.clientY - g.y) <= 4) return;
        g.box = true;
        setMarquee({ min: [Math.min(g.at[0], p[0]), Math.min(g.at[1], p[1])], max: [Math.max(g.at[0], p[0]), Math.max(g.at[1], p[1])], crossing: p[0] < g.at[0] });
        return;
      }
      case "erase":
        eraseHit(p, g);
        return;
      case "nodes": {
        const lead = g.starts[0];
        if (!lead) return;
        const q = snapped(add2(lead.start.p, sub2(p, g.at)), null, new Set(g.starts.map(nodeKey)));
        const delta = sub2(q, lead.start.p);
        setDesign({
          ...d,
          paths: d.paths.map((path) => {
            const moved = g.starts.filter((s) => s.path === path.id);
            if (!moved.length) return path;
            const nodes = path.nodes.slice();
            for (const m of moved) nodes[m.node] = { ...m.start, p: add2(m.start.p, delta), ...(m.start.in ? { in: add2(m.start.in, delta) } : {}), ...(m.start.out ? { out: add2(m.start.out, delta) } : {}) };
            return { ...path, nodes };
          }),
        });
        return;
      }
      case "handle":
        updatePath(g.path, (path) => ({
          ...path,
          nodes: path.nodes.map((n, i) => {
            if (i !== g.node) return n;
            const { auto: _auto, ...rest } = n;
            const next: CncNode = { ...rest, [g.side]: snap ? snapped(p) : p, ...(e.altKey ? { corner: true } : {}) };
            return alignOpposite(next, g.side);
          }),
        }));
        return;
      case "bend":
        updatePath(g.path, () => bendSegment(g.start, g.segment, g.t, sub2(p, g.at)));
        return;
      case "paths":
      case "scale":
        return;
      case "marquee":
        setMarquee({ min: [Math.min(g.at[0], p[0]), Math.min(g.at[1], p[1])], max: [Math.max(g.at[0], p[0]), Math.max(g.at[1], p[1])] });
        return;
      case "mirror":
        setDesign({ ...d, mirrorX: snap ? snapped(p)[0] : p[0] });
        return;
      case "guide":
        setDesign({ ...d, guides: d.guides.map((x) => (x.id === g.id ? { ...x, p: add2(g.start, sub2(snap ? snapped(p) : p, snap ? snapped(g.at) : g.at)) } : x)) });
        return;
      case "image":
        if (d.reference) setDesign({ ...d, reference: { ...d.reference, x: g.x + p[0] - g.at[0], y: g.y + p[1] - g.at[1] } });
        return;
      case "pen": {
        // Dragging from a new point pulls out its handles: the curve leaves along them.
        if (Math.hypot(p[0] - g.at[0], p[1] - g.at[1]) * view.scale < 3) return;
        const q = snap ? snapped(p) : p;
        updatePath(g.path, (path) => ({
          ...path,
          nodes: path.nodes.map((n, i) => {
            if (i !== g.node) return n;
            if (g.close) return { ...n, in: sub2(n.p, sub2(q, n.p)), ...(n.out ? {} : { corner: true }) };
            if (e.altKey) return { ...n, out: q, corner: true };
            return { p: n.p, out: q, in: sub2(n.p, sub2(q, n.p)) };
          }),
        }));
        return;
      }
      case "pencil": {
        // A fast stroke reaches here as fewer events; the browser keeps the samples it merged.
        const merged = e.nativeEvent.getCoalescedEvents?.() ?? [];
        for (const m of merged.length ? merged : [e.nativeEvent]) g.points.push(pointerAt(m));
        setPencilLive([...g.points]);
        return;
      }
      case "rect":
        updatePath(g.id, (path) => ({ ...path, nodes: rectNodes(g.at, snapped(p, null, new Set([0, 1, 2, 3].map((i) => `${g.id}:${i}`)))) }));
        return;
      case "circle": {
        const q = snapped(p, null, new Set([0, 1, 2, 3].map((i) => `${g.id}:${i}`)));
        updatePath(g.id, (path) => ({ ...path, nodes: circleNodes(g.at, Math.hypot(q[0] - g.at[0], q[1] - g.at[1])) }));
        return;
      }
    }
  };

  const finishMarquee = (add: boolean) => {
    const m = marquee;
    setMarquee(null);
    if (!m) return;
    const d = designRef.current;
    const inside = (p: Pt) => p[0] >= m.min[0] && p[0] <= m.max[0] && p[1] >= m.min[1] && p[1] <= m.max[1];
    const hit = d.paths.flatMap((x) => x.nodes.flatMap((n, i) => (inside(n.p) ? [{ path: x.id, node: i }] : [])));
    const seen = new Set(selection.nodes.map(nodeKey));
    setSelection({ paths: [], nodes: add ? [...selection.nodes, ...hit.filter((r) => !seen.has(nodeKey(r)))] : hit });
  };

  const finishPencil = (points: Pt[]) => {
    setPencilLive(null);
    const d = designRef.current;
    if (points.length < 2) return;
    const closes = points.length > 8 && Math.hypot(points[0][0] - points[points.length - 1][0], points[0][1] - points[points.length - 1][1]) * view.scale <= 14;
    // The end of a closing stroke wanders about the start, and can cross it: the gap closes straight.
    if (closes) {
      const near = (q: Pt) => Math.hypot(q[0] - points[0][0], q[1] - points[0][1]) * view.scale < 14;
      while (points.length > 8 && near(points[points.length - 1])) points.pop();
    }
    // A looser fit can fold a tight bend over itself: fit closer until it does not.
    let nodes: CncNode[] | null = null;
    for (let k = 0; k < 4; k++) {
      nodes = fitStroke(points, smoothing / view.scale / 2 ** k, closes);
      if (!nodes || !closes || !analyse({ paths: [{ id: 0, closed: true, nodes }], mirrorX: null }).problems.length) break;
    }
    if (!nodes) return;
    // A stroke ending on the mirror line is meant to close on it.
    const m = d.mirrorX;
    const pin = (n: CncNode): CncNode => (m !== null && Math.abs(n.p[0] - m) * view.scale <= HIT_PX ? mapPath({ id: 0, closed: false, nodes: [n] }, (p) => [p[0] + m - n.p[0], p[1]]).nodes[0] : n);
    const finished = closes ? nodes : [pin(nodes[0]), ...nodes.slice(1, -1), pin(nodes[nodes.length - 1])];
    const id = d.nextId;
    commit({ ...d, nextId: id + 1, paths: [...d.paths, { id, closed: closes, nodes: finished }] });
    setSelection({ paths: [id], nodes: [] });
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const ge = gestureRef.current;
    // Press, drag and let go works as well as click, move, click.
    if (ge && (ge.kind === "move" || ge.kind === "scale") && Math.hypot(e.clientX - ge.press[0], e.clientY - ge.press[1]) > 5) {
      if (ge.kind === "move") finishMove(ge);
      else finishScale(ge);
      setGuides(null);
      return;
    }
    const g = drag.current;
    drag.current = null;
    dragDirty.current = false;
    setGuides(null);
    if (tool === "tape" && tape && !(tape.mode !== "guide" && tape.b) && Math.hypot(e.clientX - tape.pressX, e.clientY - tape.pressY) > 5) {
      const p = pointerAt(e);
      if (tape.mode === "guide") finishGuide(tape, snapped(p));
      else if (tape.mode === "square") finishSquare(tape, snapped(p));
      else finishMeasure(tape, aimed(p, e.shiftKey), makesLines(e));
      setGuides(null);
      return;
    }
    if (!g) return;
    const d = designRef.current;
    if (g.kind === "select") {
      if (g.box) finishBox(g, e);
      else clickSelect(g.at, e);
      return;
    }
    if (g.kind === "erase") return finishErase(g);
    if (g.kind === "marquee") return finishMarquee(g.add);
    if (g.kind === "pencil") return finishPencil(g.points);
    if (g.kind === "rect" || g.kind === "circle") {
      if (g.placing) {
        drag.current = g;
        return;
      }
      // Pressed and let go in place: the shape follows the cursor to a second click, as in the model.
      if (Math.hypot(e.clientX - pressAt.current[0], e.clientY - pressAt.current[1]) <= 4) {
        drag.current = { ...g, placing: true };
        return;
      }
      const path = d.paths.find((x) => x.id === g.id);
      const b = path && boundsOf(path);
      if (!b || Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]) * view.scale < 4) {
        undo();
        future.current = [];
        return;
      }
      setSelection({ paths: [g.id], nodes: [] });
    }
  };

  const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const p = pointerAt(e);
    const d = designRef.current;
    if (tool === "curve") {
      const node = hitNode(p);
      if (node) commit({ ...d, paths: d.paths.map((x) => (x.id === node.path ? setPointType(x, node.node, "corner", d.mirrorX) : x)) });
      return;
    }
    if (tool === "select") {
      // As a double-click opens a group in the model, it opens a shape's curves here.
      const id = hitLine(p)?.path ?? hitFill(p);
      if (id !== null && id !== undefined) {
        setToolState("node");
        setSelection({ paths: [id], nodes: [] });
        setNote({ text: "Editing the shape's points and curves. Esc goes back to Select.", error: false });
      }
      return;
    }
    if (tool !== "node") return;
    const node = hitNode(p);
    if (node) {
      commit({ ...d, paths: d.paths.map((x) => (x.id === node.path ? toggleSmooth(x, node.node) : x)) });
      return;
    }
    const line = hitLine(p);
    if (line) {
      commit({ ...d, paths: d.paths.map((x) => (x.id === line.path ? insertNode(x, line.segment, line.t) : x)) });
      setSelection({ paths: [], nodes: [{ path: line.path, node: line.segment + 1 }] });
    }
  };

  const deleteSelected = useCallback(() => {
    const d = designRef.current;
    if (selectedGuide !== null) {
      commit({ ...d, guides: d.guides.filter((g) => g.id !== selectedGuide) });
      setSelectedGuide(null);
      return;
    }
    if (!selection.nodes.length && !selection.paths.length) return;
    const paths = d.paths.flatMap((path) => {
      if (selection.paths.includes(path.id)) return [];
      const gone = new Set(selection.nodes.filter((r) => r.path === path.id).map((r) => r.node));
      if (!gone.size) return [path];
      const nodes = path.nodes.filter((_, i) => !gone.has(i));
      return nodes.length < (path.closed ? 3 : 2) ? [] : [{ ...path, nodes }];
    });
    commit({ ...d, paths });
    setSelection(NOTHING);
  }, [commit, selectedGuide, selection]);

  const duplicate = useCallback(() => {
    const d = designRef.current;
    const copies = d.paths.filter((x) => selection.paths.includes(x.id)).map((x, i) => ({ ...movePath(x, [16 / view.scale, -16 / view.scale]), id: d.nextId + i }));
    if (!copies.length) return;
    commit({ ...d, nextId: d.nextId + copies.length, paths: [...d.paths, ...copies] });
    setSelection({ paths: copies.map((c) => c.id), nodes: [] });
  }, [commit, selection.paths, view.scale]);

  const copyShapes = (cut: boolean) => {
    const d = designRef.current;
    const picked = d.paths.filter((x) => selection.paths.includes(x.id));
    if (!picked.length) return setNote({ text: "Select shapes first, then copy them.", error: false });
    clip.current = picked;
    if (cut) {
      commit({ ...d, paths: d.paths.filter((x) => !selection.paths.includes(x.id)) });
      setSelection(NOTHING);
    }
    setNote({ text: `${cut ? "Cut" : "Copied"} ${picked.length === 1 ? "a shape" : `${picked.length} shapes`}. Paste puts ${picked.length === 1 ? "it" : "them"} under the cursor.`, error: false });
  };

  const pasteShapes = () => {
    const d = designRef.current;
    const src = clip.current;
    if (!src.length) return setNote({ text: "Nothing to paste. Select shapes and copy them first.", error: false });
    const b = unionBounds(src)!;
    const centre: Pt = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2];
    const to = cursor ?? [centre[0] + 16 / view.scale, centre[1] - 16 / view.scale];
    const copies = src.map((x, i) => ({ ...movePath(x, sub2(to, centre)), id: d.nextId + i }));
    commit({ ...d, nextId: d.nextId + copies.length, paths: [...d.paths, ...copies] });
    setSelection({ paths: copies.map((c) => c.id), nodes: [] });
  };

  const nudge = (d: Pt) => {
    const step = snap ? grid.minor : metric(units) ? 0.001 : IN / 16;
    const by: Pt = [d[0] * step, d[1] * step];
    const now = designRef.current;
    if (!selection.nodes.length && !selection.paths.length) return;
    commit(transformed(now, selection, [(p) => add2(p, by)], false).design);
  };

  /** Backspace while drawing takes back the last point. */
  const dropLastPoint = useCallback(() => {
    const d = designRef.current;
    const p = d.paths.find((x) => x.id === penPath);
    if (!p) return false;
    if (p.nodes.length <= 1) {
      commit({ ...d, paths: d.paths.filter((x) => x.id !== p.id) });
      setPenPath(null);
    } else {
      commit({ ...d, paths: d.paths.map((x) => (x.id === p.id ? { ...x, nodes: x.nodes.slice(0, -1) } : x)) });
    }
    return true;
  }, [commit, penPath]);

  /** A tap of Ctrl (Cmd on a Mac) copies in Move and Rotate, as in the model. */
  const onTap = () => {
    if (tool === "tape") return setTapeMode(tapeMode === "reference" ? "measure" : "reference");
    if (tool !== "move" && tool !== "rotate") return;
    const now = !copy;
    setCopy(now);
    preview(gestureRef.current, now);
    setNote({ text: now ? "Copying: the original stays. Tap Ctrl again to move it instead." : "Moving (not copying).", error: false });
  };

  // ---- the value box ---------------------------------------------------------------------

  const spec = TOOLS.find((t) => t.id === tool)!;

  /** What the box shows while nothing is typed: the size the cursor is making. */
  const liveValue = (): string => {
    const g = gesture;
    const c = cursor ? resolveSnap(cursor).point : null;
    const placing = drag.current && (drag.current.kind === "rect" || drag.current.kind === "circle") ? drag.current : null;
    if (g?.kind === "move") return fmt(Math.hypot(...lockDelta(sub2(g.to, g.from))));
    if (g?.kind === "rotate") return `${Math.round(((g.angle * 180) / Math.PI) * 10) / 10}°`;
    if (g?.kind === "scale") return g.sx === g.sy ? String(Math.round(g.sx * 1000) / 1000) : `${Math.round(g.sx * 1000) / 1000}, ${Math.round(g.sy * 1000) / 1000}`;
    if (g?.kind === "offset") return fmt(Math.abs(g.d));
    if (g?.kind === "arc") return g.b ? fmt(Math.abs(g.bulge)) : c ? fmt(Math.hypot(c[0] - g.a[0], c[1] - g.a[1])) : "";
    if (placing && c) return placing.kind === "rect" ? `${fmt(Math.abs(c[0] - placing.at[0]))}, ${fmt(Math.abs(c[1] - placing.at[1]))}` : fmt(Math.hypot(c[0] - placing.at[0], c[1] - placing.at[1]));
    if (tool === "pen" && penLast && cursor) {
      const end = aim(cursor, shiftDown).point;
      return fmt(Math.hypot(end[0] - penLast.p[0], end[1] - penLast.p[1]));
    }
    if (tape?.mode === "guide" && c) return fmt(Math.abs(sideOffset(tape.base, tape.dir, c)));
    if (tape?.mode === "square") {
      const end = tape.b ?? c;
      return end ? fmt(Math.abs(sideOffset(tape.base, tape.dir, end))) : "";
    }
    if (tape?.mode === "measure") {
      const end = tape.b ?? (cursor ? aim(cursor, shiftDown).point : null);
      return end ? fmt(Math.hypot(end[0] - tape.a[0], end[1] - tape.a[1])) : "";
    }
    return "";
  };

  const length = (text: string): number | string => {
    const r = parseVcb(text, units);
    if (!r.ok) return r.error;
    if (r.value.kind !== "length" || r.value.m <= 0) return `${spec.label} takes a length here, such as 12 or 300mm.`;
    return r.value.m;
  };

  /** AutoCAD's XLINE Reference: a reference line at an angle to the line the Tape started on. */
  const guideAtAngle = (t: Extract<Tape, { mode: "guide" }>, deg: number) => {
    addGuide(t.at, dirOf(angleOf([0, 0], t.dir) + deg));
    setNote({ text: `Reference line at ${degrees(deg)} to that line.`, error: false });
  };

  /** What is typed in the Angle box, which reads a bare number as degrees. */
  const typedAngle = (text: string): number | string => {
    const t = text.trim();
    const r = parsePolar(t.includes("<") || /°|deg/i.test(t) ? t : `<${t}`, units);
    if (typeof r === "string") return "Type the angle in degrees, such as 30 or -45.";
    return r.angle ?? "Type the angle in degrees, such as 30 or -45.";
  };

  /** Enter or Tab in the Angle box. Tab only holds the angle; Enter also uses it. */
  const commitAngle = (text: string, use: boolean) => {
    setAngleText(null);
    if (text.trim() === "") return;
    const deg = typedAngle(text);
    if (typeof deg === "string") return setNote({ text: deg, error: true });
    if (tool === "tape" && tape?.mode === "measure" && !tape.b && use) {
      addGuide(tape.a, dirOf(deg));
      return setNote({ text: `Reference line at ${degrees(deg)} through that point.`, error: false });
    }
    if (tool === "tape" && tape?.mode === "guide" && use) return guideAtAngle(tape, deg);
    if (tool !== "pen") return;
    setLockAngle(deg);
    const path = designRef.current.paths.find((x) => x.id === penPath);
    if (use && lockLength !== null && path) {
      const from = path.nodes[path.nodes.length - 1].p;
      const u = dirOf(deg);
      clearLocks();
      addPenPoint(path, [from[0] + u[0] * lockLength, from[1] + u[1] * lockLength]);
      return;
    }
    setNote({ text: `Held at ${degrees(deg)}. ${lockLength !== null ? "Press Enter or click." : "Click, or type the length."}`, error: false });
  };

  /** Tab in the Length box: hold the length typed, and move to the angle. */
  const commitLengthTab = (text: string) => {
    setVcbText(null);
    if (tool === "pen" && text.trim() !== "") {
      const r = parsePolar(text, units);
      if (typeof r === "string") return setNote({ text: r, error: true });
      if (r.angle !== null) setLockAngle(r.angle);
      if (r.length !== null) setLockLength(r.length);
    }
    setAngleText("");
    requestAnimationFrame(() => angleInput.current?.focus({ preventScroll: true }));
  };

  const applyValue = (text: string) => {
    const fail = (t: string) => setNote({ text: t, error: true });
    const d = designRef.current;
    const g = gestureRef.current;
    const c = cursor;
    const r = parseVcb(text, units);
    // Arrays follow a copy, as in the model: x3 makes three, /3 divides the distance into three.
    if (r.ok && (r.value.kind === "array" || r.value.kind === "divide")) {
      const l = last.current;
      if (!l || (l.kind !== "move" && l.kind !== "rotate") || !l.copy || designRef.current !== l.result) return fail("Arrays follow a copy: tap Ctrl in Move or Rotate, copy, then type x3 or /3.");
      const n = r.value.kind === "array" ? r.value.copies : r.value.parts;
      const step = (k: number) => (r.value.kind === "array" ? k : k / n);
      const fs = Array.from({ length: n }, (_, i) => (l.kind === "move" ? (p: Pt) => add2(p, [l.delta[0] * step(i + 1), l.delta[1] * step(i + 1)]) : rotation(l.centre, l.angle * step(i + 1))));
      const { design: out, made } = transformed(l.base, l.subject, fs, true);
      setDesign(out);
      last.current = { ...l, result: out };
      setSelection({ paths: made, nodes: [] });
      return setNote({ text: r.value.kind === "array" ? `${n} copies.` : `Divided into ${n}.`, error: false });
    }
    switch (tool) {
      case "pen": {
        const path = d.paths.find((x) => x.id === penPath);
        const lastPoint = path?.nodes[path.nodes.length - 1].p;
        if (!path || !lastPoint) return fail("Click where the line starts, then type its length, an angle such as <30, or both, such as 10<30.");
        const typed = parsePolar(text, units);
        if (typeof typed === "string") return fail(typed);
        const angle = typed.angle ?? lockAngle;
        const m = typed.length ?? lockLength;
        if (m === null) {
          // An angle alone holds the line to it, as AutoCAD's <30 does; the length comes next.
          setLockAngle(angle);
          return setNote({ text: `Held at ${degrees(angle!)}. Click, or type the length.`, error: false });
        }
        let dir: Pt;
        if (angle !== null) dir = dirOf(angle);
        else {
          const towards = c ? sub2(aim(c, shiftDown).point, lastPoint) : ([0, 0] as Pt);
          const l = Math.hypot(towards[0], towards[1]);
          if (l === 0) return fail("Move the cursor to show the direction first, or type an angle too, such as 10<30.");
          dir = [towards[0] / l, towards[1] / l];
        }
        clearLocks();
        return addPenPoint(path, [lastPoint[0] + dir[0] * m, lastPoint[1] + dir[1] * m]);
      }
      case "rect":
      case "circle": {
        const placing = drag.current && drag.current.kind === tool ? drag.current : null;
        if (!placing) return fail(tool === "rect" ? "Click the first corner, then type the size, such as 24,12." : "Click the centre, then type the radius.");
        if (tool === "rect") {
          const sizes = r.ok && r.value.kind === "lengths" && r.value.m.length === 2 ? r.value.m : r.ok && r.value.kind === "length" ? [r.value.m, r.value.m] : null;
          if (!sizes || sizes.some((v) => v <= 0)) return fail("Type the width and height, such as 24,12.");
          const sx = c && c[0] < placing.at[0] ? -1 : 1;
          const sy = c && c[1] < placing.at[1] ? -1 : 1;
          updatePath(placing.id, (path) => ({ ...path, nodes: rectNodes(placing.at, [placing.at[0] + sx * sizes[0], placing.at[1] + sy * sizes[1]]) }));
        } else {
          const radius = r.ok && (r.value.kind === "length" || r.value.kind === "radius") ? r.value.m : 0;
          if (!(radius > 0)) return fail("Type a radius above zero.");
          updatePath(placing.id, (path) => ({ ...path, nodes: circleNodes(placing.at, radius) }));
        }
        drag.current = null;
        setSelection({ paths: [placing.id], nodes: [] });
        return;
      }
      case "arc": {
        if (g?.kind !== "arc" || !g.b) return fail("Click both ends of the arc first, then type the bulge.");
        const side = c ? Math.sign(bulgeFromPoint(g.a, g.b, c)) || 1 : 1;
        if (r.ok && r.value.kind === "radius") {
          const bulge = bulgeForRadius(g.a, g.b, r.value.m, side);
          if (bulge === null) return fail("That radius is smaller than half the distance between the ends.");
          return finishArc(g.a, g.b, bulge);
        }
        const m = length(text);
        if (typeof m === "string") return fail(m);
        return finishArc(g.a, g.b, side * m);
      }
      case "move": {
        const m = length(text);
        if (typeof m === "string") return fail(m);
        if (g?.kind === "move") {
          const dir = lockDelta(sub2(g.to, g.from));
          const l = Math.hypot(dir[0], dir[1]);
          if (l === 0) return fail("Move the cursor to show the direction first.");
          return finishMove({ ...g, from: [0, 0], to: [(dir[0] / l) * m, (dir[1] / l) * m] });
        }
        const l = last.current;
        if (l?.kind === "move" && designRef.current === l.result) {
          const k = m / Math.hypot(l.delta[0], l.delta[1]);
          const delta: Pt = [l.delta[0] * k, l.delta[1] * k];
          const out = transformed(l.base, l.subject, [(p) => add2(p, delta)], l.copy).design;
          setDesign(out);
          last.current = { ...l, delta, result: out };
          return setNote({ text: `Moved ${fmt(m)}.`, error: false });
        }
        return fail("Pick something up and show the way, then type the distance.");
      }
      case "rotate": {
        const deg = r.ok && r.value.kind === "angle" ? r.value.deg : Number(text.replace("°", "").trim());
        if (!Number.isFinite(deg)) return fail("Type an angle in degrees, such as 90 or -45.");
        const angle = (deg * Math.PI) / 180;
        if (g?.kind === "rotate") return finishRotate({ ...g, angle });
        const l = last.current;
        if (l?.kind === "rotate" && designRef.current === l.result) {
          const out = transformed(l.base, l.subject, [rotation(l.centre, angle)], l.copy).design;
          setDesign(out);
          last.current = { ...l, angle, result: out };
          return setNote({ text: `Turned ${deg}°.`, error: false });
        }
        return fail("Click the centre and where the angle starts, then type it.");
      }
      case "scale": {
        const t = text.includes(",") ? text.split(",").map((x) => Number(x.trim())) : null;
        const typed = parseScale(text, units);
        const box = g?.kind === "scale" ? g.box : selectedBox;
        if (!box) return fail("Select a shape, then type the scale.");
        const w = box.max[0] - box.min[0];
        const h = box.max[1] - box.min[1];
        let sx: number;
        let sy: number;
        if (t && t.length === 2 && t.every(Number.isFinite)) [sx, sy] = t;
        else if (typed.kind === "factor") {
          const along = g?.kind === "scale" ? g : { hx: 1, hy: 1 };
          sx = along.hx ? typed.t : 1;
          sy = along.hy ? typed.t : 1;
        } else if (typed.kind === "size") {
          const across = g?.kind === "scale" ? g.hx !== 0 : w >= h;
          const k = typed.m / (across ? w : h);
          sx = g?.kind === "scale" && !g.hx ? 1 : k;
          sy = g?.kind === "scale" && !g.hy ? 1 : k;
        } else return fail(typed.kind === "error" ? typed.text : "Type a factor (2), two (2,1), or a size with a unit (24in).");
        if (!sx || !sy) return fail("A scale of zero would flatten it.");
        if (g?.kind === "scale") return finishScale({ ...g, sx, sy });
        const startG: Extract<Gesture, { kind: "scale" }> = { kind: "scale", base: d, subject: { paths: selection.paths, nodes: [] }, box, hx: 1, hy: 1, sx, sy, centre: true, press: [0, 0] };
        setDesign(transformed(d, startG.subject, [(p) => [((box.min[0] + box.max[0]) / 2) + (p[0] - (box.min[0] + box.max[0]) / 2) * sx, ((box.min[1] + box.max[1]) / 2) + (p[1] - (box.min[1] + box.max[1]) / 2) * sy]], false).design);
        return finishScale(startG);
      }
      case "offset": {
        const m = length(text);
        if (typeof m === "string") return fail(m);
        if (g?.kind === "offset") return finishOffset({ ...g, d: (Math.sign(g.d) || -1) * m });
        const l = last.current;
        if (l?.kind === "offset" && designRef.current === l.result) {
          const dist = (Math.sign(l.d) || -1) * m;
          const out = offsetPath(l.source, dist);
          const problem = offsetProblem(l.source, out);
          if (problem) return fail(problem);
          const id = l.base.nextId;
          const next = { ...l.base, nextId: id + 1, paths: [...l.base.paths, { ...out, id }] };
          setDesign(next);
          last.current = { ...l, d: dist, result: next };
          return setNote({ text: `Offset ${fmt(m)}.`, error: false });
        }
        return fail("Click a shape and move in or out, then type the distance.");
      }
      case "tape": {
        if (tapeMode === "measure") return fail("Measure only adds nothing. Tap Ctrl to make reference lines, then type the distance or angle.");
        if (tape?.mode === "measure" && !tape.b) {
          // AutoCAD's XLINE at an angle: a reference line through the point clicked.
          const typed = parsePolar(text, units);
          if (typeof typed === "string") return fail(typed);
          if (typed.angle === null) return fail("Type an angle, such as <30 or 30°, for a reference line through that point.");
          addGuide(tape.a, dirOf(typed.angle));
          return setNote({ text: `Reference line at ${degrees(typed.angle)} through that point.`, error: false });
        }
        if (tape?.mode !== "guide") return fail("Click a line to measure from, then type the distance; or click a point, then type an angle such as <30.");
        const typed = parsePolar(text, units);
        if (typeof typed !== "string" && typed.angle !== null) return guideAtAngle(tape, typed.angle);
        const m = length(text);
        if (typeof m === "string") return fail(m);
        const side = c && sideOffset(tape.base, tape.dir, c) < 0 ? -1 : 1;
        addGuide(offsetPoint(tape.base, tape.dir, side * m), tape.dir);
        return setNote({ text: `Reference line ${fmt(m)} from that line.`, error: false });
      }
    }
  };

  useEffect(() => {
    // Typing into the box starts from the canvas, as in the model: the first key lands here.
    const input = vcbInput.current;
    if (vcbText !== null && input && document.activeElement !== input) {
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }, [vcbText]);

  // Keys stop here: the model's shortcuts must not reach a model nobody can see.
  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    // A ticked checkbox keeps the focus but takes no typing: the tool keys still work.
    const typing = (e.target instanceof HTMLInputElement && e.target.type !== "checkbox" && e.target.type !== "radio") || e.target instanceof HTMLSelectElement;
    tapKey.current.press(e.nativeEvent, !typing);
    if (typing) return;
    const action = actionForEvent(e.nativeEvent);
    const command = (id: string, run: () => void) => {
      if (action !== id) return false;
      e.preventDefault();
      run();
      return true;
    };
    if (
      command("undo", () => (cancelGesture() ? undefined : undo())) ||
      command("redo", redo) ||
      command("selectAll", () => {
        setToolState("select");
        setSelection({ paths: designRef.current.paths.map((x) => x.id), nodes: [] });
      }) ||
      command("copy", () => copyShapes(false)) ||
      command("cut", () => copyShapes(true)) ||
      command("paste", pasteShapes) ||
      command("zoomExtents", fit) ||
      command("feedback", () => setFeedbackOpen(true))
    )
      return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
      e.preventDefault();
      return duplicate();
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Tab" && angleShown) {
      e.preventDefault();
      setAngleText("");
      requestAnimationFrame(() => angleInput.current?.focus({ preventScroll: true }));
      return;
    }
    if (e.key === "Escape" && (lockAngle !== null || lockLength !== null)) {
      clearLocks();
      setNote({ text: "Let go of the angle and length.", error: false });
      return;
    }
    if (e.key === "Escape") {
      const placing = drag.current;
      if (placing && (placing.kind === "rect" || placing.kind === "circle")) {
        drag.current = null;
        undo();
        future.current = [];
      } else if (cancelGesture()) setNote(null);
      else if (measuring) setMeasuring(null);
      else if (tape) setTape(null);
      else if (penPath !== null) finishLine();
      else if (tool === "node" && !selection.nodes.length) setToolState("select");
      else {
        setSelection(NOTHING);
        setSelectedGuide(null);
      }
      return;
    }
    if (e.key === "Enter") return finishLine();
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      if (dropLastPoint()) return;
      return deleteSelected();
    }
    if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      // Mid-move the arrows lock a direction, as they do in the model; otherwise they nudge.
      if (gestureRef.current?.kind === "move") {
        const want = e.key === "ArrowRight" ? "x" : "y";
        setAxisLock((now) => (now === want ? null : want));
        return;
      }
      const k = e.shiftKey ? 10 : 1;
      return nudge(e.key === "ArrowLeft" ? [-k, 0] : e.key === "ArrowRight" ? [k, 0] : e.key === "ArrowUp" ? [0, k] : [0, -k]);
    }
    // "<" starts an angle, as AutoCAD's <30 does.
    if (spec.value && (startsValueEntry(e.key) || (e.key === "<" && angleShown))) {
      e.preventDefault();
      setVcbText(e.key);
      return;
    }
    const next = toolForKey(e.nativeEvent);
    if (next) {
      e.preventDefault();
      cancelGesture();
      setTool(next);
    }
  };

  // A panel field that goes away with its point (Round corner), Enter in a size box, or a
  // button clicked in the desktop's webview (WebKit does not focus a clicked button) leaves the
  // focus on the page itself. The model's keys listen there, so its tools would change behind
  // the workspace while these stayed dead. While this is open, keys with nowhere else to go
  // are this workspace's: the focus comes back here and the key with it.
  useEffect(() => {
    const reroute = (e: KeyboardEvent) => {
      const el = root.current;
      const at = document.activeElement;
      if (!el || !e.isTrusted || (at && at !== document.body && at !== document.documentElement)) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      el.focus({ preventScroll: true });
      el.dispatchEvent(new KeyboardEvent(e.type, { key: e.key, code: e.code, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey, repeat: e.repeat, bubbles: true, cancelable: true }));
    };
    window.addEventListener("keydown", reroute, true);
    window.addEventListener("keyup", reroute, true);
    return () => {
      window.removeEventListener("keydown", reroute, true);
      window.removeEventListener("keyup", reroute, true);
    };
  }, [root]);

  // ---- reference image ------------------------------------------------------------------

  const addImage = async () => {
    try {
      const file = await pickFile(IMAGE_TYPES, { requireActivation: true });
      if (!file) return;
      const lower = file.name.toLowerCase();
      const mime = lower.endsWith(".png") ? "image/png" : lower.endsWith(".jpg") || lower.endsWith(".jpeg") ? "image/jpeg" : null;
      if (!mime) return setNote({ text: `${file.name} is not a PNG or JPEG image.`, error: true });
      if (file.bytes.length > MAX_IMAGE_BYTES) return setNote({ text: `${file.name} is over 16 MB. Save a smaller copy and add that.`, error: true });
      const px = imageSize(file.bytes);
      if (!px || px.width < 1 || px.height < 1) return setNote({ text: `${file.name} could not be read as an image.`, error: true });
      if (px.width > MAX_IMAGE_PX || px.height > MAX_IMAGE_PX) return setNote({ text: `${file.name} is ${px.width} x ${px.height} pixels. A reference image can be at most 4096 x 4096.`, error: true });
      if (pendingImage) URL.revokeObjectURL(pendingImage.url);
      setPendingImage({ bytes: file.bytes, mime, url: URL.createObjectURL(new Blob([file.bytes as BlobPart], { type: mime })) });
      const width = 24 * IN;
      const aspect = px.height / px.width;
      commit({ ...designRef.current, reference: { path: null, x: view.cx - width / 2, y: view.cy - (width * aspect) / 2, width, aspect, opacity: 0.5 } });
      setNote({ text: "Image added at a rough size. Use Set Scale to give it its real size.", error: false });
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : String(e), error: true });
    }
  };

  useEffect(() => () => {
    if (pendingImage) URL.revokeObjectURL(pendingImage.url);
    // Only when the workspace goes: a replaced image is revoked where it is replaced.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyScale = () => {
    const d = designRef.current;
    if (!measuring?.a || !measuring.b || !d.reference) return;
    const r = parseVcb(measureText, units);
    if (!r.ok || r.value.kind !== "length" || r.value.m <= 0) return setNote({ text: r.ok ? "Type the real distance between the two points, such as 12 or 300mm." : r.error, error: true });
    const span = Math.hypot(measuring.b[0] - measuring.a[0], measuring.b[1] - measuring.a[1]);
    if (span <= 0) return setNote({ text: "Those two clicks are the same place. Pick two points apart.", error: true });
    const k = r.value.m / span;
    const a = measuring.a;
    commit({ ...d, reference: { ...d.reference, x: a[0] + (d.reference.x - a[0]) * k, y: a[1] + (d.reference.y - a[1]) * k, width: d.reference.width * k } });
    setMeasuring(null);
    setMeasureText("");
    setNote({ text: `The image is now to scale: those two points are ${fmt(r.value.m)} apart.`, error: false });
    requestAnimationFrame(fit);
  };

  const referenceHref = pendingImage?.url ?? (design.reference?.path ? imageHref(design.reference.path) : null);

  // ---- keeping and bringing in -----------------------------------------------------------

  /** The ops that keep this drawing with the model, its image first. */
  const keepOps = useCallback((): { ops: KernelOp[]; design: CncDesign } => {
    let d = designRef.current;
    const ops: KernelOp[] = [];
    if (pendingImage && d.reference && !d.reference.path) {
      const taken = new Set((state?.textures ?? []).map((t) => t.path));
      const ext = pendingImage.mime === "image/png" ? "png" : "jpg";
      let n = 1;
      let path = `assets/cnc-${drawingId}.${ext}`;
      while (taken.has(path)) path = `assets/cnc-${drawingId}-${++n}.${ext}`;
      ops.push({ op: "add_texture", path, mime: pendingImage.mime, data: toBase64(pendingImage.bytes) });
      d = { ...d, reference: { ...d.reference, path } };
    }
    ops.push({ op: "set_cnc_drawing", id: drawingId, json: JSON.stringify(d) });
    return { ops, design: d };
  }, [drawingId, pendingImage, state?.textures]);

  const hasWork = design.paths.length > 0 || design.reference !== null;
  // A kept drawing emptied out is still a change: reopening it must not bring the shapes back.
  const unsaved = (hasWork || keptJson !== null) && JSON.stringify(design) !== keptJson;

  /** Keep the drawing before leaving it. False: it could not be kept, so stay. */
  const keep = useCallback(async (): Promise<boolean> => {
    if (!unsaved) return true;
    const { ops, design: d } = keepOps();
    const r = await apply({ op: "batch", ops }, () => `Kept the drawing ${d.name} with this model.`);
    if (!r) {
      setNote({ text: lastError() ?? "That drawing could not be kept.", error: true });
      return false;
    }
    setDesign(d);
    setKeptJson(JSON.stringify(d));
    return true;
  }, [apply, keepOps, lastError, setDesign, unsaved]);

  const close = async () => {
    if (busy) return;
    finishLine();
    setBusy(true);
    const ok = await keep();
    setBusy(false);
    if (ok) onClose(unsaved ? `Kept the drawing ${designRef.current.name} with this model. Tools > CNC opens it again.` : undefined);
  };

  const open = async (value: string) => {
    if (busy) return;
    finishLine();
    setBusy(true);
    const ok = await keep();
    setBusy(false);
    if (!ok) return;
    const found = saved.find((s) => String(s.id) === value);
    const id = found ? found.id : Math.max(drawingId, nextDrawingId()) + (value === "new" ? 1 : 0);
    const next = found?.design ?? blank(units, (state?.cnc_drawings?.length ?? 0) + 2);
    past.current = [];
    future.current = [];
    setDrawingId(id);
    setDesign(next);
    setKeptJson(found ? JSON.stringify(found.design) : null);
    setPendingImage(null);
    setSelection(NOTHING);
    setSelectedGuide(null);
    setTape(null);
    setToolState(next.paths.length ? "select" : "pen");
  };

  const remove = async () => {
    if (busy || !saved.some((s) => s.id === drawingId)) return;
    if (!(await apply({ op: "set_cnc_drawing", id: drawingId }, () => `Deleted the drawing ${design.name}. Undo in the model brings it back.`))) return setNote({ text: lastError() ?? "That drawing could not be deleted.", error: true });
    onClose(`Deleted the drawing ${design.name}. Undo brings it back.`);
  };

  const canBringIn = analysis.parts.length > 0 && analysis.problems.length === 0 && design.thickness > 0 && penPath === null;

  const bringIn = async () => {
    if (busy || !canBringIn) return;
    setBusy(true);
    const { ops, design: d } = keepOps();
    const made = analysis.parts.length;
    const words = `${made === 1 ? "a part" : `${made} parts`}, ${fmt(d.thickness)} thick`;
    const r = await apply({ op: "batch", ops: [...ops, ...partOps(analysis, d.thickness, d.standing, d.name)] }, () => `Brought in ${words}.`);
    setBusy(false);
    if (!r) return setNote({ text: lastError() ?? "That drawing could not become a part.", error: true });
    onPlaced(outcomeObjects(r), `Brought in ${words}. Move to where it goes and click, or press Esc to leave it at the origin.`);
  };

  // ---- fields ----------------------------------------------------------------------------

  const [thicknessText, setThicknessText] = useState(() => fmt(design.thickness));
  useEffect(() => setThicknessText(fmt(design.thickness)), [fmt, design.thickness]);
  const commitThickness = () => {
    const r = parseVcb(thicknessText, units);
    if (!r.ok || r.value.kind !== "length" || r.value.m <= 0) {
      setThicknessText(fmt(designRef.current.thickness));
      return setNote({ text: r.ok ? "Thickness is a length above zero, such as 3/4 or 18mm." : r.error, error: true });
    }
    if (r.value.m !== designRef.current.thickness) commit({ ...designRef.current, thickness: r.value.m });
  };

  const selW = selectedBox ? selectedBox.max[0] - selectedBox.min[0] : 0;
  const selH = selectedBox ? selectedBox.max[1] - selectedBox.min[1] : 0;

  /** Change the selected shapes through `f`, about the centre of all of them. */
  const transformSelected = (f: (p: Pt, c: Pt) => Pt) => {
    if (!selectedBox) return;
    const c: Pt = [(selectedBox.min[0] + selectedBox.max[0]) / 2, (selectedBox.min[1] + selectedBox.max[1]) / 2];
    const d = designRef.current;
    commit({ ...d, paths: d.paths.map((x) => (selection.paths.includes(x.id) ? mapPath(x, (p) => f(p, c)) : x)) });
  };

  const resize = (axis: "w" | "h", text: string) => {
    const r = parseVcb(text, units);
    if (!r.ok || r.value.kind !== "length" || r.value.m <= 0) return setNote({ text: "Type a size above zero, such as 12 or 300mm.", error: true });
    const was = axis === "w" ? selW : selH;
    if (was <= 0 || Math.abs(r.value.m - was) < 1e-9) return;
    const k = r.value.m / was;
    transformSelected((p, c) => (axis === "w" ? [c[0] + (p[0] - c[0]) * k, p[1]] : [p[0], c[1] + (p[1] - c[1]) * k]));
  };

  const rotate = (text: string) => {
    const deg = Number(text.replace("°", "").trim());
    if (!Number.isFinite(deg)) return setNote({ text: "Type an angle in degrees, such as 15 or -90.", error: true });
    if (!deg) return;
    const a = (deg * Math.PI) / 180;
    const [cos, sin] = [Math.cos(a), Math.sin(a)];
    transformSelected((p, c) => [c[0] + (p[0] - c[0]) * cos - (p[1] - c[1]) * sin, c[1] + (p[0] - c[0]) * sin + (p[1] - c[1]) * cos]);
  };

  const selectedNodes = selection.nodes.flatMap((r) => {
    const n = design.paths.find((x) => x.id === r.path)?.nodes[r.node];
    return n ? [{ ref: r, node: n }] : [];
  });
  const commonType = selectedNodes.length && selectedNodes.every((s) => pointType(s.node) === pointType(selectedNodes[0].node)) ? pointType(selectedNodes[0].node) : null;

  const changeType = (type: PointType) => {
    const d = designRef.current;
    commit({ ...d, paths: d.paths.map((x) => selection.nodes.filter((r) => r.path === x.id).reduce((path, r) => setPointType(path, r.node, type, d.mirrorX), x)) });
  };

  const movePointTo = (axis: 0 | 1, text: string) => {
    const r = parseVcb(text.replace(/^-/, ""), units);
    const only = selectedNodes[0];
    if (!r.ok || r.value.kind !== "length" || !only) return setNote({ text: "Type a position, such as 12 or 300mm.", error: true });
    const value = text.trim().startsWith("-") ? -r.value.m : r.value.m;
    const delta: Pt = axis === 0 ? [value - only.node.p[0], 0] : [0, value - only.node.p[1]];
    updateAfterCheckpoint(only.ref, delta);
  };
  const updateAfterCheckpoint = (ref: NodeRef, delta: Pt) => {
    checkpoint();
    updatePath(ref.path, (path) => ({ ...path, nodes: path.nodes.map((n, i) => (i === ref.node ? { ...n, p: add2(n.p, delta), ...(n.in ? { in: add2(n.in, delta) } : {}), ...(n.out ? { out: add2(n.out, delta) } : {}) } : n)) }));
  };

  const [radiusText, setRadiusText] = useState("");
  const applyRadius = () => {
    const r = parseVcb(radiusText, units);
    if (!r.ok || r.value.kind !== "length" || r.value.m <= 0) return setNote({ text: "Type a radius above zero, such as 1/2 or 12mm.", error: true });
    const radius = r.value.m;
    const d = designRef.current;
    let paths = d.paths;
    // From the last point back: rounding one adds a point, which would renumber those after it.
    for (const ref of [...selection.nodes].sort((a, b) => b.node - a.node)) {
      const path = paths.find((x) => x.id === ref.path);
      if (!path) continue;
      const out = roundCorner(path, ref.node, radius);
      if (typeof out === "string") return setNote({ text: out, error: true });
      paths = paths.map((x) => (x.id === out.id ? out : x));
    }
    commit({ ...d, paths });
    setSelection(NOTHING);
    setRadiusText("");
  };

  // ---- drawing ---------------------------------------------------------------------------

  const grid = gridStep(view.scale, units);
  const lines = useMemo(() => {
    const out: { x1: number; y1: number; x2: number; y2: number; major: boolean }[] = [];
    const lo = toWorld(0, size.h);
    const hi = toWorld(size.w, 0);
    const near = (v: number, s: number) => Math.abs(v / s - Math.round(v / s)) < 1e-6;
    for (let i = Math.ceil(lo[0] / grid.minor); i * grid.minor <= hi[0] && out.length < 800; i++) {
      const x = toScreen([i * grid.minor, 0])[0];
      out.push({ x1: x, y1: 0, x2: x, y2: size.h, major: near(i * grid.minor, grid.major) });
    }
    for (let i = Math.ceil(lo[1] / grid.minor); i * grid.minor <= hi[1] && out.length < 1600; i++) {
      const y = toScreen([0, i * grid.minor])[1];
      out.push({ x1: 0, y1: y, x2: size.w, y2: y, major: near(i * grid.minor, grid.major) });
    }
    return out;
  }, [grid.major, grid.minor, size, toScreen, toWorld]);

  // A line still being drawn is not a mistake yet.
  const problems = analysis.problems.filter((p) => p.pathId === null || p.pathId !== penPath);
  const troubled = new Set(problems.flatMap((p) => (p.pathId === null ? [] : [p.pathId])));
  const fill = design.paths
    .filter((p) => p.closed || design.mirrorX !== null)
    .map((p) => {
      if (design.mirrorX === null) return pathData(p.nodes, true, toScreen);
      if (!p.closed) return pathData([...p.nodes, ...reflected(p, design.mirrorX).slice(1, -1)], true, toScreen);
      return pathData(p.nodes, true, toScreen) + pathData(reflected(p, design.mirrorX), true, toScreen);
    })
    .join("");

  /** A reference line's ends, well past the edges of the board. */
  const endless = (p: Pt, dir: Pt): [Pt, Pt] => {
    const reach = Math.hypot(size.w, size.h) / view.scale;
    const centre: Pt = [view.cx, view.cy];
    const along = (centre[0] - p[0]) * dir[0] + (centre[1] - p[1]) * dir[1];
    const mid: Pt = [p[0] + dir[0] * along, p[1] + dir[1] * along];
    return [toScreen([mid[0] - dir[0] * reach, mid[1] - dir[1] * reach]), toScreen([mid[0] + dir[0] * reach, mid[1] + dir[1] * reach])];
  };

  const pen = penPath !== null ? design.paths.find((p) => p.id === penPath) ?? null : null;
  const penLast = pen?.nodes[pen.nodes.length - 1];
  const from = aimFrom();
  const aimNow = cursor && !drag.current ? (from ? aim(cursor, shiftDown) : resolveSnap(cursor)) : null;
  const previewEnd = aimNow?.point ?? null;
  // The angle to the line before, as Fusion shows it while a line carries on.
  const prevDir: Pt | null = tool === "pen" && pen && pen.nodes.length >= 2 ? (() => {
    const a = pen.nodes[pen.nodes.length - 2].p;
    const b = pen.nodes[pen.nodes.length - 1].p;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return l > 0 ? [(b[0] - a[0]) / l, (b[1] - a[1]) / l] : null;
  })() : null;
  const angleShown = tool === "pen" ? penPath !== null : tool === "tape" && tapeMode === "reference" && !!tape && tape.mode !== "square" && !(tape.mode === "measure" && tape.b);
  const liveAngle = (): string => {
    if (lockAngle !== null) return degrees(lockAngle);
    if (!from || !previewEnd || (previewEnd[0] === from[0] && previewEnd[1] === from[1])) return "";
    return degrees(angleOf(from, previewEnd));
  };

  const size2 = analysis.bounds ? [analysis.bounds.max[0] - analysis.bounds.min[0], analysis.bounds.max[1] - analysis.bounds.min[1]] : null;
  const summary = analysis.problems.length
    ? null
    : analysis.parts.length
      ? `${analysis.parts.length === 1 ? "1 part" : `${analysis.parts.length} parts`}${analysis.holes ? `, ${analysis.holes === 1 ? "1 hole" : `${analysis.holes} holes`}` : ""}`
      : null;
  const gestureHint = gesture?.kind === "move"
    ? `Move to where it goes and click, or type a distance. ${copy ? "Copying." : "Tap Ctrl to copy."} Arrow keys lock across or up. Esc cancels.`
    : gesture?.kind === "rotate"
      ? gesture.ref ? "Click where the angle ends, or type it. Esc cancels." : "Click where the angle starts."
      : gesture?.kind === "scale"
        ? "Move and click, or type a factor or a size. Shift keeps the proportions; Ctrl scales about the centre."
        : gesture?.kind === "offset"
          ? "Move in or out and click, or type the distance. Esc cancels."
          : gesture?.kind === "arc"
            ? gesture.b ? "Move out for the bulge and click, or type it (12r for a radius)." : "Click the other end of the arc."
            : drag.current && (drag.current.kind === "rect" || drag.current.kind === "circle") && drag.current.placing
              ? drag.current.kind === "rect" ? "Click the opposite corner, or type the size, such as 24,12." : "Click the radius, or type it."
              : null;
  const activeHint = gestureHint ?? (measuring ? (!measuring.a ? "Click one end of something whose real size you know." : !measuring.b ? "Click the other end." : "Type the real distance between those two points.") : tape?.mode === "guide" ? "Move away and click where the reference line goes, or type the distance and press Enter. Esc cancels." : tape?.mode === "measure" && !tape.b ? (tapeMode === "reference" ? "Click a second point for a reference line through both, or type an angle such as <30. Option-click only measures." : "Click the other end to measure. Option-click for a reference line through both.") : tape?.mode === "square" && !tape.b ? "Move away and click to measure square to the line." : tool === "tape" && tapeMode === "measure" && !tape ? "Measure only: click two points, or a line and then a point. Nothing is added. Tap Ctrl for reference lines." : hover === "first" ? "Click to close the shape." : hover === "reference" ? (tapeMode === "reference" ? "Click to pull a reference line off this line." : "Click to measure square to this line.") : (TOOLS.find((t) => t.id === tool)?.hint ?? ""));
  const cursorStyle = tool === "select"
      ? "default"
      : tool === "scale" && hover === "box"
        ? "nwse-resize"
      : tool === "erase"
        ? hover ? "pointer" : "default"
      : tool === "node"
        ? hover === "line" ? "grab" : hover ? "pointer" : "default"
        : tool === "image"
          ? "move"
          : hover === "first" ? "pointer" : "crosshair";

  return (
    <section
      ref={root as React.RefObject<HTMLElement>}
      className="cnc"
      role="dialog"
      aria-label="CNC drawing"
      onKeyDown={onKeyDown}
      onKeyUp={(e) => {
        e.stopPropagation();
        if (tapKey.current.release(e.key) === "ctrl") onTap();
      }}
    >
      <header className="cnc-top">
        <h1 className="cnc-title">CNC</h1>
        <label className="cnc-field-inline">
          <span className="sr-only">Drawing</span>
          <select aria-label="Drawing" value={saved.some((s) => s.id === drawingId) ? String(drawingId) : "current"} onChange={(e) => void open(e.target.value)} disabled={busy}>
            {saved.some((s) => s.id === drawingId) ? null : <option value="current">{design.name}</option>}
            {saved.map((s) => (
              <option key={s.id} value={String(s.id)}>{s.id === drawingId ? design.name : s.design.name}</option>
            ))}
            <option value="new">New drawing</option>
          </select>
        </label>
        {saved.some((s) => s.id === drawingId) ? <button type="button" className="cnc-btn" onClick={() => void remove()} disabled={busy}>Delete</button> : null}
        <span className="cnc-spacer" />
        <button type="button" className="cnc-btn" onClick={undo} disabled={!past.current.length}>Undo</button>
        <button type="button" className="cnc-btn" onClick={redo} disabled={!future.current.length}>Redo</button>
        <button type="button" className="cnc-btn" onClick={fit}>Fit</button>
        <span className="cnc-sep" />
        <button type="button" className="cnc-btn" onClick={() => void close()} disabled={busy}>Close</button>
        <button type="button" className="cnc-btn primary" onClick={() => void bringIn()} disabled={busy || !canBringIn} title={canBringIn ? "Make this drawing a part in the model" : "Finish the drawing first: see Part on the right"}>Bring In</button>
      </header>

      <nav className="rail cnc-rail" aria-label="Drawing tools">
        {TOOL_GROUPS.map((group, gi) => (
          <div className="grp" key={gi}>
            {group.map((t) => {
              const k = keyOf(t);
              return (
                <button key={t.id} type="button" className="tool" title={platformText(`${t.label}${k ? ` (${k})` : ""}. ${t.hint}`)} aria-pressed={tool === t.id && !measuring} onClick={() => setTool(t.id)}>
                  {k ? <kbd>{k}</kbd> : null}
                  <svg viewBox="0 0 24 24" aria-hidden="true">{t.glyph}</svg>
                  <small>{t.label}</small>
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="cnc-board" ref={board}>
        <svg
          ref={svgRef}
          className="cnc-svg"
          width={size.w}
          height={size.h}
          data-testid="cnc-board"
          style={{ cursor: cursorStyle }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => setCursor(null)}
          onDoubleClick={onDoubleClick}
          onWheel={onWheel}
          onContextMenu={(e) => e.preventDefault()}
        >
          <g className="cnc-grid">
            {lines.map((l, i) => (
              <line key={i} {...{ x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2 }} className={l.major ? "major" : undefined} />
            ))}
          </g>
          {design.reference && referenceHref ? (() => {
            const r = design.reference;
            const [x, y] = toScreen([r.x, r.y + r.width * r.aspect]);
            return <image href={referenceHref} x={x} y={y} width={r.width * view.scale} height={r.width * r.aspect * view.scale} opacity={r.opacity} preserveAspectRatio="none" />;
          })() : null}
          <line className="cnc-axis" x1={toScreen([0, 0])[0]} y1={0} x2={toScreen([0, 0])[0]} y2={size.h} />
          <line className="cnc-axis" x1={0} y1={toScreen([0, 0])[1]} x2={size.w} y2={toScreen([0, 0])[1]} />
          {design.guides.map((g) => {
            const [a, b] = endless(g.p, g.dir);
            return <line key={g.id} className={`cnc-ref${selectedGuide === g.id ? " sel" : ""}`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />;
          })}
          {tape?.mode === "guide" && cursor ? (() => {
            const off = sideOffset(tape.base, tape.dir, resolveSnap(cursor).point);
            const [a, b] = endless(offsetPoint(tape.base, tape.dir, off), tape.dir);
            return <line className="cnc-ref live" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />;
          })() : null}
          {fill ? <path className="cnc-fill" d={fill} fillRule="evenodd" /> : null}
          {design.mirrorX !== null ? (
            <>
              <line className="cnc-mirror" x1={toScreen([design.mirrorX, 0])[0]} y1={0} x2={toScreen([design.mirrorX, 0])[0]} y2={size.h} />
              {design.paths.map((p) => <path key={p.id} className="cnc-ghost" d={pathData(reflected(p, design.mirrorX!), p.closed, toScreen)} />)}
            </>
          ) : null}
          {design.paths.map((p) => (
            <path key={p.id} className={`cnc-path${selection.paths.includes(p.id) ? " sel" : ""}${troubled.has(p.id) ? " bad" : ""}`} d={pathData(p.nodes, p.closed, toScreen)} />
          ))}
          {pen && previewEnd && tool === "curve" ? (
            <path className="cnc-rubber" d={pathData(relaxAuto({ ...pen, closed: hover === "first", nodes: hover === "first" ? pen.nodes : [...pen.nodes, { p: previewEnd, auto: true }] }, design.mirrorX).nodes, hover === "first", toScreen)} />
          ) : null}
          {pen && penLast && previewEnd && tool === "pen" ? (
            <path className="cnc-rubber" d={pathData([penLast, { ...pen.nodes[0], p: hover === "first" ? pen.nodes[0].p : previewEnd, in: hover === "first" ? pen.nodes[0].in : undefined, out: undefined }], false, toScreen)} />
          ) : null}
          {pencilLive ? <polyline className="cnc-pencil" points={pencilLive.map((p) => toScreen(p).map((v) => v.toFixed(1)).join(",")).join(" ")} /> : null}
          {guides?.x !== undefined ? <line className="cnc-guide" x1={toScreen([guides.x, 0])[0]} y1={0} x2={toScreen([guides.x, 0])[0]} y2={size.h} /> : null}
          {guides?.y !== undefined ? <line className="cnc-guide" x1={0} y1={toScreen([0, guides.y])[1]} x2={size.w} y2={toScreen([0, guides.y])[1]} /> : null}
          {erasing ? (
            <g className="cnc-erasing">
              {[...erasing.segs].flatMap(([id, segs]) => {
                const path = design.paths.find((x) => x.id === id);
                return path ? [...segs].map((i) => <path key={`${id}:${i}`} d={segmentData(path, i, toScreen)} />) : [];
              })}
              {design.guides.filter((g) => erasing.guides.has(g.id)).map((g) => {
                const [a, b] = endless(g.p, g.dir);
                return <line key={g.id} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />;
              })}
            </g>
          ) : null}
          {gesture?.kind === "arc" && cursor ? (() => {
            const end = gesture.b ?? resolveSnap(cursor).point;
            return <path className="cnc-rubber" d={pathData(gesture.b ? arcNodes(gesture.a, gesture.b, gesture.bulge) : [{ p: gesture.a }, { p: end }], false, toScreen)} />;
          })() : null}
          {gesture?.kind === "move" ? (() => {
            const [ax, ay] = toScreen(gesture.from);
            const [bx, by] = toScreen(add2(gesture.from, lockDelta(sub2(gesture.to, gesture.from))));
            return <line className={`cnc-move-line${axisLock ? ` lock-${axisLock}` : ""}`} x1={ax} y1={ay} x2={bx} y2={by} />;
          })() : null}
          {gesture?.kind === "rotate" ? (() => {
            const [cx, cy] = toScreen(gesture.centre);
            const end = gesture.ref ? rotation(gesture.centre, gesture.angle)(gesture.ref) : cursor ? resolveSnap(cursor).point : gesture.centre;
            const r = 46;
            const spoke = (q: Pt) => {
              const d2 = sub2(q, gesture.centre);
              const l = Math.hypot(d2[0], d2[1]) || 1;
              return [cx + (d2[0] / l) * r * 1.4, cy - (d2[1] / l) * r * 1.4];
            };
            return (
              <g className="cnc-protractor">
                <circle cx={cx} cy={cy} r={r} />
                {Array.from({ length: 24 }, (_, i) => {
                  const a = (i * Math.PI) / 12;
                  return <line key={i} x1={cx + Math.cos(a) * (r - (i % 6 ? 4 : 8))} y1={cy - Math.sin(a) * (r - (i % 6 ? 4 : 8))} x2={cx + Math.cos(a) * r} y2={cy - Math.sin(a) * r} />;
                })}
                {gesture.ref ? <line className="ref" x1={cx} y1={cy} x2={spoke(gesture.ref)[0]} y2={spoke(gesture.ref)[1]} /> : null}
                <line x1={cx} y1={cy} x2={spoke(end)[0]} y2={spoke(end)[1]} />
              </g>
            );
          })() : null}
          {from && previewEnd && aimNow?.track && lockAngle === null ? (() => {
            // AutoCAD's tracking line: the step the aim is on, drawn out past the cursor.
            const u = dirOf(aimNow.track.angle);
            const reach = Math.hypot(size.w, size.h) / view.scale;
            const [ax, ay] = toScreen(from);
            const [bx, by] = toScreen([from[0] + u[0] * reach, from[1] + u[1] * reach]);
            return <line className="cnc-track" x1={ax} y1={ay} x2={bx} y2={by} />;
          })() : null}
          {from && previewEnd && lockAngle !== null ? (() => {
            const u = dirOf(lockAngle);
            const reach = Math.hypot(size.w, size.h) / view.scale;
            const [ax, ay] = toScreen(from);
            const [bx, by] = toScreen([from[0] + u[0] * reach, from[1] + u[1] * reach]);
            return <line className="cnc-track held" x1={ax} y1={ay} x2={bx} y2={by} />;
          })() : null}
          {protractor && from && previewEnd && Math.hypot(previewEnd[0] - from[0], previewEnd[1] - from[1]) * view.scale > 6 ? (() => {
            const [cx, cy] = toScreen(from);
            const r = 52;
            const angle = angleOf(from, previewEnd);
            const t = (angle * Math.PI) / 180;
            const at = (a: number, k: number): Pt => [cx + Math.cos(a) * k, cy - Math.sin(a) * k];
            const [ex, ey] = at(t, r);
            const mid = at(t / 2, r + 16);
            const ticks = Math.round(360 / polarStep);
            const turn = prevDir ? turnBetween(prevDir, dirOf(angle)) : null;
            return (
              <g className="cnc-protractor aim" aria-hidden="true">
                <circle cx={cx} cy={cy} r={r} />
                {Array.from({ length: ticks }, (_, i) => {
                  const a = (i * polarStep * Math.PI) / 180;
                  const big = (i * polarStep) % 90 === 0;
                  const [x1, y1] = at(a, r - (big ? 9 : 5));
                  const [x2, y2] = at(a, r);
                  return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />;
                })}
                <line className="ref" x1={cx} y1={cy} x2={cx + r * 1.35} y2={cy} />
                <path className="sweep" d={`M${cx + r * 0.6} ${cy}A${r * 0.6} ${r * 0.6} 0 0 ${angle > 0 ? 0 : 1} ${at(t, r * 0.6)[0]} ${at(t, r * 0.6)[1]}`} />
                <line x1={cx} y1={cy} x2={ex} y2={ey} />
                <text className="cnc-tape-label cnc-angle-label" x={mid[0]} y={mid[1] + 4} textAnchor="middle">{degrees(angle)}</text>
                {turn !== null ? <text className="cnc-tape-label cnc-angle-label quiet" x={cx} y={cy + r + 18} textAnchor="middle">{degrees(turn)} to the last line</text> : null}
              </g>
            );
          })() : null}
          {tool === "select" ? selection.nodes.map((r) => {
            const n = design.paths.find((x) => x.id === r.path)?.nodes[r.node];
            if (!n) return null;
            const [x, y] = toScreen(n.p);
            return <rect key={nodeKey(r)} className="cnc-node on" x={x - 3.5} y={y - 3.5} width={7} height={7} />;
          }) : null}
          {tool === "scale" && selectedBox ? (() => {
            const [x0, y0] = toScreen([selectedBox.min[0], selectedBox.max[1]]);
            const [x1, y1] = toScreen([selectedBox.max[0], selectedBox.min[1]]);
            const cx = (x0 + x1) / 2;
            const cy = (y0 + y1) / 2;
            return (
              <g>
                <rect className="cnc-bbox" x={x0} y={y0} width={x1 - x0} height={y1 - y0} />
                {BOX_HANDLES.map(([hx, hy]) => <rect key={`${hx}${hy}`} className="cnc-box-handle" x={cx + (hx * (x1 - x0)) / 2 - 4} y={cy - (hy * (y1 - y0)) / 2 - 4} width={8} height={8} />)}
              </g>
            );
          })() : null}
          {visibleHandles.filter(() => tool === "node" || tool === "curve").map((h) => {
            const [x, y] = toScreen(h.from);
            const [hx, hy] = toScreen(h.at);
            return (
              <g key={`${h.path}:${h.node}:${h.side}`}>
                <line className="cnc-arm" x1={x} y1={y} x2={hx} y2={hy} />
                <circle className="cnc-handle" cx={hx} cy={hy} r={4} />
              </g>
            );
          })}
          {design.paths.filter((p) => tool === "node" || (tool === "curve" && penPath === null) || p.id === penPath).map((p) => (
            <g key={p.id}>
              {p.nodes.map((n, i) => {
                const [x, y] = toScreen(n.p);
                const on = selection.nodes.some((r) => r.path === p.id && r.node === i);
                const closing = hover === "first" && p.id === penPath && i === 0;
                return <rect key={i} className={`cnc-node${on ? " on" : ""}${pointType(n) !== "corner" ? " curve" : ""}${closing ? " closing" : ""}`} x={x - 3.5} y={y - 3.5} width={7} height={7} />;
              })}
            </g>
          ))}
          {marquee ? (() => {
            const [x0, y0] = toScreen([marquee.min[0], marquee.max[1]]);
            const [x1, y1] = toScreen([marquee.max[0], marquee.min[1]]);
            return <rect className={`cnc-marquee${marquee.crossing ? " crossing" : ""}`} x={x0} y={y0} width={x1 - x0} height={y1 - y0} />;
          })() : null}
          {tape?.mode === "measure" && !tape.b && tapeMode === "reference" && previewEnd && Math.hypot(previewEnd[0] - tape.a[0], previewEnd[1] - tape.a[1]) * view.scale > 2 ? (() => {
            const d2 = sub2(previewEnd, tape.a);
            const l = Math.hypot(d2[0], d2[1]);
            const [a, b] = endless(tape.a, [d2[0] / l, d2[1] / l]);
            return <line className="cnc-ref live" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />;
          })() : null}
          {tape?.mode === "square" ? (() => {
            const end = tape.b ?? (cursor ? resolveSnap(cursor).point : null);
            if (!end) return null;
            const t = (end[0] - tape.base[0]) * tape.dir[0] + (end[1] - tape.base[1]) * tape.dir[1];
            const foot: Pt = [tape.base[0] + tape.dir[0] * t, tape.base[1] + tape.dir[1] * t];
            const [ax, ay] = toScreen(foot);
            const [bx, by] = toScreen(end);
            const off = Math.abs(sideOffset(tape.base, tape.dir, end));
            return (
              <g className="cnc-measure">
                <line x1={ax} y1={ay} x2={bx} y2={by} />
                <circle cx={ax} cy={ay} r={3.5} />
                <circle cx={bx} cy={by} r={3.5} />
                {off > 0 ? <text className="cnc-tape-label" x={(ax + bx) / 2 + 8} y={(ay + by) / 2 - 8}>{fmt(off)}</text> : null}
              </g>
            );
          })() : null}
          {tape?.mode === "measure" ? (() => {
            const end = tape.b ?? previewEnd ?? tape.a;
            const [ax, ay] = toScreen(tape.a);
            const [bx, by] = toScreen(end);
            const length = Math.hypot(end[0] - tape.a[0], end[1] - tape.a[1]);
            return (
              <g className="cnc-measure">
                <line x1={ax} y1={ay} x2={bx} y2={by} />
                <circle cx={ax} cy={ay} r={3.5} />
                <circle cx={bx} cy={by} r={3.5} />
                {length > 0 ? <text className="cnc-tape-label" x={(ax + bx) / 2} y={(ay + by) / 2 - 8} textAnchor="middle">{fmt(length)}</text> : null}
              </g>
            );
          })() : null}
          {measuring?.a ? (() => {
            const [ax, ay] = toScreen(measuring.a);
            const end = measuring.b ?? (cursor ? resolveSnap(cursor).point : measuring.a);
            const [bx, by] = toScreen(end);
            return <g className="cnc-measure"><line x1={ax} y1={ay} x2={bx} y2={by} /><circle cx={ax} cy={ay} r={3.5} /><circle cx={bx} cy={by} r={3.5} /></g>;
          })() : null}
        </svg>
        {!hasWork && !pen ? (
          <p className="cnc-empty">
            <b>Draw a closed outline with the pen.</b>
            <span>Or add a reference image and trace over it. Holes go inside the outline.</span>
          </p>
        ) : null}
        {size2 ? <output className="cnc-size">{fmt(size2[0])} × {fmt(size2[1])}</output> : null}
      </div>

      <aside className="cnc-panel" aria-label="Part and image settings">
        <section>
          <h2>Part</h2>
          <label className="cnc-field">
            <span>Name</span>
            <input value={design.name} maxLength={64} onChange={(e) => setDesign({ ...design, name: e.target.value })} onFocus={checkpoint} />
          </label>
          <label className="cnc-field">
            <span>Thickness</span>
            <input className="num" value={thicknessText} onChange={(e) => setThicknessText(e.target.value)} onBlur={commitThickness} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
          </label>
          <div className="cnc-segment" role="radiogroup" aria-label="How the part arrives">
            <button type="button" role="radio" aria-checked={!design.standing} onClick={() => design.standing && commit({ ...design, standing: false })}>Lying flat</button>
            <button type="button" role="radio" aria-checked={design.standing} onClick={() => !design.standing && commit({ ...design, standing: true })}>Standing up</button>
          </div>
          {penPath !== null ? <p className="cnc-quiet">Still drawing. Click the first point to close the shape.</p> : null}
          {problems.length ? (
            <ul className="cnc-problems">
              {problems.slice(0, 6).map((p, i) => (
                <li key={i}>
                  <button type="button" onClick={() => { if (p.pathId !== null) { setToolState("select"); setSelection({ paths: [p.pathId], nodes: [] }); } }}>{p.text}</button>
                </li>
              ))}
              {problems.length > 6 ? <li className="more">{problems.length - 6} more to fix</li> : null}
            </ul>
          ) : penPath !== null ? null : summary ? <p className="cnc-ready">Ready to bring in: {summary}.</p> : <p className="cnc-quiet">Nothing to bring in yet.</p>}
          {damaged > 0 ? <p className="cnc-quiet">{damaged === 1 ? "One drawing kept with this model could not be read." : `${damaged} drawings kept with this model could not be read.`}</p> : null}
        </section>

        {selectedBox ? (
          <section>
            <h2>{selection.paths.length > 1 ? `${selection.paths.length} shapes` : "Selected shape"}</h2>
            <SizeField label="Width" value={fmt(selW)} onCommit={(t) => resize("w", t)} />
            <SizeField label="Height" value={fmt(selH)} onCommit={(t) => resize("h", t)} />
            <SizeField label="Rotate" value="0" clearOnCommit onCommit={rotate} />
            <div className="cnc-row">
              <button type="button" className="cnc-btn" onClick={() => transformSelected((p, c) => [2 * c[0] - p[0], p[1]])}>Flip Across</button>
              <button type="button" className="cnc-btn" onClick={() => transformSelected((p, c) => [p[0], 2 * c[1] - p[1]])}>Flip Up</button>
              <button type="button" className="cnc-btn" onClick={duplicate}>Duplicate</button>
            </div>
          </section>
        ) : null}

        {selectedNodes.length ? (
          <section>
            <h2>{selectedNodes.length > 1 ? `${selectedNodes.length} points` : "Selected point"}</h2>
            <div className="cnc-segment three" role="radiogroup" aria-label="Kind of point">
              {(["corner", "smooth", "auto"] as PointType[]).map((t) => (
                <button key={t} type="button" role="radio" aria-checked={commonType === t} onClick={() => changeType(t)}>{t === "corner" ? "Corner" : t === "smooth" ? "Smooth" : "Auto"}</button>
              ))}
            </div>
            {selectedNodes.length === 1 ? (
              <>
                <SizeField label="X" value={fmt(selectedNodes[0].node.p[0])} onCommit={(t) => movePointTo(0, t)} />
                <SizeField label="Y" value={fmt(selectedNodes[0].node.p[1])} onCommit={(t) => movePointTo(1, t)} />
              </>
            ) : null}
            <div className="cnc-measure-form">
              <label className="cnc-field">
                <span>Round corner</span>
                <input className="num" placeholder="radius" value={radiusText} onChange={(e) => setRadiusText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") applyRadius(); }} />
              </label>
              <button type="button" className="cnc-btn" onClick={applyRadius}>Apply</button>
            </div>
          </section>
        ) : null}

        <section>
          <h2>Drawing aids</h2>
          <label className="cnc-check"><input type="checkbox" checked={design.mirrorX !== null} onChange={(e) => commit({ ...design, mirrorX: e.target.checked ? 0 : null })} /> Mirror about a center line</label>
          <label className="cnc-check"><input type="checkbox" checked={smart} onChange={(e) => setSmart(e.target.checked)} /> Smart guides</label>
          <label className="cnc-check"><input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> Snap to the grid</label>
          <div className="cnc-row">
            <label className="cnc-check"><input type="checkbox" checked={protractor} onChange={(e) => setProtractor(e.target.checked)} /> Protractor</label>
            <select aria-label="Protractor step" value={polarStep} disabled={!protractor} onChange={(e) => setPolarStep(Number(e.target.value))}>
              {POLAR_STEPS.map((v) => <option key={v} value={v}>every {v}°</option>)}
            </select>
          </div>
          {tool === "pencil" ? (
            <label className="cnc-field">
              <span>Smoothing</span>
              <input type="range" min={1} max={12} step={0.5} value={smoothing} onChange={(e) => setSmoothing(Number(e.target.value))} />
            </label>
          ) : null}
          <p className="cnc-quiet">Grid: {fmt(grid.minor)}. Swipe to pan, pinch to zoom.</p>
        </section>

        {design.guides.length ? (
          <section>
            <h2>Reference lines</h2>
            <div className="cnc-row">
              {selectedGuide !== null ? <button type="button" className="cnc-btn" onClick={deleteSelected}>Delete Line</button> : null}
              <button type="button" className="cnc-btn" onClick={() => { commit({ ...design, guides: [] }); setSelectedGuide(null); }}>Clear All ({design.guides.length})</button>
            </div>
            <p className="cnc-quiet">Click one with Select to move or delete it. They are never cut.</p>
          </section>
        ) : null}

        <section>
          <h2>Reference image</h2>
          {design.reference ? (
            <>
              <div className="cnc-row">
                <button type="button" className="cnc-btn" onClick={() => { setToolState("select"); setMeasuring({ a: null, b: null }); setMeasureText(""); }}>Set Scale</button>
                <button type="button" className="cnc-btn" onClick={() => void addImage()}>Replace</button>
                <button type="button" className="cnc-btn" onClick={() => { commit({ ...design, reference: null }); setPendingImage(null); setMeasuring(null); }}>Remove</button>
              </div>
              {measuring?.b ? (
                <div className="cnc-measure-form">
                  <label className="cnc-field">
                    <span>Real distance</span>
                    <input className="num" autoFocus value={measureText} onChange={(e) => setMeasureText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") applyScale(); }} />
                  </label>
                  <button type="button" className="cnc-btn" onClick={applyScale}>Apply</button>
                </div>
              ) : null}
              <label className="cnc-field">
                <span>Opacity</span>
                <input type="range" min={0.1} max={1} step={0.05} value={design.reference.opacity} onPointerDown={checkpoint} onChange={(e) => setDesign({ ...design, reference: { ...design.reference!, opacity: Number(e.target.value) } })} />
              </label>
              {!referenceHref ? <p className="cnc-quiet">This drawing's image is not in this model.</p> : null}
            </>
          ) : (
            <button type="button" className="cnc-btn" onClick={() => void addImage()}>Add Image…</button>
          )}
        </section>
      </aside>

      <footer className={`cnc-status${note?.error ? " err" : ""}`}>
        <span role="status" aria-live="polite"><b>{note?.error ? "Can't do that" : spec.label}.</b> {platformText(note?.text ?? activeHint)}</span>
        {tool === "tape" ? (
          <div className="cnc-segment cnc-tape-mode" role="radiogroup" aria-label="What the Tape makes">
            <button type="button" role="radio" aria-checked={tapeMode === "reference"} title={platformText("Tap Ctrl to switch")} onClick={() => tapeMode !== "reference" && setTapeMode("reference")}>Reference line</button>
            <button type="button" role="radio" aria-checked={tapeMode === "measure"} title={platformText("Tap Ctrl to switch")} onClick={() => tapeMode !== "measure" && setTapeMode("measure")}>Measure only</button>
          </div>
        ) : null}
        {spec.value ? (
          <label className={`cnc-tape-field${lockLength !== null && tool === "pen" ? " held" : ""}`}>
            <span>{tool === "tape" && tape?.mode !== "guide" ? "Length" : spec.value}</span>
            <input
              ref={vcbInput}
              className="num"
              aria-label={spec.value}
              value={vcbText ?? (lockLength !== null && tool === "pen" ? fmt(lockLength) : liveValue())}
              onFocus={(e) => {
                if (vcbText === null) {
                  setVcbText(e.target.value);
                  e.target.select();
                }
              }}
              onChange={(e) => setVcbText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  applyValue(vcbText ?? "");
                  setVcbText(null);
                  root.current?.focus({ preventScroll: true });
                }
                if (e.key === "Escape") {
                  setVcbText(null);
                  root.current?.focus({ preventScroll: true });
                }
                if (e.key === "Tab" && angleShown) {
                  e.preventDefault();
                  commitLengthTab(vcbText ?? "");
                }
              }}
            />
          </label>
        ) : null}
        {angleShown ? (
          <label className={`cnc-tape-field${lockAngle !== null ? " held" : ""}`}>
            <span>{tool === "tape" && tape?.mode === "guide" ? "Angle to line" : "Angle"}</span>
            <input
              ref={angleInput}
              className="num"
              aria-label="Angle"
              value={angleText ?? liveAngle()}
              onFocus={(e) => {
                if (angleText === null) {
                  setAngleText(e.target.value.replace("°", ""));
                  requestAnimationFrame(() => e.target.select());
                }
              }}
              onChange={(e) => setAngleText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  commitAngle(angleText ?? "", true);
                  root.current?.focus({ preventScroll: true });
                } else if (e.key === "Tab") {
                  // Tab holds the angle and goes back to the length, as in AutoCAD and Fusion.
                  e.preventDefault();
                  commitAngle(angleText ?? "", false);
                  if (spec.value) {
                    // A held length shows, selected, so typing replaces it.
                    setVcbText(lockLength !== null && tool === "pen" ? fmt(lockLength) : "");
                    requestAnimationFrame(() => {
                      vcbInput.current?.focus({ preventScroll: true });
                      vcbInput.current?.select();
                    });
                  } else root.current?.focus({ preventScroll: true });
                } else if (e.key === "Escape") {
                  setAngleText(null);
                  root.current?.focus({ preventScroll: true });
                }
              }}
            />
          </label>
        ) : null}
      </footer>
      {feedbackOpen ? (
        <FeedbackDialog
          context={{ ...feedback, mode: "CNC", tool: spec.label, selection: selection.paths.length + selection.nodes.length, status: note?.text ?? null, lastError: lastError() }}
          onSaved={() => {
            setFeedbackOpen(false);
            setNote({ text: "Added to your feedback log.", error: false });
          }}
          onClose={() => setFeedbackOpen(false)}
        />
      ) : null}
    </section>
  );
}

function SizeField({ label, value, onCommit, clearOnCommit }: { label: string; value: string; onCommit: (text: string) => void; clearOnCommit?: boolean }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <label className="cnc-field">
      <span>{label}</span>
      <input
        className="num"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text === value) return;
          onCommit(text);
          if (clearOnCommit) setText(value);
        }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      />
    </label>
  );
}
