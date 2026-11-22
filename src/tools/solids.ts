// Solids: Union, Subtract, Intersect and Split, one tool with four modes.
//
// It works the way Joint does, so the two feel alike: click the part (or Shift+click the
// parts) to work with, then click the part to change. Union joins them into it; Subtract
// cuts them out of it and takes them away (Joint is the one that keeps the cutter); Intersect
// keeps only where they overlap; Split leaves three parts, each side without the other and
// the overlap on its own. Tapping Alt steps to the next mode; the Tools menu picks one.
// Every change is one kernel op, so one undo puts it all back.
import type { Item, KernelOp } from "../kernel/types";
import { itemsOf } from "../lib/entities";
import { solidName } from "../lib/names";
import { describeNode, graphOf, scopeEntity } from "../lib/scope";
import { itemOf, partOf, sameItem } from "./joint";
import { Tool, type ToolEvent } from "./tool";

export type SolidMode = "union" | "subtract" | "intersect" | "split";

interface ModeDef {
  id: SolidMode;
  name: string;
  how: "add" | "subtract" | "intersect" | "split";
  /** The Tools menu's tooltip. */
  title: string;
  /** The status line before anything is picked. */
  first: string;
  /** The status line once `what` is picked. */
  next: (what: string) => string;
}

export const SOLID_MODES: ModeDef[] = [
  {
    id: "union",
    title: "Join overlapping or touching parts into one: the part clicked last keeps its name and place",
    name: "Union",
    how: "add",
    first: "Union: click the part to join (Shift+click adds more), then the part to join it into. Tap Alt for the next mode.",
    next: (what) => `Union: click the part to join ${what} into. Esc picks again.`,
  },
  {
    id: "subtract",
    title: "Cut the parts picked first out of the part clicked last, and take them away",
    name: "Subtract",
    how: "subtract",
    first: "Subtract: click the part to take away (Shift+click adds more), then the part to cut it out of. Tap Alt for the next mode.",
    next: (what) => `Subtract: click the part to cut ${what} out of. ${what} goes away. Esc picks again.`,
  },
  {
    id: "intersect",
    title: "Keep only where two parts overlap",
    name: "Intersect",
    how: "intersect",
    first: "Intersect: click a part, then a part it overlaps. Only the overlap is kept. Tap Alt for the next mode.",
    next: (what) => `Intersect: click the part ${what} overlaps. Only where they overlap is kept. Esc picks again.`,
  },
  {
    id: "split",
    title: "Two overlapping parts become three: each without the other, and the overlap as a part of its own",
    name: "Split",
    how: "split",
    first: "Split: click a part, then a part it overlaps. Each loses the overlap, and the overlap becomes a part of its own. Tap Alt for the next mode.",
    next: (what) => `Split: click the part ${what} overlaps. Esc picks again.`,
  },
];

const modeOf = (id: SolidMode): ModeDef => SOLID_MODES.find((m) => m.id === id) ?? SOLID_MODES[0];

export class SolidsTool extends Tool {
  readonly id = "solids" as const;
  private mode: SolidMode = "union";
  private working = false;
  /** Told when the mode changes (the Tools menu checks the one in use). */
  onMode: ((m: SolidMode) => void) | null = null;

  /** The mode in use (the Tools menu shows it checked). */
  current(): SolidMode {
    return this.mode;
  }

  /** Switch mode, keeping what is picked; says the new mode's step. */
  setMode(m: SolidMode): void {
    this.mode = m;
    this.onMode?.(m);
    this.say(this.prompt());
  }

  private name(item: Item): string {
    return "node" in item ? describeNode(graphOf(this.host.state()), item.node) : solidName(item.object);
  }

  private what(items: Item[]): string {
    return items.length === 1 ? this.name(items[0]) : `${items.length} parts`;
  }

  private say(text: string | null, error = false): void {
    this.host.status(text, error);
  }

  private prompt(): string {
    const picked = itemsOf(this.host.selection());
    const m = modeOf(this.mode);
    return picked.length ? m.next(this.what(picked)) : m.first;
  }

  activate(): void {
    this.say(this.prompt());
  }

  variantHint(): string | null {
    return this.prompt();
  }

  reset(): void {
    this.working = false;
  }

  onModifier(key: "ctrl" | "alt"): void {
    if (key !== "alt") return;
    const k = SOLID_MODES.findIndex((m) => m.id === this.mode);
    this.setMode(SOLID_MODES[(k + 1) % SOLID_MODES.length].id);
  }

  onEvent(e: ToolEvent): void {
    const h = this.host;
    if (e.type === "leave") return h.hover(null);
    if (e.type === "move") return h.hover(partOf(scopeEntity(e.picked?.entity ?? null, h.state())));
    if (e.type !== "click" || this.working) return;
    const raw = e.picked?.entity ?? null;
    const part = partOf(scopeEntity(raw, h.state()));
    if (!part) {
      if (raw) this.say("That is outside the group or component you have open. Esc closes it.", true);
      else {
        h.setSelection([]);
        this.say(this.prompt());
      }
      return;
    }
    const clicked = itemOf(part);
    const picked = itemsOf(h.selection());
    if (!picked.length || e.shift) {
      h.setSelection(e.shift ? [...h.selection(), part] : [part]);
      this.say(this.prompt());
      return;
    }
    if (picked.some((c) => sameItem(c, clicked))) {
      this.say("That part is already picked. Click a different part, or press Esc to pick again.", true);
      return;
    }
    if (this.mode === "split" && picked.length > 1) {
      this.say("Split works on two parts. Press Esc and pick one part, then click the other.", true);
      return;
    }
    void this.run(clicked, picked);
  }

  private async run(target: Item, picked: Item[]): Promise<void> {
    const h = this.host;
    const m = modeOf(this.mode);
    const op: KernelOp = { op: "combine_parts", target, with: picked, how: m.how };
    const name = this.name(target);
    const named = this.what(picked);
    this.working = true;
    const r = await h.apply(op, (res) => {
      const o = res.outcome;
      const pieces = o.kind === "parts_combined" ? o.objects.length : 1;
      const unique = o.kind === "parts_combined" && o.unique ? " Only this copy changed: it is its own component now." : "";
      const apart = pieces > 1 ? ` It came apart into ${pieces} parts.` : "";
      switch (this.mode) {
        case "union":
          return `Joined ${named} into ${name}.${unique}`;
        case "subtract":
          return `Cut ${named} out of ${name} and took ${named} away.${apart}${unique}`;
        case "intersect":
          return `Kept only where ${named} and ${name} overlap.${apart}${unique}`;
        case "split":
          return `Split ${name} and ${named}: ${pieces} parts now.${unique}`;
      }
    });
    this.working = false;
    if (!r) return;
    // Every mode starts over, so the next click picks afresh rather than reusing a part
    // that has just changed or gone.
    h.setSelection([]);
  }
}
