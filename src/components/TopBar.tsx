import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { shortcutLabel } from "../lib/keys";
import { usePlacedMenu } from "../lib/menuPlace";

// "Plugins" (lane 11) sits after Tools: commands from enabled plugins, and managing them.
const MENUS = ["File", "Edit", "View", "Draw", "Tools", "Plugins", "Window", "Help"];

/** One entry in a drop-down menu ("-" is a separator; `items` opens a submenu). */
export type MenuItem =
  | "-"
  | {
      label: string;
      /** Shortcut shown on the right (display only; the app owns the keys). */
      keys?: string;
      checked?: boolean;
      disabled?: boolean;
      /** Shown as a tooltip and to screen readers. */
      title?: string;
      onSelect: () => void;
    }
  | { label: string; items: MenuItem[]; disabled?: boolean };

export interface TopBarProps {
  /** Buttons for the side panel's panes, at the right (Maya's panel toggles). */
  docks?: DockButton[];
  /** Credits on this device; null while the render service is not connected. */
  credits: number | null;
  /** Lane 15: the chip is shown only when renders are on (a service set and answering). */
  showCredits?: boolean;
  /** Connection state of the render service (data attribute and tooltip). */
  creditsState?: string;
  creditsTitle?: string;
  /** Click on the chip (opens the Render pane). */
  onCredits?: () => void;
  /** Drop-down contents by menu name; menus without an entry stay inert, as in the mock. */
  menus?: Partial<Record<string, MenuItem[]>>;
  /** The open file, always in view. */
  docName?: string;
  /** "Edited" or "Saved 2:14 PM"; null when nothing has happened yet. */
  docState?: string | null;
}

/**
 * A drop-down or submenu, fixed to the window and kept inside it. Fixed rather than absolute so
 * a parent that scrolls (a long menu, the viewport's menu row) cannot clip it.
 */
function DropMenu({ kind, label, children }: { kind: "below" | "side"; label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  usePlacedMenu(ref, () => {
    const host = ref.current?.parentElement;
    if (!host) return null;
    const box = host.getBoundingClientRect();
    if (kind === "below") return { kind, box };
    // A submenu sits beside the whole parent menu, not just its entry, so it clears the
    // parent's scrollbar when that menu is capped and scrolls.
    const parent = host.closest(".drop")?.getBoundingClientRect() ?? box;
    return { kind, box: { top: box.top, bottom: box.bottom, left: parent.left, right: parent.right } };
  });
  return (
    <div ref={ref} className={kind === "side" ? "drop sub" : "drop"} role="menu" aria-label={label}>
      {children}
    </div>
  );
}

function Entry({ item: it, sub, setSub, close }: { item: MenuItem; sub: string | null; setSub: (s: string | null) => void; close: (byKeyboard: boolean) => void }) {
  if (it === "-") return <hr />;
  if ("items" in it) {
    const isOpen = sub === it.label;
    // Pointing opens the submenu and a click (or Enter) opens it too; a click never closes it.
    // It used to toggle, so the usual point-then-click shut the submenu the pointer had just
    // opened, and whether a fast click did depended on whether React had rendered the hover
    // yet (a red CI run, plugins-ui.spec). Esc, a click outside or another entry closes it.
    return (
      <span className="subwrap" onMouseEnter={() => !it.disabled && setSub(it.label)}>
        <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={isOpen} disabled={it.disabled} onClick={() => setSub(it.label)}>
          <span>{it.label}</span>
          <kbd aria-hidden="true">▸</kbd>
        </button>
        {isOpen ? (
          <DropMenu kind="side" label={it.label}>
            {it.items.map((x, k) => (
              <Entry key={k} item={x} sub={null} setSub={() => {}} close={close} />
            ))}
          </DropMenu>
        ) : null}
      </span>
    );
  }
  return (
    <button
      type="button"
      role={it.checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={it.checked}
      disabled={it.disabled}
      title={it.title}
      onMouseEnter={() => setSub(null)}
      onClick={(e) => {
        close(e.detail === 0);
        it.onSelect();
      }}
    >
      <span>
        {it.checked === undefined ? "" : it.checked ? "✓ " : "   "}
        {it.label}
      </span>
      {it.keys ? <kbd>{shortcutLabel(it.keys)}</kbd> : null}
    </button>
  );
}

/** A row of drop-down menus: the window's (File, Edit…) or a viewport panel's (View, Shading…). */
export function MenuBar({ names, menus, label, prefix }: { names: string[]; menus?: Partial<Record<string, MenuItem[]>>; label: string; prefix?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const [sub, setSub] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => setSub(null), [open]);

  // Chosen from the keyboard, focus goes back to the menu's own button, not lost with the
  // entry (and a dialog the entry opens returns it there). A mouse user's Space stays a tool key.
  const closeMenu = (byKeyboard: boolean) => {
    if (byKeyboard) navRef.current?.querySelector<HTMLElement>('button[aria-expanded="true"]')?.focus();
    setOpen(null);
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof PointerEvent && navRef.current?.contains(e.target as Node)) return;
      setOpen(null);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <nav className="menu" aria-label={label} ref={navRef}>
      {names.map((m) => {
        const items = menus?.[m];
        return (
          <span key={m} style={{ position: "relative" }}>
            <button
              type="button"
              aria-haspopup={items ? "menu" : undefined}
              aria-expanded={items ? open === m : undefined}
              // A second row of menus (the viewport's) says whose they are, so "View" here and
              // the window's View menu are told apart by screen readers.
              aria-label={prefix ? `${prefix} ${m}` : undefined}
              onClick={() => items && setOpen(open === m ? null : m)}
            >
              {m}
            </button>
            {items && open === m ? (
              <DropMenu kind="below" label={m}>
                {items.map((it, i) => (
                  <Entry key={i} item={it} sub={sub} setSub={setSub} close={closeMenu} />
                ))}
              </DropMenu>
            ) : null}
          </span>
        );
      })}
    </nav>
  );
}

/** A button in the top bar that brings a side-panel pane forward (or puts the panel away). */
export interface DockButton {
  id: string;
  label: string;
  glyph: ReactElement;
  pressed: boolean;
  onClick: () => void;
}

export function TopBar({ credits, showCredits = true, creditsState, creditsTitle, onCredits, menus, docName, docState, docks = [] }: TopBarProps) {
  return (
    <header className="top">
      <MenuBar names={MENUS} menus={menus} label="Menu" />
      <div className="spacer"></div>
      {docName ? (
        <div className="doc-state" data-testid="doc-state" data-edited={docState === "Edited" || undefined}>
          <b title={docName}>{docName}</b>
          {docState ? <span>{docState}</span> : null}
        </div>
      ) : null}
      <div className="spacer"></div>
      {docks.length ? (
        <div className="docks" role="group" aria-label="Panels">
          {docks.map((d) => (
            <button key={d.id} type="button" className="dock" aria-label={d.label} title={d.pressed ? `${d.label}: press again to put the panel away` : d.label} aria-pressed={d.pressed} data-dock={d.id} onClick={d.onClick}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {d.glyph}
              </svg>
            </button>
          ))}
        </div>
      ) : null}
      {showCredits ? (
      <button type="button" className="chip" title={creditsTitle ?? "Render credits on this device"} data-state={creditsState} onClick={onCredits}>
        Credits <b id="credits">{credits ?? "—"}</b>
      </button>
      ) : null}
    </header>
  );
}
