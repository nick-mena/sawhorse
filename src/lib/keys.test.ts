import { afterEach, describe, expect, it, vi } from "vitest";
import { platformText, shortcutLabel } from "./keys";

const on = (platform: string) => vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);

describe("shortcuts on screen", () => {
  afterEach(() => vi.restoreAllMocks());

  it("on a Mac, menus use the Mac's symbols in the Mac's order", () => {
    on("MacIntel");
    expect(shortcutLabel("Ctrl+S")).toBe("⌘S");
    expect(shortcutLabel("Ctrl+Shift+G")).toBe("⇧⌘G");
    expect(shortcutLabel("Alt+Shift+K")).toBe("⌥⇧K");
    expect(shortcutLabel("Shift+Z")).toBe("⇧Z");
    expect(shortcutLabel("Ctrl+Shift+Z")).toBe("⇧⌘Z");
  });

  it("on a Mac, keys with no Mac symbol stay as written", () => {
    on("MacIntel");
    expect(shortcutLabel("Delete")).toBe("Delete");
    expect(shortcutLabel("Esc")).toBe("Esc");
    expect(shortcutLabel("Meta+K")).toBe("Meta+K");
  });

  it("on a Mac, sentences say Cmd", () => {
    on("MacIntel");
    expect(platformText("Ctrl softens and smooths, Ctrl+Shift+click unsoftens.")).toBe("Cmd softens and smooths, Cmd+Shift+click unsoftens.");
  });

  it("elsewhere nothing changes", () => {
    on("Win32");
    expect(shortcutLabel("Ctrl+Shift+S")).toBe("Ctrl+Shift+S");
    expect(shortcutLabel("Ctrl+Y")).toBe("Ctrl+Y");
    expect(platformText("Ctrl copies.")).toBe("Ctrl copies.");
  });
});
