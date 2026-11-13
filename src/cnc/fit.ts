// Turns a freehand stroke into a few Bezier curves: the Pencil. This is Schneider's published
// least-squares method ("An Algorithm for Automatically Fitting Digitized Curves", Graphics
// Gems, 1990), written from the paper. A stroke with hundreds of samples becomes points a
// person can edit, and a hand's wobble smaller than the tolerance goes.
import type { CncNode, Pt } from "./design";

type Bezier = [Pt, Pt, Pt, Pt];

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Pt, s: number): Pt => [a[0] * s, a[1] * s];
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
const len = (a: Pt) => Math.hypot(a[0], a[1]);
const unit = (a: Pt): Pt => {
  const l = len(a);
  return l > 0 ? [a[0] / l, a[1] / l] : [0, 0];
};
const at = (b: Bezier, t: number): Pt => {
  const s = 1 - t;
  return add(add(mul(b[0], s * s * s), mul(b[1], 3 * s * s * t)), add(mul(b[2], 3 * s * t * t), mul(b[3], t * t * t)));
};

function chordParams(d: Pt[]): number[] {
  const u = [0];
  for (let i = 1; i < d.length; i++) u.push(u[i - 1] + len(sub(d[i], d[i - 1])));
  const total = u[u.length - 1] || 1;
  return u.map((v) => v / total);
}

function generate(d: Pt[], u: number[], t1: Pt, t2: Pt): Bezier {
  const first = d[0];
  const last = d[d.length - 1];
  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;
  u.forEach((t, i) => {
    const s = 1 - t;
    const b0 = s * s * s;
    const b1 = 3 * t * s * s;
    const b2 = 3 * t * t * s;
    const b3 = t * t * t;
    const a1 = mul(t1, b1);
    const a2 = mul(t2, b2);
    c00 += dot(a1, a1);
    c01 += dot(a1, a2);
    c11 += dot(a2, a2);
    const rest = sub(d[i], add(mul(first, b0 + b1), mul(last, b2 + b3)));
    x0 += dot(a1, rest);
    x1 += dot(a2, rest);
  });
  const det = c00 * c11 - c01 * c01;
  const span = len(sub(last, first));
  let alpha1 = Math.abs(det) > 1e-18 ? (x0 * c11 - x1 * c01) / det : 0;
  let alpha2 = Math.abs(det) > 1e-18 ? (c00 * x1 - c01 * x0) / det : 0;
  // A negative or vanishing handle makes a loop; a third of the span is the safe fallback.
  const floor = 1e-6 * span;
  if (alpha1 < floor || alpha2 < floor) alpha1 = alpha2 = span / 3;
  return [first, add(first, mul(t1, alpha1)), add(last, mul(t2, alpha2)), last];
}

function worst(d: Pt[], b: Bezier, u: number[]): { error: number; index: number } {
  let error = 0;
  let index = Math.floor(d.length / 2);
  for (let i = 1; i < d.length - 1; i++) {
    const v = sub(at(b, u[i]), d[i]);
    const e = dot(v, v);
    if (e >= error) {
      error = e;
      index = i;
    }
  }
  return { error, index };
}

/** One Newton step for each sample: move its parameter to the nearest place on the curve. */
function reparameterise(d: Pt[], b: Bezier, u: number[]): number[] {
  const d1: Pt[] = [mul(sub(b[1], b[0]), 3), mul(sub(b[2], b[1]), 3), mul(sub(b[3], b[2]), 3)];
  const d2: Pt[] = [mul(sub(d1[1], d1[0]), 2), mul(sub(d1[2], d1[1]), 2)];
  return u.map((t, i) => {
    const s = 1 - t;
    const q = sub(at(b, t), d[i]);
    const q1 = add(add(mul(d1[0], s * s), mul(d1[1], 2 * s * t)), mul(d1[2], t * t));
    const q2 = add(mul(d2[0], s), mul(d2[1], t));
    const den = dot(q1, q1) + dot(q, q2);
    return den === 0 ? t : Math.max(0, Math.min(1, t - dot(q, q1) / den));
  });
}

function fit(d: Pt[], t1: Pt, t2: Pt, tol2: number, out: Bezier[]): void {
  if (d.length === 2) {
    const third = len(sub(d[1], d[0])) / 3;
    out.push([d[0], add(d[0], mul(t1, third)), add(d[1], mul(t2, third)), d[1]]);
    return;
  }
  let u = chordParams(d);
  let b = generate(d, u, t1, t2);
  let w = worst(d, b, u);
  if (w.error < tol2) return void out.push(b);
  if (w.error < tol2 * 16) {
    for (let i = 0; i < 4; i++) {
      u = reparameterise(d, b, u);
      b = generate(d, u, t1, t2);
      w = worst(d, b, u);
      if (w.error < tol2) return void out.push(b);
    }
  }
  const k = Math.max(1, Math.min(d.length - 2, w.index));
  const centre = unit(sub(d[k - 1], d[k + 1]));
  const tangent: Pt = len(centre) > 0 ? centre : unit(sub(d[k - 1], d[k]));
  fit(d.slice(0, k + 1), t1, tangent, tol2, out);
  fit(d.slice(k), mul(tangent, -1), t2, tol2, out);
}

/** Tangent at the start of `d`, looking a few samples in so one jittery sample does not rule. */
function endTangent(d: Pt[]): Pt {
  return unit(sub(d[Math.min(3, d.length - 1)], d[0]));
}

function corners(d: Pt[], closed: boolean): number[] {
  const n = d.length;
  const W = 3;
  const turn = (i: number) => {
    const a = closed ? d[(i - W + n) % n] : d[Math.max(0, i - W)];
    const b = closed ? d[(i + W) % n] : d[Math.min(n - 1, i + W)];
    const u = unit(sub(d[i], a));
    const v = unit(sub(b, d[i]));
    return Math.acos(Math.max(-1, Math.min(1, dot(u, v))));
  };
  const limit = (65 * Math.PI) / 180;
  const out: number[] = [];
  const from = closed ? 0 : W;
  const to = closed ? n : n - W;
  for (let i = from; i < to; i++) {
    const t = turn(i);
    if (t < limit) continue;
    // Only the sharpest sample of a bend is its corner.
    let peak = true;
    for (let k = -W; k <= W && peak; k++) {
      if (k && (closed || (i + k >= 0 && i + k < n)) && turn(closed ? (i + k + n) % n : i + k) > t) peak = false;
    }
    if (peak && (!out.length || i - out[out.length - 1] >= W)) out.push(i);
  }
  return out;
}

function nodesFrom(curves: Bezier[], isCorner: Set<Pt>, closed: boolean): CncNode[] {
  const nodes: CncNode[] = curves.map((c, i) => {
    const before = i > 0 ? curves[i - 1] : closed ? curves[curves.length - 1] : null;
    return { p: c[0], ...(before ? { in: before[2] } : {}), out: c[1], ...(isCorner.has(c[0]) ? { corner: true } : {}) };
  });
  if (!closed) {
    const last = curves[curves.length - 1];
    nodes.push({ p: last[3], in: last[2] });
  }
  return nodes;
}

/**
 * Curves through a stroke's samples, none further than `tolerance` (metres) from them. A
 * closed stroke does not repeat its first sample. Null: too short to be anything.
 */
export function fitStroke(samples: Pt[], tolerance: number, closed: boolean): CncNode[] | null {
  const spaced: Pt[] = [];
  for (const p of samples) {
    if (!spaced.length || len(sub(p, spaced[spaced.length - 1])) >= tolerance / 2) spaced.push(p);
  }
  if (closed && spaced.length > 1 && len(sub(spaced[0], spaced[spaced.length - 1])) < tolerance / 2) spaced.pop();
  if (spaced.length < (closed ? 4 : 2)) return null;
  const tol2 = tolerance * tolerance;
  const n = spaced.length;
  const cut = corners(spaced, closed);
  const out: Bezier[] = [];
  const cornerPoints = new Set<Pt>(cut.map((i) => spaced[i]));
  if (closed) {
    // Start at a corner when there is one, so the seam does not smooth a real corner away.
    const start = cut[0] ?? 0;
    const order = spaced.slice(start).concat(spaced.slice(0, start), [spaced[start]]);
    const marks = (cut.length ? cut.map((i) => (i - start + n) % n) : [0]).sort((a, b) => a - b);
    marks.push(n);
    const seam = cut.length ? null : unit(sub(order[1], order[n - 1]));
    for (let k = 0; k + 1 < marks.length; k++) {
      const run = order.slice(marks[k], marks[k + 1] + 1);
      const t1 = seam ?? endTangent(run);
      const t2 = seam ? mul(seam, -1) : endTangent([...run].reverse());
      if (run.length >= 2) fit(run, t1, t2, tol2, out);
    }
    return nodesFrom(out, cornerPoints, true);
  }
  const marks = [0, ...cut, n - 1];
  for (let k = 0; k + 1 < marks.length; k++) {
    const run = spaced.slice(marks[k], marks[k + 1] + 1);
    if (run.length >= 2) fit(run, endTangent(run), endTangent([...run].reverse()), tol2, out);
  }
  return nodesFrom(out, cornerPoints, false);
}
