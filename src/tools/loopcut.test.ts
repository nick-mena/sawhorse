// Loop Cut's steps: the edge it aims across, the ring it previews, and the ops it sends.
import { describe, expect, it } from "vitest";
import type { Entity, MeshData, MeshPart, OpOutcome, Picked, V3 } from "../kernel/types";
import { aimFor, edgesOf, LoopCutTool, ringOf } from "./loopcut";
import { ev, fakeHost } from "./fakeHost";

/** A box solid's mesh: two triangles a face, twelve edges, owned by `object`. */
function boxMesh(object: number, [w, d, h]: V3): MeshData {
  const c = (x: number, y: number, z: number): V3 => [x * w, y * d, z * h];
  const quads: V3[][] = [
    [c(0, 0, 0), c(0, 1, 0), c(1, 1, 0), c(1, 0, 0)],
    [c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)],
    [c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), c(0, 0, 1)],
    [c(0, 1, 0), c(0, 1, 1), c(1, 1, 1), c(1, 1, 0)],
    [c(0, 0, 0), c(0, 0, 1), c(0, 1, 1), c(0, 1, 0)],
    [c(1, 0, 0), c(1, 1, 0), c(1, 1, 1), c(1, 0, 1)],
  ];
  const positions: number[] = [];
  const indices: number[] = [];
  const faceIds: number[] = [];
  const parts: MeshPart[] = [];
  const edges: number[] = [];
  quads.forEach((q, f) => {
    const base = positions.length / 3;
    q.forEach((p) => positions.push(...p));
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    faceIds.push(f, f);
    parts.push({ kind: "face", owner: object, index: f + 1, origin: q[0], normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] } as MeshPart);
  });
  const seen = new Set<string>();
  for (const q of quads)
    for (let k = 0; k < 4; k++) {
      const [a, b] = [q[k], q[(k + 1) % 4]];
      const key = [a, b].map((p) => p.join(",")).sort().join("|");
      if (!seen.has(key)) {
        seen.add(key);
        edges.push(...a, ...b);
      }
    }
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    faceIds: new Uint32Array(faceIds),
    edges: new Float32Array(edges),
    edgeOwner: new Uint32Array(edges.length / 6),
    edgeOwners: [{ kind: "object", id: object }],
    parts,
  };
}

const BOARD: V3 = [1, 0.1, 0.02];
const top = (object: number): Entity => ({ kind: "face", object, face: 2 }) as Entity;
/** Pointing at the board's top face at `at`. */
function onTop(type: "move" | "click", at: V3) {
  const picked = { entity: top(7), point: at, surface: { at: { kind: "face", object: 7, face: 2 }, frame: { origin: [0, 0, 0.02], normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] }, point: at, t: 1 } } as unknown as Picked;
  return ev(type, at, { picked, snapKind: "on-face" });
}
const split: OpOutcome = { kind: "face_split", faces: [7, 8, 9, 10] };

describe("Loop Cut", () => {
  it("aims across the face's edge nearest the pointer, measured from its nearer end", () => {
    const mesh = boxMesh(7, BOARD);
    expect(edgesOf(mesh, 7)).toHaveLength(12);
    const aim = aimFor(onTop("move", [0.3, 0.09, 0.02]), mesh, top(7))!;
    expect(aim.object).toBe(7);
    // The long edge along y = 0.1, from its x = 0 end.
    expect(aim.toward.map((x) => Math.abs(x))).toEqual([1, 0, 0]);
    expect(aim.d).toBeCloseTo(0.3);
    const far = aimFor(onTop("move", [0.98, 0.05, 0.02]), mesh, top(7))!;
    // Nearest is now the short end edge at x = 1, so the cut would run lengthways.
    expect(far.toward.map((x) => Math.abs(x))).toEqual([0, 1, 0]);
  });

  it("the preview is a closed ring around the board", () => {
    const mesh = boxMesh(7, BOARD);
    const ring = ringOf(mesh, 7, [0.3, 0, 0], [1, 0, 0]);
    // Two triangles a long face, four long faces, one segment each.
    expect(ring.length).toBe(16);
    for (const p of ring) expect(p[0]).toBeCloseTo(0.3);
  });

  it("a click cuts there, in one op", async () => {
    const h = fakeHost({ outcome: split, _mesh: boxMesh(7, BOARD) });
    const t = new LoopCutTool(h);
    t.onEvent(onTop("move", [0.3, 0.09, 0.02]));
    expect(t.view().overlay[0].points.length).toBe(16);
    t.onEvent(onTop("click", [0.3, 0.09, 0.02]));
    await Promise.resolve();
    expect(h.ops).toHaveLength(1);
    const op = h.ops[0] as { op: string; object: number; origin: V3; normal: V3 };
    expect(op.op).toBe("loop_cut");
    expect(op.object).toBe(7);
    expect(op.origin[0]).toBeCloseTo(0.3);
    expect(op.normal).toEqual([1, 0, 0]);
  });

  it("a typed distance measures from the nearer end, and /4 divides the edge", async () => {
    const h = fakeHost({ outcome: split, _mesh: boxMesh(7, BOARD), _units: "mm" });
    const t = new LoopCutTool(h);
    t.onEvent(onTop("move", [0.8, 0.09, 0.02]));
    t.onValue("100");
    await new Promise((r) => setTimeout(r));
    const one = h.ops[0] as { origin: V3; normal: V3 };
    expect(one.origin[0]).toBeCloseTo(0.9);
    expect(one.normal).toEqual([-1, 0, 0]);
    // Pointing at another edge, then /4: three rings, one undo step.
    t.onEvent(onTop("move", [0.3, 0.01, 0.02]));
    t.onValue("/4");
    await new Promise((r) => setTimeout(r));
    const batch = h.ops[1] as { op: string; ops: { origin: V3 }[] };
    expect(batch.op).toBe("batch");
    expect(batch.ops.map((o) => +o.origin[0].toFixed(6))).toEqual([0.25, 0.5, 0.75]);
  });

  it("typing straight after a cut moves it: undo, then the cut at the new distance", async () => {
    const h = fakeHost({ outcome: split, _mesh: boxMesh(7, BOARD), _units: "mm" });
    const t = new LoopCutTool(h);
    t.onEvent(onTop("move", [0.3, 0.09, 0.02]));
    t.onEvent(onTop("click", [0.3, 0.09, 0.02]));
    await new Promise((r) => setTimeout(r));
    t.onValue("250");
    await new Promise((r) => setTimeout(r));
    expect(h.ops.map((o) => o.op)).toEqual(["loop_cut", "undo", "loop_cut"]);
    expect((h.ops[2] as { origin: V3 }).origin[0]).toBeCloseTo(0.25);
  });

  it("a distance off the edge is refused in words, with nothing sent", () => {
    const h = fakeHost({ outcome: split, _mesh: boxMesh(7, BOARD), _units: "mm" });
    const t = new LoopCutTool(h);
    t.onEvent(onTop("move", [0.3, 0.09, 0.02]));
    t.onValue("2000");
    expect(h.ops).toEqual([]);
    expect(h.statuses.at(-1)).toEqual({ text: expect.stringContaining("not along the edge"), error: true });
  });

  it("a value after another edit (or an undo) makes a new cut instead of undoing that edit", async () => {
    const h = fakeHost({ outcome: split, _mesh: boxMesh(7, BOARD), _units: "mm" });
    h._state = { undo_depth: 1 } as never;
    const apply = h.apply;
    let depth = 1;
    h.apply = async (op, d) => {
      const r = await apply(op, d);
      depth += op.op === "undo" ? -1 : 1;
      (h._state as { undo_depth: number }).undo_depth = depth;
      return r ? ({ ...r, scene: { ...r.scene, state: { ...r.scene.state, undo_depth: depth } } } as typeof r) : r;
    };
    const t = new LoopCutTool(h);
    t.onEvent(onTop("move", [0.3, 0.09, 0.02]));
    t.onEvent(onTop("click", [0.3, 0.09, 0.02]));
    await new Promise((r) => setTimeout(r));
    // Something else is done (a Push, say): the depth moves on.
    depth += 1;
    (h._state as { undo_depth: number }).undo_depth = depth;
    t.onValue("250");
    await new Promise((r) => setTimeout(r));
    expect(h.ops.map((o) => o.op)).toEqual(["loop_cut", "loop_cut"]);
  });

  it("moving a cut that is then refused puts the first cut back", async () => {
    const h = fakeHost({ outcome: split, _mesh: boxMesh(7, BOARD), _units: "mm" });
    const apply = h.apply;
    let cuts = 0;
    h.apply = async (op, d) => {
      if (op.op === "loop_cut" && ++cuts === 2) {
        h.ops.push(op);
        return null;
      }
      return apply(op, d);
    };
    const t = new LoopCutTool(h);
    t.onEvent(onTop("move", [0.3, 0.09, 0.02]));
    t.onEvent(onTop("click", [0.3, 0.09, 0.02]));
    await new Promise((r) => setTimeout(r));
    t.onValue("250");
    await new Promise((r) => setTimeout(r));
    expect(h.ops.map((o) => o.op)).toEqual(["loop_cut", "undo", "loop_cut", "redo"]);
  });

  it("a divide past the limit is refused in words, with nothing sent", () => {
    const h = fakeHost({ outcome: split, _mesh: boxMesh(7, BOARD) });
    const t = new LoopCutTool(h);
    t.onEvent(onTop("move", [0.3, 0.09, 0.02]));
    t.onValue("/1000");
    expect(h.ops).toEqual([]);
    expect(h.statuses.at(-1)).toEqual({ text: expect.stringContaining("at most 100 parts"), error: true });
  });

  it("switching tools lets go of the last cut", async () => {
    const h = fakeHost({ outcome: split, _mesh: boxMesh(7, BOARD), _units: "mm" });
    const t = new LoopCutTool(h);
    t.onEvent(onTop("move", [0.3, 0.09, 0.02]));
    t.onEvent(onTop("click", [0.3, 0.09, 0.02]));
    await new Promise((r) => setTimeout(r));
    t.deactivate();
    t.onEvent(onTop("move", [0.3, 0.09, 0.02]));
    t.onValue("250");
    await new Promise((r) => setTimeout(r));
    expect(h.ops.map((o) => o.op)).toEqual(["loop_cut", "loop_cut"]);
  });
});
