// A CNC drawing: closed outlines of lines and Bezier curves on a flat sheet, in metres with y
// up, and what they become in the model. Pure functions, so the rules that decide whether a
// drawing can be a part are unit-tested without a window. The kernel checks an outline again
// (crates/kernel/src/profile.rs); these checks exist to point at the shape that is wrong.
import type { KernelOp, V3 } from "../kernel/types";

export type Pt = [number, number];

export interface CncNode {
  p: Pt;
  /** Handles, absolute. Absent: that side of the point is straight. */
  in?: Pt;
  out?: Pt;
  /** The Curve tool's point: its handles follow its neighbours until someone drags one. */
  auto?: boolean;
  /** Handles that move separately. Otherwise they stay in one straight line through the point. */
  corner?: boolean;
}

export type PointType = "corner" | "smooth" | "auto";

export interface CncPath {
  id: number;
  closed: boolean;
  nodes: CncNode[];
}

export interface CncReference {
  /** Where the model keeps the image (assets/...). Null until the drawing is first kept. */
  path: string | null;
  /** Lower-left corner and width on the sheet, metres; the height follows the picture. */
  x: number;
  y: number;
  width: number;
  /** Pixel height over pixel width. */
  aspect: number;
  opacity: number;
}

/** A reference line: endless, snapped to, and no part of what gets cut. */
export interface CncGuide {
  id: number;
  p: Pt;
  /** Unit direction. */
  dir: Pt;
}

export interface CncDesign {
  version: 1;
  name: string;
  paths: CncPath[];
  nextId: number;
  thickness: number;
  /** Stands up on the ground, drawn as seen from the front, instead of lying flat. */
  standing: boolean;
  /** The mirror line's x, or null with mirroring off. */
  mirrorX: number | null;
  reference: CncReference | null;
  guides: CncGuide[];
}

export function emptyDesign(name: string, thickness: number): CncDesign {
  return { version: 1, name, paths: [], nextId: 1, thickness, standing: false, mirrorX: null, reference: null, guides: [] };
}

// ---- reading a drawing back; the file it came from is not to be trusted --------------------

const MAX_PATHS = 2_000;
const MAX_NODES = 20_000;
const MAX_GUIDES = 500;
const MAX_NAME = 64;
const REACH = 1e4;

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= REACH;
const pt = (v: unknown): v is Pt => Array.isArray(v) && v.length === 2 && num(v[0]) && num(v[1]);
const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** The drawing in `json`, or null when it is not one. */
export function parseDesign(json: string): CncDesign | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const d = rec(raw);
  if (!d || d.version !== 1 || typeof d.name !== "string" || !Array.isArray(d.paths) || d.paths.length > MAX_PATHS) return null;
  if (!num(d.thickness) || !num(d.nextId) || typeof d.standing !== "boolean") return null;
  if (d.mirrorX !== null && !num(d.mirrorX)) return null;
  let count = 0;
  const paths: CncPath[] = [];
  for (const entry of d.paths) {
    const p = rec(entry);
    if (!p || !num(p.id) || typeof p.closed !== "boolean" || !Array.isArray(p.nodes)) return null;
    count += p.nodes.length;
    if (count > MAX_NODES) return null;
    const nodes: CncNode[] = [];
    for (const item of p.nodes) {
      const n = rec(item);
      if (!n || !pt(n.p) || (n.in !== undefined && !pt(n.in)) || (n.out !== undefined && !pt(n.out))) return null;
      nodes.push({ p: n.p, ...(n.in ? { in: n.in as Pt } : {}), ...(n.out ? { out: n.out as Pt } : {}), ...(n.auto === true ? { auto: true } : {}), ...(n.corner === true ? { corner: true } : {}) });
    }
    paths.push({ id: p.id, closed: p.closed, nodes });
  }
  let reference: CncReference | null = null;
  if (d.reference !== null && d.reference !== undefined) {
    const r = rec(d.reference);
    if (!r || !num(r.x) || !num(r.y) || !num(r.width) || !num(r.aspect) || !num(r.opacity) || r.width <= 0 || r.aspect <= 0) return null;
    if (r.path !== null && (typeof r.path !== "string" || !/^assets\/[A-Za-z0-9._-]+\.(png|jpe?g)$/.test(r.path))) return null;
    reference = { path: r.path as string | null, x: r.x, y: r.y, width: r.width, aspect: r.aspect, opacity: Math.min(1, Math.max(0, r.opacity)) };
  }
  // Older drawings have none.
  const guides: CncGuide[] = [];
  if (d.guides !== undefined) {
    if (!Array.isArray(d.guides) || d.guides.length > MAX_GUIDES) return null;
    for (const entry of d.guides) {
      const g = rec(entry);
      if (!g || !num(g.id) || !pt(g.p) || !pt(g.dir)) return null;
      const length = Math.hypot(g.dir[0], g.dir[1]);
      if (length < 1e-9) return null;
      guides.push({ id: g.id, p: g.p, dir: [g.dir[0] / length, g.dir[1] / length] });
    }
  }
  return { version: 1, name: d.name.slice(0, MAX_NAME), paths, nextId: d.nextId, thickness: d.thickness, standing: d.standing, mirrorX: d.mirrorX as number | null, reference, guides };
}

// ---- geometry ------------------------------------------------------------------------------

export const sub2 = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
export const add2 = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const mix = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const dist2 = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const cross2 = (a: Pt, b: Pt) => a[0] * b[1] - a[1] * b[0];

/** How far a curve may stray from its straight pieces: 0.1 mm, finer than a router cuts. */
const CHORD = 1e-4;
/** Points closer than this become one: a little over the kernel's 0.01 mm. */
const MERGE = 3e-5;
/** Shapes nearer than this count as touching: the kernel's 0.01 mm, doubled to be sure. */
const TOUCH = 2e-5;
/** Tangents within this angle (radians) are one smooth curve; beyond it is a corner. */
const SMOOTH_TURN = (3 * Math.PI) / 180;
const MAX_POINTS = 50_000;

function pointSegment(p: Pt, a: Pt, b: Pt): number {
  const d = sub2(b, a);
  const l = d[0] * d[0] + d[1] * d[1];
  const t = l > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / l)) : 0;
  return dist2(p, [a[0] + d[0] * t, a[1] + d[1] * t]);
}

function cubic(a: Pt, b: Pt, c: Pt, d: Pt, out: Pt[], depth = 0): void {
  if (depth >= 10 || Math.max(pointSegment(b, a, d), pointSegment(c, a, d)) <= CHORD) {
    out.push(d);
    return;
  }
  const ab = mix(a, b, 0.5);
  const bc = mix(b, c, 0.5);
  const cd = mix(c, d, 0.5);
  const abc = mix(ab, bc, 0.5);
  const bcd = mix(bc, cd, 0.5);
  const m = mix(abc, bcd, 0.5);
  cubic(a, ab, abc, m, out, depth + 1);
  cubic(m, bcd, cd, d, out, depth + 1);
}

export interface Ring {
  points: Pt[];
  /** Indices of the points on a curve, where the walls either side should blend. */
  smooth: number[];
}

const curved = (a: CncNode, b: CncNode) => !!(a.out || b.in);

function nodeIsSmooth(prev: CncNode, n: CncNode, next: CncNode): boolean {
  const inward = sub2(n.p, n.in ?? prev.out ?? prev.p);
  const outward = sub2(n.out ?? next.in ?? next.p, n.p);
  const li = Math.hypot(inward[0], inward[1]);
  const lo = Math.hypot(outward[0], outward[1]);
  if (li === 0 || lo === 0) return false;
  if (!curved(prev, n) && !curved(n, next)) return false;
  return Math.abs(Math.atan2(cross2(inward, outward), inward[0] * outward[0] + inward[1] * outward[1])) <= SMOOTH_TURN;
}

/** A closed path as straight pieces no more than 0.1 mm from its curves. */
export function flatten(nodes: CncNode[]): Ring {
  const n = nodes.length;
  const points: Pt[] = [];
  const isSmooth: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const a = nodes[i];
    const b = nodes[(i + 1) % n];
    points.push(a.p);
    isSmooth.push(nodeIsSmooth(nodes[(i + n - 1) % n], a, b));
    if (!curved(a, b)) continue;
    const run: Pt[] = [];
    cubic(a.p, a.out ?? a.p, b.in ?? b.p, b.p, run);
    run.pop();
    for (const p of run) {
      points.push(p);
      isSmooth.push(true);
    }
  }
  const kept: Pt[] = [];
  const smooth: number[] = [];
  points.forEach((p, i) => {
    if (kept.length && dist2(kept[kept.length - 1], p) <= MERGE) return;
    if (isSmooth[i]) smooth.push(kept.length);
    kept.push(p);
  });
  while (kept.length > 1 && dist2(kept[kept.length - 1], kept[0]) <= MERGE) {
    kept.pop();
    if (smooth[smooth.length - 1] === kept.length) smooth.pop();
  }
  return { points: kept, smooth };
}

export function ringArea(r: Pt[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) a += cross2(r[i], r[(i + 1) % r.length]);
  return a / 2;
}

function pointInRing(p: Pt, r: Pt[]): boolean {
  let odd = false;
  for (let i = 0; i < r.length; i++) {
    const a = r[i];
    const b = r[(i + 1) % r.length];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < a[0] + ((p[1] - a[1]) / (b[1] - a[1])) * (b[0] - a[0])) odd = !odd;
  }
  return odd;
}

function nearSegments(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const side = (p: Pt, q: Pt, r: Pt) => cross2(sub2(q, p), sub2(r, p));
  if (side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0) return true;
  return pointSegment(a, c, d) <= TOUCH || pointSegment(b, c, d) <= TOUCH || pointSegment(c, a, b) <= TOUCH || pointSegment(d, a, b) <= TOUCH;
}

/** Every pair of rings that cross or touch; a ring paired with itself crosses itself. */
function crossings(rings: Pt[][]): [number, number][] {
  type Seg = { a: Pt; b: Pt; ring: number; i: number; n: number; lo: Pt; hi: Pt };
  const segs: Seg[] = [];
  rings.forEach((r, ring) => {
    r.forEach((a, i) => {
      const b = r[(i + 1) % r.length];
      segs.push({ a, b, ring, i, n: r.length, lo: [Math.min(a[0], b[0]), Math.min(a[1], b[1])], hi: [Math.max(a[0], b[0]), Math.max(a[1], b[1])] });
    });
  });
  segs.sort((p, q) => p.lo[0] - q.lo[0]);
  const hits = new Map<string, [number, number]>();
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    for (let j = i + 1; j < segs.length; j++) {
      const t = segs[j];
      if (t.lo[0] > s.hi[0] + TOUCH) break;
      if (t.lo[1] > s.hi[1] + TOUCH || s.lo[1] > t.hi[1] + TOUCH) continue;
      if (s.ring === t.ring) {
        const before = (s.i + 1) % s.n === t.i ? [s, t] : (t.i + 1) % t.n === s.i ? [t, s] : null;
        // Neighbours meet where they join, and again only if the line doubles back on itself.
        const hit = before ? pointSegment(before[0].a, before[1].a, before[1].b) <= TOUCH || pointSegment(before[1].b, before[0].a, before[0].b) <= TOUCH : nearSegments(s.a, s.b, t.a, t.b);
        if (hit) hits.set(`${s.ring}:${s.ring}`, [s.ring, s.ring]);
      } else if (nearSegments(s.a, s.b, t.a, t.b)) {
        const pair: [number, number] = s.ring < t.ring ? [s.ring, t.ring] : [t.ring, s.ring];
        hits.set(pair.join(":"), pair);
      }
    }
  }
  return [...hits.values()];
}

// ---- mirroring -----------------------------------------------------------------------------

const reflectPt = (p: Pt, x: number): Pt => [2 * x - p[0], p[1]];

/** One node reflected: its handles swap sides, because the path now runs the other way. */
function reflectNode(n: CncNode, x: number): CncNode {
  return { p: reflectPt(n.p, x), ...(n.out ? { in: reflectPt(n.out, x) } : {}), ...(n.in ? { out: reflectPt(n.in, x) } : {}) };
}

/** The other half of a path, for the view; it runs the opposite way. */
export function reflected(path: CncPath, x: number): CncNode[] {
  return path.nodes.map((n) => reflectNode(n, x)).reverse();
}

const onLine = (n: CncNode, x: number) => Math.abs(n.p[0] - x) <= 1e-6;

/** Whether a path needs its reflection in the result: one that crosses the line is whole. */
function crossesLine(nodes: CncNode[], x: number): boolean {
  let lo = Infinity;
  let hi = -Infinity;
  for (const n of nodes) {
    lo = Math.min(lo, n.p[0]);
    hi = Math.max(hi, n.p[0]);
  }
  return lo < x - 1e-6 && hi > x + 1e-6;
}

/** The closed loops a path makes, mirrored as the drawing says; null if it does not close. */
function loopsOf(path: CncPath, mirrorX: number | null): CncNode[][] | null {
  if (mirrorX === null) return path.closed ? [path.nodes] : null;
  if (path.closed) return crossesLine(path.nodes, mirrorX) ? [path.nodes] : [path.nodes, reflected(path, mirrorX)];
  const first = path.nodes[0];
  const last = path.nodes[path.nodes.length - 1];
  if (!first || !onLine(first, mirrorX) || !onLine(last, mirrorX) || path.nodes.length < 2) return null;
  const back = reflected(path, mirrorX);
  // The ends lie on the line, so each is one point with this half's handle and its reflection.
  const joinEnd: CncNode = { p: last.p, ...(last.in ? { in: last.in } : {}), ...(back[0].out ? { out: back[0].out } : {}) };
  const joinStart: CncNode = { p: first.p, ...(back[back.length - 1].in ? { in: back[back.length - 1].in } : {}), ...(first.out ? { out: first.out } : {}) };
  return [[joinStart, ...path.nodes.slice(1, -1), joinEnd, ...back.slice(1, -1)]];
}

// ---- what the drawing makes ----------------------------------------------------------------

export interface PartShape {
  outer: Ring;
  holes: Ring[];
}

export interface Analysis {
  parts: PartShape[];
  /** Each says what is wrong and names the shape to fix (null: the whole drawing). */
  problems: { pathId: number | null; text: string }[];
  holes: number;
  bounds: { min: Pt; max: Pt } | null;
}

export function analyse(design: Pick<CncDesign, "paths" | "mirrorX">): Analysis {
  const problems: Analysis["problems"] = [];
  const rings: { path: number; ring: Ring }[] = [];
  for (const path of design.paths) {
    if (!path.nodes.length) continue;
    const loops = loopsOf(path, design.mirrorX);
    if (!loops) {
      problems.push({
        pathId: path.id,
        text: design.mirrorX === null ? "This line is open. Press its end with the Pen or Curve tool, then click its first point to close it." : "This line is open. With Mirror on, start and end it on the mirror line, or close it.",
      });
      continue;
    }
    for (const nodes of loops) {
      const ring = flatten(nodes);
      if (ring.points.length < 3) problems.push({ pathId: path.id, text: "This shape is too small or too thin to cut." });
      else rings.push({ path: path.id, ring });
    }
  }
  const total = rings.reduce((n, r) => n + r.ring.points.length, 0);
  if (total > MAX_POINTS) problems.push({ pathId: null, text: `This drawing has ${total.toLocaleString()} points once its curves are worked out, over the 50,000 a part can hold. Remove some detail.` });
  const pts = rings.map((r) => r.ring.points);
  if (total <= MAX_POINTS) {
    const found = crossings(pts);
    // After the crossings: a figure eight can enclose no area at all, and that is not "small".
    rings.forEach((r, i) => {
      if (Math.abs(ringArea(r.ring.points)) <= 1e-9 && !found.some(([a, b]) => a === i && b === i)) problems.push({ pathId: r.path, text: "This shape is too small or too thin to cut." });
    });
    for (const [a, b] of found) {
      if (a === b) problems.push({ pathId: rings[a].path, text: "This shape crosses or touches itself." });
      else problems.push({ pathId: rings[b].path, text: rings[a].path === rings[b].path ? "This shape meets its mirror image. Keep it clear of the mirror line, or draw across the line." : "These two shapes cross or touch. Keep a hole inside its outline, clear of the edge." });
    }
  }
  let bounds: Analysis["bounds"] = null;
  for (const r of pts) {
    for (const p of r) {
      if (!bounds) bounds = { min: [p[0], p[1]], max: [p[0], p[1]] };
      bounds.min = [Math.min(bounds.min[0], p[0]), Math.min(bounds.min[1], p[1])];
      bounds.max = [Math.max(bounds.max[0], p[0]), Math.max(bounds.max[1], p[1])];
    }
  }
  const contains = pts.map((r, i) => pts.flatMap((o, j) => (j !== i && pointInRing(r[0], o) ? [j] : [])));
  const parts = new Map<number, PartShape>();
  pts.forEach((_, i) => {
    if (contains[i].length % 2 === 0) parts.set(i, { outer: rings[i].ring, holes: [] });
  });
  let holes = 0;
  pts.forEach((_, i) => {
    if (contains[i].length % 2 === 0) return;
    // Its outline is the innermost shape around it: one level up.
    const parent = contains[i].find((j) => contains[j].length === contains[i].length - 1);
    if (parent !== undefined) {
      parts.get(parent)?.holes.push(rings[i].ring);
      holes++;
    }
  });
  if (problems.length) return { parts: [], problems, holes, bounds };
  return { parts: [...parts.values()], problems, holes, bounds };
}

/** The kernel ops for the parts: centred on the origin, sitting on the ground. */
/** The longest name the model takes for a part. */
const PART_NAME_MAX = 64;

export function partOps(a: Analysis, thickness: number, standing: boolean, name = ""): KernelOp[] {
  if (!a.bounds) return [];
  const cx = (a.bounds.min[0] + a.bounds.max[0]) / 2;
  const cy = (a.bounds.min[1] + a.bounds.max[1]) / 2;
  const bottom = a.bounds.min[1];
  const place = (p: Pt): V3 => (standing ? [p[0] - cx, 0, p[1] - bottom] : [p[0] - cx, p[1] - cy, 0]);
  const normal: V3 = standing ? [0, 1, 0] : [0, 0, 1];
  const label = [...name.trim()].slice(0, PART_NAME_MAX).join("").trim();
  return a.parts.map((part): KernelOp => ({
    op: "extrude_profile",
    origin: [0, 0, 0],
    normal,
    rings: [part.outer, ...part.holes].map((r) => ({ points: r.points.map(place), smooth: r.smooth })),
    distance: thickness,
    // The drawing's name names the part in the Outliner and the cut list.
    ...(label ? { name: label } : {}),
  }));
}

// ---- reference lines -----------------------------------------------------------------------

/** How far `p` is to the left of the line through `base` along `dir` (negative: the right). */
export function sideOffset(base: Pt, dir: Pt, p: Pt): number {
  return cross2(dir, sub2(p, base));
}

/** The point on a line `offset` to its left of `base`. */
export function offsetPoint(base: Pt, dir: Pt, offset: number): Pt {
  return [base[0] - dir[1] * offset, base[1] + dir[0] * offset];
}

function projectOnto(g: Pick<CncGuide, "p" | "dir">, p: Pt): Pt {
  const along = (p[0] - g.p[0]) * g.dir[0] + (p[1] - g.p[1]) * g.dir[1];
  return [g.p[0] + g.dir[0] * along, g.p[1] + g.dir[1] * along];
}

/** `p` pulled onto the nearest reference line in reach, or where two cross. Null: none near. */
export function snapToGuides(p: Pt, guides: CncGuide[], reach: number): Pt | null {
  const near = guides.map((g) => ({ g, d: Math.abs(sideOffset(g.p, g.dir, p)) })).filter((x) => x.d <= reach).sort((a, b) => a.d - b.d);
  if (!near.length) return null;
  const first = near[0].g;
  for (const { g } of near.slice(1)) {
    const den = cross2(first.dir, g.dir);
    if (Math.abs(den) < 1e-6) continue;
    const t = cross2(sub2(g.p, first.p), g.dir) / den;
    const crossing: Pt = [first.p[0] + first.dir[0] * t, first.p[1] + first.dir[1] * t];
    if (dist2(crossing, p) <= reach * 1.5) return crossing;
  }
  return projectOnto(first, p);
}

// ---- editing -------------------------------------------------------------------------------

/** An SVG path for `nodes`, each point through `at` (canvas pixels). */
export function pathData(nodes: CncNode[], closed: boolean, at: (p: Pt) => Pt): string {
  if (!nodes.length) return "";
  const f = (p: Pt) => {
    const [x, y] = at(p);
    return `${x.toFixed(2)} ${y.toFixed(2)}`;
  };
  let d = `M${f(nodes[0].p)}`;
  const count = closed ? nodes.length : nodes.length - 1;
  for (let i = 0; i < count; i++) {
    const a = nodes[i];
    const b = nodes[(i + 1) % nodes.length];
    d += curved(a, b) ? `C${f(a.out ?? a.p)} ${f(b.in ?? b.p)} ${f(b.p)}` : `L${f(b.p)}`;
  }
  return closed ? `${d}Z` : d;
}

function cubicAt(a: CncNode, b: CncNode, t: number): Pt {
  const [p0, p1, p2, p3] = [a.p, a.out ?? a.p, b.in ?? b.p, b.p];
  const ab = mix(p0, p1, t);
  const bc = mix(p1, p2, t);
  const cd = mix(p2, p3, t);
  return mix(mix(ab, bc, t), mix(bc, cd, t), t);
}

/** The nearest place on a path to `p`: its segment, how far along, and the distance. */
export function nearestOnPath(path: CncPath, p: Pt): { segment: number; t: number; distance: number } | null {
  const n = path.nodes.length;
  const count = path.closed ? n : n - 1;
  let best: { segment: number; t: number; distance: number } | null = null;
  for (let i = 0; i < count; i++) {
    const a = path.nodes[i];
    const b = path.nodes[(i + 1) % n];
    const steps = curved(a, b) ? 48 : 1;
    let prev = a.p;
    for (let k = 1; k <= steps; k++) {
      const q = curved(a, b) ? cubicAt(a, b, k / steps) : b.p;
      const d = sub2(q, prev);
      const l = d[0] * d[0] + d[1] * d[1];
      const u = l > 0 ? Math.max(0, Math.min(1, ((p[0] - prev[0]) * d[0] + (p[1] - prev[1]) * d[1]) / l)) : 0;
      const distance = dist2(p, [prev[0] + d[0] * u, prev[1] + d[1] * u]);
      if (!best || distance < best.distance) best = { segment: i, t: (k - 1 + u) / steps, distance };
      prev = q;
    }
  }
  return best;
}

/** A new point on segment `segment`, leaving the shape of the curve exactly as it was. */
export function insertNode(path: CncPath, segment: number, t: number): CncPath {
  const nodes = path.nodes.map((n) => ({ ...n }));
  const a = nodes[segment];
  const next = (segment + 1) % nodes.length;
  const b = nodes[next];
  if (!curved(a, b)) {
    nodes.splice(segment + 1, 0, { p: mix(a.p, b.p, t) });
    return { ...path, nodes };
  }
  const [p0, p1, p2, p3] = [a.p, a.out ?? a.p, b.in ?? b.p, b.p];
  const ab = mix(p0, p1, t);
  const bc = mix(p1, p2, t);
  const cd = mix(p2, p3, t);
  const abc = mix(ab, bc, t);
  const bcd = mix(bc, cd, t);
  a.out = ab;
  b.in = cd;
  nodes.splice(segment + 1, 0, { p: mix(abc, bcd, t), in: abc, out: bcd });
  return { ...path, nodes };
}

const SMOOTHING = 1 / 3;

/** A corner becomes a smooth point with handles along its neighbours, and a smooth one a corner. */
export function toggleSmooth(path: CncPath, index: number): CncPath {
  const n = path.nodes.length;
  const nodes = path.nodes.map((x) => ({ ...x }));
  const node = nodes[index];
  delete node.auto;
  delete node.corner;
  if (node.in || node.out) {
    delete node.in;
    delete node.out;
    return { ...path, nodes };
  }
  const prev = path.closed || index > 0 ? nodes[(index + n - 1) % n].p : node.p;
  const next = path.closed || index < n - 1 ? nodes[(index + 1) % n].p : node.p;
  const dir = sub2(next, prev);
  const span = Math.hypot(dir[0], dir[1]);
  if (span === 0) return path;
  const unit: Pt = [dir[0] / span, dir[1] / span];
  node.in = [node.p[0] - unit[0] * dist2(node.p, prev) * SMOOTHING, node.p[1] - unit[1] * dist2(node.p, prev) * SMOOTHING];
  node.out = [node.p[0] + unit[0] * dist2(node.p, next) * SMOOTHING, node.p[1] + unit[1] * dist2(node.p, next) * SMOOTHING];
  return { ...path, nodes };
}

/** Every point and handle of a path through `f`; a point keeps what kind of point it is. */
export function mapPath(path: CncPath, f: (p: Pt) => Pt): CncPath {
  return { ...path, nodes: path.nodes.map((n) => ({ ...n, p: f(n.p), ...(n.in ? { in: f(n.in) } : {}), ...(n.out ? { out: f(n.out) } : {}) })) };
}

export function movePath(path: CncPath, d: Pt): CncPath {
  return mapPath(path, (p) => add2(p, d));
}

const unit2 = (d: Pt): Pt => {
  const l = Math.hypot(d[0], d[1]);
  return l > 0 ? [d[0] / l, d[1] / l] : [0, 0];
};

/** Keep the other handle in line with the one just moved, at its own length. */
export function alignOpposite(n: CncNode, moved: "in" | "out"): CncNode {
  const other = moved === "in" ? "out" : "in";
  const a = n[moved];
  const b = n[other];
  if (!a || !b || n.corner) return n;
  const dir = unit2(sub2(n.p, a));
  if (dir[0] === 0 && dir[1] === 0) return n;
  const length = dist2(n.p, b);
  return { ...n, [other]: [n.p[0] + dir[0] * length, n.p[1] + dir[1] * length] };
}

/**
 * Curve-tool points take their handles from their neighbours, so the curve runs through every
 * click. An end has only one neighbour and leans toward its handle, except on the mirror
 * line, where it leaves square to the line so the two halves meet without a kink.
 */
export function relaxAuto(path: CncPath, mirrorX: number | null = null): CncPath {
  if (!path.nodes.some((n) => n.auto)) return path;
  const nodes = path.nodes.map((x) => ({ ...x }));
  const n = nodes.length;
  const around = (i: number, d: number) => (path.closed ? nodes[(i + d + n) % n] : nodes[i + d]);
  const ends: number[] = [];
  nodes.forEach((node, i) => {
    if (!node.auto) return;
    const prev = around(i, -1);
    const next = around(i, 1);
    if (!prev || !next) return void ends.push(i);
    const dir = unit2(sub2(next.p, prev.p));
    delete node.in;
    delete node.out;
    if (dir[0] === 0 && dir[1] === 0) return;
    node.in = [node.p[0] - (dir[0] * dist2(node.p, prev.p)) / 3, node.p[1] - (dir[1] * dist2(node.p, prev.p)) / 3];
    node.out = [node.p[0] + (dir[0] * dist2(node.p, next.p)) / 3, node.p[1] + (dir[1] * dist2(node.p, next.p)) / 3];
  });
  for (const i of ends) {
    const node = nodes[i];
    const side = i === 0 ? "out" : "in";
    const other = i === 0 ? nodes[1] : nodes[n - 2];
    delete node.in;
    delete node.out;
    if (!other) continue;
    if (mirrorX !== null && Math.abs(node.p[0] - mirrorX) <= 1e-6 && Math.abs(other.p[0] - mirrorX) > 1e-6) {
      node[side] = [node.p[0] + Math.sign(other.p[0] - mirrorX) * (dist2(node.p, other.p) / 3), node.p[1]];
      continue;
    }
    const toward = (i === 0 ? other.in : other.out) ?? other.p;
    if (toward !== other.p) node[side] = mix(node.p, toward, 0.5);
  }
  return { ...path, nodes };
}

/** Drag the line itself: the curve moves through the grabbed place by the amount dragged. */
export function bendSegment(start: CncPath, segment: number, t: number, d: Pt): CncPath {
  const nodes = start.nodes.map((x) => ({ ...x }));
  const a = nodes[segment];
  const b = nodes[(segment + 1) % nodes.length];
  const wasCurve = curved(a, b);
  // Close to an end, a small move would need a huge handle: treat it as a little further in.
  const u = Math.max(0.15, Math.min(0.85, t));
  const c1 = 3 * (1 - u) * (1 - u) * u;
  const c2 = 3 * (1 - u) * u * u;
  const k = c1 * c1 + c2 * c2;
  const p1 = a.out ?? (wasCurve ? a.p : mix(a.p, b.p, 1 / 3));
  const p2 = b.in ?? (wasCurve ? b.p : mix(a.p, b.p, 2 / 3));
  a.out = add2(p1, [(d[0] * c1) / k, (d[1] * c1) / k]);
  b.in = add2(p2, [(d[0] * c2) / k, (d[1] * c2) / k]);
  delete a.auto;
  delete b.auto;
  const i = segment;
  const j = (segment + 1) % nodes.length;
  nodes[i] = alignOpposite(a, "out");
  nodes[j] = alignOpposite(b, "in");
  return { ...start, nodes };
}

export function setPointType(path: CncPath, index: number, type: PointType, mirrorX: number | null = null): CncPath {
  const nodes = path.nodes.map((x) => ({ ...x }));
  const node = nodes[index];
  delete node.auto;
  delete node.corner;
  if (type === "corner") {
    delete node.in;
    delete node.out;
    return { ...path, nodes };
  }
  if (type === "auto") {
    node.auto = true;
    return relaxAuto({ ...path, nodes }, mirrorX);
  }
  if (!node.in && !node.out) return toggleSmooth({ ...path, nodes }, index);
  nodes[index] = alignOpposite(node, node.out ? "out" : "in");
  return { ...path, nodes };
}

export function pointType(n: CncNode): PointType {
  if (n.auto) return "auto";
  return (n.in || n.out) && !n.corner ? "smooth" : "corner";
}

/** Round a corner between two straight lines; a sentence when it cannot be done. */
export function roundCorner(path: CncPath, index: number, radius: number): CncPath | string {
  const n = path.nodes.length;
  if (!path.closed && (index === 0 || index === n - 1)) return "The end of an open line has no corner to round.";
  const node = path.nodes[index];
  const prev = path.nodes[(index + n - 1) % n];
  const next = path.nodes[(index + 1) % n];
  if (node.in || node.out || curved(prev, node) || curved(node, next)) return "Rounding works on a corner between two straight lines.";
  const u = unit2(sub2(prev.p, node.p));
  const v = unit2(sub2(next.p, node.p));
  const angle = Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1])));
  if (angle < 1e-3 || angle > Math.PI - 1e-3) return "That point is on a straight line, so there is no corner to round.";
  const back = radius / Math.tan(angle / 2);
  if (back >= Math.min(dist2(node.p, prev.p), dist2(node.p, next.p)) * 0.999) return "That radius is too large for the lines beside this corner.";
  const sweep = Math.PI - angle;
  const handle = (4 / 3) * Math.tan(sweep / 4) * radius;
  const from: Pt = [node.p[0] + u[0] * back, node.p[1] + u[1] * back];
  const to: Pt = [node.p[0] + v[0] * back, node.p[1] + v[1] * back];
  const first: CncNode = { p: from, out: [from[0] - u[0] * handle, from[1] - u[1] * handle] };
  const second: CncNode = { p: to, in: [to[0] - v[0] * handle, to[1] - v[1] * handle] };
  const nodes = path.nodes.slice();
  nodes.splice(index, 1, first, second);
  return { ...path, nodes };
}

/** Whether `p` is inside a closed shape (its fill can be grabbed). */
export function insideNodes(nodes: CncNode[], p: Pt): boolean {
  return nodes.length >= 3 && pointInRing(p, flatten(nodes).points);
}

/** The bounds of a path, the closing segment included. */
export function boundsOf(path: CncPath): { min: Pt; max: Pt } | null {
  return pathBounds(path.closed && path.nodes.length ? [...path.nodes, path.nodes[0]] : path.nodes);
}

export function rectNodes(a: Pt, b: Pt): CncNode[] {
  return [{ p: [a[0], a[1]] }, { p: [b[0], a[1]] }, { p: [b[0], b[1]] }, { p: [a[0], b[1]] }];
}

/** Four arcs, each within 0.03% of a true circle: editable points, like anything drawn here. */
export function circleNodes(c: Pt, r: number): CncNode[] {
  const k = 0.5522847498 * r;
  return [
    { p: [c[0] + r, c[1]], in: [c[0] + r, c[1] - k], out: [c[0] + r, c[1] + k] },
    { p: [c[0], c[1] + r], in: [c[0] + k, c[1] + r], out: [c[0] - k, c[1] + r] },
    { p: [c[0] - r, c[1]], in: [c[0] - r, c[1] + k], out: [c[0] - r, c[1] - k] },
    { p: [c[0], c[1] - r], in: [c[0] - k, c[1] - r], out: [c[0] + k, c[1] - r] },
  ];
}

export function pathBounds(nodes: CncNode[]): { min: Pt; max: Pt } | null {
  if (!nodes.length) return null;
  const n = nodes.length;
  const pts: Pt[] = [];
  nodes.forEach((a, i) => {
    pts.push(a.p);
    const b = nodes[(i + 1) % n];
    if (i < n - 1 && curved(a, b)) for (let k = 1; k < 32; k++) pts.push(cubicAt(a, b, k / 32));
  });
  return { min: [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))], max: [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))] };
}

/** Resize about the shape's centre, handles and all. */
export function scalePath(path: CncPath, sx: number, sy: number): CncPath {
  const b = boundsOf(path);
  if (!b) return path;
  const c: Pt = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2];
  return mapPath(path, (p) => [c[0] + (p[0] - c[0]) * sx, c[1] + (p[1] - c[1]) * sy]);
}
