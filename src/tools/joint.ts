// Joint. Cut one part with another, or add parts into one.
//
// What is selected is the cutter: click a part to choose it (Shift adds another), then click
// each part it should cut. The cutter stays where it is, because a tenon that cuts its own
// mortise is still needed afterwards, and stays selected so the next click cuts again and
// Delete takes it away if it was only there to make the hole. Ctrl+click adds the selected
// parts into the part clicked instead. The kernel checks every step and says why it refuses.
import type { Entity, Item, KernelOp } from "../kernel/types";
import { itemsOf, objectOf } from "../lib/entities";
import { solidName } from "../lib/names";
import { describeNode, graphOf, scopeEntity } from "../lib/scope";
import { Tool, type ToolEvent } from "./tool";

const sameItem = (a: Item, b: Item) => ("node" in a && "node" in b && a.node === b.node) || ("object" in a && "object" in b && a.object === b.object);

/** The whole part an entity belongs to: a face or an edge stands for its solid. */
export function partOf(e: Entity | null): Entity | null {
  if (!e) return null;
  if (e.kind === "node") return e;
  const object = objectOf(e);
  return object === null ? null : { kind: "object", object };
}

const itemOf = (part: Entity): Item => (part.kind === "node" ? { node: part.node } : { object: (part as { object: number }).object });

export class JointTool extends Tool {
  readonly id = "joint" as const;
  private working = false;
  private said: string | null = null;

  private name(item: Item): string {
    return "node" in item ? describeNode(graphOf(this.host.state()), item.node) : solidName(item.object);
  }

  private what(items: Item[]): string {
    return items.length === 1 ? this.name(items[0]) : `${items.length} parts`;
  }

  private say(text: string | null, error = false): void {
    this.said = text;
    this.host.status(text, error);
  }

  /** The status line for the parts selected now. */
  private prompt(): string | null {
    const cutters = itemsOf(this.host.selection());
    return cutters.length ? `Cutting with ${this.what(cutters)}. Click each part to cut, or Ctrl+click a part to add into it. Esc picks again.` : null;
  }

  activate(): void {
    this.say(this.prompt());
  }

  reset(): void {
    this.working = false;
    this.said = null;
  }

  onEvent(e: ToolEvent): void {
    const h = this.host;
    if (e.type === "leave") return h.hover(null);
    if (e.type === "move") {
      h.hover(partOf(scopeEntity(e.picked?.entity ?? null, h.state())));
      // Delete or Esc may have emptied the selection since the last line was written; a
      // refusal stays up until the next click.
      const now = this.prompt();
      if (!now && this.said?.startsWith("Cutting with")) this.say(null);
      return;
    }
    if (e.type !== "click" || this.working) return;
    const raw = e.picked?.entity ?? null;
    const part = partOf(scopeEntity(raw, h.state()));
    if (!part) {
      if (raw) this.say("That is outside the group or component you have open. Esc closes it.", true);
      else {
        h.setSelection([]);
        this.say(null);
      }
      return;
    }
    const clicked = itemOf(part);
    const cutters = itemsOf(h.selection());
    if (!cutters.length || e.shift) {
      h.setSelection(e.shift ? [...h.selection(), part] : [part]);
      this.say(this.prompt());
      return;
    }
    if (cutters.some((c) => sameItem(c, clicked))) {
      this.say("That part is the one selected to cut with. Click a different part, or press Esc to pick again.", true);
      return;
    }
    void this.combine(clicked, part, cutters, e.ctrl);
  }

  private async combine(target: Item, part: Entity, cutters: Item[], adding: boolean): Promise<void> {
    const h = this.host;
    const op: KernelOp = { op: "combine_parts", target, with: cutters, how: adding ? "add" : "cut" };
    const name = this.name(target);
    const named = this.what(cutters);
    this.working = true;
    let text = "";
    const r = await h.apply(op, (res) => {
      const o = res.outcome;
      const pieces = o.kind === "parts_combined" ? o.objects.length : 1;
      const unique = o.kind === "parts_combined" && o.unique ? " Only this copy changed: it is its own component now." : "";
      const apart = pieces > 1 ? ` It came apart into ${pieces} parts.` : "";
      text = adding ? `Added ${named} into ${name}.${unique}` : `Cut ${name} with ${named}.${apart}${unique} Click another part to cut, or press Delete to remove the cutter.`;
      return text;
    });
    this.working = false;
    if (!r) return;
    // What was added is gone, so the part it joined is what is left to select. A cut's
    // selection is untouched: the cutter is ready for the next part.
    if (adding) h.setSelection([part]);
    this.said = text;
  }
}
