// How the 3D view answers a trackpad, kept per device (Edit > Settings…).

import { isMac } from "./keys";

const ORBIT_SPEED_KEY = "sawhorse.trackpadOrbitSpeed";
const NAV_STYLE_KEY = "sawhorse.navStyle";

/** `sawhorse`: gestures act on the point under the cursor. `maya`: Alt (Option) plus a mouse
 * button tumbles, tracks and dollies, and every orbit turns about the centre of the view. */
export type NavStyle = "sawhorse" | "maya";

export function navStyle(): NavStyle {
  try {
    return localStorage.getItem(NAV_STYLE_KEY) === "maya" ? "maya" : "sawhorse";
  } catch {
    return "sawhorse";
  }
}

export function setNavStyle(style: NavStyle): void {
  try {
    localStorage.setItem(NAV_STYLE_KEY, style);
  } catch {
    /* a per-device convenience only */
  }
}

/** This press of the left button is the camera's, not the active tool's. */
export function navClaimsLeft(e: { altKey: boolean; button: number; pointerType: string }): boolean {
  return e.button === 0 && e.altKey && e.pointerType !== "touch" && navStyle() === "maya";
}

/** Percent of a mouse drag's speed: the same distance turns the model this much as far. */
export const ORBIT_SPEED = { min: 10, max: 150, step: 5, standard: 50 };

/** Two-finger swipes orbit on macOS only: elsewhere a mouse wheel cannot be told from them. */
export function swipeOrbits(): boolean {
  return isMac();
}

export function trackpadOrbitSpeed(): number {
  let saved: number | null = null;
  try {
    const v = localStorage.getItem(ORBIT_SPEED_KEY);
    if (v !== null) saved = Number(v);
  } catch {
    /* a per-device convenience only */
  }
  if (saved === null || !Number.isFinite(saved)) return ORBIT_SPEED.standard;
  return Math.min(ORBIT_SPEED.max, Math.max(ORBIT_SPEED.min, saved));
}

export function setTrackpadOrbitSpeed(percent: number): void {
  try {
    localStorage.setItem(ORBIT_SPEED_KEY, String(percent));
  } catch {
    /* a per-device convenience only */
  }
}
