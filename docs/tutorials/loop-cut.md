# Tutorial: Loop Cut

Loop Cut (**K**) draws a ring of edges all the way around a part. It does not change the part's shape on its own; it divides every face the ring crosses, so each band between two rings can be pushed or pulled by itself. This is how you mark where a tenon's shoulder starts, where a leg begins to taper, or where a bead runs around a rail.

This lesson takes about five minutes. You will make a rail, cut three rings, and raise a bead.

## 1. Make a rail

1. Press **R** and type `24,2` then Enter. A 24 x 2 in rectangle appears at the origin.
2. Press **P**, click the rectangle and type `2` then Enter. You have a 24 x 2 x 2 in rail.

## 2. Aim a cut

1. Press **K**. The status line says: point at a face near the edge to cut across.
2. Move the pointer over the rail's top face, close to one of its long edges. A blue ring appears around the rail, square to that edge, and the **Distance** box shows how far it is from the nearer end.
3. Slide the pointer along the edge and watch the ring follow. Move toward one of the short end edges instead and the ring turns to run lengthways: Loop Cut always cuts across the edge nearest the pointer.

The distance is measured from the end of the edge nearer the pointer, so point near the end you want to measure from.

## 3. Cut by clicking, then by typing

1. Point near the left end of a long edge and click. The ring becomes edges. The status line says where it went, for example `Loop cut solid 1: 5 1/4 in from the end.`
2. Without pointing at another edge, type `6` and press Enter. The cut moves to exactly 6 in from that end. (Typing straight after a cut moves it, the way Move and Offset let you correct what you just did.)
3. Point near the right end of the same edge, type `6`, and press Enter. A second ring goes 6 in from the right end.

A ring you have already cut counts as an end, so the next distance can be measured from it.

## 4. Divide evenly

1. Press **Cmd+Z** twice to take both rings away.
2. Point at a long edge and type `/3`, then Enter. Two rings divide the rail into three equal parts, in one undo step.

`/4` gives three rings and four parts, and so on.

## 5. Push a band

1. Press **P** and click the top face of the middle third.
2. Type `1/4` and press Enter. Only that band rises: a 1/4 in bead across the rail.
3. Do the same on the front face of the middle third, so the bead wraps two sides.

Push/Pull with a negative distance (`-1/8`) sinks a band instead, for a groove.

## When Loop Cut says no

- **"There is nothing to cut there."** The plane misses the part, or there are edges all the way around there already (at an end, or on an earlier ring).
- **"The cut passes through a hole in a face."** A loop cut cannot yet cross a through-mortise or another hole. Make the loop cut first, then cut the hole.
- **"That is inside a group or component that is not open."** Double-click the group to edit inside it, then cut.

Every refusal changes nothing, and every cut is one undo step.
