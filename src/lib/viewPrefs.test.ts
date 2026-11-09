import { afterEach, describe, expect, it } from "vitest";
import { setViewInfoShown, viewInfoShown } from "./viewPrefs";

afterEach(() => localStorage.clear());

describe("what the view shows", () => {
  it("shows stats and the legend until told not to", () => {
    expect(viewInfoShown("stats")).toBe(true);
    expect(viewInfoShown("legend")).toBe(true);
  });

  it("remembers each one on its own", () => {
    setViewInfoShown("stats", false);
    expect(viewInfoShown("stats")).toBe(false);
    expect(viewInfoShown("legend")).toBe(true);
    setViewInfoShown("stats", true);
    expect(viewInfoShown("stats")).toBe(true);
  });
});
