import { describe, expect, it } from "vitest";
import type { CutList } from "../kernel/types";
import { copyLetters, stampLabels } from "./stamps";

const occurrence = (x: number, visible = true) => ({ center: [x, 0, 0], visible }) as unknown;
const list = (rows: unknown[][], visible_only = false) => ({ visible_only, rows: rows.map((occurrences) => ({ occurrences })) }) as unknown as CutList;

describe("part stamps", () => {
  it("counts copies as the kernel's tags do", () => {
    expect([1, 26, 27, 52, 53].map(copyLetters)).toEqual(["a", "z", "aa", "az", "ba"]);
  });

  it("marks a lone part with its row, and copies with a letter", () => {
    expect(stampLabels(list([[occurrence(1)], [occurrence(2), occurrence(3)]])).map((l) => l.text)).toEqual(["1", "2a", "2b"]);
  });

  it("a hidden copy keeps its letter and is not drawn, as nesting counts it", () => {
    expect(stampLabels(list([[occurrence(1, false), occurrence(2)]])).map((l) => l.text)).toEqual(["1b"]);
  });

  it("with Visible only, a hidden copy is not counted at all", () => {
    expect(stampLabels(list([[occurrence(1, false), occurrence(2)]], true)).map((l) => l.text)).toEqual(["1"]);
  });

  it("leaves a model of many parts unmarked rather than buried", () => {
    expect(stampLabels(list(Array.from({ length: 41 }, (_, i) => [occurrence(i)])))).toEqual([]);
  });
});
