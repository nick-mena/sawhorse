// Edits the model's tools make, done to a CNC drawing: erasing segments, lines that join where
// they meet, two-point arcs and offsets. Pure functions, unit-tested; the workspace only
// decides when to call them.
import { analyse, flatten, insertNode, nearestOnPath, ringArea, type CncNode, type CncPath, type Pt } from "./design";

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Pt, s: number): Pt => [a[0] * s, a[1] * s];
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
const cross = (a: Pt, b: Pt) => a[0] * b[1] - a[1] * b[0];
const len = (a: Pt) => Math.hypot(a[0], a[1]);
const unit = (a: Pt): Pt => {
  const l = len(a);
  return l > 0 ? [a[0] / l, a[1] / l] : [0, 0];
};
const left = (t: Pt): Pt => [-t[1], t[0]];
/** Points this close are the same point: snapping makes ends meet exactly. */
const SAME = 1e-9;
const same = (a: Pt, b: Pt) => len(sub(a, b)) <= SAME;

/** The path the other way round: each point's handles swap sides. */
export function reversed(path: CncPath): CncPath {
  return {
    ...path,
    nodes: path.nodes
      .map((n) => {
        const { in: i, out: o, ...rest } = n;
        return { ...rest, ...(o ? { in: o } : {}), ...(i ? { out: i } : {}) };
      })
      .reverse(),
  };
}

/**
 * Take segments out of a path, as the Eraser takes edges: a closed shape opens, an open line
 * breaks in two. What is left is the runs of segments that stay; a lone point goes. The first
 * piece keeps the path's id, the others take ids from `nextId`.
 */
export function eraseSegments(path: CncPath, gone: Set<number>, nextId: number): CncPath[] {
  const n = path.nodes.length;
  const count = path.closed ? n : n - 1;
  if (![...gone].some((s) => s >= 0 && s < count)) return [path];
  // Start just after an erased segment, so no run wraps past the end.
  const first = path.closed ? ([...gone].sort((a, b) => a - b)[0] + 1) % n : 0;
  const order = Array.from({ length: count }, (_, k) => (first + k) % n);
  const runs: number[][] = [];
  let run: number[] = [];
  for (const s of order) {
    if (gone.has(s)) {
      if (run.length) runs.push(run);
      run = [];
    } else run.push(s);
  }
  if (run.length) runs.push(run);
  return runs.map((segs, k) => {
    const idx = [segs[0], ...segs.map((s) => (s + 1) % n)];
    const nodes = idx.map((i) => ({ ...path.nodes[i] }));
    delete nodes[0].in;
    delete nodes[nodes.length - 1].out;
    return { id: k === 0 ? path.id : nextId + k - 1, closed: false, nodes };
  });
}

/** Two paths meeting end to start become one; the joint keeps the handle on each side. */
function glue(a: CncPath, b: CncPath): CncPath {
  const last = a.nodes[a.nodes.length - 1];
  const head = b.nodes[0];
  const joint: CncNode = { p: last.p, ...(last.in ? { in: last.in } : {}), ...(head.out ? { out: head.out } : {}), corner: true };
  return { ...a, nodes: [...a.nodes.slice(0, -1), joint, ...b.nodes.slice(1)] };
}

/** An open path whose ends meet closes. */
function closeIfMet(p: CncPath): CncPath {
  if (p.closed || p.nodes.length < 3 || !same(p.nodes[0].p, p.nodes[p.nodes.length - 1].p)) return p;
  const last = p.nodes[p.nodes.length - 1];
  const nodes = p.nodes.slice(0, -1);
  nodes[0] = { ...nodes[0], ...(last.in ? { in: last.in } : {}), corner: true };
  return { ...p, closed: true, nodes };
}

/**
 * Lines that meet end to end join, as they do in the model: the path `id` takes in every open
 * line one of its ends lands on, and closes when its own ends meet.
 */
export function joinEnds(paths: CncPath[], id: number): { paths: CncPath[]; joined: number; closed: boolean } {
  let all = paths.slice();
  let joined = 0;
  for (;;) {
    const me = all.find((p) => p.id === id);
    if (!me || me.closed) break;
    const closed = closeIfMet(me);
    if (closed.closed) {
      all = all.map((p) => (p.id === id ? closed : p));
      break;
    }
    const start = me.nodes[0].p;
    const end = me.nodes[me.nodes.length - 1].p;
    const other = all.find((p) => p.id !== id && !p.closed && p.nodes.length > 1 && [p.nodes[0].p, p.nodes[p.nodes.length - 1].p].some((q) => same(q, start) || same(q, end)));
    if (!other) break;
    const oStart = other.nodes[0].p;
    let merged: CncPath;
    if (same(end, oStart)) merged = glue(me, other);
    else if (same(end, other.nodes[other.nodes.length - 1].p)) merged = glue(me, reversed(other));
    else if (same(start, other.nodes[other.nodes.length - 1].p)) merged = { ...glue(other, me), id };
    else merged = { ...glue(reversed(other), me), id };
    all = all.filter((p) => p.id !== other.id).map((p) => (p.id === id ? merged : p));
    joined++;
  }
  const me = all.find((p) => p.id === id);
  return { paths: all, joined, closed: !!me?.closed };
}

// ---- two-point arcs -------------------------------------------------------------------------

/** How far `p` stands off the chord a-b, positive to its left: the Arc tool's bulge. */
export function bulgeFromPoint(a: Pt, b: Pt, p: Pt): number {
  return cross(unit(sub(b, a)), sub(p, mul(add(a, b), 0.5)));
}

/** The bulge of the shorter arc of radius `r` on chord a-b; null when the chord is longer than the diameter. */
export function bulgeForRadius(a: Pt, b: Pt, r: number, side: number): number | null {
  const half = len(sub(b, a)) / 2;
  if (!(r >= half - 1e-12)) return null;
  return (side < 0 ? -1 : 1) * (r - Math.sqrt(Math.max(0, r * r - half * half)));
}

/** An arc from a to b bulging `bulge` to the left of a-b, as curves of at most a quarter turn. */
export function arcNodes(a: Pt, b: Pt, bulge: number): CncNode[] {
  const c = len(sub(b, a));
  if (c === 0) return [{ p: a }];
  if (Math.abs(bulge) < 1e-9 * Math.max(1, c)) return [{ p: a }, { p: b }];
  const s = Math.abs(bulge);
  const r = (c * c) / 4 / (2 * s) + s / 2;
  const n = left(unit(sub(b, a)));
  const apex = add(mul(add(a, b), 0.5), mul(n, bulge));
  const centre = sub(apex, mul(n, Math.sign(bulge) * r));
  const angle = (p: Pt) => Math.atan2(p[1] - centre[1], p[0] - centre[0]);
  const turn = (u: Pt, v: Pt) => Math.atan2(cross(sub(u, centre), sub(v, centre)), dot(sub(u, centre), sub(v, centre)));
  const sweep = turn(a, apex) + turn(apex, b);
  const pieces = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
  const step = sweep / pieces;
  const k = (4 / 3) * Math.tan(step / 4) * r;
  const a0 = angle(a);
  const nodes: CncNode[] = [];
  for (let i = 0; i <= pieces; i++) {
    const t = a0 + step * i;
    const p: Pt = i === 0 ? a : i === pieces ? b : [centre[0] + r * Math.cos(t), centre[1] + r * Math.sin(t)];
    const tangent: Pt = [-Math.sin(t), Math.cos(t)];
    nodes.push({ p, ...(i > 0 ? { in: sub(p, mul(tangent, k)) } : {}), ...(i < pieces ? { out: add(p, mul(tangent, k)) } : {}) });
  }
  return nodes;
}

// ---- offset ---------------------------------------------------------------------------------

const curved = (a: CncNode, b: CncNode) => !!(a.out || b.in);

/** Split curves until none turns more than 30 degrees, so each offsets as a near-arc. */
function finer(path: CncPath): CncPath {
  let p = path;
  for (let round = 0; round < 6; round++) {
    const n = p.nodes.length;
    const count = p.closed ? n : n - 1;
    let split = false;
    for (let i = count - 1; i >= 0; i--) {
      const a = p.nodes[i];
      const b = p.nodes[(i + 1) % n];
      if (!curved(a, b)) continue;
      const t0 = sub(a.out ?? b.in ?? b.p, a.p);
      const t1 = sub(b.p, b.in ?? a.out ?? a.p);
      if (Math.abs(Math.atan2(cross(t0, t1), dot(t0, t1))) > Math.PI / 6) {
        p = insertNode(p, i, 0.5);
        split = true;
      }
    }
    if (!split) break;
  }
  return p;
}

/**
 * The path moved `d` sideways, positive to the left of the way it runs. Corners stay sharp, as
 * the model's Offset leaves them; curves stay curves. A large inward offset can cross itself,
 * which the drawing's checks then report.
 */
export function offsetPath(path: CncPath, d: number): CncPath {
  const src = finer(path);
  const n = src.nodes.length;
  const around = (i: number) => (src.closed ? src.nodes[(i + n) % n] : src.nodes[i]);
  const moved = src.nodes.map((node, i) => {
    const prev = around(i - 1);
    const next = around(i + 1);
    const tin = prev ? unit(sub(node.p, node.in ?? prev.out ?? prev.p)) : null;
    const tout = next ? unit(sub(node.out ?? next.in ?? next.p, node.p)) : null;
    const nin = tin ? left(tin) : null;
    const nout = tout ? left(tout) : null;
    let m: Pt;
    if (nin && nout) {
      const k = 1 + dot(nin, nout);
      // A corner's offset point is where the two offset sides meet; a near-reversal is capped.
      m = k > 0.1 ? mul(add(nin, nout), 1 / k) : nout;
    } else m = nin ?? nout ?? [0, 0];
    return add(node.p, mul(m, d));
  });
  const nodes: CncNode[] = src.nodes.map((node, i) => {
    const { auto: _auto, in: _in, out: _out, ...rest } = node;
    return { ...rest, p: moved[i] };
  });
  const count = src.closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % n;
    const a = src.nodes[i];
    const b = src.nodes[j];
    if (!curved(a, b)) continue;
    const before = len(sub(b.p, a.p));
    const ratio = before > 0 ? len(sub(moved[j], moved[i])) / before : 1;
    if (a.out) nodes[i].out = add(moved[i], mul(sub(a.out, a.p), ratio));
    if (b.in) nodes[j].in = add(moved[j], mul(sub(b.in, b.p), ratio));
  }
  return { ...src, nodes };
}

/** How far `p` is from a path and on which side: positive is to its left. */
export function sideOf(path: CncPath, p: Pt): number {
  const hit = nearestOnPath(path, p);
  if (!hit) return 0;
  const n = path.nodes.length;
  const a = path.nodes[hit.segment];
  const b = path.nodes[(hit.segment + 1) % n];
  const at = (t: number): Pt => {
    const [p0, p1, p2, p3] = [a.p, a.out ?? a.p, b.in ?? b.p, b.p];
    const s = 1 - t;
    return add(add(mul(p0, s * s * s), mul(p1, 3 * s * s * t)), add(mul(p2, 3 * s * t * t), mul(p3, t * t * t)));
  };
  const t0 = Math.max(0, hit.t - 1e-3);
  const t1 = Math.min(1, hit.t + 1e-3);
  const q = at(hit.t);
  return Math.sign(cross(sub(at(t1), at(t0)), sub(p, q))) * hit.distance;
}

/** Why an offset cannot be used: it turned inside out or crosses itself. Null: it is fine. */
export function offsetProblem(source: CncPath, result: CncPath): string | null {
  if (source.closed) {
    const before = ringArea(flatten(source.nodes).points);
    const after = ringArea(flatten(result.nodes).points);
    if (Math.sign(before) !== Math.sign(after) || Math.abs(after) < 1e-12) return "That offset is wider than the shape. Use a smaller distance.";
  }
  const a = analyse({ paths: [{ ...result, closed: true }], mirrorX: null });
  if (source.closed && a.problems.length) return "That offset would cross itself. Use a smaller distance.";
  return null;
}
