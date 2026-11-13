import type { CncGuide, Pt } from "./design";
import { dirOf, normalise } from "./polar";

/**
 * Where a point aimed at the CNC board lands. Every candidate is measured from where the
 * pointer really is, so the grid never pushes the aim away from a point it was on, and a
 * level with some off-grid point only wins over the grid when it is the nearer of the two.
 */

/** What the pointer can land on. Points are the drawing's, less any being moved. */
export interface SnapScene {
  points: Pt[];
  guides: CncGuide[];
  mirrorX: number | null;
  /** The grid step when snapping to the grid is on. */
  grid: number | null;
  /** Levels with other points, and reference lines. */
  smart: boolean;
  /** Pixels a metre. */
  scale: number;
  /** The protractor: aims near a whole number of steps (degrees) from this point lock to it. */
  polar?: { from: Pt; step: number };
}

export interface Snap {
  point: Pt;
  /** A level shown as a dashed line through the point it came from. */
  guide: { x?: number; y?: number } | null;
  /** The protractor's angle the aim locked to, drawn as a dotted line from where it starts. */
  track?: { from: Pt; angle: number };
}

/** How near, in pixels, each kind of target pulls. */
export const POINT_PX = 8;
export const ALIGN_PX = 6;
export const MIRROR_PX = 9;
/** How near a protractor step pulls, and how far out it starts to: close in, every angle is near. */
export const TRACK_PX = 8;
export const TRACK_START_PX = 24;

const roundTo = (v: number, step: number) => Math.round(v / step) * step;
const R = Math.SQRT1_2;
/** The eight directions Shift locks to, exact so a level line stays level. */
const DIRECTIONS: Pt[] = [[1, 0], [R, R], [0, 1], [-R, R], [-1, 0], [-R, -R], [0, -1], [R, -R]];

/** The drawing point nearest `p` within `reach`, exactly as it is, so lines that meet there join. */
function nearestPoint(p: Pt, points: Pt[], reach: number): Pt | null {
  let best = reach;
  let hit: Pt | null = null;
  for (const q of points) {
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d < best) {
      best = d;
      hit = q;
    }
  }
  return hit;
}

interface Level {
  v: number;
  /** Shown as a guide; the mirror line is already on the board. */
  shown: boolean;
}

/** The nearest level with a point (or the mirror line) along one axis, within reach. */
function nearestLevel(v: number, k: 0 | 1, s: SnapScene): Level | null {
  let best = Infinity;
  let hit: Level | null = null;
  if (s.smart) {
    for (const p of s.points) {
      const d = Math.abs(p[k] - v);
      if (d * s.scale < ALIGN_PX && d < best) {
        best = d;
        hit = { v: p[k], shown: true };
      }
    }
  }
  if (k === 0 && s.mirrorX !== null) {
    const d = Math.abs(s.mirrorX - v);
    if (d * s.scale <= MIRROR_PX && d < best) hit = { v: s.mirrorX, shown: false };
  }
  return hit;
}

export function snapPoint(raw: Pt, s: SnapScene, shiftFrom?: Pt | null): Snap {
  if (shiftFrom) {
    const a = Math.round(Math.atan2(raw[1] - shiftFrom[1], raw[0] - shiftFrom[0]) / (Math.PI / 4));
    return snapAlong(raw, s, shiftFrom, DIRECTIONS[((a % 8) + 8) % 8]);
  }
  const hit = nearestPoint(raw, s.points, POINT_PX / s.scale);
  if (hit) return { point: hit, guide: null };
  if (s.polar && s.polar.step > 0) {
    const { from, step } = s.polar;
    const d: Pt = [raw[0] - from[0], raw[1] - from[1]];
    if (Math.hypot(d[0], d[1]) * s.scale >= TRACK_START_PX) {
      const angle = normalise(Math.round((Math.atan2(d[1], d[0]) * 180) / Math.PI / step) * step);
      const u = dirOf(angle);
      const off = Math.abs(u[0] * d[1] - u[1] * d[0]);
      if (off * s.scale <= TRACK_PX && u[0] * d[0] + u[1] * d[1] > 0) return { ...snapAlong(raw, s, from, u), track: { from, angle } };
    }
  }
  // Each axis on its own: a level wins over the grid only when it is nearer.
  const axis = (k: 0 | 1): Level | null => {
    const level = nearestLevel(raw[k], k, s);
    if (level && (s.grid === null || Math.abs(level.v - raw[k]) < Math.abs(roundTo(raw[k], s.grid) - raw[k]))) return level;
    return null;
  };
  const lx = axis(0);
  const ly = axis(1);
  const at = (k: 0 | 1, level: Level | null) => level?.v ?? (s.grid === null ? raw[k] : roundTo(raw[k], s.grid));
  let point: Pt = [at(0, lx), at(1, ly)];
  if (s.smart && !(lx && ly)) {
    const on = onGuides(raw, s, lx?.v ?? null, ly?.v ?? null);
    if (on) point = on;
  }
  const guide = lx?.shown || ly?.shown ? { ...(lx?.shown ? { x: lx.v } : {}), ...(ly?.shown ? { y: ly.v } : {}) } : null;
  return { point, guide };
}

/** A point on the nearest reference line, or where two cross; null when none is near. */
function onGuides(raw: Pt, s: SnapScene, fx: number | null, fy: number | null): Pt | null {
  const reach = ALIGN_PX / s.scale;
  const near = s.guides
    .map((g) => ({ g, d: Math.abs(g.dir[0] * (raw[1] - g.p[1]) - g.dir[1] * (raw[0] - g.p[0])) }))
    .filter((x) => x.d <= reach)
    .sort((a, b) => a.d - b.d);
  if (!near.length) return null;
  const first = near[0].g;
  for (const { g } of near.slice(1)) {
    const den = first.dir[0] * g.dir[1] - first.dir[1] * g.dir[0];
    if (Math.abs(den) < 1e-6) continue;
    const t = ((g.p[0] - first.p[0]) * g.dir[1] - (g.p[1] - first.p[1]) * g.dir[0]) / den;
    const crossing: Pt = [first.p[0] + first.dir[0] * t, first.p[1] + first.dir[1] * t];
    if (Math.hypot(crossing[0] - raw[0], crossing[1] - raw[1]) <= reach * 1.5) return crossing;
  }
  const t0 = (raw[0] - first.p[0]) * first.dir[0] + (raw[1] - first.p[1]) * first.dir[1];
  const along = (t: number): Pt => [first.p[0] + first.dir[0] * t, first.p[1] + first.dir[1] * t];
  // Where the line meets x = v (k 0) or y = v (k 1), if it does.
  const meets = (k: 0 | 1, v: number): number | null => (Math.abs(first.dir[k]) < 1e-9 ? null : (v - first.p[k]) / first.dir[k]);
  // Slide along the line to a level already found, or else to the nearest grid line.
  let stops: (number | null)[];
  if (fx !== null) stops = [meets(0, fx)];
  else if (fy !== null) stops = [meets(1, fy)];
  else if (s.grid !== null) stops = [meets(0, roundTo(raw[0], s.grid)), meets(1, roundTo(raw[1], s.grid))];
  else stops = [];
  let best: number | null = null;
  for (const t of stops) if (t !== null && Math.abs(t - t0) * s.scale <= 2 * Math.max(ALIGN_PX, (s.grid ?? 0) * s.scale) && (best === null || Math.abs(t - t0) < Math.abs(best - t0))) best = t;
  return along(best ?? t0);
}

/**
 * The point stays on the line from `from` along unit `u` (Shift's direction, a protractor
 * step, a typed angle) and stops along it at a point, a level with one, or the grid.
 */
export function snapAlong(raw: Pt, s: SnapScene, from: Pt, u: Pt): Snap {
  const l = (raw[0] - from[0]) * u[0] + (raw[1] - from[1]) * u[1];
  const at = (t: number): Pt => [from[0] + u[0] * t, from[1] + u[1] * t];
  const hit = nearestPoint(at(l), s.points, POINT_PX / s.scale);
  if (hit) return { point: hit, guide: null };
  // Where the direction crosses x = v (k 0) or y = v (k 1).
  const meets = (k: 0 | 1, v: number): number | null => (u[k] === 0 ? null : (v - from[k]) / u[k]);
  let level: { t: number; guide: Snap["guide"] } | null = null;
  for (const k of [0, 1] as const) {
    const near = nearestLevel(at(l)[k], k, s);
    const t = near ? meets(k, near.v) : null;
    if (near && t !== null && (!level || Math.abs(t - l) < Math.abs(level.t - l))) level = { t, guide: near.shown ? (k === 0 ? { x: near.v } : { y: near.v }) : null };
  }
  let grid: number | null = null;
  if (s.grid !== null) {
    for (const k of [0, 1] as const) {
      const t = meets(k, roundTo(at(l)[k], s.grid));
      if (t !== null && (grid === null || Math.abs(t - l) < Math.abs(grid - l))) grid = t;
    }
  }
  if (level && (grid === null || Math.abs(level.t - l) < Math.abs(grid - l))) return { point: at(level.t), guide: level.guide };
  return { point: at(grid ?? l), guide: null };
}
