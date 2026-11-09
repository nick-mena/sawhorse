// The keys a person can change (Edit > Keyboard Shortcuts…), kept per device. A combination is
// written as the menus write it: "L", "Shift+Z", "Ctrl+Shift+S". Ctrl means Ctrl or Cmd.
// Keys with a fixed job (Esc, Delete, the arrows, Enter and the value box's characters) are not here.

import { useSyncExternalStore } from "react";
import { isMac } from "./keys";
import { startsValueEntry, TOOLS, toolById, type BuiltinToolId, type ToolDef } from "./tools";

const STORAGE_KEY = "sawhorse.shortcuts";

export type CommandId = "open" | "save" | "saveAs" | "import" | "undo" | "redo" | "selectAll" | "group" | "explode" | "zoomExtents" | "feedback";
export type ActionId = BuiltinToolId | CommandId;
export type ShortcutGroup = "Tools" | "File" | "Edit" | "View" | "Help";

export interface ShortcutAction {
  id: ActionId;
  label: string;
  group: ShortcutGroup;
  /** "key" fires only outside text fields; "chord" holds Ctrl so it can fire from anywhere. */
  kind: "key" | "chord";
  defaults: string[];
}

function toolCombo(t: ToolDef): string[] {
  if (!t.key) return [];
  return [t.key === " " ? "Space" : t.key.toUpperCase()];
}

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  ...TOOLS.map((t): ShortcutAction => ({ id: t.id as BuiltinToolId, label: t.label, group: "Tools", kind: "key", defaults: toolCombo(t) })),
  { id: "open", label: "Open", group: "File", kind: "chord", defaults: ["Ctrl+O"] },
  { id: "save", label: "Save", group: "File", kind: "chord", defaults: ["Ctrl+S"] },
  { id: "saveAs", label: "Save As", group: "File", kind: "chord", defaults: ["Ctrl+Shift+S"] },
  { id: "import", label: "Import", group: "File", kind: "chord", defaults: ["Ctrl+I"] },
  { id: "undo", label: "Undo", group: "Edit", kind: "chord", defaults: ["Ctrl+Z"] },
  { id: "redo", label: "Redo", group: "Edit", kind: "chord", defaults: ["Ctrl+Y", "Ctrl+Shift+Z"] },
  { id: "selectAll", label: "Select All", group: "Edit", kind: "chord", defaults: ["Ctrl+A"] },
  { id: "group", label: "Make Group", group: "Edit", kind: "chord", defaults: ["Ctrl+G"] },
  { id: "explode", label: "Explode", group: "Edit", kind: "chord", defaults: ["Ctrl+Shift+G"] },
  { id: "zoomExtents", label: "Zoom Extents", group: "View", kind: "key", defaults: ["Shift+Z"] },
  { id: "feedback", label: "Log Feedback", group: "Help", kind: "chord", defaults: ["Ctrl+Shift+F"] },
];

const ACTION_BY_ID = new Map(SHORTCUT_ACTIONS.map((a) => [a.id, a]));
const TOOL_IDS = new Set<string>(TOOLS.map((t) => t.id));

/** Keys the system or text editing already answers: bound here, they would misfire or never arrive. */
const RESERVED_CHORDS = new Set(["Ctrl+Q", "Ctrl+W", "Ctrl+H", "Ctrl+M", "Ctrl+C", "Ctrl+V", "Ctrl+X", "Ctrl+R"]);

function defaultsOf(a: ShortcutAction): string[] {
  // Both redo keys work everywhere; each platform lists its own first.
  return a.id === "redo" && isMac() ? ["Ctrl+Shift+Z", "Ctrl+Y"] : a.defaults;
}

/** The combination a key press spells, or null for a modifier pressed alone. */
export function comboOf(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): string | null {
  if (["Shift", "Control", "Alt", "Meta", "CapsLock", "Dead", "Unidentified"].includes(e.key)) return null;
  const key = e.key === " " ? "Space" : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return [(e.ctrlKey || e.metaKey) && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", key].filter(Boolean).join("+");
}

/** Why a combination cannot be given to an action, as a sentence for the page; null when it can. */
export function shortcutProblem(id: ActionId, combo: string): string | null {
  const action = ACTION_BY_ID.get(id);
  if (!action) return "That command no longer exists.";
  const parts = combo.split("+");
  const key = parts.pop()!;
  const ctrl = parts.includes("Ctrl");
  if (parts.includes("Alt")) return "Alt combinations are kept for plugins. Try another key.";
  const letter = /^[A-Z]$/.test(key);
  const digit = /^[0-9]$/.test(key);
  if (!letter && !digit && !/^F([1-9]|1[0-2])$/.test(key) && key !== "Space") {
    return key.length === 1 ? "Use a letter, a number with Ctrl, or a function key." : `${key} has a fixed job in Sawhorse and can't be reassigned.`;
  }
  if (action.kind === "chord") {
    if (!ctrl) return `${action.label} needs Ctrl, so that it still works while a panel has focus.`;
    if (key === "Space") return "Ctrl+Space belongs to the system. Try another key.";
    if (RESERVED_CHORDS.has(combo)) return `${combo} already belongs to the system or to text editing. Try another key.`;
    return null;
  }
  if (ctrl) return `${action.label} uses a single key, with or without Shift.`;
  if (key === "Space" && parts.length) return "Shift+Space can't be told from Space by every tool. Try another key.";
  if (startsValueEntry(key)) return `${key} starts typing a value in the Measurements box. Try another key.`;
  return null;
}

// ---- the bindings ---------------------------------------------------------------------------

type Overrides = Partial<Record<ActionId, string[]>>;

let overrides: Overrides = {};
let byAction = new Map<ActionId, string[]>();
let byCombo = new Map<string, ActionId>();
let version = 0;
const listeners = new Set<() => void>();

/** Overrides win over defaults; a combination is only ever one action's, first in list order. */
function rebuild(): void {
  byAction = new Map();
  byCombo = new Map();
  const claimed = new Set(Object.values(overrides).flat());
  for (const a of SHORTCUT_ACTIONS) {
    const own = overrides[a.id];
    const combos = (own ?? defaultsOf(a).filter((c) => !claimed.has(c))).filter((c) => !byCombo.has(c));
    byAction.set(a.id, combos);
    for (const c of combos) byCombo.set(c, a.id);
  }
}

/** Read the saved keys again, dropping whatever is not a binding this build would accept. */
export function loadShortcuts(): void {
  const clean: Overrides = {};
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (saved && typeof saved === "object") {
      for (const [id, combos] of Object.entries(saved)) {
        if (!ACTION_BY_ID.has(id as ActionId) || !Array.isArray(combos)) continue;
        clean[id as ActionId] = combos.filter((c): c is string => typeof c === "string" && shortcutProblem(id as ActionId, c) === null);
      }
    }
  } catch {
    /* a per-device convenience only */
  }
  overrides = clean;
  rebuild();
}

function changed(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    /* a per-device convenience only */
  }
  rebuild();
  version++;
  listeners.forEach((f) => f());
}

export function shortcutsFor(id: ActionId): string[] {
  return byAction.get(id) ?? [];
}

export function isCustomised(id: ActionId): boolean {
  return overrides[id] !== undefined;
}

/** The action already holding a combination, if any. */
export function actionFor(combo: string): ActionId | undefined {
  return byCombo.get(combo);
}

/** Give an action this one combination, taking it from any action that held it. */
export function assignShortcut(id: ActionId, combo: string): void {
  const holder = byCombo.get(combo);
  if (holder && holder !== id) overrides[holder] = shortcutsFor(holder).filter((c) => c !== combo);
  overrides[id] = [combo];
  changed();
}

export function clearShortcut(id: ActionId): void {
  overrides[id] = [];
  changed();
}

export function resetShortcut(id: ActionId): void {
  delete overrides[id];
  changed();
}

export function resetAllShortcuts(): void {
  overrides = {};
  changed();
}

function subscribe(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** Re-renders a component when any binding changes; the number also keys memoised menus. */
export function useShortcutsVersion(): number {
  return useSyncExternalStore(subscribe, () => version);
}

// ---- answering a key press --------------------------------------------------------------------

/** The action a key press asks for. Shift held over a single-key action still reaches it. */
export function actionForEvent(e: KeyboardEvent): ActionId | undefined {
  const combo = comboOf(e);
  if (!combo) return undefined;
  const exact = byCombo.get(combo);
  if (exact || !combo.startsWith("Shift+")) return exact;
  const plain = byCombo.get(combo.slice("Shift+".length));
  return plain && ACTION_BY_ID.get(plain)?.kind === "key" ? plain : undefined;
}

export function toolForAction(id: ActionId | undefined): ToolDef | undefined {
  return id && TOOL_IDS.has(id) ? toolById(id as BuiltinToolId) : undefined;
}

// ---- naming keys in text ------------------------------------------------------------------------

/** The first key of an action, for a menu; undefined when it has none. */
export function menuKeys(id: ActionId): string | undefined {
  return shortcutsFor(id)[0];
}

/** "Push/Pull (P)", or just "Push/Pull" once its key is cleared. */
export function withKey(name: string, id: ActionId): string {
  const k = menuKeys(id);
  return k ? `${name} (${k})` : name;
}

/** "Ctrl+Z", or a way to reach the command without a key ("Edit > Undo"). */
export function keyOr(id: ActionId, fallback: string): string {
  return menuKeys(id) ?? fallback;
}

loadShortcuts();
