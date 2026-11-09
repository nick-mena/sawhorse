// How the 3D view answers a trackpad, kept per device (Edit > Settings…).

import { isMac } from "./keys";

const ORBIT_SPEED_KEY = "sawhorse.trackpadOrbitSpeed";

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
