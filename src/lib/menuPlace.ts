import { useLayoutEffect, type RefObject } from "react";

/** A box in viewport pixels (what getBoundingClientRect gives). */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Where a menu opens from:
 * - "below": under a menu-bar button (a drop-down).
 * - "side": beside a menu entry (a submenu).
 * - "point": at the pointer (a context menu).
 */
export type MenuAnchor = { kind: "below"; box: Box } | { kind: "side"; box: Box } | { kind: "point"; x: number; y: number };

export interface MenuPlacement {
  left: number;
  top: number;
  /** Cap on the menu's height; it scrolls past this. */
  maxHeight: number;
}

/** Room kept between a menu and the window edge. */
export const EDGE = 8;
/** A menu is never squeezed shorter than this, even in a tiny window. */
const MIN_HEIGHT = 96;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

/**
 * Puts a menu of size `w`×`h` next to its anchor, inside a `vw`×`vh` window.
 * A menu that would run past the right edge moves left (a submenu flips to the other side);
 * a context menu or submenu that would run past the bottom moves up; and whatever still does
 * not fit gets a height cap so it scrolls instead of leaving the window.
 */
export function placeMenu(anchor: MenuAnchor, w: number, h: number, vw: number, vh: number, edge = EDGE): MenuPlacement {
  const maxLeft = Math.max(edge, vw - edge - w);
  const fitTop = (top: number) => clamp(top, edge, Math.max(edge, vh - edge - h));
  let left: number;
  let top: number;
  if (anchor.kind === "below") {
    left = clamp(anchor.box.left, edge, maxLeft);
    // Stays attached under its button; a long menu scrolls rather than covering the bar.
    top = anchor.box.bottom + 4;
  } else if (anchor.kind === "side") {
    left = anchor.box.right + 2;
    if (left + w > vw - edge) {
      const flipped = anchor.box.left - 2 - w;
      left = flipped >= edge ? flipped : maxLeft;
    }
    top = fitTop(anchor.box.top - 5);
  } else {
    // Flipped up or left when that fits, then still clamped: a click inside the edge margin
    // must not leave the flipped menu a few pixels short and scrolling.
    left = clamp(anchor.x + w > vw - edge && anchor.x - w >= edge ? anchor.x - w : anchor.x, edge, maxLeft);
    top = fitTop(anchor.y + h > vh - edge && anchor.y - h >= edge ? anchor.y - h : anchor.y);
  }
  return { left, top, maxHeight: Math.max(MIN_HEIGHT, vh - edge - top) };
}

/**
 * Keeps a `position: fixed` menu inside the window. Runs after every render (before paint),
 * and again on resize or on any scroll, since the anchor may have moved.
 * `anchor` returns null while the menu is closed.
 */
export function usePlacedMenu(ref: RefObject<HTMLElement | null>, anchor: () => MenuAnchor | null): void {
  useLayoutEffect(() => {
    const place = (e?: Event) => {
      const el = ref.current;
      // The menu's own scrolling (or its submenu's) moves nothing it is anchored to, and
      // re-measuring then would reset its scroll position.
      if (e?.target instanceof Node && el?.contains(e.target)) return;
      const a = anchor();
      if (!el || !a) return;
      el.style.maxHeight = "";
      const r = el.getBoundingClientRect();
      const p = placeMenu(a, r.width, r.height, window.innerWidth, window.innerHeight);
      el.style.left = `${p.left}px`;
      el.style.top = `${p.top}px`;
      el.style.maxHeight = `${p.maxHeight}px`;
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  });
}
