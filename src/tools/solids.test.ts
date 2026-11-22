// The Solids tool's steps: pick, then click the part to change; Alt steps through the modes.
import { describe, expect, it } from "vitest";
import type { Entity, OpOutcome, Picked } from "../kernel/types";
import { SolidsTool } from "./solids";
import { ev, fakeHost } from "./fakeHost";

const face = (object: number): Entity => ({ kind: "face", object, face: 1 }) as Entity;
const picked = (e: Entity): Picked => ({ entity: e, point: [0, 0, 0], surface: null }) as unknown as Picked;
const click = async (t: SolidsTool, object: number, mods = {}) => {
  t.onEvent(ev("click", [0, 0, 0], { picked: picked(face(object)), ...mods }));
  await new Promise((r) => setTimeout(r));
};
const done: OpOutcome = { kind: "parts_combined", objects: [1], unique: false };

describe("Solids", () => {
  it("each mode sends its own op, then starts over", async () => {
    for (const [mode, how] of [
      ["union", "add"],
      ["subtract", "subtract"],
      ["intersect", "intersect"],
      ["split", "split"],
    ] as const) {
      const h = fakeHost({ outcome: done });
      const t = new SolidsTool(h);
      t.setMode(mode);
      await click(t, 2);
      expect(h.ops).toEqual([]);
      await click(t, 1);
      expect(h.ops).toEqual([{ op: "combine_parts", target: { object: 1 }, with: [{ object: 2 }], how }]);
      expect(h.sel).toEqual([]);
    }
  });

  it("Shift+click picks several to subtract at once", async () => {
    const h = fakeHost({ outcome: done });
    const t = new SolidsTool(h);
    t.setMode("subtract");
    await click(t, 2);
    await click(t, 3, { shift: true });
    expect(h.statuses.at(-1)?.text).toContain("2 parts");
    await click(t, 1);
    expect(h.ops).toEqual([{ op: "combine_parts", target: { object: 1 }, with: [{ object: 2 }, { object: 3 }], how: "subtract" }]);
  });

  it("Alt steps through the modes and says which one is on", () => {
    const h = fakeHost();
    const t = new SolidsTool(h);
    const seen: string[] = [];
    t.onMode = (m) => seen.push(m);
    for (let k = 0; k < 4; k++) t.onModifier("alt");
    expect(seen).toEqual(["subtract", "intersect", "split", "union"]);
    expect(h.statuses.at(-1)?.text).toMatch(/^Union:/);
    t.onModifier("ctrl");
    expect(seen).toHaveLength(4);
  });

  it("split takes exactly two parts, and a part cannot work on itself", async () => {
    const h = fakeHost({ outcome: done });
    const t = new SolidsTool(h);
    t.setMode("split");
    await click(t, 2);
    await click(t, 2);
    expect(h.statuses.at(-1)).toEqual({ text: expect.stringContaining("already picked"), error: true });
    await click(t, 3, { shift: true });
    await click(t, 1);
    expect(h.ops).toEqual([]);
    expect(h.statuses.at(-1)).toEqual({ text: expect.stringContaining("two parts"), error: true });
  });

  it("a refusal keeps what was picked, so the next click can try again", async () => {
    const h = fakeHost({ outcome: null });
    const t = new SolidsTool(h);
    t.setMode("intersect");
    await click(t, 2);
    await click(t, 1);
    expect(h.ops).toHaveLength(1);
    expect(h.sel).toEqual([{ kind: "object", object: 2 }]);
  });
});
