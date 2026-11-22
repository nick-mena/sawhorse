import { describe, expect, it } from "vitest";
import { EDGE, placeMenu, type Box } from "./menuPlace";

const box = (left: number, top: number, w: number, h: number): Box => ({ left, top, right: left + w, bottom: top + h });

describe("placeMenu", () => {
  it("opens a drop-down under its button when it fits", () => {
    const p = placeMenu({ kind: "below", box: box(50, 4, 40, 24) }, 220, 300, 1440, 900);
    expect(p).toEqual({ left: 50, top: 32, maxHeight: 900 - EDGE - 32 });
  });

  it("caps a drop-down taller than the window so it scrolls (the Edit menu at 1024x700)", () => {
    const p = placeMenu({ kind: "below", box: box(50, 4, 40, 24) }, 220, 770, 1024, 700);
    expect(p.top).toBe(32);
    expect(p.top + p.maxHeight).toBe(700 - EDGE);
  });

  it("moves a drop-down left when it would run past the right edge", () => {
    const p = placeMenu({ kind: "below", box: box(900, 4, 40, 24) }, 220, 100, 1024, 700);
    expect(p.left).toBe(1024 - EDGE - 220);
  });

  it("opens a submenu to the right, lifted to stay inside the bottom", () => {
    const p = placeMenu({ kind: "side", box: box(50, 600, 220, 28) }, 250, 300, 1440, 700);
    expect(p.left).toBe(272);
    expect(p.top + 300).toBe(700 - EDGE);
  });

  it("flips a submenu to the left side when the right has no room", () => {
    const p = placeMenu({ kind: "side", box: box(1100, 100, 220, 28) }, 250, 200, 1440, 900);
    expect(p.left).toBe(1100 - 2 - 250);
  });

  it("caps a submenu taller than the window at the top edge", () => {
    const p = placeMenu({ kind: "side", box: box(50, 300, 220, 28) }, 250, 900, 1024, 700);
    expect(p.top).toBe(EDGE);
    expect(p.maxHeight).toBe(700 - 2 * EDGE);
  });

  it("opens a context menu at the pointer when it fits", () => {
    expect(placeMenu({ kind: "point", x: 100, y: 120 }, 200, 300, 1440, 900)).toEqual({ left: 100, top: 120, maxHeight: 900 - EDGE - 120 });
  });

  it("opens a context menu up and to the left near the bottom-right corner", () => {
    const p = placeMenu({ kind: "point", x: 1400, y: 850 }, 200, 300, 1440, 900);
    expect(p.left).toBe(1200);
    expect(p.top).toBe(550);
  });

  it("fits a context menu opened inside the edge margin without a scrollbar", () => {
    const p = placeMenu({ kind: "point", x: 1015, y: 695 }, 200, 104, 1024, 700);
    expect(p.left + 200).toBeLessThanOrEqual(1024 - EDGE);
    expect(p.top + 104).toBe(700 - EDGE);
    expect(p.maxHeight).toBeGreaterThanOrEqual(104);
  });

  it("keeps a context menu inside a window too small to flip it", () => {
    const p = placeMenu({ kind: "point", x: 150, y: 250 }, 200, 400, 300, 450);
    expect(p.left).toBeGreaterThanOrEqual(EDGE);
    expect(p.left + 200).toBeLessThanOrEqual(300 - EDGE);
    expect(p.top).toBeGreaterThanOrEqual(EDGE);
    expect(p.top + Math.min(400, p.maxHeight)).toBeLessThanOrEqual(450 - EDGE);
  });
});
