// The viewport's own bar (Maya's panel menus and panel toolbar): View, Shading, Show and
// Panels menus, then the standard views and one-click switches for what the view draws.
// Everything here also has a place elsewhere (the View menu, the Styles pane); this bar only
// puts it where the eye already is.
import type { ReactElement } from "react";
import type { Style } from "../kernel/types";
import { FACE_STYLES, fullStyle, type FullStyle } from "../lib/looks";
import { VIEWS, type ViewId } from "../viewport/camera";
import { VIEW_GLYPHS } from "./glyphs";
import { MenuBar, type MenuItem } from "./TopBar";

export interface ViewPanelProps {
  view: ViewId | null;
  onView: (v: ViewId) => void;
  perspective: boolean;
  onPerspective: () => void;
  onExtents: () => void;
  extentsKeys?: string;
  style: Style | null;
  /** Change the drawing style (`what` says what changed, for the status line). */
  onStyle: (next: Partial<FullStyle>, what: string) => void;
  shadows: boolean;
  onShadows: (on: boolean) => void;
  stats: boolean;
  onStats: () => void;
  legend: boolean;
  onLegend: () => void;
  onAddScene: () => void;
  /** The side panel's panes, the one in front, and whether the panel is put away. */
  panes: { id: string; label: string }[];
  pane: string;
  collapsed: boolean;
  onPane: (id: string) => void;
  onCollapse: () => void;
}

function Toggle({ label, glyph, pressed, onClick, title }: { label: string; glyph: ReactElement; pressed?: boolean; onClick: () => void; title?: string }) {
  return (
    <button type="button" className="vb-icon" aria-label={label} title={title ?? label} aria-pressed={pressed} onClick={onClick}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {glyph}
      </svg>
    </button>
  );
}

export function ViewPanel(p: ViewPanelProps) {
  const s = fullStyle(p.style);
  const face = (f: FullStyle["face"]) => p.onStyle({ face: f }, `Faces: ${FACE_STYLES.find((x) => x.id === f)?.label ?? f}`);
  const menus: Record<string, MenuItem[]> = {
    View: [
      ...VIEWS.map((v) => ({ label: `${v.label} view`, checked: p.view === v.id, onSelect: () => p.onView(v.id) })),
      "-",
      { label: "Perspective", checked: p.perspective, onSelect: p.onPerspective },
      { label: "Zoom Extents", keys: p.extentsKeys, onSelect: p.onExtents },
      "-",
      { label: "Add Scene", title: "Save this view (camera, hidden tags, open group) as a scene tab", onSelect: p.onAddScene },
    ],
    Shading: [
      ...FACE_STYLES.map((f) => ({ label: f.label, checked: s.face === f.id, onSelect: () => face(f.id) })),
      "-",
      { label: "Edges", checked: s.edges.edges, onSelect: () => p.onStyle({ edges: { ...s.edges, edges: !s.edges.edges } }, `Edges ${s.edges.edges ? "hidden" : "shown"}`) },
      { label: "Shadows", checked: p.shadows, onSelect: () => p.onShadows(!p.shadows) },
    ],
    Show: [
      { label: "Scene Stats", checked: p.stats, onSelect: p.onStats },
      { label: "Snap Legend", checked: p.legend, onSelect: p.onLegend },
      { label: "Grid", checked: s.grid, onSelect: () => p.onStyle({ grid: !s.grid }, `Grid ${s.grid ? "hidden" : "shown"}`) },
      "-",
      { label: "Section Planes", checked: s.section_planes, onSelect: () => p.onStyle({ section_planes: !s.section_planes }, `Section planes ${s.section_planes ? "hidden" : "shown"}`) },
      { label: "Section Cuts", checked: s.section_cuts, onSelect: () => p.onStyle({ section_cuts: !s.section_cuts }, `Section cuts ${s.section_cuts ? "off" : "on"}`) },
      { label: "Section Fill", checked: s.section_fill, disabled: !s.section_cuts, onSelect: () => p.onStyle({ section_fill: !s.section_fill }, `Section fill ${s.section_fill ? "off" : "on"}`) },
    ],
    Panels: [
      ...p.panes.map((x) => ({ label: x.label, checked: !p.collapsed && p.pane === x.id, onSelect: () => p.onPane(x.id) })),
      "-",
      { label: p.collapsed ? "Show Side Panel" : "Hide Side Panel", onSelect: p.onCollapse },
    ],
  };
  return (
    <div className="viewbar" role="toolbar" aria-label="Viewport">
      <MenuBar names={["View", "Shading", "Show", "Panels"]} menus={menus} label="Viewport menus" prefix="Viewport" />
      <span className="vb-sep" />
      <div className="views" role="group" aria-label="Views">
        {VIEWS.map((v) => (
          <button key={v.id} type="button" title={v.title} aria-pressed={p.view === v.id} onClick={() => p.onView(v.id)}>
            {v.label}
          </button>
        ))}
      </div>
      <Toggle label="Zoom Extents" glyph={VIEW_GLYPHS.extents} onClick={p.onExtents} />
      <span className="vb-sep" />
      <Toggle label="Shaded" glyph={VIEW_GLYPHS.shaded} pressed={s.face === "shaded" || s.face === "textured"} onClick={() => face("textured")} title="Shaded with materials" />
      <Toggle label="Wireframe" glyph={VIEW_GLYPHS.wire} pressed={s.face === "wireframe"} onClick={() => face("wireframe")} />
      <Toggle label="X-ray" glyph={VIEW_GLYPHS.xray} pressed={s.face === "x_ray"} onClick={() => face("x_ray")} />
      <span className="vb-sep" />
      <Toggle label="Shadows" glyph={VIEW_GLYPHS.shadows} pressed={p.shadows} onClick={() => p.onShadows(!p.shadows)} />
      <Toggle label="Grid" glyph={VIEW_GLYPHS.grid} pressed={s.grid} onClick={() => p.onStyle({ grid: !s.grid }, `Grid ${s.grid ? "hidden" : "shown"}`)} />
      <Toggle label="Section Cuts" glyph={VIEW_GLYPHS.section} pressed={s.section_cuts} onClick={() => p.onStyle({ section_cuts: !s.section_cuts }, `Section cuts ${s.section_cuts ? "off" : "on"}`)} />
      <Toggle label="Scene Stats" glyph={VIEW_GLYPHS.stats} pressed={p.stats} onClick={p.onStats} />
    </div>
  );
}
