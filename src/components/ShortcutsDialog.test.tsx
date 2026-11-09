import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadShortcuts, shortcutsFor } from "../lib/shortcuts";
import { ShortcutsDialog } from "./ShortcutsDialog";

const keyFor = (name: string) => screen.getByRole("button", { name: new RegExp(`key for ${name}(,|$)`) });
const listen = (name: string) => fireEvent.click(keyFor(name));

describe("the Keyboard Shortcuts page", () => {
  beforeEach(() => {
    localStorage.clear();
    loadShortcuts();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const open = (plugins: { label: string; keys: string }[] = [], onClose = () => {}) => render(<ShortcutsDialog plugins={plugins} onClose={onClose} />);

  it("shows every group, the current keys and the fixed keys", () => {
    open();
    for (const h of ["Tools", "File", "Edit", "View", "Fixed keys"]) expect(screen.getByRole("heading", { name: h })).toBeTruthy();
    expect(keyFor("Line").textContent).toBe("L");
    expect(keyFor("Section").textContent).toBe("None");
    expect(screen.getByText("Erase the selection")).toBeTruthy();
  });

  it("changes a key and saves it at once", () => {
    open();
    listen("Line");
    expect(keyFor("Line").textContent).toBe("Press a key…");
    fireEvent.keyDown(keyFor("Line"), { key: "k" });
    expect(keyFor("Line").textContent).toBe("K");
    expect(shortcutsFor("line")).toEqual(["K"]);
    loadShortcuts();
    expect(shortcutsFor("line")).toEqual(["K"]);
  });

  it("waits through modifiers for the real key", () => {
    open();
    listen("Save");
    fireEvent.keyDown(keyFor("Save"), { key: "Shift", shiftKey: true });
    expect(keyFor("Save").textContent).toBe("Press a key…");
    fireEvent.keyDown(keyFor("Save"), { key: "K", ctrlKey: true, shiftKey: true });
    expect(shortcutsFor("save")).toEqual(["Ctrl+Shift+K"]);
  });

  it("explains a refused key and keeps listening", () => {
    open();
    listen("Line");
    fireEvent.keyDown(keyFor("Line"), { key: "5" });
    expect(screen.getByRole("alert").textContent).toMatch(/Measurements box/);
    expect(shortcutsFor("line")).toEqual(["L"]);
    fireEvent.keyDown(keyFor("Line"), { key: "k" });
    expect(shortcutsFor("line")).toEqual(["K"]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("asks before taking a key from another action", () => {
    open();
    listen("Line");
    fireEvent.keyDown(keyFor("Line"), { key: "r" });
    expect(screen.getByRole("alert").textContent).toMatch(/already Rect/);
    expect(shortcutsFor("line")).toEqual(["L"]);
    fireEvent.click(screen.getByRole("button", { name: "Use it for Line" }));
    expect(shortcutsFor("line")).toEqual(["R"]);
    expect(shortcutsFor("rect")).toEqual([]);
  });

  it("refuses a key a running plugin holds", () => {
    open([{ label: "Box: Make", keys: "Meta+K" }]);
    expect(screen.getByRole("heading", { name: "Plugins" })).toBeTruthy();
    listen("Save");
    fireEvent.keyDown(keyFor("Save"), { key: "k", metaKey: true });
    expect(screen.getByRole("alert").textContent).toMatch(/belongs to Box: Make/);
    expect(shortcutsFor("save")).toEqual(["Ctrl+S"]);
  });

  it("Esc cancels listening first, then closes the page", () => {
    const onClose = vi.fn();
    open([], onClose);
    listen("Line");
    fireEvent.keyDown(keyFor("Line"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(keyFor("Line").textContent).toBe("L");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("clears a key, and resets one or all", () => {
    open();
    listen("Line");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(keyFor("Line").textContent).toBe("None");
    fireEvent.click(screen.getByRole("button", { name: "Reset Line" }));
    expect(keyFor("Line").textContent).toBe("L");
    listen("Rect");
    fireEvent.keyDown(keyFor("Rect"), { key: "j" });
    const all = screen.getByRole("button", { name: "Reset all" });
    fireEvent.click(all);
    expect(shortcutsFor("rect")).toEqual(["J"]);
    fireEvent.click(screen.getByRole("button", { name: "Click again to reset all" }));
    expect(shortcutsFor("rect")).toEqual(["R"]);
  });
});
