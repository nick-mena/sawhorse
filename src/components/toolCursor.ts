// The pointer over the 3D view says which tool is active: a small crosshair on the exact
// point, with the tool's own rail glyph beside it. Drawn to a PNG on a canvas because WebKit,
// the desktop app's webview, cannot be relied on for SVG cursors.
import { Children, Fragment, isValidElement, type ReactNode } from "react";
import type { ToolId } from "../lib/tools";
import { PLUGIN_GLYPH, TOOL_GLYPHS } from "./glyphs";

const SIZE = 32;
const HOTSPOT = 8;
const GLYPH_AT = 14;
const GLYPH_SIZE = 17;
const FALLBACK = "crosshair";

/** Add a rail glyph's shapes to `path`, in the glyph's 24 x 24 units. */
function addGlyph(path: Path2D, node: ReactNode): void {
  Children.forEach(node, (el) => {
    if (!isValidElement(el)) return;
    const p = el.props as { children?: ReactNode; d?: string; x?: string; y?: string; width?: string; height?: string; cx?: string; cy?: string; r?: string };
    if (el.type === Fragment) addGlyph(path, p.children);
    else if (el.type === "path") path.addPath(new Path2D(p.d));
    else if (el.type === "rect") path.rect(Number(p.x), Number(p.y), Number(p.width), Number(p.height));
    else if (el.type === "circle") {
      path.moveTo(Number(p.cx) + Number(p.r), Number(p.cy));
      path.arc(Number(p.cx), Number(p.cy), Number(p.r), 0, 2 * Math.PI);
    }
  });
}

/** The cursor as a PNG data URL at `scale` device pixels per CSS pixel, or null with no canvas. */
function draw(glyph: ReactNode, scale: number): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(scale, scale);
  ctx.lineCap = ctx.lineJoin = "round";
  // A light halo under a dark line, so it reads on pale faces and on dark ones.
  const stroke = (path: Path2D, unit: number): void => {
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 3.25 / unit;
    ctx.stroke(path);
    ctx.strokeStyle = "#16181c";
    ctx.lineWidth = 1.5 / unit;
    ctx.stroke(path);
  };
  const h = HOTSPOT;
  stroke(new Path2D(`M${h} 1V${h - 2}M${h} ${h + 2}V${h + 7}M1 ${h}H${h - 2}M${h + 2} ${h}H${h + 7}`), 1);
  const path = new Path2D();
  addGlyph(path, glyph);
  const unit = GLYPH_SIZE / 24;
  ctx.translate(GLYPH_AT, GLYPH_AT);
  ctx.scale(unit, unit);
  stroke(path, unit);
  return canvas.toDataURL("image/png");
}

function build(glyph: ReactNode): string {
  const sharp = draw(glyph, 2);
  if (!sharp) return FALLBACK;
  for (const fn of ["image-set", "-webkit-image-set"]) {
    const value = `${fn}(url("${sharp}") 2x) ${HOTSPOT} ${HOTSPOT}, ${FALLBACK}`;
    if (CSS.supports("cursor", value)) return value;
  }
  return `url("${draw(glyph, 1)}") ${HOTSPOT} ${HOTSPOT}, ${FALLBACK}`;
}

const built = new Map<ToolId, string>();

/** The CSS cursor for a tool; undefined for Select, which keeps the system arrow. */
export function toolCursor(id: ToolId): string | undefined {
  if (id === "select") return undefined;
  let value = built.get(id);
  if (!value) {
    value = build(id.startsWith("plugin:") ? PLUGIN_GLYPH : TOOL_GLYPHS[id as keyof typeof TOOL_GLYPHS]);
    built.set(id, value);
  }
  return value;
}
