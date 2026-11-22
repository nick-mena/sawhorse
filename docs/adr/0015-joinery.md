# ADR-0015: A joinery library

- Status: accepted (2026-11-16); step 1 built, steps 2 to 5 not started
- Source: the owner's pick from the 2026-11-16 survey of similar tools. The idea of named joints that stay linked to their boards comes from BenchUp's public README (github.com/BenchUp3D/benchup, MIT). The list of joints a furniture maker reaches for is general woodworking knowledge. Nothing from Hew informed this ADR (see `docs/CLEANROOM.md`, 2026-11-16).

## Context

The Joint tool (`src/tools/joint.ts`, `Op::CombineParts`) cuts one part with another. To make a mortise and tenon today, someone has to draw the tenon on the rail, push it out, then cut the leg with the rail. They have to work out the shoulders, the clearance and the mortise depth themselves. Each joint is many steps, the result is only geometry, and nothing remembers that it was a joint. A joint can't be resized, removed, listed or checked afterwards.

Woodworkers think in joints: "a 3/8 in tenon, 1-1/4 in long, with 1/4 in shoulders." Peer tools let them pick a joint, aim it at two boards and type its sizes. The joint then stays editable and follows the boards when they move.

## Decision (proposed)

**A joint is a record in the model, plus the cuts it made.** `Op::MakeJoint { kind, params, a, b }` takes the receiving board (`a`: the leg, the case side) and the inserting board (`b`: the rail, the shelf). It works out where they meet, makes both boards' cuts in one transaction, and stores a `Joint { id, kind, params, a, b, meeting, stock }`. As with every op, a joint that can't be made changes nothing, and the refusal is a full sentence ("The tenon would be thicker than the rail: the rail is 3/4 in, the tenon 7/8 in.").

**Kept in the kernel, in Rust** (`crates/kernel/src/joinery.rs`), not in a plugin. Joints have to be deterministic and run through undo, the validator, the hash and crash recovery. They also have to move with Move, and a plugin can't do that. A later step exposes `MakeJoint` through the plugin API so plugins like the cabinet generator can ask for joints.

**Where boards meet decides which joints are offered.** Each board's own axes are already known: the cut list's `Shape` gives T, W and L, exact for rectilinear parts. Two boards that touch or overlap meet in one of these ways:

| Meeting | Example | Joints offered |
|---|---|---|
| End to face (T) | rail into leg, shelf into side | mortise and tenon (through, blind, haunched), dado / housing, stopped dado, dowels, Domino, biscuit, pocket screws |
| End to end (L) | box corner, drawer front to side | through dovetail, half-blind dovetail, finger (box) joint, rabbet, miter, miter with spline |
| Face across face (X) | stretchers crossing | cross half-lap, bridle |
| End to end in line (I) | lengthening a rail | scarf (later) |

When the boards don't meet like this, the joint is refused in words ("These boards don't touch. Move the rail against the leg, then make the joint."). Boards that overlap where they meet are trimmed back to the shoulder, so a rail drawn running into the leg gets the right length.

**Sizes default the way a woodworker would, and are typed in the value box.** A tenon is a third of the rail's thickness, rounded to a common chisel size (1/4, 5/16, 3/8, 1/2 in, or 6, 8, 10, 12 mm), with a length of 2/3 of the leg's depth. Clearance defaults to 0 for the model, with a fit setting (snug, 0.1 mm, or a typed value) for parts sent to CNC. Values are typed straight into the value box with Tab between fields, the same way the CNC workspace takes length and angle.

**Loose pieces become real parts.** Dowels, Domino tenons, biscuits and splines are made as small components, so they show up in the cut list (dowels and biscuits in a hardware section, by size and count) and on labels. BenchUp leaves them out; listing them is where a cut-list tool earns its keep.

**Editing and removing a joint.** The record keeps each board's solid as it was before its first joint (`stock`). Editing a joint's sizes, or removing it, rebuilds that board from `stock` and replays its remaining joints in order. It's one undo step and exact, with no unioning a cavity back. If a board has its geometry edited directly (push/pull a face, Loop Cut, solid tools), its joints are *baked*: the records go, the geometry stays, and the status line says so ("The rail's two joints are now plain geometry, because its shape was edited directly."). The fork never keeps a stale record that disagrees with what's on screen.

**Moving a jointed board refits its joints** (second step below). A Move, Rotate or array that changes a jointed board's placement rebuilds the joint from the new meeting in the same transaction. If the boards no longer meet, the joint is baked and the reason given.

**Components.** A joint on a component instance cuts the definition, so all four legs get the mortise. This is usually right for repeated parts and is how every edit to a component works (ADR-0005). The status line says "Cut all 4 copies of Leg". Ctrl at the click makes the copy unique first, the way `CombineParts` already can.

**Saved and hashed only when present.** `scene.json` gains an optional `joints` array (`docs/format.md`): kind, params, the two board ids, and the stock solids' geometry stored once per board. The model hash includes joints only when there are some, so every older document and golden keeps its hash. Joint records from a file are untrusted and checked like an op log.

## Steps

1. **T joints, made and refused.** `joinery.rs` with meeting detection and the end-to-face joints that are box cuts: mortise and tenon (blind, through, haunched), dado, stopped dado, rabbet. Also the half-lap for X. The Joint tool gets a joint picker, with Cut and Add staying as the two free-form modes, plus a preview and typed sizes. The joint record is saved and shown in the Attributes pane, read only. Tests: per joint, the tenon's volume equals the mortise's volume minus clearance; the validator passes; native and WASM hashes match; the fuzzer makes and undoes random joints.
2. **Edit, remove and refit.** `stock` and replay, editing in the Attributes pane, baking on direct edits, refitting on Move and Rotate.
3. **Corner joints.** Through and half-blind dovetails (pin and tail count, angle 1:6 / 1:8, half-pins), finger joints (count or finger width), miter and miter with spline. These are extruded polygon cuts, not boxes, so they need the boolean path's coplanar cases tested hard.
4. **Loose joinery and holes.** Dowels, Domino, biscuits and pocket screws as generated parts, a hardware section in the cut list, and holes on their own layer in DXF and the CNC booklet.
5. **Checks.** Short-grain warnings (a tenon across the grain), wood movement (a wide solid panel glued across the grain), breakout (a mortise too near an end) and fit. They're shown as notes, never refusals, because the woodworker may know better. Also expose `MakeJoint` to plugins.

## Step 1 as built (2026-11-16)

- **Storage.** Rather than a `scene.json` `joints` table, each joint leaves a `JointNote` on both parts' cut-list attributes (`part.joints`, `docs/format.md`). Notes ride with the solid through save, undo, the hash (only when present) and components (a note on a definition member is on every copy) without a new model table. Step 2 adds `stock` and params to replay from; the notes' shared `id` is what will tie the two halves together.
- **Joints built:** mortise and tenon (blind and through), dado, stopped dado (stopped at the end away from the click), rabbet, half-lap. Clearance is a parameter, default 0. A joint on a component cuts every copy (the proposed default; no unshare yet).
- **Not yet in step 1:** a live preview of the cut (only the board under the cursor is highlighted), haunched tenons, typing a dado's stop length, the fuzzer making joints, and an e2e spec. A copy of a jointed part keeps its notes, which is harmless until step 2 makes notes editable.

## Consequences

- The cut list needs no change for the boards themselves. A tenon is part of the rail's geometry, so the rail's oriented box already includes it. A rail shortened to its shoulders shows its true cutting length.
- Steps 1 and 3 use only the kernel's existing booleans (`Object::combine`). Step 2 is the first place the model keeps geometry the view doesn't show (`stock`). This costs file size, at most one extra solid per jointed board, and it's covered by the existing size limits in `docs/LIMITS.md`.
- Free-form Cut and Add stay. Anything the library doesn't cover can still be cut by hand.
- Not planned: a general feature history for the whole model. Joints are the one place a record replays.

## Open questions for the owner

- Which joints first? The order above starts with what a table or a case needs (mortise and tenon, dado, rabbet).
- Should a joint on one copy of a component cut every copy by default (proposed), or ask?
- Is a fit/clearance setting needed in step 1, or can it wait for CNC output in step 4?
