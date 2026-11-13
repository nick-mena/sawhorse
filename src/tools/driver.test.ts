import { describe, expect, it } from "vitest";
import type { Inference, MeshData, V3 } from "../kernel/types";
import { InferenceMemory } from "./driver";

const mesh = (...edges: [V3, V3][]) => ({ edges: new Float32Array(edges.flat(2)) }) as unknown as MeshData;
const seen = (kind: string, point: V3, edge?: [V3, V3]) => ({ kind, point, edge }) as unknown as Inference;
const O: V3 = [0, 0, 0];
const X: V3 = [2, 0, 0];

describe("what the snapping remembers across an edit", () => {
  it("keeps points and edges that are still there", () => {
    const m = new InferenceMemory();
    m.observe(seen("endpoint", X, [O, X]));
    m.observe(seen("midpoint", [1, 0, 0]));
    m.retain(mesh([O, X]), []);
    expect(m.anchors).toHaveLength(2);
    expect(m.refs).toEqual([[O, X]]);
  });

  it("lets go of what moved or was erased", () => {
    const m = new InferenceMemory();
    m.observe(seen("endpoint", X, [O, X]));
    m.retain(mesh([O, [3, 0, 0]]), []);
    expect(m.anchors).toEqual([]);
    expect(m.refs).toEqual([]);
  });

  it("a crossing needs both of its lines", () => {
    const p: V3 = [1, 0, 0];
    const guide = { point: [1, -5, 0] as V3, dir: [0, 1, 0] as V3 };
    const m = new InferenceMemory();
    m.observe(seen("intersection", p));
    m.retain(mesh([O, X]), [guide]);
    expect(m.anchors).toHaveLength(1);
    m.retain(mesh([O, X]), []);
    expect(m.anchors).toEqual([]);
  });

  it("a guide point goes with its guide", () => {
    const g: V3 = [4, 4, 0];
    const m = new InferenceMemory();
    m.observe(seen("guide-point", g));
    m.retain(mesh(), [{ point: g, dir: null }]);
    expect(m.anchors).toHaveLength(1);
    m.retain(mesh(), []);
    expect(m.anchors).toEqual([]);
  });
});
