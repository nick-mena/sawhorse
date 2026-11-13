import { describe, expect, it } from "vitest";
import { analyse, circleNodes, flatten, nearestOnPath, rectNodes, ringArea, type CncPath } from "./design";
import { arcNodes, bulgeForRadius, bulgeFromPoint, eraseSegments, joinEnds, offsetPath, offsetProblem, reversed, sideOf } from "./edit";

const square: CncPath = { id: 1, closed: true, nodes: rectNodes([0, 0], [1, 1]) };
const line = (id: number, a: [number, number], b: [number, number]): CncPath => ({ id, closed: false, nodes: [{ p: a }, { p: b }] });

describe("erasing segments", () => {
  it("one side of a square leaves an open line of three", () => {
    const [p, ...rest] = eraseSegments(square, new Set([0]), 9);
    expect(rest).toEqual([]);
    expect(p.closed).toBe(false);
    expect(p.nodes.map((n) => n.p)).toEqual([[1, 0], [1, 1], [0, 1], [0, 0]]);
  });

  it("the middle of an open line breaks it in two, the second with a new id", () => {
    const open: CncPath = { id: 4, closed: false, nodes: [{ p: [0, 0] }, { p: [1, 0] }, { p: [2, 0] }, { p: [3, 0] }] };
    const parts = eraseSegments(open, new Set([1]), 7);
    expect(parts.map((p) => p.id)).toEqual([4, 7]);
    expect(parts.map((p) => p.nodes.length)).toEqual([2, 2]);
  });

  it("every segment leaves nothing, and a curve's cut ends lose the handle into the gap", () => {
    expect(eraseSegments(square, new Set([0, 1, 2, 3]), 9)).toEqual([]);
    const [arc] = eraseSegments({ id: 2, closed: true, nodes: circleNodes([0, 0], 1) }, new Set([3]), 9);
    expect(arc.nodes[0].in).toBeUndefined();
    expect(arc.nodes[arc.nodes.length - 1].out).toBeUndefined();
  });
});

describe("joining", () => {
  it("lines drawn end to end become one, and closing the loop makes a shape", () => {
    let paths = [line(1, [0, 0], [1, 0]), line(2, [1, 0], [1, 1]), line(3, [1, 1], [0, 0])];
    let r = joinEnds(paths, 2);
    expect(r.joined).toBe(2);
    expect(r.closed).toBe(true);
    paths = r.paths;
    expect(paths).toHaveLength(1);
    expect(paths[0].nodes).toHaveLength(3);
    r = joinEnds([line(5, [0, 0], [1, 0]), line(6, [2, 0], [3, 0])], 5);
    expect(r.joined).toBe(0);
  });

  it("joins whichever way the other line runs", () => {
    const r = joinEnds([line(1, [0, 0], [1, 0]), reversed(line(2, [1, 0], [2, 1]))], 1);
    expect(r.paths).toHaveLength(1);
    expect(r.paths[0].nodes.map((n) => n.p)).toEqual([[0, 0], [1, 0], [2, 1]]);
  });
});

describe("two-point arcs", () => {
  it("a half circle bulging to the left of its chord", () => {
    const nodes = arcNodes([-1, 0], [1, 0], 1);
    const path: CncPath = { id: 1, closed: false, nodes };
    expect(nearestOnPath(path, [0, 1])!.distance).toBeLessThan(1e-3);
    expect(nearestOnPath(path, [0, -1])!.distance).toBeGreaterThan(1);
    for (let k = 1; k < 20; k++) {
      const a = (k / 20) * Math.PI;
      expect(nearestOnPath(path, [Math.cos(a), Math.sin(a)])!.distance).toBeLessThan(5e-4);
    }
  });

  it("bulge from the cursor, and from a typed radius", () => {
    expect(bulgeFromPoint([0, 0], [2, 0], [1, -0.5])).toBeCloseTo(-0.5, 12);
    expect(bulgeForRadius([0, 0], [2, 0], 1, 1)).toBeCloseTo(1, 12);
    expect(bulgeForRadius([0, 0], [2, 0], 0.5, 1)).toBeNull();
  });

  it("no bulge is a straight line", () => {
    expect(arcNodes([0, 0], [1, 0], 0)).toEqual([{ p: [0, 0] }, { p: [1, 0] }]);
  });
});

describe("offset", () => {
  it("a circle offsets to a circle, inward to the left of its run", () => {
    const circle: CncPath = { id: 1, closed: true, nodes: circleNodes([0, 0], 1) };
    const inner = offsetPath(circle, 0.2);
    expect(Math.abs(ringArea(flatten(inner.nodes).points))).toBeCloseTo(Math.PI * 0.64, 2);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * 2 * Math.PI;
      expect(nearestOnPath(inner, [0.8 * Math.cos(a), 0.8 * Math.sin(a)])!.distance).toBeLessThan(2e-3);
    }
  });

  it("a square keeps sharp corners going out", () => {
    const out = offsetPath(square, -0.1);
    expect(out.nodes.map((n) => n.p.map((v) => Math.round(v * 1e9) / 1e9))).toEqual([[-0.1, -0.1], [1.1, -0.1], [1.1, 1.1], [-0.1, 1.1]]);
  });

  it("too far in crosses itself, which the checks report", () => {
    const thin: CncPath = { id: 1, closed: true, nodes: rectNodes([0, 0], [2, 0.2]) };
    expect(offsetProblem(thin, offsetPath(thin, 0.5))).toMatch(/wider than the shape/);
    expect(offsetProblem(thin, offsetPath(thin, 0.05))).toBeNull();
    expect(analyse({ paths: [offsetPath(thin, 0.05)], mirrorX: null }).problems).toEqual([]);
  });

  it("which side of a path the cursor is on", () => {
    expect(sideOf(square, [0.5, 0.2])).toBeCloseTo(0.2, 6);
    expect(sideOf(square, [0.5, -0.2])).toBeCloseTo(-0.2, 6);
  });
});
