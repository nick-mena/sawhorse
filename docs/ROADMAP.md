# BenchCraft development plan

- Written: 2026-11-16, from the feature survey of similar tools (BenchUp, Hew, OpenCutList, FreeCAD Woodworking, ShopPrentice, Shapr3D, Mozaik, PolyBoard, Cabinet Vision, SketchUp 2026) and the joinery work in ADR-0015.
- Owner: the owner of this fork. This plan says what to build next and in what order; the ADRs say how.
- Keep it current: when an item is done, move it to "Done" with the date and the commit; when the order changes, say why in one line.

## How to choose what comes next

The order below follows `PRODUCT.md`'s principles, in this order:

1. **Trust first.** Work that could lose or quietly change a model (unfinished joinery records, imported parts that aren't solid) comes before new surface area.
2. **The owner's real workflow.** Furniture and casework built on a Mac: joints, edges, a cut list that prices the job, and output for the shop.
3. **Stay close to upstream.** A feature that fits Sawhorse in general (joinery, edge profiles, cost) is designed so it could be offered upstream: kernel ops, `.shz` fields that are absent when unused, no fork-only assumptions. Mac-only polish stays in the fork.
4. **Say what is true.** Each step ends with its limits in `docs/LIMITS.md` and in the README's "Not yet" list, not just in code.

## Rules for every item

- **An ADR before code** for anything that adds a kernel op, a `.shz` field or a plugin permission. Small UI items need no ADR.
- **Kernel invariants hold:** one op is one undo step and is transactional; native and WASM hashes match; new state is hashed and saved only when present, so existing goldens never change. Never `UPDATE_GOLDEN=1` to pass a test.
- **Tests at the lowest layer that shows the behaviour:** Rust for the kernel and files, Vitest for front-end logic, one Playwright spec for the real-page path. New ops join the fuzzer.
- **Done means documented:** `CHANGELOG.md` under `[Unreleased]`, `docs/USER-GUIDE.md`, `docs/format.md` for file changes, `docs/LIMITS.md` for any new limit.
- **Clean room:** Hew and `hew3d/openskp` are never read for code. Items marked *(Hew-noted)* below were seen only in Hew's README (`docs/CLEANROOM.md`, 2026-11-16). They cite that entry, and they're built in a session that didn't read it.
- **Size:** S is a session or two, M is a few sessions, L needs an ADR and several steps.

## Phase 0: finish and land what's open

| # | Item | Done when | Size |
|---|---|---|---|
| 0.3 | **Close the step 1 gaps:** a live preview of the cut before the click; haunched tenons; typing a stopped dado's stop length; the fuzzer making and undoing random joints; a copied part dropping (or re-numbering) its joint notes. | Each gap has a test; ADR-0015's "Step 1 as built" list is empty or says why an item moved to step 2. | M |

## Phase 1: joints and edges a furniture maker uses every day

| # | Item | Why | Done when | Size |
|---|---|---|---|---|
| 1.1 | **Joinery step 2: edit, remove, refit** (ADR-0015). Keep each board's `stock` solid, replay its joints in order, edit sizes in the Attributes pane, bake joints on direct edits with a message, refit on Move and Rotate. | Today a joint can't be resized or removed after the fact; it's the biggest trust gap in step 1. | Changing a tenon in the Attributes pane is one undo step and exact; moving a rail refits or bakes with a sentence; a document never holds a record that disagrees with the geometry. | L |
| 1.2 | **Router edge profiles** (new ADR-0016). Chamfer, roundover, cove, ogee, bead, rabbet and groove along a picked edge or a line drawn on a face, editable and removable. | Covers the README's "Fillet and chamfer" gap in woodworkers' terms (BenchUp). | Profiles keep the solid closed; the cut list sizes the part from its stock box; a profile can be removed exactly. | L |
| 1.3 | **Joinery step 3: corner joints.** Through and half-blind dovetails, finger joints, miter and miter with spline. | Boxes and drawers need them. These are polygon cuts, so the coplanar boolean cases need hard tests first. | Every joint passes the volume test (tenon equals socket minus clearance) and the validator, at several board sizes. | L |

## Phase 2: the shop side

| # | Item | Why | Done when | Size |
|---|---|---|---|---|
| 2.1 | **Cost, weight and time estimates** in the cut list. Price per board foot, per sheet and per linear foot in the stock library; weight from species density; an optional finish and labour line. | The stock library already knows board feet and sheet area, so this is a small step that answers "what will it cost?" (OpenCutList, BenchUp, FreeCAD Woodworking). | Totals in the Cut list pane, CSV and PDF; prices saved only when set; nothing priced shows "not priced", never 0. | M |
| 2.2 | **Joinery step 4: loose joinery and hardware.** Dowels, Domino, biscuits, pocket screws, hinges and shelf pins as generated parts; a hardware section in the cut list; holes on their own layer in DXF and the CNC booklet. | Real parts on the list are where a cut-list tool earns its keep (Mozaik, PolyBoard, Cabinet Vision). The shelf-pin and cabinet plugins are the first callers. | Hardware counted by size; holes reach DXF; the cabinet generator plugin can request them. | L |
| 2.3 | **Joinery step 5: woodworking checks.** Short grain, wood movement across a wide glued panel, breakout near an end, parts that collide. Shown as notes, never refusals. Expose `MakeJoint` to plugins. | ShopPrentice-style checks fit "say what is true". | Each check has a model that triggers it and one that doesn't; notes show in the Attributes pane and the cut list. | M |
| 2.4 | **Label and output extras.** QR codes on labels, edge banding and veneer as their own lines in the cut list, an exploded view on drawing sheets. | OpenCutList users expect them; the output pipeline already exists. | Each output covered by a golden or snapshot test. | M |

## Phase 3: repair and automation

| # | Item | Why | Done when | Size |
|---|---|---|---|---|
| 3.1 | **Model Health and Make Solid** *(Hew-noted)*. Report what's wrong with an imported part (open edges, flipped faces, slivers) and offer to close it into a solid. | Most hand-made SketchUp furniture arrives as open meshes; the cut list can only size them from their bounds. | A repaired part is a validated solid, the change is one undo step, and anything that can't be repaired says why. | L |
| 3.2 | **Drive the app from an agent.** A command-line tool and an MCP server over the existing plugin API: add boards and joints, read the cut list, render a preview. | Three peers ship this (BenchUp, Hew, ShopPrentice). The sandboxed plugin API is most of the groundwork. | A security ADR first: what the server can reach, how the person grants it, and that it never widens the plugin sandbox or the Tauri capabilities. | L |
| 3.3 | **Session record and replay** *(Hew-noted)*. Record the op log and input of a session so a reported bug can be replayed. | Pairs with the feedback log; makes "it broke" reproducible. | A recorded session replays to the same hash, and recording is off unless the owner turns it on. | M |

## Later: worth doing, not yet scheduled

- **Parametric sizes:** named variables and expressions for part sizes (Shapr3D, PolyBoard). It's a large kernel change, so it needs its own ADR and a deliberate decision. It may build on joinery's replay.
- **`.skp` export** *(Hew-noted)*: blocked on the attorney read and a blank template of our own (ADR-0002).
- **README "Not yet" items:** Back and Bottom views, copy and paste in place, Weld Edges, text and radius or diameter dimensions in the model. Each is small and a good fit for upstream.
- **Small additions:** Create Guide Point and undoable scene changes (SketchUp 2026), SpaceMouse support, a procedural wood grain and finish preview (BenchUp), viewing a model on a phone with AR *(Hew-noted)*.

## Not planned

- **Bidding, job costing and order management** (pro cabinet suites). Cost estimates (2.1) stop at materials and time.
- **Real-time collaboration** (SketchUp 2026). It doesn't fit a local-first tool for one person.
- **A full feature history for the whole model.** Joints are the one place a record replays (ADR-0015).

## Done

- 2026-11-22, 0.1: the Nov 12 work committed apart from joinery on `fix/stability-pass`: `1c198a9` `feat(kernel): loop cut, and subtract, intersect and split parts` and `b2a5f78` `feat(ui): Loop Cut and solid tools, the Attributes pane and a Maya-style layout`. Every suite passes at each commit. It reaches `main` when the branch is merged.
- 2026-11-22, 0.2: joinery step 1 (ADR-0015), `24538e6` `feat(kernel): joinery step 1`: mortise and tenon, dado, stopped dado, rabbet and half-lap in the Joint tool, listed in the Attributes pane, saved in `.shz`.
- 2026-11-22: the UI audit's menu, field and tool-rail fixes, `7aa2e2b` `fix(ui): keep menus, fields and the tool rail inside the window`. Still open from that audit: spacing, radius and shadow tokens, hit targets under 24px, and the 9px rail labels.
