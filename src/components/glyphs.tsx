// Our own tool glyphs, drawn for the approved mock (ADR-0003: own glyphs, no copied icons).
// 24x24 viewBox, stroked with currentColor by the .tool svg rule.
import type { ReactElement } from "react";
import type { BuiltinToolId } from "../lib/tools";

export const TOOL_GLYPHS: Record<BuiltinToolId, ReactElement> = {
  select: <path d="M5 3l14 9-6 1-3 6z" />,
  erase: <path d="M4 16l9-9 6 6-9 9H8z M13 7l4-4" />,
  line: (
    <>
      <path d="M4 20L20 4" />
      <circle cx="4" cy="20" r="1.5" />
      <circle cx="20" cy="4" r="1.5" />
    </>
  ),
  rect: <rect x="4" y="6" width="16" height="12" />,
  circle: <circle cx="12" cy="12" r="8" />,
  arc: <path d="M4 18a8 8 0 0 1 16 0" />,
  pushpull: (
    <>
      <path d="M4 16l6 4 10-6V8l-6-4L4 10z M10 20V10l10-6 M10 10L4 6" />
      <path d="M14 3v5M12 6l2-2 2 2" />
    </>
  ),
  move: <path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" />,
  rotate: (
    <>
      <path d="M20 12a8 8 0 1 1-8-8" />
      <path d="M12 4l3-2M12 4l3 2" />
    </>
  ),
  scale: (
    <>
      <rect x="4" y="10" width="10" height="10" />
      <path d="M14 10l6-6M20 4h-5M20 4v5" />
    </>
  ),
  offset: (
    <>
      <rect x="3" y="3" width="18" height="18" />
      <rect x="8" y="8" width="8" height="8" />
    </>
  ),
  follow: (
    <>
      <path d="M3 18c5 0 5-12 10-12s5 12 8 12" />
      <circle cx="3" cy="18" r="2" />
    </>
  ),
  // A tenon's shoulders and tongue.
  joint: <path d="M3 6h9v4h9v4h-9v4H3z" />,
  tape: <path d="M3 15l12-12 6 6-12 12z M7 11l2 2M10 8l2 2M13 5l2 2" />,
  dim: <path d="M3 12h18M3 8v8M21 8v8" />,
  paint: <path d="M4 20c0-3 2-5 5-5l6-9 4 4-9 6c0 3-2 5-6 4z M12 8l4 4" />,
  // Lane 12: a plane seen at an angle, with the arrows that show the side it keeps.
  section: <path d="M5 8l10-4v12L5 20z M15 10h5 M18 8l2 2-2 2 M10 9v6" />,
};

/** BenchCraft's beagle, in profile: one filled shape (the ear's line and the muzzle cut out of it), so it takes the theme's colour. */
const BEAGLE = "M0.43 22.01C0.43 21.99 0.55 21.50 0.70 20.92C0.95 19.98 1.57 17.40 1.74 16.58C1.78 16.41 1.82 16.26 1.82 16.25C1.83 16.24 1.97 16.35 2.12 16.49C3.94 18.10 5.76 19.05 7.33 19.22C9.81 19.49 11.75 17.48 11.61 14.80C11.55 13.55 11.21 12.48 10.32 10.71C9.46 8.98 9.15 7.91 9.09 6.47C9.08 5.96 9.06 5.81 9 5.72C8.79 5.37 8.24 5.41 8.04 5.80C7.93 6.02 7.99 7.16 8.15 7.97C8.39 9.14 8.69 9.93 9.52 11.57C10.73 13.94 10.83 15.93 9.81 17.19C8.99 18.21 7.60 18.40 5.98 17.72C4.54 17.12 2.68 15.70 1.49 14.29C0.40 13.01 0.05 12.36 0.01 11.56C-0.03 10.76 -0.03 10.75 1.46 8.07C2.63 5.96 2.65 5.93 2.96 5.62C3.13 5.45 3.34 5.25 3.43 5.18C3.52 5.11 3.68 4.90 3.82 4.68C4.25 3.96 4.98 3.30 5.76 2.90C7 2.26 8.22 2.02 10.26 2.02C12.58 2.02 14.23 2.41 15.56 3.27C16.28 3.73 16.51 3.99 16.74 4.63C17.03 5.40 17.44 5.85 18.07 6.07C18.26 6.14 22.15 7.02 23.04 7.20C23.74 7.35 24.07 7.76 24.03 8.47C23.98 9.25 23.50 11.24 23.19 11.97C22.32 13.97 20.53 15.17 18.13 15.39C17.09 15.48 16.57 15.66 15.97 16.12C14.77 17.04 13.88 19.19 13.64 21.74L13.62 22.04L7.02 22.04C2.90 22.04 0.43 22.03 0.43 22.01ZM16.37 14.63C16.85 14.45 17.37 14.34 17.97 14.29C18.86 14.21 19.45 14.06 20.05 13.76C21.34 13.12 22.20 11.98 22.55 10.42L22.58 10.25L22.34 10.13C21.95 9.94 21.47 9.60 21.21 9.34C20.77 8.90 20.65 8.50 20.85 8.07C20.92 7.93 20.93 7.86 20.90 7.85C20.87 7.84 20.23 7.70 19.48 7.54C18.11 7.24 17.69 7.12 17.33 6.94L17.14 6.85L17.16 6.95C17.18 7.01 17.19 7.25 17.19 7.49C17.19 8.57 16.77 9.34 15.71 10.24C14.92 10.92 14.60 11.48 14.49 12.41C14.37 13.34 14.64 14.12 15.21 14.51C15.62 14.79 15.85 14.81 16.37 14.63Z";

export function BrandMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={BEAGLE} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}

/** Small panel glyphs (Outliner, Tags, scene tabs): 16x16, stroked with currentColor. */
export function PanelGlyph({ name }: { name: "eye" | "eye-off" | "lock" | "unlock" | "open" | "closed" | "plus" | "tag" | "trash" }) {
  const d: Record<typeof name, string> = {
    eye: "M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z M8 6.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6z",
    "eye-off": "M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z M2.5 13.5l11-11",
    lock: "M4 7.5h8v6H4z M5.5 7.5V5.2a2.5 2.5 0 0 1 5 0v2.3",
    unlock: "M4 7.5h8v6H4z M5.5 7.5V5.2a2.5 2.5 0 0 1 4.8-1",
    open: "M4 6l4 4 4-4",
    closed: "M6 4l4 4-4 4",
    plus: "M8 3v10M3 8h10",
    tag: "M2.5 2.5h5.5l5.5 5.5-5.5 5.5-5.5-5.5z M5.2 5.2h.1",
    trash: "M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5",
  };
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className="pg">
      <path d={d[name]} stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A plugin tool without its own icon: a puzzle piece (ours). */
export const PLUGIN_GLYPH = <path d="M5 9h3a2 2 0 1 1 4 0h3v3a2 2 0 1 1 0 4v3h-3a2 2 0 1 0-4 0H5v-3a2 2 0 1 0 0-4z" />;
