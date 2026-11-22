// Loop Cut (K). Point at a face near one of its edges: a ring shows where a cut across that
// edge would run all the way around the part. Click to draw it, or type a distance (from
// the end of the edge nearer the pointer; a ring already cut counts as an end) and press
// Enter, or type /4 to divide the edge into four equal parts with three rings. Typing
// straight after a cut, before pointing at another edge, moves that cut.
//
// The ring is drawn as edges on every face the cut crosses, so each band between two rings
// can be pushed or pulled on its own: a tenon's shoulder, where a taper starts, a bead.
// The kernel does the cut (one op, one undo step) and says why when it cannot.
import type { Entity, KernelOp, MeshData, V3 } from "../kernel/types";
import { solidName } from "../lib/names";
import { scopeEntity } from "../lib/scope";
import { parseVcb } from "../lib/vcb";
import { add, dot, len, mul, sub, unit } from "./draw";
import { EMPTY_VIEW, Tool, type ToolEvent, type ToolView } from "./tool";

/** The edge a cut runs across, and where along it. */
export interface Aim {
  object: number;
  /** The end the distance is measured from (the one nearer the pointer), the edge's
   * direction from there, and its length. */
  from: V3;
  toward: V3;
  length: number;
  /** Distance from `from` to the cut. */
  d: number;
}

/** Where the cut plane sits for a distance along the aim's edge. */
export const cutAt = (a: Aim, d: number): V3 => add(a.from, mul(a.toward, d));

/** Distance from `q` to segment a-b, and the parameter of the nearest point. */
function nearest(q: V3, a: V3, b: V3): { dist: number; t: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(q, a), ab) / l2)) : 0;
  return { dist: len(sub(q, add(a, mul(ab, t)))), t };
}

const p3 = (f: Float32Array, i: number): V3 => [f[i], f[i + 1], f[i + 2]];

/** The most cuts one `/n` makes (n - 1 rings): past this it is a slip of the keys, not a plan. */
export const MAX_DIVIDE = 100;

/** Per mesh (each edit sends a new one), each solid's edges and triangles, worked out once:
 * the pointer moves far more often than the model changes. */
const parts = new WeakMap<MeshData, Map<number, { edges: [V3, V3][]; tris: number[] }>>();
function partOf(mesh: MeshData, object: number): { edges: [V3, V3][]; tris: number[] } {
  let byObject = parts.get(mesh);
  if (!byObject) {
    byObject = new Map();
    for (let k = 0; k < mesh.edgeOwner.length; k++) {
      const o = mesh.edgeOwners[mesh.edgeOwner[k]];
      if (o?.kind !== "object") continue;
      if (!byObject.has(o.id)) byObject.set(o.id, { edges: [], tris: [] });
      byObject.get(o.id)!.edges.push([p3(mesh.edges, k * 6), p3(mesh.edges, k * 6 + 3)]);
    }
    for (let t = 0; t < mesh.faceIds.length; t++) {
      const part = mesh.parts[mesh.faceIds[t]];
      if (part?.kind !== "face") continue;
      if (!byObject.has(part.owner)) byObject.set(part.owner, { edges: [], tris: [] });
      byObject.get(part.owner)!.tris.push(t);
    }
    parts.set(mesh, byObject);
  }
  return byObject.get(object) ?? { edges: [], tris: [] };
}

/** The edges of solid `object` in the mesh, as segments. */
export function edgesOf(mesh: MeshData, object: number): [V3, V3][] {
  return partOf(mesh, object).edges;
}

/** Where the plane through `origin` across `normal` meets solid `object`'s faces: the ring
 * the cut would draw, as segment pairs (for the preview). */
export function ringOf(mesh: MeshData, object: number, origin: V3, normal: V3): V3[] {
  const out: V3[] = [];
  const side = (p: V3) => dot(sub(p, origin), normal);
  for (const t of partOf(mesh, object).tris) {
    const v = [0, 1, 2].map((k) => p3(mesh.positions, mesh.indices[t * 3 + k] * 3));
    const s = v.map(side);
    const hits: V3[] = [];
    for (let k = 0; k < 3; k++) {
      const [i, j] = [k, (k + 1) % 3];
      if ((s[i] < 0 && s[j] > 0) || (s[i] > 0 && s[j] < 0)) hits.push(add(v[i], mul(sub(v[j], v[i]), s[i] / (s[i] - s[j]))));
    }
    if (hits.length === 2) out.push(hits[0], hits[1]);
  }
  return out;
}

/** The edge to cut across for a pointer event, or null when it is not on a solid. */
export function aimFor(e: ToolEvent, mesh: MeshData | null, entity: Entity | null): Aim | null {
  if (!mesh || !e.picked) return null;
  let object: number;
  let edge: [V3, V3] | null = null;
  if (entity?.kind === "edge" && entity.owner.kind === "object") {
    object = entity.owner.id;
    edge = [entity.a, entity.b];
  } else if (entity?.kind === "face") {
    object = entity.object;
  } else return null;
  const hit = e.picked.point;
  if (!edge) {
    // The face's own edges: those lying in its plane. The nearest one is the one aimed at.
    const s = e.picked.surface;
    if (!s || s.at.kind !== "face") return null;
    const { origin, normal } = s.frame;
    const onFace = (p: V3) => Math.abs(dot(sub(p, origin), normal)) < 1e-5;
    let best = Infinity;
    for (const [a, b] of edgesOf(mesh, object)) {
      if (!onFace(a) || !onFace(b)) continue;
      const n = nearest(hit, a, b);
      if (n.dist < best) {
        best = n.dist;
        edge = [a, b];
      }
    }
    if (!edge) return null;
  }
  const [a, b] = edge;
  const length = len(sub(b, a));
  if (length < 1e-6) return null;
  // A snap on the edge (its midpoint, say) places the cut exactly there.
  const at = e.snap && e.snap.kind !== "free" && nearest(e.snap.point, a, b).dist < 1e-6 ? e.snap.point : hit;
  const t = nearest(at, a, b).t;
  return t <= 0.5 ? { object, from: a, toward: unit(sub(b, a)), length, d: t * length } : { object, from: b, toward: unit(sub(a, b)), length, d: (1 - t) * length };
}

export class LoopCutTool extends Tool {
  readonly id = "loopcut" as const;
  private aim: Aim | null = null;
  private ring: V3[] = [];
  private working = false;
  /** The last cut, while nothing has moved since: a typed value moves it. `depth` is the
   * undo depth it left, so any other edit or an undo since lets go of it (an undo then
   * would take back that edit, not the cut). */
  private last: { aim: Aim; ds: number[]; depth: number | undefined } | null = null;

  valueLabel(): string {
    return "Distance";
  }

  activate(): void {
    this.host.status("Point at a face near the edge to cut across, then click. Or type a distance from the nearer end, or /4 to divide it.");
  }

  reset(): void {
    this.aim = null;
    this.ring = [];
    this.working = false;
    this.last = null;
  }

  onEvent(e: ToolEvent): void {
    const h = this.host;
    if (e.type === "leave") {
      this.aim = null;
      this.ring = [];
      h.hover(null);
      return h.changed();
    }
    if (e.type === "move") {
      const scoped = scopeEntity(e.picked?.entity ?? null, h.state());
      const aim = aimFor(e, h.mesh(), scoped);
      const was = this.aim;
      this.aim = aim;
      // Pointing at another edge (or off the part) lets go of the last cut, so the next value
      // makes a new one; sliding along the same edge keeps it, to move it by typing.
      const same = (x: Aim | null) => x !== null && aim !== null && x.object === aim.object && len(sub(x.from, aim.from)) < 1e-9 && len(sub(x.toward, aim.toward)) < 1e-9;
      if (this.last && !same(this.last.aim) && !same(was)) this.last = null;
      this.ring = aim ? ringOf(h.mesh()!, aim.object, cutAt(aim, aim.d), aim.toward) : [];
      h.hover(aim ? { kind: "object", object: aim.object } : null);
      if (aim) h.showValue(h.fmt(aim.d));
      return h.changed();
    }
    if (e.type !== "click" || this.working) return;
    const raw = e.picked?.entity ?? null;
    if (raw && !this.aim) {
      const scoped = scopeEntity(raw, h.state());
      if (scoped?.kind === "node") return void h.status("That is inside a group or component that is not open. Double-click it to edit inside it.", true);
      return void h.status("Point at a face of a solid, near the edge to cut across.", true);
    }
    if (!this.aim) return;
    void this.cut(this.aim, [this.aim.d], false);
  }

  onValue(text: string): void {
    const h = this.host;
    const r = parseVcb(text, h.units());
    if (!r.ok) return void h.status(r.error, true);
    const again = this.last && this.last.depth === h.state()?.undo_depth ? this.last : null;
    if (!again) this.last = null;
    const aim = again?.aim ?? this.aim;
    if (!aim) return void h.status("Point at a face near the edge to cut across, then type the distance.", true);
    let ds: number[];
    if (r.value.kind === "length") {
      if (r.value.m <= 0 || r.value.m >= aim.length) return void h.status(`That is not along the edge: it is ${h.fmt(aim.length)} ${h.unitLabel()} long. Type a distance between its ends.`, true);
      ds = [r.value.m];
    } else if (r.value.kind === "divide") {
      const n = r.value.parts;
      if (n < 2) return void h.status("Type /2 or more to divide the edge into equal parts.", true);
      if (n > MAX_DIVIDE) return void h.status(`Loop Cut divides an edge into at most ${MAX_DIVIDE} parts at a time.`, true);
      ds = Array.from({ length: n - 1 }, (_, k) => (aim.length * (k + 1)) / n);
    } else return void h.status("Loop Cut takes a distance from the nearer end of the edge, or /4 to divide it into four.", true);
    void this.cut(aim, ds, again !== null);
  }

  private async cut(aim: Aim, ds: number[], replace: boolean): Promise<void> {
    const h = this.host;
    const prev = this.last;
    const cuts: KernelOp[] = ds.map((d) => ({ op: "loop_cut", object: aim.object, origin: cutAt(aim, d), normal: aim.toward }));
    const op: KernelOp = cuts.length === 1 ? cuts[0] : { op: "batch", ops: cuts };
    this.working = true;
    if (replace && !(await h.apply({ op: "undo" }))) {
      this.working = false;
      return;
    }
    const where = ds.length === 1 ? `${h.fmt(ds[0])} ${h.unitLabel()} from the end` : `${ds.length} rings, ${ds.length + 1} equal parts`;
    const r = await h.apply(op, () => `Loop cut ${solidName(aim.object)}: ${where}. Push/Pull a band between rings, or type a distance to move the cut.`);
    // Moving a cut that the kernel then refuses puts the first cut back, so a refusal never
    // costs the cut that was there (the refusal stays on the status line).
    if (!r && replace) {
      const said = h.lastError();
      await h.apply({ op: "redo" });
      if (said) h.status(said, true);
    }
    this.working = false;
    this.last = r ? { aim, ds, depth: r.scene.state.undo_depth } : replace ? prev : null;
    this.ring = [];
    h.changed();
  }

  view(): ToolView {
    if (!this.ring.length) return EMPTY_VIEW;
    return { ...EMPTY_VIEW, overlay: [{ kind: "segments", points: this.ring, color: "--sel", width: 3 }] };
  }
}
