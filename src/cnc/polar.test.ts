import { describe, expect, it } from "vitest";
import { angleOf, dirOf, parsePolar, turnBetween } from "./polar";
import { snapPoint, type SnapScene } from "./snap";

const IN = 0.0254;

describe("angles", () => {
  it("measures counterclockwise from the right, between -180 and 180", () => {
    expect(angleOf([0, 0], [1, 0])).toBe(0);
    expect(angleOf([0, 0], [0, 1])).toBe(90);
    expect(angleOf([0, 0], [-1, 0])).toBe(180);
    expect(angleOf([0, 0], [1, -1])).toBeCloseTo(-45, 9);
  });

  it("gives exact directions on the quarters and eighths, so a level line stays level", () => {
    expect(dirOf(0)).toEqual([1, 0]);
    expect(dirOf(90)).toEqual([0, 1]);
    expect(dirOf(-90)).toEqual([0, -1]);
    expect(dirOf(270)).toEqual([0, -1]);
    expect(dirOf(180)).toEqual([-1, 0]);
    expect(dirOf(45)).toEqual([Math.SQRT1_2, Math.SQRT1_2]);
    const d = dirOf(30);
    expect(d[0]).toBeCloseTo(Math.sqrt(3) / 2, 12);
    expect(d[1]).toBeCloseTo(0.5, 12);
  });

  it("gives the angle between one line and the next, as the corner reads", () => {
    // Up the side, then off to the right: a square corner.
    expect(turnBetween([0, 1], [1, 0])).toBeCloseTo(90, 9);
    // Straight on is 180; doubling back is 0.
    expect(turnBetween([1, 0], [1, 0])).toBeCloseTo(180, 9);
    expect(turnBetween([1, 0], [-1, 0])).toBeCloseTo(0, 9);
    expect(turnBetween([0, 1], dirOf(60))).toBeCloseTo(150, 9);
  });
});

describe("parsePolar", () => {
  it("reads a length, an angle, or both as AutoCAD writes them", () => {
    expect(parsePolar("10", "in")).toEqual({ length: 10 * IN, angle: null });
    expect(parsePolar("<30", "in")).toEqual({ length: null, angle: 30 });
    expect(parsePolar("30°", "in")).toEqual({ length: null, angle: 30 });
    expect(parsePolar("30deg", "in")).toEqual({ length: null, angle: 30 });
    const both = parsePolar("10<30", "in");
    expect(both).toEqual({ length: 10 * IN, angle: 30 });
    expect(parsePolar("250mm < -45", "in")).toEqual({ length: 0.25, angle: -45 });
  });

  it("brings an angle round to between -180 and 180", () => {
    expect(parsePolar("<330", "in")).toEqual({ length: null, angle: -30 });
    expect(parsePolar("<-190", "in")).toEqual({ length: null, angle: 170 });
  });

  it("says what is wrong in a sentence", () => {
    expect(parsePolar("<abc", "in")).toMatch(/angle/i);
    expect(parsePolar("0<30", "in")).toMatch(/length/i);
    expect(parsePolar("", "in")).toMatch(/\.$/);
  });
});

describe("polar tracking", () => {
  // 1000 pixels a metre; no grid, so only the tracking moves the aim.
  const scene = (over: Partial<SnapScene> = {}): SnapScene => ({ points: [], guides: [], mirrorX: null, grid: null, smart: true, scale: 1000, polar: { from: [0, 0], step: 15 }, ...over });

  it("pulls an aim a few pixels off 30 degrees onto it, and says so", () => {
    const r = snapPoint([0.1 * Math.cos(Math.PI / 6) + 0.002, 0.05], scene());
    expect(angleOf([0, 0], r.point)).toBeCloseTo(30, 9);
    expect(r.track).toEqual({ from: [0, 0], angle: 30 });
  });

  it("leaves an aim between the steps alone", () => {
    const raw: [number, number] = [0.1, 0.0364]; // about 20 degrees, well off 15 and 30
    const r = snapPoint(raw, scene());
    expect(r.point).toEqual(raw);
    expect(r.track).toBeUndefined();
  });

  it("does not track right at the start, where every angle is a few pixels away", () => {
    expect(snapPoint([0.004, 0.0013], scene()).track).toBeUndefined();
  });

  it("follows the step that is set", () => {
    const r = snapPoint([0.1, 0.0364], scene({ polar: { from: [0, 0], step: 10 } }));
    expect(angleOf([0, 0], r.point)).toBeCloseTo(20, 9);
  });

  it("stops along the track where it is level with a point", () => {
    const r = snapPoint([0.0505, 0.0004], scene({ points: [[0.05, 0.3]] }));
    expect(r.point).toEqual([0.05, 0]);
    expect(r.guide).toEqual({ x: 0.05 });
    expect(r.track?.angle).toBe(0);
  });

  it("still lands on a point near the track", () => {
    expect(snapPoint([0.0501, 0.0003], scene({ points: [[0.0502, 0.0001]] })).point).toEqual([0.0502, 0.0001]);
  });
});
