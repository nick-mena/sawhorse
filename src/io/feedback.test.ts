import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendFeedback, feedbackEntry, feedbackLocation, type FeedbackContext } from "./feedback";

const fs = vi.hoisted(() => ({ mkdir: vi.fn(async () => undefined), writeTextFile: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/plugin-fs", () => fs);
vi.mock("@tauri-apps/api/path", () => ({ appDataDir: async () => "/data/app", join: async (...p: string[]) => p.join("/") }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "1.2.3" }));

const ctx: FeedbackContext = { file: "Bench", edited: true, mode: "Model", tool: "Line", selection: 2, status: "Couldn't do that.", lastError: "Couldn't do that." };
const when = new Date(2026, 10, 8, 19, 5);

describe("the feedback log", () => {
  beforeEach(() => {
    localStorage.clear();
    fs.mkdir.mockClear();
    fs.writeTextFile.mockReset();
    fs.writeTextFile.mockResolvedValue(undefined);
  });
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });
  const desktop = () => ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {});

  it("writes a note with what the app was doing", () => {
    expect(feedbackEntry("Problem", "It froze", ctx, "1.2.3 desktop", when)).toBe(
      [
        "## 2026-11-08 19:05 · Problem",
        "",
        "> It froze",
        "",
        "- App: 1.2.3 desktop",
        "- File: Bench (edited)",
        "- Working in: Model, Line tool",
        "- Selected: 2",
        "- Status line: Couldn't do that.",
        "- Last error: Couldn't do that.",
        "",
        "---",
        "",
        "",
      ].join("\n"),
    );
  });

  it("quotes every line, so a note cannot pose as a new entry", () => {
    const e = feedbackEntry("Feedback", "first\n\n## 2020-01-01 · Problem\n---", { ...ctx, status: null, lastError: null }, "b", when);
    expect(e).toContain("> first\n>\n> ## 2020-01-01 · Problem\n> ---\n");
    expect(e.match(/^## /gm)).toHaveLength(1);
  });

  it("keeps a file name or message with line breaks on one line", () => {
    const e = feedbackEntry("Feedback", "x", { ...ctx, file: "a\n## b", status: null, lastError: "one\ntwo" }, "b", when);
    expect(e).toContain("- File: a ## b (edited)");
    expect(e).toContain("- Last error: one two");
  });

  it("on the desktop appends to one file in the app's data folder", async () => {
    desktop();
    await expect(feedbackLocation()).resolves.toBe("/data/app/feedback-log.md");
    await appendFeedback("Problem", "It froze", ctx, when);
    expect(fs.mkdir).toHaveBeenCalledWith("/data/app", { recursive: true });
    const [path, text, opts] = fs.writeTextFile.mock.calls[0] as unknown as [string, string, object];
    expect(path).toBe("/data/app/feedback-log.md");
    expect(text).toContain("- App: 1.2.3 desktop");
    expect(opts).toEqual({ append: true });
  });

  it("passes on a failed write", async () => {
    desktop();
    fs.writeTextFile.mockRejectedValue(new Error("disk full"));
    await expect(appendFeedback("Problem", "x", ctx)).rejects.toThrow("disk full");
  });

  it("in the browser adds to local storage and refuses once full, keeping what is there", async () => {
    await expect(feedbackLocation()).resolves.toBeNull();
    await appendFeedback("Feedback", "one", ctx, when);
    await appendFeedback("Feedback", "two", ctx, when);
    const kept = localStorage.getItem("sawhorse.feedback")!;
    expect(kept.indexOf("> one")).toBeLessThan(kept.indexOf("> two"));
    localStorage.setItem("sawhorse.feedback", "x".repeat(1_000_000));
    await expect(appendFeedback("Feedback", "three", ctx)).rejects.toThrow(/full/);
    expect(localStorage.getItem("sawhorse.feedback")).toHaveLength(1_000_000);
  });
});
