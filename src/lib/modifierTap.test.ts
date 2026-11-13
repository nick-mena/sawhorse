import { describe, expect, it } from "vitest";
import { ModifierTap } from "./modifierTap";

const down = (key: string, mods: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean } = {}, repeat = false) => ({ key, repeat, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

describe("ModifierTap", () => {
  it("answers when the key comes up alone", () => {
    const t = new ModifierTap();
    t.press(down("Control", { ctrlKey: true }), true);
    expect(t.release("Control")).toBe("ctrl");
    t.press(down("Alt", { altKey: true }), true);
    expect(t.release("Alt")).toBe("alt");
  });

  it("a shortcut held with it is not a tap", () => {
    const t = new ModifierTap();
    t.press(down("Control", { ctrlKey: true }), true);
    t.press(down("c", { ctrlKey: true }), true);
    expect(t.release("c")).toBeNull();
    expect(t.release("Control")).toBeNull();
  });

  it("two modifiers together are not a tap of either", () => {
    const t = new ModifierTap();
    t.press(down("Control", { ctrlKey: true }), true);
    t.press(down("Alt", { ctrlKey: true, altKey: true }), true);
    expect(t.release("Alt")).toBeNull();
    expect(t.release("Control")).toBeNull();
  });

  it("key repeat while held keeps the tap; a mouse press or leaving the window ends it", () => {
    const t = new ModifierTap();
    t.press(down("Control", { ctrlKey: true }), true);
    t.press(down("Control", { ctrlKey: true }, true), true);
    expect(t.release("Control")).toBe("ctrl");
    t.press(down("Control", { ctrlKey: true }), true);
    t.cancel();
    expect(t.release("Control")).toBeNull();
  });

  it("a long hold is not a tap: letting go after deciding against it does nothing", () => {
    const t = new ModifierTap();
    t.press(down("Control", { ctrlKey: true }), true, 1000);
    expect(t.release("Control", 1900)).toBeNull();
    t.press(down("Control", { ctrlKey: true }), true, 2000);
    expect(t.release("Control", 2200)).toBe("ctrl");
  });

  it("not while typing in a field", () => {
    const t = new ModifierTap();
    t.press(down("Control", { ctrlKey: true }), false);
    expect(t.release("Control")).toBeNull();
  });
});
