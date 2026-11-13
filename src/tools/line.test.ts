import { describe, expect, it } from "vitest";
import type { KernelOp, SurfaceHit, V3 } from "../kernel/types";
import { ev, fakeHost } from "./fakeHost";
import { CircleTool } from "./circle";
import { LineTool } from "./line";

const tick = () => new Promise((r) => setTimeout(r, 0));
const side: SurfaceHit = {
  at: { kind: "face", object: 1, face: 2 },
  frame: { origin: [1, 0, 0], normal: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  point: [1, 0.5, 0.5],
  t: 9,
};
const fromRight = (y: number, z: number) => ({ ray: { origin: [10, y, z] as V3, dir: [-1, 0, 0] as V3 }, forward: [-1, 0, 0] as V3 });
const onSide = (type: "move" | "click", y: number, z: number) => {
  const e = ev(type, [1, y, z], { snapKind: "on-face", ...fromRight(y, z) });
  return { ...e, snap: { ...e.snap!, surface: { ...side, point: [1, y, z] as V3 } } };
};
const free = (type: "move" | "click", y: number, z: number) => ev(type, [0, y, z], { snapKind: "free", ...fromRight(y, z) });
const refuseDangling = (h: ReturnType<typeof fakeHost>) => {
  h.apply = async (op) => {
    const target = (op as unknown as { target: { on: string } }).target;
    h.ops.push(op);
    if (target.on === "face") return null;
    return { outcome: { kind: "drawn", regions: [], faces: [] }, scene: {} } as never;
  };
  h.lastError = () => "a line on a face must start and end on its edges, or close into a loop";
};
const draw = (op: KernelOp | undefined) => op as unknown as { op: string; target: { on: string; origin?: V3; normal?: V3 }; points: V3[]; closed: boolean };

describe("Line: a stroke on a face that has not reached an edge", () => {
  async function dangling() {
    const h = fakeHost();
    refuseDangling(h);
    const t = new LineTool(h);
    for (const [y, z] of [[0.2, 0.2], [0.6, 0.2], [0.6, 0.7]]) {
      t.onEvent(onSide("move", y, z));
      t.onEvent(onSide("click", y, z));
      await tick();
    }
    return { h, t };
  }

  it("Esc keeps what was clicked, as one line on the face's plane", async () => {
    const { h, t } = await dangling();
    const before = h.ops.length;
    expect(t.cancel()).toBe(true);
    await tick();
    expect(h.ops.length).toBe(before + 1);
    const kept = draw(h.ops.at(-1));
    expect(kept.target).toMatchObject({ on: "plane", normal: [1, 0, 0] });
    expect(kept.points).toEqual([[1, 0.2, 0.2], [1, 0.6, 0.2], [1, 0.6, 0.7]]);
    expect(kept.closed).toBe(false);
    expect(t.busy()).toBe(false);
  });

  it("switching tools keeps it too", async () => {
    const { h, t } = await dangling();
    t.deactivate();
    await tick();
    expect(draw(h.ops.at(-1)).target.on).toBe("plane");
  });

  it("a stroke that never got a second point leaves nothing", async () => {
    const h = fakeHost();
    refuseDangling(h);
    const t = new LineTool(h);
    t.onEvent(onSide("click", 0.2, 0.2));
    await tick();
    t.cancel();
    await tick();
    expect(h.ops).toEqual([]);
  });

  it("the status line says Esc keeps it", async () => {
    const { h } = await dangling();
    expect(h.statuses.at(-1)?.text).toMatch(/Esc .*keeps/);
  });
});

describe("Looking level (Right, Front...): what the first segment settles", () => {
  it("a level line stays on the upright plane facing the eye, so the next click can land", async () => {
    const h = fakeHost();
    h.outcome = { kind: "drawn", regions: [], faces: [] } as never;
    const t = new LineTool(h);
    t.onEvent(free("move", 0, 0.5));
    t.onEvent(free("click", 0, 0.5));
    t.onEvent(free("move", 1, 0.5));
    t.onEvent(free("click", 1, 0.5));
    await tick();
    expect(draw(h.ops[0]).target.normal?.[0]).toBeCloseTo(1, 12);
    expect(Math.abs(draw(h.ops[0]).target.normal![2])).toBeCloseTo(0, 12);
  });

  it("a circle started in empty space faces the eye", () => {
    const h = fakeHost();
    const t = new CircleTool(h);
    t.onEvent(free("move", 0, 0.5));
    t.onEvent(free("click", 0, 0.5));
    expect(t.inferContext().plane?.normal).toEqual([1, 0, 0]);
  });
});
