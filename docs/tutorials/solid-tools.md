# Tutorial: the Solid tools

**Union**, **Subtract**, **Intersect** and **Split** combine parts that overlap. They are one tool with four modes: pick one from the **Tools** menu, or click **Solids** on the tool rail and tap **Alt** to step through the modes. The status line always names the mode and the next step.

Every mode works the same way, like Joint:

1. Click the part to work with. Shift+click adds more (not for Split, which takes two).
2. Click the part to change.

Each change is one undo step, and a refusal says why and changes nothing. What you picked stays picked after a refusal, so you can move a part and click again.

This lesson takes about ten minutes. You will build two overlapping blocks and try each mode on them, undoing in between.

## Set up two overlapping blocks

1. Press **R**, type `12,12`, Enter. Press **P**, click the rectangle, type `6`, Enter. That is solid 1, 12 x 12 x 6 in.
2. Press **M**, tap **Ctrl** (Cmd on a Mac) to copy, click the block's front-left bottom corner, press the **Left arrow** to lock to green, move along green and type `6`, Enter. Solid 2 overlaps solid 1 by half.
3. Press **Space**, then **Esc**, so nothing is selected.

## Union: two parts become one

1. **Tools > Union**. The status line: click the part to join, then the part to join it into.
2. Click solid 2, then solid 1.
3. One part is left, 18 in long, still called solid 1. The Outliner shows one solid.

Union also joins parts that only rest flat against each other, such as an apron set on a leg. It refuses parts that do not touch.

Press **Cmd+Z** to get both blocks back.

## Subtract: cut one out of the other, and take it away

1. **Tools > Subtract**. The status line: click the part to take away, then the part to cut it out of.
2. Click solid 2, then solid 1.
3. Solid 1 has lost the half that overlapped, and solid 2 is gone.

Use Subtract when the cutter was only there to make the shape: a dado, a notch, a hole. When you still need the cutter afterwards, use **Joint** instead (Tools > Cut With Selection): the tenon cuts its mortise and stays in place.

Shift+click several cutters before you click the part, and they all come out in one step: a row of shelf-pin holes, say.

Press **Cmd+Z**.

## Intersect: keep only the overlap

1. **Tools > Intersect**.
2. Click solid 2, then solid 1.
3. Only the overlap is left: a 12 x 6 x 6 in block, called solid 1.

Intersect is handy for shapes that are hard to draw directly: draw a part's outline from the front and pull it through, draw it from the side and pull that through, then Intersect the two to get the part that matches both views. A cabriole leg is made this way.

Press **Cmd+Z**.

## Split: three parts from two

1. **Tools > Split**, or tap **Alt** until the status line says Split.
2. Click solid 2, then solid 1.
3. Three parts now: solid 1 without the overlap, solid 2 without the overlap, and the overlap as a new solid of its own. The status line says `3 parts now`.

If one part is wholly inside the other, Split hollows the outer one and leaves the inner one as it is.

## When the tools say no

- **"Those parts do not overlap."** Move them together first (Move, with the arrows to lock an axis).
- **"Those parts fill the same space."** Split has nothing to divide.
- **"That group holds more than one solid."** Open the group (double-click) and pick the solid inside.
- **"Split works on two parts."** Press Esc and pick one part, then click the other.

Clicking a copy of a component changes only that copy, which becomes its own component; the status line tells you when that happens.
