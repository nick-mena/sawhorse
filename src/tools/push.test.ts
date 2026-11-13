import { describe, expect, it } from "vitest";
import type { KernelOp, Picked, SurfaceHit } from "../kernel/types";
import { ev, fakeHost } from "./fakeHost";
import { PushTool } from "./push";

const IN = 0.0254;
const top: SurfaceHit = {
  at: { kind: "face", object: 1, face: 2 },
  frame: { origin: [0.5, 0.5, 1], normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  point: [0.5, 0.5, 1],
  t: 9,
};
const onTop: Picked = { entity: { kind: "face", object: 1, face: 2 }, point: [0.5, 0.5, 1], surface: top };
const at = (z: number, extra = {}) => ev("move", [0.5, 0.5, z], { picked: onTop, snapKind: "axis-z", ...extra });
const tick = () => new Promise((r) => setTimeout(r, 0));
const last = (h: { ops: KernelOp[] }) => h.ops[h.ops.length - 1] as unknown as Record<string, unknown>;

describe("Push/Pull feel", () => {
  it("press, drag and let go: the face follows the cursor and commits on release", async () => {
    const h = fakeHost();
    const t = new PushTool(h);
    t.onEvent(ev("down", [0.5, 0.5, 1], { picked: onTop }));
    await tick();
    expect(t.busy()).toBe(true);
    t.onEvent({ ...at(1.25), type: "drag", start: [0, 0] });
    expect(h.values.at(-1)).toMatch(/9/); // the live distance (about 9 27/32 in)
    expect(t.view().overlay.length).toBeGreaterThan(0); // the preview (outline loaded)
    t.onEvent({ ...at(1.25), type: "dragend", start: [0, 0] });
    await tick();
    expect(last(h)).toMatchObject({ op: "push_pull", object: 1, face: 2 });
    expect(last(h).distance as number).toBeCloseTo(0.25, 12);
    expect(t.busy()).toBe(false);
  });

  it("click, move, click; a typed distance mid-gesture goes the way the cursor went", async () => {
    const h = fakeHost();
    const t = new PushTool(h);
    t.onEvent(ev("down", [0.5, 0.5, 1], { picked: onTop }));
    t.onEvent(ev("click", [0.5, 0.5, 1], { picked: onTop }));
    expect(t.busy()).toBe(true);
    t.onEvent(at(0.9)); // moved inward
    t.onValue("3/4");
    await tick();
    expect(last(h).distance as number).toBeCloseTo(-0.75 * IN, 12);
    // Click, move, click.
    t.onEvent(ev("down", [0.5, 0.5, 1], { picked: onTop }));
    t.onEvent(ev("click", [0.5, 0.5, 1], { picked: onTop }));
    t.onEvent(at(1.5));
    t.onEvent(ev("down", [0.5, 0.5, 1.5], { picked: onTop }));
    t.onEvent(ev("click", [0.5, 0.5, 1.5], { picked: onTop, snapKind: "axis-z" }));
    await tick();
    expect(last(h).distance as number).toBeCloseTo(0.5, 12);
  });

  it("double-click repeats the last distance; Ctrl pulls out a new face", async () => {
    const h = fakeHost();
    const t = new PushTool(h);
    t.onEvent(ev("down", [0.5, 0.5, 1], { picked: onTop }));
    t.onEvent({ ...at(1.1), type: "drag", start: [0, 0] });
    t.onEvent({ ...at(1.1), type: "dragend", start: [0, 0], ctrl: true });
    await tick();
    expect(last(h)).toMatchObject({ op: "push_pull_new_face" });
    // A double-click elsewhere: down, click, down, click, dblclick.
    const other: Picked = { ...onTop, entity: { kind: "face", object: 1, face: 5 }, surface: { ...top, at: { kind: "face", object: 1, face: 5 } } };
    const n = h.ops.length;
    for (const type of ["down", "click", "down", "click", "dblclick"] as const) t.onEvent(ev(type, [0.5, 0.5, 1], { picked: other }));
    await tick();
    expect(h.ops.length).toBe(n + 1);
    expect(last(h)).toMatchObject({ op: "push_pull", face: 5 });
    expect(last(h).distance as number).toBeCloseTo(0.1, 12);
  });

  it("with no gesture a typed distance applies to the last thing drawn", async () => {
    const h = fakeHost({ _target: { kind: "region", sketch: 1, region: 4 } });
    const t = new PushTool(h);
    t.onValue("12");
    await tick();
    expect(last(h)).toMatchObject({ op: "extrude", sketch: 1, region: 4 });
    t.onValue("x3");
    expect(h.statuses.at(-1)?.text).toMatch(/follow a copy/);
  });
});

describe("Push/Pull: a tap of Ctrl pulls out a new face", () => {
  const start = (t: PushTool) => {
    t.onEvent(ev("down", [0.5, 0.5, 1], { picked: onTop }));
    t.onEvent(ev("click", [0.5, 0.5, 1], { picked: onTop }));
    t.onEvent(at(1.25));
  };
  const finish = (t: PushTool) => {
    t.onEvent(ev("down", [0.5, 0.5, 1.25], { picked: onTop }));
    t.onEvent(ev("click", [0.5, 0.5, 1.25], { picked: onTop, snapKind: "axis-z" }));
  };

  it("offers the tap as soon as a push starts, and says when it is on", () => {
    const h = fakeHost();
    const t = new PushTool(h);
    t.onEvent(ev("down", [0.5, 0.5, 1], { picked: onTop }));
    expect(h.statuses.at(-1)?.text).toMatch(/Tap Ctrl/);
    t.onModifier("ctrl");
    expect(h.statuses.at(-1)?.text).toMatch(/new face/i);
    expect(h.statuses.at(-1)?.text).toMatch(/Tap Ctrl again/);
  });

  it("tapped mid-push: the pull makes a new face, and the preview says so", async () => {
    const h = fakeHost();
    const t = new PushTool(h);
    start(t);
    t.onModifier("ctrl");
    t.onEvent(at(1.25));
    expect(t.view().labels[0].text).toMatch(/\+$/);
    finish(t);
    await tick();
    expect(last(h)).toMatchObject({ op: "push_pull_new_face", object: 1, face: 2 });
  });

  it("tapped before the press works too, and only for the next pull", async () => {
    const h = fakeHost();
    const t = new PushTool(h);
    t.onModifier("ctrl");
    start(t);
    finish(t);
    await tick();
    expect(last(h).op).toBe("push_pull_new_face");
    start(t);
    finish(t);
    await tick();
    expect(last(h).op).toBe("push_pull");
  });

  it("a second tap goes back to moving the face", async () => {
    const h = fakeHost();
    const t = new PushTool(h);
    start(t);
    t.onModifier("ctrl");
    t.onModifier("ctrl");
    finish(t);
    await tick();
    expect(last(h).op).toBe("push_pull");
  });

  it("applies to a typed distance, in a gesture or after one", async () => {
    const h = fakeHost();
    const t = new PushTool(h);
    start(t);
    t.onModifier("ctrl");
    t.onValue("2");
    await tick();
    expect(last(h).op).toBe("push_pull_new_face");
    h._target = { kind: "face", object: 1, face: 2 };
    t.onModifier("ctrl");
    t.onValue("2");
    await tick();
    expect(last(h).op).toBe("push_pull_new_face");
    t.onValue("2");
    await tick();
    expect(last(h).op).toBe("push_pull");
  });

  it("Esc forgets the tap", async () => {
    const h = fakeHost();
    const t = new PushTool(h);
    start(t);
    t.onModifier("ctrl");
    t.cancel();
    start(t);
    finish(t);
    await tick();
    expect(last(h).op).toBe("push_pull");
  });
});
