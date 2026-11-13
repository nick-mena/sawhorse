import { describe, expect, it } from "vitest";
import type { CncGuide, Pt } from "./design";
import { snapPoint, type SnapScene } from "./snap";

// A board at 1000 pixels a metre with a half-inch grid: one cell is 12.7 pixels.
const GRID = 0.0127;
const scene = (over: Partial<SnapScene> = {}): SnapScene => ({ points: [], guides: [], mirrorX: null, grid: GRID, smart: true, scale: 1000, ...over });
const onGrid = (v: number) => Math.abs(v / GRID - Math.round(v / GRID)) < 1e-9;

describe("snapPoint", () => {
  it("rounds to the grid when nothing else is near", () => {
    const r = snapPoint([0.0262, 0.0119], scene());
    expect(r.point[0]).toBeCloseTo(0.0254, 9);
    expect(r.point[1]).toBeCloseTo(0.0127, 9);
  });

  it("lands on a point under the cursor even when the grid would round far from it", () => {
    // The point sits mid-cell: rounding first put the aim nine pixels away, past the reach.
    const p: Pt = [0.0063, 0.0063];
    expect(snapPoint([0.0064, 0.0062], scene({ points: [p] })).point).toEqual(p);
  });

  it("keeps the grid over an off-grid point's level that is farther than the grid line", () => {
    // An arc's middle point is level at y = 0.0170; the cursor is nearer the grid line at 0.0127.
    const r = snapPoint([0.0254, 0.0130], scene({ points: [[0.2, 0.017]] }));
    expect(r.point[0]).toBeCloseTo(0.0254, 9);
    expect(r.point[1]).toBeCloseTo(0.0127, 9);
    expect(r.guide).toBeNull();
  });

  it("takes a point's level when it is nearer than the grid line, and shows the guide", () => {
    const r = snapPoint([0.0254, 0.0138], scene({ points: [[0.2, 0.014]] }));
    expect(r.point).toEqual([0.0254, 0.014]);
    expect(r.guide).toEqual({ y: 0.014 });
  });

  it("aligns to points without the grid", () => {
    const r = snapPoint([0.0503, 0.0302], scene({ grid: null, points: [[0.05, 0.2]] }));
    expect(r.point).toEqual([0.05, 0.0302]);
    expect(r.guide).toEqual({ x: 0.05 });
  });

  it("does not align when smart guides are off, but still lands on a point", () => {
    expect(snapPoint([0.0503, 0.0302], scene({ grid: null, smart: false, points: [[0.05, 0.2]] })).point).toEqual([0.0503, 0.0302]);
    expect(snapPoint([0.0503, 0.0302], scene({ grid: null, smart: false, points: [[0.05, 0.03]] })).point).toEqual([0.05, 0.03]);
  });

  it("slides along a reference line to the nearest grid line", () => {
    const level: CncGuide = { id: 1, p: [0, 0.0101], dir: [1, 0] };
    const r = snapPoint([0.0130, 0.0105], scene({ guides: [level] }));
    expect(r.point[0]).toBeCloseTo(0.0127, 9);
    expect(r.point[1]).toBeCloseTo(0.0101, 9);
  });

  it("lands where two reference lines cross", () => {
    const level: CncGuide = { id: 1, p: [0, 0.0101], dir: [1, 0] };
    const plumb: CncGuide = { id: 2, p: [0.0302, 0], dir: [0, 1] };
    const r = snapPoint([0.0299, 0.0104], scene({ guides: [level, plumb] }));
    expect(r.point[0]).toBeCloseTo(0.0302, 9);
    expect(r.point[1]).toBeCloseTo(0.0101, 9);
  });

  it("keeps Shift's direction exact on the grid, from a start off the grid", () => {
    const from: Pt = [0.005, 0.001];
    const r = snapPoint([0.035, 0.033], scene(), from);
    const d: Pt = [r.point[0] - from[0], r.point[1] - from[1]];
    expect(d[1]).toBeCloseTo(d[0], 9);
    expect(onGrid(r.point[0]) || onGrid(r.point[1])).toBe(true);
    const level = snapPoint([0.04, 0.003], scene(), from);
    expect(level.point[1]).toBeCloseTo(from[1], 9);
    expect(onGrid(level.point[0])).toBe(true);
  });

  it("with Shift, stops level with a nearby point along the locked direction", () => {
    const from: Pt = [0, 0];
    const r = snapPoint([0.0505, 0.002], scene({ grid: null, points: [[0.05, 0.3]] }), from);
    expect(r.point).toEqual([0.05, 0]);
    expect(r.guide).toEqual({ x: 0.05 });
  });

  it("pulls onto the mirror line", () => {
    expect(snapPoint([0.1005, 0.0302], scene({ grid: null, mirrorX: 0.1 })).point).toEqual([0.1, 0.0302]);
  });
});
