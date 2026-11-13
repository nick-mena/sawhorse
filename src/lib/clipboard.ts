// Copy, Cut and Paste within one document. The clipboard holds what to copy, by id, and not
// the geometry: Paste is then Move's copy, one op that replays from the log like any other.
// Cut is the same with a move instead of a copy, so what is cut stays in the model until it
// is pasted (as a spreadsheet's cut does); deleting it first would need geometry kept outside
// the document, which the log could not replay.
import type { DocState, Entity, MeshData, V3 } from "../kernel/types";
import { objectOf, partsOf, sketchEdges } from "./entities";
import { graphOf } from "./scope";
import { boundsOf, isSketchEntity, loadOutlines, meshNear, subjectOf, type SketchPart, type SketchPreview, type Subject } from "../tools/xform";
import type { ToolHost } from "../tools/tool";

export type ClipSubject = Extract<Subject, { kind: "objects" }>;

export interface Clip {
  subject: ClipSubject;
  cut: boolean;
}

/** A face, edge or point cannot be copied by itself: its whole solid is. */
function whole(e: Entity): Entity {
  if (e.kind === "object" || e.kind === "node" || isSketchEntity(e)) return e;
  const object = objectOf(e);
  return object === null ? e : { kind: "object", object };
}

const copyable = (e: Entity) => e.kind === "object" || e.kind === "node" || isSketchEntity(e);

/** The selection as a clip, or the sentence saying why it cannot be. */
export async function takeClip(h: Pick<ToolHost, "selection" | "outline" | "state">, cut: boolean): Promise<Clip | string> {
  const seen = new Set<string>();
  const items = h.selection().map(whole).filter((e) => {
    const key = JSON.stringify(e);
    if (seen.has(key) || !copyable(e)) return false;
    seen.add(key);
    return true;
  });
  if (!items.length) return h.selection().length ? "Copy takes solids, groups, components and sketch shapes, not guides, dimensions or section planes." : "Select what to copy first.";
  const outlines = await loadOutlines((t) => h.outline(t), items, null);
  const subject = subjectOf(items, null, outlines, h.state());
  if (typeof subject === "string") return subject;
  if (subject.kind !== "objects") return "Copy takes whole solids, groups, components and sketch shapes.";
  return { subject, cut };
}

/** A sketch part as copied is still what is in the sketch: its regions, edges and points. */
function sketchPartAlive(part: SketchPart, mesh: MeshData | null): boolean {
  if (part.regions.some((region) => !partsOf({ kind: "region", sketch: part.sketch, region }, mesh).length)) return false;
  const all = sketchEdges(part.sketch, mesh);
  const same = ([a, b]: [V3, V3], [c, d]: [V3, V3]) => (meshNear(a, c) && meshNear(b, d)) || (meshNear(a, d) && meshNear(b, c));
  return part.edges.every((e) => all.some((x) => same(e, x))) && part.moving.every((p) => all.some(([a, b]) => meshNear(p, a) || meshNear(p, b)));
}

/** Everything in the clip is still there as it was copied (it may have been erased, undone
 * or redrawn since). A solid may have moved: it is found by id and copied from where it is. */
export function clipAlive(s: ClipSubject, state: DocState | null, mesh: MeshData | null = null): boolean {
  if (!state) return false;
  const solids = new Set(state.solids.map((x) => x.id));
  const nodes = new Set(graphOf(state).nodes.map((x) => x.id));
  const sketches = new Set(state.sketches.map((x) => x.id));
  return s.objects.every((o) => solids.has(o)) && (s.nodes ?? []).every((n) => nodes.has(n)) && (s.sketches ?? []).every((p) => sketches.has(p.sketch) && sketchPartAlive(p, mesh));
}

/** Every corner of the triangles that draw these parts. */
function partPoints(parts: number[], mesh: MeshData): V3[] {
  const wanted = new Set(parts);
  const { faceIds, indices, positions: p } = mesh;
  const out: V3[] = [];
  for (let t = 0; t < faceIds.length; t++) {
    if (!wanted.has(faceIds[t])) continue;
    for (let c = 0; c < 3; c++) {
      const i = indices[3 * t + c];
      out.push([p[3 * i], p[3 * i + 1], p[3 * i + 2]]);
    }
  }
  return out;
}

/** The point the cursor carries: the middle of the clip's footprint, at its lowest point, so
 * a pasted part sits on what the cursor is on. Null when nothing of it is drawn. */
export function clipBase(s: ClipSubject, state: DocState | null, previews: SketchPreview[], mesh: MeshData | null = null): V3 | null {
  const solids = new Set(s.covered ?? s.objects);
  const points: V3[] = (state?.solids ?? []).filter((x) => solids.has(x.id)).flatMap((x) => [x.min, x.max]);
  for (const p of previews) for (const [a, b] of p.edges) points.push(a, b);
  // Imported geometry that is not a solid has no listed bounds: what is drawn says.
  if (!points.length && mesh) for (const node of s.nodes ?? []) points.push(...partPoints(partsOf({ kind: "node", node }, mesh, graphOf(state)), mesh));
  const bounds = boundsOf(points);
  if (!bounds) return null;
  const [lo, hi] = bounds;
  return [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]];
}
