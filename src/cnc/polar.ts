import { parseLength, type UnitSystem } from "../lib/units";
import type { Pt } from "./design";

/**
 * Angles for the CNC protractor, measured as AutoCAD and Fusion measure them: degrees
 * counterclockwise from the right. Shown between -180 and 180, so a line heading down and
 * to the right reads -30 rather than 330.
 */

/** Bring an angle round to (-180, 180]. */
export function normalise(deg: number): number {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return a === 0 ? 0 : a;
}

export function angleOf(from: Pt, to: Pt): number {
  return normalise((Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI);
}

/** The unit direction at an angle; exact on every eighth of a turn, so level stays level. */
export function dirOf(deg: number): Pt {
  const a = normalise(deg);
  const eighth = a / 45;
  if (Number.isInteger(eighth)) {
    const r = Math.SQRT1_2;
    const table: Record<number, Pt> = { 0: [1, 0], 1: [r, r], 2: [0, 1], 3: [-r, r], 4: [-1, 0], [-1]: [r, -r], [-2]: [0, -1], [-3]: [-r, -r] };
    return table[eighth];
  }
  const t = (a * Math.PI) / 180;
  return [Math.cos(t), Math.sin(t)];
}

/** The corner between the line coming in (direction `prev`) and the one going out: 180 is straight on. */
export function turnBetween(prev: Pt, next: Pt): number {
  const back: Pt = [-prev[0], -prev[1]];
  const dot = back[0] * next[0] + back[1] * next[1];
  const cross = back[0] * next[1] - back[1] * next[0];
  return Math.abs((Math.atan2(cross, dot) * 180) / Math.PI);
}

export interface PolarEntry {
  length: number | null;
  angle: number | null;
}

const NUMBER = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/;
const DEGREES = /^(.*?)\s*(?:°|deg|degrees?)$/i;

function readAngle(text: string): number | null {
  const s = text.trim().replace(DEGREES, "$1").trim();
  return NUMBER.test(s) ? normalise(Number(s)) : null;
}

/**
 * What is typed for a line's next point: a length ("10"), an angle ("<30" or "30°"), or both
 * as AutoCAD's polar entry has them ("10<30"). A string is the reason it cannot be read.
 */
export function parsePolar(text: string, units: UnitSystem): PolarEntry | string {
  const s = text.trim();
  if (s === "") return "Type a length, an angle such as <30, or both, such as 10<30.";
  const at = s.indexOf("<");
  if (at >= 0) {
    const angle = readAngle(s.slice(at + 1));
    if (angle === null) return "Type the angle in degrees after <, such as <30 or 10<30.";
    const head = s.slice(0, at).trim();
    if (head === "") return { length: null, angle };
    const r = parseLength(head, units);
    if (!r.ok || r.metres <= 0) return "Type a length above zero before the <, such as 10<30.";
    return { length: r.metres, angle };
  }
  if (DEGREES.test(s)) {
    const angle = readAngle(s);
    return angle === null ? "Type the angle in degrees, such as 30°." : { length: null, angle };
  }
  const r = parseLength(s, units);
  if (!r.ok) return r.error;
  if (r.metres <= 0) return "Type a length above zero.";
  return { length: r.metres, angle: null };
}
