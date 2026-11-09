// Edit > Keyboard Shortcuts…: every key the app answers. A change applies and is saved at once,
// on this device; keys with a fixed job and a plugin's own keys are listed but not editable.
import { useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { platformText, shortcutLabel } from "../lib/keys";
import {
  actionFor,
  assignShortcut,
  clearShortcut,
  comboOf,
  isCustomised,
  resetAllShortcuts,
  resetShortcut,
  SHORTCUT_ACTIONS,
  shortcutProblem,
  shortcutsFor,
  useShortcutsVersion,
  type ActionId,
  type ShortcutAction,
  type ShortcutGroup,
} from "../lib/shortcuts";
import { useDialogFocus } from "./useDialogFocus";

export interface PluginShortcut {
  label: string;
  keys: string;
}

export interface ShortcutsDialogProps {
  plugins: PluginShortcut[];
  onClose: () => void;
}

const GROUPS: ShortcutGroup[] = ["Tools", "File", "Edit", "View", "Help"];

const FIXED: [string, string][] = [
  ["Esc", "Cancel the tool, clear the selection, or close a group"],
  ["Delete", "Erase the selection"],
  ["Enter", "Accept a typed value"],
  ["Arrow keys", "Lock to an axis or plane"],
  ["Shift (hold)", "Lock to the inference under the pointer"],
  ["Ctrl (tap)", "The tool's option, such as copy with Move"],
  ["Alt (tap)", "The tool's second option, such as autofold with Move"],
];

const plugged = (keys: string) => keys.replace(/\bMeta\b/g, "Ctrl");

export function ShortcutsDialog({ plugins, onClose }: ShortcutsDialogProps) {
  useShortcutsVersion();
  const dialog = useDialogFocus();
  const [capturing, setCapturing] = useState<ActionId | null>(null);
  const [problem, setProblem] = useState<{ id: ActionId; text: string } | null>(null);
  const [conflict, setConflict] = useState<{ id: ActionId; combo: string; holder: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const stopCapture = () => {
    setCapturing(null);
    setProblem(null);
    setConflict(null);
  };

  const capture = (e: ReactKeyboardEvent, id: ActionId) => {
    if (e.key === "Tab") {
      stopCapture();
      return;
    }
    e.preventDefault();
    if (e.repeat) return;
    if (e.key === "Escape") {
      stopCapture();
      return;
    }
    const combo = comboOf(e.nativeEvent);
    if (!combo) return;
    const refused = shortcutProblem(id, combo);
    const plugin = plugins.find((p) => plugged(p.keys) === combo);
    if (refused || plugin) {
      setConflict(null);
      setProblem({ id, text: refused ?? `${combo} belongs to ${plugin!.label}. Try another key.` });
      return;
    }
    const holder = actionFor(combo);
    if (holder && holder !== id) {
      setProblem(null);
      setConflict({ id, combo, holder: SHORTCUT_ACTIONS.find((a) => a.id === holder)!.label });
      return;
    }
    assignShortcut(id, combo);
    stopCapture();
  };

  const row = (a: ShortcutAction) => {
    const combos = shortcutsFor(a.id);
    const now = combos.map(shortcutLabel).join(" or ");
    const listening = capturing === a.id;
    return (
      <li key={a.id} data-action={a.id}>
        <div className="sc-row">
          <span className="sc-name">{a.label}</span>
          <button
            type="button"
            className="sc-key"
            data-listening={listening || undefined}
            aria-label={listening ? `Press the new key for ${a.label}` : `Change the key for ${a.label}, now ${now || "none"}`}
            onClick={() => {
              stopCapture();
              setCapturing(a.id);
            }}
            onKeyDown={listening ? (e) => capture(e, a.id) : undefined}
          >
            {listening ? "Press a key…" : now || "None"}
          </button>
          {listening ? (
            <>
              {combos.length ? (
                <button
                  type="button"
                  className="sc-act"
                  onClick={() => {
                    clearShortcut(a.id);
                    stopCapture();
                  }}
                >
                  Clear
                </button>
              ) : null}
              <button type="button" className="sc-act" onClick={stopCapture}>
                Cancel
              </button>
            </>
          ) : isCustomised(a.id) ? (
            <button type="button" className="sc-act" aria-label={`Reset ${a.label}`} onClick={() => resetShortcut(a.id)}>
              Reset
            </button>
          ) : null}
        </div>
        {problem?.id === a.id ? (
          <p className="note err" role="alert">
            {platformText(problem.text)}
          </p>
        ) : null}
        {conflict?.id === a.id ? (
          <p className="note sc-conflict" role="alert">
            <span>
              {shortcutLabel(conflict.combo)} is already {conflict.holder}.
            </span>
            <button
              type="button"
              className="sc-act"
              onClick={() => {
                assignShortcut(a.id, conflict.combo);
                stopCapture();
              }}
            >
              Use it for {a.label}
            </button>
          </p>
        ) : null}
      </li>
    );
  };

  return (
    <section
      ref={dialog}
      className="name-dialog shortcuts-dialog"
      role="dialog"
      aria-label="Keyboard Shortcuts"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" && !capturing) onClose();
      }}
    >
      <header>
        <b>Keyboard Shortcuts</b>
      </header>
      <p className="note">{platformText("Click a key to change it. Changes apply at once and are saved on this device.")}</p>
      <div className="sc-list">
        {GROUPS.map((g) => (
          <div key={g}>
            <h5>{g}</h5>
            <ul>{SHORTCUT_ACTIONS.filter((a) => a.group === g).map(row)}</ul>
          </div>
        ))}
        {plugins.length ? (
          <div>
            <h5>Plugins</h5>
            <ul>
              {plugins.map((p) => (
                <li key={p.label}>
                  <div className="sc-row">
                    <span className="sc-name">{p.label}</span>
                    <kbd>{shortcutLabel(p.keys)}</kbd>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div>
          <h5>Fixed keys</h5>
          <ul>
            {FIXED.map(([key, what]) => (
              <li key={key}>
                <div className="sc-row">
                  <span className="sc-name">{platformText(what)}</span>
                  <kbd>{platformText(key)}</kbd>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="btnrow">
        <button
          type="button"
          className="btn"
          onClick={() => {
            if (!confirmReset) {
              setConfirmReset(true);
              return;
            }
            resetAllShortcuts();
            stopCapture();
            setConfirmReset(false);
          }}
          onBlur={() => setConfirmReset(false)}
        >
          {confirmReset ? "Click again to reset all" : "Reset all"}
        </button>
        <button type="button" className="btn primary" onClick={onClose}>
          Done
        </button>
      </div>
    </section>
  );
}
