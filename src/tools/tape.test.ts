import { describe, expect, it } from "vitest";
import type { KernelOp, V3 } from "../kernel/types";
import { ev, fakeHost } from "./fakeHost";
import { DimensionTool, TapeTool, perpendicularFrom } from "./tape";
import type { Snap as ToolSnap } from "./tool";

const IN = 0.0254;
const tick = () => new Promise((r) => setTimeout(r, 0));
const last = (h: { ops: KernelOp[] }) => h.ops[h.ops.length - 1] as unknown as Record<string, unknown>;
const onEdge = (p: V3, a: V3, b: V3): ToolSnap => ({
  point: p,
  kind: "on-edge",
  tip: "On Edge",
  surface: null,
  entity: { kind: "edge", owner: { kind: "object", id: 1 }, a, b, drawn: false },
  lines: [],
});

describe("Tape measure", () => {
  describe("from an edge's midpoint", () => {
    const edge: [V3, V3] = [[0, 0, 0], [2, 0, 0]];
    const mid = (): ToolSnap => ({ ...onEdge([1, 0, 0], ...edge), kind: "midpoint", tip: "Midpoint" });
    const started = () => {
      const h = fakeHost();
      const t = new TapeTool(h);
      t.onEvent(ev("click", [1, 0, 0], { snap: mid() }));
      return { h, t };
    };
    const free = (p: V3): ToolSnap => ({ point: p, kind: "free", tip: "", surface: null, entity: null, lines: [] });

    it("places a guide through the midpoint, square to the edge", async () => {
      const { h, t } = started();
      // Off to one side and well along: only the sideways part sets the direction.
      t.onEvent(ev("click", [1.7, 0.4, 0], { snap: free([1.7, 0.4, 0]) }));
      await tick();
      expect(last(h)).toMatchObject({ op: "add_guide", point: [1, 0, 0], dir: [0, 1, 0] });
    });

    it("measures instead after a tap of Ctrl, and goes back on a second tap", async () => {
      const { h, t } = started();
      t.onModifier("ctrl");
      t.onEvent(ev("click", [1.5, 0, 0], { snap: free([1.5, 0, 0]) }));
      await tick();
      expect(h.ops).toHaveLength(0);
      expect(t.view().labels).toHaveLength(1);

      const again = started();
      again.t.onModifier("ctrl");
      again.t.onModifier("ctrl");
      again.t.onEvent(ev("click", [1, 0.4, 0], { snap: free([1, 0.4, 0]) }));
      await tick();
      expect(last(again.h)).toMatchObject({ op: "add_guide", dir: [0, 1, 0] });
    });

    it("drops a guide point a typed length along the square", async () => {
      const { h, t } = started();
      t.onEvent(ev("move", [1, 0.4, 0], { snap: free([1, 0.4, 0]) }));
      t.onValue("0.5m");
      await tick();
      const op = last(h);
      expect(op).toMatchObject({ op: "add_guide", dir: null });
      expect((op.point as V3)[1]).toBeCloseTo(0.5, 9);
    });
  });

  const pt = (p: V3): ToolSnap => ({ point: p, kind: "endpoint", tip: "Endpoint", surface: null, entity: null, lines: [] });
  const measure = () => {
    const h = fakeHost();
    const t = new TapeTool(h);
    t.onEvent(ev("click", [0, 0, 0], { snap: pt([0, 0, 0]) }));
    t.onEvent(ev("click", [1, 0, 0], { snap: pt([1, 0, 0]) }));
    return t;
  };

  it("keeps the measured line and its length on screen", () => {
    const v = measure().view();
    expect(v.overlay.map((o) => o.points)).toContainEqual([[0, 0, 0], [1, 0, 0]]);
    expect(v.labels).toHaveLength(1);
  });

  it("drops the measured line on the next click, on Esc and on another tool", () => {
    let t = measure();
    t.onEvent(ev("click", [2, 0, 0], { snap: pt([2, 0, 0]) }));
    expect(t.view().labels).toHaveLength(0);
    t = measure();
    expect(t.cancel()).toBe(true);
    expect(t.view().overlay).toHaveLength(0);
    expect(t.cancel()).toBe(false);
    t = measure();
    t.deactivate();
    expect(t.view().overlay).toHaveLength(0);
  });

  it("shows no marker from its last use when it comes back", () => {
    const t = new TapeTool(fakeHost());
    t.onEvent(ev("move", [1, 2, 3], { snap: pt([1, 2, 3]) }));
    expect(t.view().marker).not.toBeNull();
    t.deactivate();
    t.activate();
    expect(t.view().marker).toBeNull();
  });

  it("perpendicular offsets from an edge", () => {
    expect(perpendicularFrom([0, 0, 0], [1, 0, 0], [0.4, 0, 0.3])).toEqual([0, 0, 0.3]);
  });

  it("from an edge: move away and type the offset to place a parallel guide", async () => {
    const h = fakeHost({ outcome: { kind: "guide_added", guide: 1 } });
    const t = new TapeTool(h);
    // The bottom edge of a side's inner face (x = 3/4 in, along y).
    const a: V3 = [0.75 * IN, 0, 0];
    const b: V3 = [0.75 * IN, 11.25 * IN, 0];
    t.onEvent(ev("click", [0.75 * IN, 5 * IN, 0], { snap: onEdge([0.75 * IN, 5 * IN, 0], a, b) }));
    expect(t.valueLabel()).toBe("Offset");
    t.onEvent(ev("move", [0.75 * IN, 5 * IN, 0.3], { snapKind: "on-face" }));
    t.onValue("21 1/2");
    await tick();
    const op = last(h) as { op: string; point: V3; dir: V3 };
    expect(op.op).toBe("add_guide");
    expect(op.dir).toEqual([0, 1, 0]);
    expect(op.point[0]).toBeCloseTo(0.75 * IN, 12);
    expect(op.point[2]).toBeCloseTo(21.5 * IN, 12);
  });

  it("point to point measures without drawing; a typed length drops a guide point", async () => {
    const h = fakeHost();
    const t = new TapeTool(h);
    t.onEvent(ev("click", [0, 0, 0], { snapKind: "endpoint" }));
    t.onEvent(ev("click", [0, 16 * IN, 0], { snapKind: "endpoint" }));
    expect(h.statuses.at(-1)?.text).toMatch(/Distance 16 in/);
    expect(h.ops).toHaveLength(0);
    t.onEvent(ev("click", [0, 0, 0], { snapKind: "endpoint" }));
    t.onEvent(ev("move", [1, 0, 0], { snapKind: "axis-x" }));
    t.onValue("36");
    await tick();
    expect(last(h)).toMatchObject({ op: "add_guide", dir: null });
    expect((last(h).point as V3)[0]).toBeCloseTo(36 * IN, 12);
  });
});

describe("Dimension", () => {
  it("two points, then the line's place: the offset is perpendicular to the span", async () => {
    const h = fakeHost();
    const t = new DimensionTool(h);
    t.onEvent(ev("click", [0, 0, 0], { snapKind: "endpoint" }));
    t.onEvent(ev("click", [1, 0, 0], { snapKind: "endpoint" }));
    t.onEvent(ev("move", [0.7, -0.2, 0], { snapKind: "free" }));
    expect(t.view().labels[0].text).toBe(h.fmt(1));
    t.onEvent(ev("click", [0.7, -0.2, 0], { snapKind: "free" }));
    await tick();
    expect(last(h)).toMatchObject({ op: "add_dimension", a: [0, 0, 0], b: [1, 0, 0] });
    const off = last(h).offset as V3;
    expect(off[0]).toBeCloseTo(0, 12);
    expect(off[1]).toBeCloseTo(-0.2, 12);
  });

  it("clicking an edge dimensions it", () => {
    const h = fakeHost();
    const t = new DimensionTool(h);
    t.onEvent(ev("click", [0.5, 0, 0], { snap: onEdge([0.5, 0, 0], [0, 0, 0], [2, 0, 0]) }));
    t.onEvent(ev("move", [1, 1, 0], { snapKind: "free" }));
    expect(t.view().labels[0].text).toBe(h.fmt(2));
  });
});
