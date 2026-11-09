// The Joint tool's steps: the selection is the cutter, a click cuts, Ctrl+click adds.
import { describe, expect, it } from "vitest";
import type { Entity, OpOutcome, Picked } from "../kernel/types";
import { JointTool, partOf } from "./joint";
import { ev, fakeHost } from "./fakeHost";

const face = (object: number): Entity => ({ kind: "face", object, face: 1 }) as Entity;
const picked = (e: Entity): Picked => ({ entity: e, point: [0, 0, 0], surface: null }) as unknown as Picked;
const click = (t: JointTool, object: number, mods = {}) => {
  t.onEvent(ev("click", [0, 0, 0], { picked: picked(face(object)), ...mods }));
  return Promise.resolve();
};
const cutDone: OpOutcome = { kind: "parts_combined", objects: [1], unique: false };

describe("Joint", () => {
  it("a face stands for its whole solid", () => {
    expect(partOf(face(4))).toEqual({ kind: "object", object: 4 });
    expect(partOf({ kind: "node", node: 9 })).toEqual({ kind: "node", node: 9 });
    expect(partOf(null)).toBeNull();
  });

  it("the first click picks the cutter and changes nothing", async () => {
    const h = fakeHost({ outcome: cutDone });
    const t = new JointTool(h);
    await click(t, 2);
    expect(h.ops).toEqual([]);
    expect(h.sel).toEqual([{ kind: "object", object: 2 }]);
    expect(h.statuses.at(-1)?.text).toContain("Click each part to cut");
  });

  it("the next click cuts, the cutter stays selected, and another click cuts again", async () => {
    const h = fakeHost({ outcome: cutDone });
    const t = new JointTool(h);
    await click(t, 2);
    await click(t, 1);
    await Promise.resolve();
    expect(h.ops).toEqual([{ op: "combine_parts", target: { object: 1 }, with: [{ object: 2 }], how: "cut" }]);
    expect(h.sel).toEqual([{ kind: "object", object: 2 }]);
    await click(t, 3);
    expect(h.ops).toHaveLength(2);
  });

  it("Ctrl+click adds, and leaves the joined part selected", async () => {
    const h = fakeHost({ outcome: cutDone });
    const t = new JointTool(h);
    await click(t, 2);
    await click(t, 1, { ctrl: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(h.ops).toEqual([{ op: "combine_parts", target: { object: 1 }, with: [{ object: 2 }], how: "add" }]);
    expect(h.sel).toEqual([{ kind: "object", object: 1 }]);
  });

  it("a part already selected is the cutter when the tool starts", async () => {
    const h = fakeHost({ outcome: cutDone, sel: [face(5)] });
    const t = new JointTool(h);
    t.activate();
    await click(t, 1);
    expect(h.ops).toEqual([{ op: "combine_parts", target: { object: 1 }, with: [{ object: 5 }], how: "cut" }]);
  });

  it("clicking the cutter itself explains and does nothing", async () => {
    const h = fakeHost({ outcome: cutDone, sel: [{ kind: "object", object: 2 }] });
    const t = new JointTool(h);
    await click(t, 2);
    expect(h.ops).toEqual([]);
    expect(h.statuses.at(-1)).toEqual({ text: expect.stringContaining("Click a different part"), error: true });
  });

  it("Shift+click adds a second cutter", async () => {
    const h = fakeHost({ outcome: cutDone });
    const t = new JointTool(h);
    await click(t, 2);
    await click(t, 3, { shift: true });
    await click(t, 1);
    expect(h.ops).toEqual([{ op: "combine_parts", target: { object: 1 }, with: [{ object: 2 }, { object: 3 }], how: "cut" }]);
  });

  it("a click on nothing lets go of the cutter", async () => {
    const h = fakeHost({ outcome: cutDone });
    const t = new JointTool(h);
    await click(t, 2);
    t.onEvent(ev("click", [0, 0, 0], { picked: null }));
    expect(h.sel).toEqual([]);
  });

  it("a refused cut keeps the cutter so the next click can try again", async () => {
    const h = fakeHost({ outcome: null });
    const t = new JointTool(h);
    await click(t, 2);
    await click(t, 1);
    await Promise.resolve();
    expect(h.sel).toEqual([{ kind: "object", object: 2 }]);
  });
});
