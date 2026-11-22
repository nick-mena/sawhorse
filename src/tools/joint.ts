// Joint. Cut one part with another, add parts into one, or make a named joint.
//
// What is selected is the part picked first: click a part to choose it, then click the part
// it works on. Tapping Alt steps through the modes, and the Tools menu picks one.
//
// - Cut (the free-form mode): the selection is the cutter (Shift adds another). It stays
//   where it is, because a tenon that cuts its own mortise is still needed afterwards, and
//   stays selected so the next click cuts again and Delete takes it away if it was only
//   there to make the hole. Ctrl+click adds the selected parts into the part clicked instead.
// - Mortise and Tenon, Dado, Rabbet, Half-Lap (ADR-0015): the board picked first goes into
//   the board clicked (the rail into the leg, the shelf into the side). The kernel works out
//   the cuts from where the two boards meet and picks the sizes a woodworker would; typing
//   sizes straight afterwards makes the joint again at those sizes, in one undo step.
//
// The kernel checks every step and says why it refuses.
import type { Entity, Item, JointKind, JointNote, JointParams, KernelOp, V3 } from "../kernel/types";
import { itemsOf, objectOf } from "../lib/entities";
import { solidName } from "../lib/names";
import { describeNode, graphOf, scopeEntity } from "../lib/scope";
import { parseVcb } from "../lib/vcb";
import { Tool, type ToolEvent } from "./tool";

export const sameItem = (a: Item, b: Item) => ("node" in a && "node" in b && a.node === b.node) || ("object" in a && "object" in b && a.object === b.object);

/** The whole part an entity belongs to: a face or an edge stands for its solid. */
export function partOf(e: Entity | null): Entity | null {
  if (!e) return null;
  if (e.kind === "node") return e;
  const object = objectOf(e);
  return object === null ? null : { kind: "object", object };
}

export const itemOf = (part: Entity): Item => (part.kind === "node" ? { node: part.node } : { object: (part as { object: number }).object });

export type JointMode = "cut" | JointKind;

interface ModeDef {
  id: JointMode;
  name: string;
  /** The Tools menu's tooltip. */
  title: string;
  /** What typed values mean, for the value box's label. */
  value: string | null;
  /** The status line before anything is picked. */
  first: string;
}

export const JOINT_MODES: ModeDef[] = [
  {
    id: "cut",
    name: "Cut With Selection",
    title: "The selected parts stay put and cut each part you click next, the way a tenon marks its mortise",
    value: null,
    first: "Cut: click the part that does the cutting, then each part to cut. Tap Alt for joints.",
  },
  {
    id: "mortise_tenon",
    name: "Mortise and Tenon",
    title: "A tenon on the end of the board picked first, and its mortise in the board clicked",
    value: "Thickness, width, length",
    first: "Mortise and tenon: click the rail, then the leg it goes into. Tap Alt for the next joint.",
  },
  {
    id: "dado",
    name: "Dado",
    title: "A groove across the board clicked that houses the end of the board picked first",
    value: "Depth",
    first: "Dado: click the shelf, then the side it goes into. Click near an end of the dado to stop it short there. Tap Alt for the next joint.",
  },
  {
    id: "rabbet",
    name: "Rabbet",
    title: "A step along the edge of the board clicked that takes the end of the board picked first",
    value: "Depth",
    first: "Rabbet: click the board that sits in the rabbet, then the board at whose edge it sits. Tap Alt for the next joint.",
  },
  {
    id: "half_lap",
    name: "Half-Lap",
    title: "Two boards crossing face to face each lose half of where they overlap",
    value: "Depth",
    first: "Half-lap: click one board, then the board it crosses. Draw them overlapping where they cross. Tap Alt for the next joint.",
  },
];

const modeOf = (id: JointMode): ModeDef => JOINT_MODES.find((m) => m.id === id) ?? JOINT_MODES[0];

const NM = 1e-9;

/** The last joint, while nothing has changed since: typed sizes make it again. */
interface LastJoint {
  kind: JointKind;
  receiving: Item;
  inserting: Item;
  params: JointParams;
  depth: number | undefined;
}

export class JointTool extends Tool {
  readonly id = "joint" as const;
  private mode: JointMode = "cut";
  private working = false;
  private said: string | null = null;
  private last: LastJoint | null = null;
  /** Told when the mode changes (the Tools menu checks the one in use). */
  onMode: ((m: JointMode) => void) | null = null;

  current(): JointMode {
    return this.mode;
  }

  /** Switch mode, keeping what is picked; says the new mode's step. */
  setMode(m: JointMode): void {
    this.mode = m;
    this.last = null;
    this.onMode?.(m);
    this.say(this.prompt());
  }

  valueLabel(): string | null {
    return modeOf(this.mode).value;
  }

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
    const picked = itemsOf(this.host.selection());
    if (this.mode === "cut") {
      return picked.length ? `Cutting with ${this.what(picked)}. Click each part to cut, or Ctrl+click a part to add into it. Esc picks again.` : null;
    }
    const m = modeOf(this.mode);
    if (!picked.length) return m.first;
    return `${m.name}: click the board ${this.what(picked)} goes into. Esc picks again.`;
  }

  activate(): void {
    this.say(this.mode === "cut" ? this.prompt() : this.prompt() ?? modeOf(this.mode).first);
  }

  variantHint(): string | null {
    return this.mode === "cut" ? null : this.prompt();
  }

  reset(): void {
    this.working = false;
    this.said = null;
    this.last = null;
  }

  onModifier(key: "ctrl" | "alt"): void {
    if (key !== "alt") return;
    const k = JOINT_MODES.findIndex((m) => m.id === this.mode);
    this.setMode(JOINT_MODES[(k + 1) % JOINT_MODES.length].id);
  }

  onEvent(e: ToolEvent): void {
    const h = this.host;
    if (e.type === "leave") return h.hover(null);
    if (e.type === "move") {
      h.hover(partOf(scopeEntity(e.picked?.entity ?? null, h.state())));
      // Delete or Esc may have emptied the selection since the last line was written; a
      // refusal stays up until the next click.
      const now = this.prompt();
      if (this.mode === "cut" && !now && this.said?.startsWith("Cutting with")) this.say(null);
      return;
    }
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
    if (!picked.length || (e.shift && this.mode === "cut")) {
      h.setSelection(e.shift ? [...h.selection(), part] : [part]);
      this.say(this.prompt());
      return;
    }
    if (picked.some((c) => sameItem(c, clicked))) {
      this.say("That part is the one picked first. Click a different part, or press Esc to pick again.", true);
      return;
    }
    if (this.mode === "cut") return void this.combine(clicked, part, picked, e.ctrl);
    if (picked.length > 1) {
      this.say("A joint is between two boards. Press Esc, click one board, then the board it goes into.", true);
      return;
    }
    const kind = this.mode;
    const params: JointParams = {};
    // A dado or rabbet clicked near one end can stop short there; the point is kept so a
    // typed stop later knows which end. (Stopping is not offered as a typed value yet.)
    if ((kind === "dado" || kind === "rabbet") && e.picked?.point) params.near = e.picked.point as V3;
    void this.join({ kind, receiving: clicked, inserting: picked[0], params, depth: undefined }, false);
  }

  onValue(text: string): void {
    const h = this.host;
    if (this.mode === "cut") return void h.status("Cut takes no typed value. Pick a joint with Alt to type its sizes.", true);
    const last = this.last && this.last.depth === h.state()?.undo_depth ? this.last : null;
    if (!last) return void h.status(`Make the joint first, then type its sizes: ${modeOf(this.mode).value?.toLowerCase()}.`, true);
    const r = parseVcb(text, h.units());
    if (!r.ok) return void h.status(r.error, true);
    const ms = r.value.kind === "length" ? [r.value.m] : r.value.kind === "lengths" ? r.value.m : null;
    if (!ms) return void h.status(`Type ${modeOf(last.kind).value?.toLowerCase()}, as lengths.`, true);
    const params: JointParams = { ...last.params };
    if (last.kind === "mortise_tenon") {
      if (ms.length > 3) return void h.status("Type up to three sizes: the tenon's thickness, width and length.", true);
      params.thickness = ms[0];
      // The default shoulders are as wide as the tenon is thick, so an untyped width follows
      // the new thickness; an untyped length stays what it was.
      if (ms.length > 1) params.width = ms[1];
      else delete params.width;
      if (ms.length > 2) params.depth = ms[2];
    } else {
      if (ms.length > 1) return void h.status("Type one size: how deep the cut goes.", true);
      params.depth = ms[0];
    }
    void this.join({ ...last, params }, true);
  }

  private metric(): boolean {
    const u = this.host.units();
    return u === "mm" || u === "cm" || u === "m";
  }

  private describe(note: JointNote, copies: number, target: string): string {
    const h = this.host;
    const f = (nm: number) => h.fmt(nm * NM);
    const all = copies > 1 ? ` All ${copies} copies of ${target} have it.` : "";
    const unit = h.unitLabel();
    switch (note.kind) {
      case "mortise_tenon":
        return `Mortise and tenon in ${target}: tenon ${f(note.thickness_nm)} x ${f(note.width_nm)} x ${f(note.depth_nm)} ${unit}${note.through ? ", through" : ""}.${all} Type thickness, width, length to change it.`;
      case "dado":
        return `Dado in ${target}: ${f(note.thickness_nm)} wide, ${f(note.depth_nm)} ${unit} deep.${all} Type a depth to change it.`;
      case "rabbet":
        return `Rabbet in ${target}: ${f(note.thickness_nm)} wide, ${f(note.depth_nm)} ${unit} deep.${all} Type a depth to change it.`;
      case "half_lap":
        return `Half-lap: ${target} cut ${f(note.depth_nm)} ${unit} deep, the other board the rest.${all} Type a depth to change it.`;
    }
  }

  /** Make a joint, or (`replace`) make the last one again with new sizes. */
  private async join(j: LastJoint, replace: boolean): Promise<void> {
    const h = this.host;
    const params: JointParams = { ...j.params, metric: this.metric() || undefined };
    const op: KernelOp = { op: "make_joint", kind: j.kind, receiving: j.receiving, inserting: j.inserting, params };
    const target = this.name(j.receiving);
    this.working = true;
    if (replace && !(await h.apply({ op: "undo" }))) {
      this.working = false;
      return;
    }
    let text = "";
    const r = await h.apply(op, (res) => {
      const o = res.outcome;
      text = o.kind === "joint_made" ? this.describe(o.joint, o.copies, target) : `Made the joint in ${target}.`;
      return text;
    });
    // New sizes that the kernel refuses put the joint that was there back, so a refusal never
    // costs the joint (the refusal stays on the status line).
    if (!r && replace) {
      const said = h.lastError();
      await h.apply({ op: "redo" });
      if (said) h.status(said, true);
    }
    this.working = false;
    if (r) {
      this.last = { ...j, depth: r.scene.state.undo_depth };
      this.said = text;
      // The next joint starts with a fresh pick: the board picked first has just changed.
      h.setSelection([]);
    } else if (!replace) this.last = null;
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
