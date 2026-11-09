import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  actionFor,
  actionForEvent,
  assignShortcut,
  clearShortcut,
  comboOf,
  keyOr,
  loadShortcuts,
  menuKeys,
  resetAllShortcuts,
  resetShortcut,
  shortcutProblem,
  shortcutsFor,
  withKey,
} from "./shortcuts";

const press = (key: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>> = {}) => new KeyboardEvent("keydown", { key, ...mods });

describe("keyboard shortcuts", () => {
  beforeEach(() => {
    localStorage.clear();
    loadShortcuts();
  });
  afterEach(() => vi.restoreAllMocks());

  it("spells a key press the way the menus do", () => {
    expect(comboOf(press("l"))).toBe("L");
    expect(comboOf(press(" "))).toBe("Space");
    expect(comboOf(press("S", { metaKey: true, shiftKey: true }))).toBe("Ctrl+Shift+S");
    expect(comboOf(press("s", { ctrlKey: true }))).toBe("Ctrl+S");
    expect(comboOf(press("Shift", { shiftKey: true }))).toBeNull();
  });

  it("answers the defaults, with Ctrl and Cmd alike", () => {
    expect(actionForEvent(press("l"))).toBe("line");
    expect(actionForEvent(press(" "))).toBe("select");
    expect(actionForEvent(press("s", { metaKey: true }))).toBe("save");
    expect(actionForEvent(press("S", { ctrlKey: true, shiftKey: true }))).toBe("saveAs");
    expect(actionForEvent(press("z", { metaKey: true, shiftKey: true }))).toBe("redo");
    expect(actionForEvent(press("y", { ctrlKey: true }))).toBe("redo");
    expect(actionForEvent(press("Z", { shiftKey: true }))).toBe("zoomExtents");
  });

  it("still reaches a tool with Shift held, as it always has", () => {
    expect(actionForEvent(press("L", { shiftKey: true }))).toBe("line");
  });

  it("lists the redo key each platform expects first", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    loadShortcuts();
    expect(menuKeys("redo")).toBe("Ctrl+Shift+Z");
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
    loadShortcuts();
    expect(menuKeys("redo")).toBe("Ctrl+Y");
  });

  it("moves a tool to a new key and frees the old one", () => {
    assignShortcut("line", "K");
    expect(actionForEvent(press("k"))).toBe("line");
    expect(actionForEvent(press("l"))).toBeUndefined();
  });

  it("takes a key from the action that held it, leaving that action without one", () => {
    assignShortcut("line", "R");
    expect(actionFor("R")).toBe("line");
    expect(shortcutsFor("rect")).toEqual([]);
  });

  it("keeps changes across a restart", () => {
    assignShortcut("save", "Ctrl+K");
    clearShortcut("erase");
    loadShortcuts();
    expect(shortcutsFor("save")).toEqual(["Ctrl+K"]);
    expect(shortcutsFor("erase")).toEqual([]);
  });

  it("resets one action, or all of them", () => {
    assignShortcut("line", "K");
    assignShortcut("rect", "J");
    resetShortcut("line");
    expect(shortcutsFor("line")).toEqual(["L"]);
    expect(shortcutsFor("rect")).toEqual(["J"]);
    resetAllShortcuts();
    expect(shortcutsFor("rect")).toEqual(["R"]);
    loadShortcuts();
    expect(shortcutsFor("rect")).toEqual(["R"]);
  });

  it("gives a default back its key only while nothing else claims it", () => {
    assignShortcut("line", "R");
    resetShortcut("rect");
    expect(shortcutsFor("line")).toEqual(["R"]);
    expect(shortcutsFor("rect")).toEqual([]);
  });

  it("refuses keys that would break typing, the system or a fixed job", () => {
    expect(shortcutProblem("line", "5")).toMatch(/Measurements box/);
    expect(shortcutProblem("line", "X")).toMatch(/Measurements box/);
    expect(shortcutProblem("line", "Shift+X")).toMatch(/Measurements box/);
    expect(shortcutProblem("line", "Ctrl+K")).toMatch(/single key/);
    expect(shortcutProblem("save", "K")).toMatch(/needs Ctrl/);
    expect(shortcutProblem("save", "Ctrl+Q")).toMatch(/system/);
    expect(shortcutProblem("save", "Ctrl+C")).toMatch(/system/);
    expect(shortcutProblem("line", "Escape")).toMatch(/fixed job/);
    expect(shortcutProblem("line", "Enter")).toMatch(/fixed job/);
    expect(shortcutProblem("line", "Alt+K")).toMatch(/plugins/);
    expect(shortcutProblem("line", "Shift+Space")).not.toBeNull();
  });

  it("accepts ordinary keys", () => {
    expect(shortcutProblem("line", "K")).toBeNull();
    expect(shortcutProblem("line", "Shift+K")).toBeNull();
    expect(shortcutProblem("line", "F2")).toBeNull();
    expect(shortcutProblem("line", "Space")).toBeNull();
    expect(shortcutProblem("save", "Ctrl+Shift+K")).toBeNull();
    expect(shortcutProblem("save", "Ctrl+1")).toBeNull();
  });

  it("drops saved values this build would refuse, and survives junk", () => {
    localStorage.setItem("sawhorse.shortcuts", JSON.stringify({ line: ["Ctrl+Q", "K"], nope: ["J"], rect: "R", save: ["K"] }));
    loadShortcuts();
    expect(shortcutsFor("line")).toEqual(["K"]);
    expect(shortcutsFor("rect")).toEqual(["R"]);
    expect(shortcutsFor("save")).toEqual([]);
    localStorage.setItem("sawhorse.shortcuts", "{not json");
    loadShortcuts();
    expect(shortcutsFor("line")).toEqual(["L"]);
  });

  it("never lets a tampered file give two actions one key", () => {
    localStorage.setItem("sawhorse.shortcuts", JSON.stringify({ line: ["K"], rect: ["K"] }));
    loadShortcuts();
    expect(shortcutsFor("line")).toEqual(["K"]);
    expect(shortcutsFor("rect")).toEqual([]);
  });

  it("names the current key in messages, or the way there without one", () => {
    expect(withKey("Push/Pull", "pushpull")).toBe("Push/Pull (P)");
    assignShortcut("pushpull", "J");
    expect(withKey("Push/Pull", "pushpull")).toBe("Push/Pull (J)");
    clearShortcut("pushpull");
    expect(withKey("Push/Pull", "pushpull")).toBe("Push/Pull");
    expect(keyOr("undo", "Edit > Undo")).toBe("Ctrl+Z");
    clearShortcut("undo");
    expect(keyOr("undo", "Edit > Undo")).toBe("Edit > Undo");
  });
});
