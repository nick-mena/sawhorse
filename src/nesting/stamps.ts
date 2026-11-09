// A part's stamp: the mark that follows it from the model to the cut list, the cutting
// diagrams and the board labels. These are the kernel's nesting tags (crates/kernel/src/
// nesting.rs): the row's number in the cut list, and a letter per copy when there are several.
import type { CutList } from "../kernel/types";
import type { Label } from "../components/Viewport";

/** Past this many parts the marks would bury the model. */
const MAX_STAMPS = 40;

/** a, b, ... z, aa, ab: `copy` counts from 1. */
export function copyLetters(copy: number): string {
  let n = copy;
  let out = "";
  while (n > 0) {
    n -= 1;
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}

/** One mark on each drawn part, shown while the Cut list is open. */
export function stampLabels(list: CutList | null): Label[] {
  if (!list) return [];
  const labels: Label[] = [];
  list.rows.forEach((row, i) => {
    const counted = row.occurrences.filter((o) => !list.visible_only || o.visible);
    counted.forEach((o, k) => {
      if (o.visible) labels.push({ at: o.center, text: counted.length > 1 ? `${i + 1}${copyLetters(k + 1)}` : `${i + 1}`, className: "stamp" });
    });
  });
  return labels.length > MAX_STAMPS ? [] : labels;
}
