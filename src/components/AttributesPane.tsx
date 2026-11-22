// Attributes: the selection's name, where it sits and how big it is, typed straight into
// fields (the Channel Box idea from Maya). Enter or leaving a field applies it as one undo
// step; Esc puts the field back. The facts and ops live in src/lib/attributes.ts.
import { useRef, useState, type KeyboardEvent } from "react";
import type { EditResult } from "../kernel/client";
import type { DocState, Entity, KernelOp } from "../kernel/types";
import { attributesOf, positionOp, sizeOp } from "../lib/attributes";
import { quoted } from "../lib/scope";
import { formatLength, unitInfo, type UnitSystem } from "../lib/units";
import { parseVcb } from "../lib/vcb";

export interface AttributesPaneProps {
  state: DocState | null;
  selection: Entity[];
  units: UnitSystem;
  apply: (op: KernelOp, describe?: (r: EditResult) => string) => Promise<EditResult | null>;
  /** A field's own refusal (a size of zero, a value that is not a length). */
  onError: (text: string) => void;
}

const AXES = [
  { k: 0, label: "x", title: "Along red" },
  { k: 1, label: "y", title: "Along green" },
  { k: 2, label: "z", title: "Along blue" },
] as const;

/** A text field that applies on Enter or when left, and goes back on Esc. Keyed by its value
 * from outside, so a change made elsewhere (an undo, a Move) shows at once. */
function Field({ value, label, onCommit, align = "left", placeholder }: { value: string; label: string; onCommit: (text: string) => void; align?: "left" | "right"; placeholder?: string }) {
  const [text, setText] = useState(value);
  const [shown, setShown] = useState(value);
  /** The text already sent for this value: Enter then a blur (Tab, a click) sends it once,
   * not twice from the same stale facts while the kernel's answer is on its way. */
  const sent = useRef<string | null>(null);
  /** Esc was pressed: the blur it causes must not send what was typed. */
  const cancelled = useRef(false);
  if (shown !== value) {
    setShown(value);
    setText(value);
    sent.current = null;
  }
  const done = () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (text.trim() === value.trim() || text === sent.current) return;
    sent.current = text;
    onCommit(text);
  };
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    // Keys typed here are for the field, never the tools.
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      done();
      e.currentTarget.select();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelled.current = true;
      setText(value);
      e.currentTarget.blur();
    }
  };
  return <input className={`attr-field${align === "right" ? " num" : ""}`} aria-label={label} placeholder={placeholder} value={text} spellCheck={false} onChange={(e) => setText(e.target.value)} onKeyDown={key} onBlur={done} onFocus={(e) => e.currentTarget.select()} />;
}

export function AttributesPane({ state, selection, units, apply, onError }: AttributesPaneProps) {
  const a = attributesOf(selection, state);
  if (typeof a === "string") return <p className="note attr-empty">{a}</p>;
  const unit = unitInfo(units).short;
  const fmt = (m: number) => formatLength(m, units);
  const length = (text: string): number | null => {
    const r = parseVcb(text, units);
    if (!r.ok) {
      onError(r.error);
      return null;
    }
    if (r.value.kind !== "length") {
      onError("Type a length, such as 12 or 3/4.");
      return null;
    }
    return r.value.m;
  };
  const what = a.title;

  const setPosition = (k: 0 | 1 | 2, text: string) => {
    const m = length(text);
    if (m === null) return;
    const op = positionOp(a, state, k, m);
    if (op) void apply(op, () => `Moved ${what} so it starts at ${fmt(m)} ${unit} along ${AXES[k].label}.`);
  };
  const setSize = (k: 0 | 1 | 2, text: string) => {
    const m = length(text);
    if (m === null) return;
    const op = sizeOp(a, state, k, m);
    if (typeof op === "string") return onError(op);
    if (op) void apply(op, () => `Made ${what} ${fmt(m)} ${unit} along ${AXES[k].label}, from its lowest corner.`);
  };
  const setName = (text: string) => {
    const name = text.trim() || null;
    void apply({ op: "rename", item: a.items[0], name }, () => (name ? `Renamed it ${quoted(name)}.` : "Name cleared."));
  };
  const setMaterial = (material: string) => {
    const m = material || null;
    const ops: KernelOp[] = a.objects.map((object) => ({ op: "set_material", object, material: m }));
    void apply(ops.length === 1 ? ops[0] : { op: "batch", ops }, () => (m ? `${what}: ${m}.` : `${what}: no material of its own.`));
  };
  const setTag = (tag: string) => {
    const t = tag || null;
    void apply({ op: "tag_items", items: a.items, tag: t }, () => (t ? `${what} on tag ${quoted(t)}.` : `${what} untagged.`));
  };
  const materials = state?.materials.map((m) => m.name) ?? [];
  const tags = Object.keys(state?.tags ?? {});

  return (
    <div className="attrs" data-testid="attributes">
      <div className="attr-row">
        <span>Name</span>
        {a.items.length === 1 ? <Field value={a.name ?? ""} label="Name" placeholder={a.title} onCommit={setName} /> : <span className="attr-mixed">{a.title}: names are their own</span>}
      </div>
      <div className="attr-row">
        <span>Position</span>
        {AXES.map(({ k, label, title }) => (
          <label key={k} className={`attr-axis ax-${label}`} title={`${title}: where its lowest corner is`}>
            <i>{label}</i>
            <Field value={fmt(a.lo[k])} label={`Position ${label}`} align="right" onCommit={(t) => setPosition(k, t)} />
          </label>
        ))}
      </div>
      <div className="attr-row">
        <span>Size</span>
        {AXES.map(({ k, label, title }) => (
          <label key={k} className={`attr-axis ax-${label}`} title={`${title}: typed, it scales from the lowest corner`}>
            <i>{label}</i>
            <Field value={fmt(a.hi[k] - a.lo[k])} label={`Size ${label}`} align="right" onCommit={(t) => setSize(k, t)} />
          </label>
        ))}
      </div>
      <div className="attr-row">
        <span>Material</span>
        {a.canMaterial ? (
          <select aria-label="Material" value={a.mixed.material ? "\u0000" : (a.material ?? "")} onChange={(e) => setMaterial(e.target.value)}>
            {a.mixed.material ? <option value={"\u0000"} disabled>Mixed</option> : null}
            <option value="">None of its own</option>
            {materials.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        ) : (
          <span className="attr-mixed">Groups and components take paint inside them</span>
        )}
      </div>
      <div className="attr-row">
        <span>Tag</span>
        <select aria-label="Tag" value={a.mixed.tag ? "\u0000" : (a.tag ?? "")} onChange={(e) => setTag(e.target.value)}>
          {a.mixed.tag ? <option value={"\u0000"} disabled>Mixed</option> : null}
          <option value="">Untagged</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <p className="note">
        Sizes are in {unitInfo(units).name}. Position is the lowest corner; a new size stretches from it. Each change is one undo step.
      </p>
    </div>
  );
}
