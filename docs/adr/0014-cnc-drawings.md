# ADR-0014: CNC drawings

- Status: accepted (2026-11-10)
- Source: the owner's request for a 2D drawing window for curved parts, such as a rocking chair rail or a toy horse's head

## Context

A curved outline is hard to draw with the 3D tools: a Line, Arc or Circle at a time, on a plane the camera has to be aimed at. The owner wants to draw it flat with a pen and curve handles, over a reference image, set the stock thickness and bring it into the model.

## Decision

**It is a workspace inside the app's window**, not a second native window. A second window needs its own entry in `src-tauri/capabilities/` and messaging between two webviews. The workspace needs neither, and the model cannot change while a drawing is open. It adds no native permission, dependency or CSP source: the reference image reaches the page as a `blob:` URL, which both CSPs already allow.

**The drawing is lines and cubic Beziers, in metres with y up** (`src/cnc/design.ts`). The kernel has no curve of this kind, and this ADR does not add one: a curve becomes straight pieces within 0.1 mm of it when it is brought in.

**`Op::ExtrudeProfile` builds the part directly**, not through `Draw` and `Extrude`. A sketch merges a stroke with whatever lies on its plane, so a part brought in onto the ground would pick up the ground's lines. Sketches also cannot say which walls are curves: a polyline's walls stay hard (ADR-0013), and a rail would show every facet. The op takes rings of world points with the indices of the points where the walls blend, checks them itself (an op log is untrusted), and is one undo step inside a batch with the rest.

**`Op::SetCncDrawing` keeps the drawing with the model**, as JSON the kernel stores and does not read. As an op it is covered by undo, the unsaved-changes prompt and crash recovery. `plugin-data.json` was the alternative and has none of those. The JSON is read through `parseDesign`, which treats it as untrusted. The reference image is a texture (`AddTexture`), under the texture limits, so its bytes are written once and not with every edit of the drawing.

The workspace's tools mirror the model's and answer to the model's keys, read from `src/lib/shortcuts.ts`, so a key someone changed works the same in both. The few tools the model has no counterpart for (Points, Curve, Pencil, Image) take fixed keys of their own, used only where no model tool claims the key.

Bringing a drawing in does not link the part to it. Reopening the drawing and bringing it in again makes a new part, and edits made to a part in the model stay where they are.

## Saved and hashed only when present

`scene.json` gains an optional `cnc_drawings`. The model hash includes the drawings only when there is one, so every older document and every golden keeps its hash.
