// The Attributes pane's facts and edits: what the selection is called, where its box sits,
// how big it is, and the ops that change those (the Channel Box idea from Maya, for parts).
//
// Position is the box's lowest corner in model axes and Size its extent, both in metres;
// a typed position moves the selection there, a typed size scales it from that corner, so
// the corner stays put. Every edit is one op, one undo step, checked by the kernel.
import type { DocState, Entity, Item, JointNote, KernelOp, V3 } from "../kernel/types";
import { objectsOp, objectsSubject, scaling } from "../tools/xform";
import { itemsOf } from "./entities";
import { solidName } from "./names";
import { describeNode, graphOf, nodeById, objectParent } from "./scope";

export interface Attributes {
  /** What is selected, as items (solids, groups, components). */
  items: Item[];
  objects: number[];
  nodes: number[];
  /** One item: its own name (null: none set). */
  name: string | null;
  /** How the pane titles it: "solid 3", "Leg (component)", "3 parts". */
  title: string;
  /** The box around everything selected (metres). */
  lo: V3;
  hi: V3;
  /** Shared by every selected item, else null; `mixed` when they differ. */
  material: string | null;
  tag: string | null;
  mixed: { material: boolean; tag: boolean };
  /** A material can be set: only solids carry one. */
  canMaterial: boolean;
  /** ADR-0015: the joints the selected parts were cut for, once each, with the part on the
   * other side of each (null when it is gone). */
  joints: { note: JointNote; partner: string | null }[];
}

/** The facts for the selection, or a sentence saying why there are none. */
export function attributesOf(selection: Entity[], state: DocState | null): Attributes | string {
  if (!state) return "The model is still loading.";
  const items = itemsOf(selection);
  if (!items.length) return selection.length ? "Select whole parts (solids, groups or components) to see their size and place." : "Select a part to see its name, size and where it sits.";
  const objects = items.flatMap((i) => ("object" in i ? [i.object] : []));
  const nodes = items.flatMap((i) => ("node" in i ? [i.node] : []));
  const g = graphOf(state);
  const subject = objectsSubject(objects, nodes, state);
  const covered = subject.kind === "objects" ? (subject.covered ?? objects) : objects;
  const boxes = state.solids.filter((s) => covered.includes(s.id));
  if (!boxes.length) return "That has no solid in it, so it has no size to show.";
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], b.min[k]);
      hi[k] = Math.max(hi[k], b.max[k]);
    }
  const info = new Map(state.object_info.map((o) => [o.id, o]));
  const facts = items.map((i) => {
    if ("object" in i) {
      const o = info.get(i.object);
      return { name: o?.name ?? null, tag: o?.tag ?? null, material: o?.material ?? null, title: o?.name ?? solidName(i.object) };
    }
    const n = nodeById(g, i.node);
    return { name: n?.name ?? null, tag: n?.tag ?? null, material: null, title: describeNode(g, i.node) };
  });
  // Joints: each once (copies of a component all remember the same one), and the part that
  // remembers the other side of it, named as the Outliner names it.
  const joints: Attributes["joints"] = [];
  const seen = new Set<string>();
  const nameOf = (object: number) => {
    const parent = objectParent(g, object);
    return info.get(object)?.name ?? (parent !== null ? describeNode(g, parent) : solidName(object));
  };
  for (const id of covered) {
    for (const note of info.get(id)?.joints ?? []) {
      const key = `${note.id}:${note.role}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const other = state.object_info.find((o) => !covered.includes(o.id) && o.joints?.some((j) => j.id === note.id && j.role !== note.role));
      joints.push({ note, partner: other ? nameOf(other.id) : null });
    }
  }
  const same = <K extends "tag" | "material">(k: K) => facts.every((f) => f[k] === facts[0][k]);
  const one = facts.length === 1;
  return {
    items,
    objects,
    nodes,
    name: one ? facts[0].name : null,
    title: one ? facts[0].title : `${facts.length} parts`,
    lo,
    hi,
    material: same("material") ? facts[0].material : null,
    tag: same("tag") ? facts[0].tag : null,
    mixed: { material: !same("material"), tag: !same("tag") },
    canMaterial: nodes.length === 0,
    joints,
  };
}

const subjectFor = (a: Attributes, state: DocState | null) => objectsSubject(a.objects, a.nodes, state);

/** Move the selection so its box's corner is at `value` along axis `k`, or null when it is there. */
export function positionOp(a: Attributes, state: DocState | null, k: 0 | 1 | 2, value: number): KernelOp | null {
  const d = value - a.lo[k];
  if (Math.abs(d) < 1e-9) return null;
  const t: V3 = [0, 0, 0];
  t[k] = d;
  const s = subjectFor(a, state);
  if (s.kind !== "objects") return null;
  return objectsOp(s, { linear: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], translation: t }, false);
}

/** Scale the selection along axis `k` to `value`, from its box's corner; a sentence when
 * that cannot be done, null when it is that size already. */
export function sizeOp(a: Attributes, state: DocState | null, k: 0 | 1 | 2, value: number): KernelOp | string | null {
  if (!(value > 0)) return "A size has to be more than zero.";
  const now = a.hi[k] - a.lo[k];
  if (now < 1e-9) return "That is flat along this axis, so it cannot be stretched to a size there.";
  if (Math.abs(value - now) < 1e-9) return null;
  const f: V3 = [1, 1, 1];
  f[k] = value / now;
  const s = subjectFor(a, state);
  if (s.kind !== "objects") return null;
  return objectsOp(s, scaling(a.lo, f), false);
}

const JOINT_NAMES: Record<JointNote["kind"], string> = { mortise_tenon: "Mortise and tenon", dado: "Dado", rabbet: "Rabbet", half_lap: "Half-lap" };

/** One joint in words, as the pane lists it: "Mortise and tenon into Leg: tenon 1/4 x 2 1/2 x 1 3/16". */
export function jointLine(j: Attributes["joints"][number], fmt: (m: number) => string): string {
  const n = j.note;
  const f = (nm: number) => fmt(nm * 1e-9);
  const name = JOINT_NAMES[n.kind];
  const other = j.partner ? (n.kind === "half_lap" ? ` with ${j.partner}` : n.role === "receives" ? ` for ${j.partner}` : ` into ${j.partner}`) : "";
  const fit = n.clearance_nm ? `, ${f(n.clearance_nm)} clearance` : "";
  switch (n.kind) {
    case "mortise_tenon":
      return `${name}${other}: ${n.role === "receives" ? "mortise" : "tenon"} ${f(n.thickness_nm)} x ${f(n.width_nm)} x ${f(n.depth_nm)}${n.through ? ", through" : ""}${fit}`;
    case "dado":
    case "rabbet":
      return `${name}${other}: ${f(n.thickness_nm)} wide, ${f(n.depth_nm)} deep${fit}`;
    case "half_lap":
      return `${name}${other}: ${n.role === "receives" ? f(n.depth_nm) : f(n.thickness_nm - n.depth_nm)} deep`;
  }
}
