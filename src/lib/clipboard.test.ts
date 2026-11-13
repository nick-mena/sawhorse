import { describe, expect, it } from "vitest";
import type { DocState, Entity, MeshData } from "../kernel/types";
import { clipAlive, clipBase, takeClip, type ClipSubject } from "./clipboard";

const state = {
  solids: [{ id: 1, number: 1, min: [0, 0, 1], max: [2, 4, 3], volume: 1 }],
  sketches: [],
  graph: { nodes: [], context: null },
} as unknown as DocState;
const host = (sel: Entity[]) => ({ selection: () => sel, outline: async () => [], state: () => state });

describe("the clipboard", () => {
  it("a selected face copies its whole solid, once", async () => {
    const clip = await takeClip(host([{ kind: "face", object: 1, face: 2 }, { kind: "face", object: 1, face: 3 }]), false);
    expect(clip).toMatchObject({ cut: false, subject: { kind: "objects", objects: [1] } });
  });

  it("says why when there is nothing it can take", async () => {
    expect(await takeClip(host([]), false)).toMatch(/Select what to copy/);
    expect(await takeClip(host([{ kind: "guide", guide: 4 }]), true)).toMatch(/not guides/);
  });

  it("the cursor carries the middle of the footprint, at the bottom", () => {
    expect(clipBase({ kind: "objects", objects: [1] }, state, [])).toEqual([1, 2, 1]);
  });

  it("notices when what was copied is gone", () => {
    expect(clipAlive({ kind: "objects", objects: [1] }, state)).toBe(true);
    expect(clipAlive({ kind: "objects", objects: [9] }, state)).toBe(false);
    expect(clipAlive({ kind: "objects", objects: [], nodes: [5] }, state)).toBe(false);
  });

  it("takes a very large selection", () => {
    const n = 200_000;
    const solids = Array.from({ length: n }, (_, i) => ({ id: i, number: i, min: [i, 0, 0], max: [i + 1, 1, 1], volume: 1 }));
    const big = { ...state, solids } as unknown as DocState;
    const s = { kind: "objects" as const, objects: solids.map((x) => x.id) };
    expect(clipAlive(s, big)).toBe(true);
    expect(clipBase(s, big, [])).toEqual([n / 2, 0.5, 0]);
  });

  it("a sketch shape that has been redrawn is no longer what was copied", () => {
    const sketchState = { ...state, sketches: [{ id: 2 }] } as unknown as DocState;
    const mesh = {
      positions: new Float32Array(),
      indices: new Uint32Array(),
      faceIds: new Uint32Array(),
      edges: new Float32Array([0, 0, 0, 1, 0, 0]),
      edgeOwner: new Uint32Array([0]),
      edgeOwners: [{ kind: "sketch", id: 2 }],
      parts: [{ kind: "region", owner: 2, index: 3 }],
    } as unknown as MeshData;
    const part = { sketch: 2, edges: [[[0, 0, 0], [1, 0, 0]]], regions: [] as number[], rings: [], moving: [[0, 0, 0], [1, 0, 0]] };
    const subject = (over: object) => ({ kind: "objects" as const, objects: [], sketches: [{ ...part, ...over }] }) as unknown as ClipSubject;
    expect(clipAlive(subject({}), sketchState, mesh)).toBe(true);
    expect(clipAlive(subject({ regions: [3] }), sketchState, mesh)).toBe(true);
    expect(clipAlive(subject({ regions: [9] }), sketchState, mesh)).toBe(false);
    expect(clipAlive(subject({ edges: [[[0, 0, 0], [2, 0, 0]]] }), sketchState, mesh)).toBe(false);
    expect(clipAlive(subject({ moving: [[5, 5, 5]] }), sketchState, mesh)).toBe(false);
  });
});
