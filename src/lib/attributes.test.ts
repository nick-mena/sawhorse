// The Attributes pane's facts and the ops its fields send.
import { describe, expect, it } from "vitest";
import type { DocState } from "../kernel/types";
import { attributesOf, positionOp, sizeOp, type Attributes } from "./attributes";

const IN = 0.0254;
const state = {
  solids: [
    { id: 1, number: 1, min: [0, 0, 0], max: [36 * IN, 8 * IN, 3 * IN], volume: 1 },
    { id: 2, number: 2, min: [40 * IN, 0, 0], max: [42 * IN, 2 * IN, 20 * IN], volume: 1 },
  ],
  object_info: [
    { id: 1, name: "Seat rail", tag: null, material: "White oak" },
    { id: 2, name: null, tag: "Legs", material: "Walnut" },
  ],
  graph: { nodes: [], definitions: [], leaves: [], context: null },
} as unknown as DocState;

const of = (ids: number[]) => attributesOf(ids.map((object) => ({ kind: "object" as const, object })), state) as Attributes;

describe("Attributes", () => {
  it("says what to do when nothing usable is selected", () => {
    expect(attributesOf([], state)).toMatch(/Select a part/);
    // A face stands for its solid, as it does for Move and the Outliner.
    expect((attributesOf([{ kind: "face", object: 1, face: 3 } as never], state) as Attributes).title).toBe("Seat rail");
  });

  it("one solid: its name, box, material and tag", () => {
    const a = of([1]);
    expect(a.title).toBe("Seat rail");
    expect(a.name).toBe("Seat rail");
    expect(a.hi.map((x) => +(x / IN).toFixed(6))).toEqual([36, 8, 3]);
    expect(a.material).toBe("White oak");
    expect(a.canMaterial).toBe(true);
  });

  it("several: one box around them all, and mixed values are said to be mixed", () => {
    const a = of([1, 2]);
    expect(a.title).toBe("2 parts");
    expect(a.hi.map((x) => +(x / IN).toFixed(6))).toEqual([42, 8, 20]);
    expect(a.material).toBeNull();
    expect(a.mixed).toEqual({ material: true, tag: true });
  });

  it("a typed position moves by the difference, in one op", () => {
    const op = positionOp(of([1]), state, 0, 10 * IN) as { op: string; objects: number[]; xform: { translation: number[] } };
    expect(op.op).toBe("transform");
    expect(op.objects).toEqual([1]);
    expect(op.xform.translation[0]).toBeCloseTo(10 * IN);
    expect(positionOp(of([1]), state, 0, 0)).toBeNull();
  });

  it("a typed size scales from the box's corner, and refuses in words", () => {
    const op = sizeOp(of([1]), state, 2, 6 * IN) as { xform: { linear: number[][]; translation: number[] } };
    expect(op.xform.linear[2][2]).toBeCloseTo(2);
    for (const t of op.xform.translation) expect(t).toBeCloseTo(0);
    expect(sizeOp(of([1]), state, 2, 0)).toMatch(/more than zero/);
    expect(sizeOp(of([1]), state, 2, 3 * IN)).toBeNull();
  });
});
