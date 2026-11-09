import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedbackContext } from "../io/feedback";
import { FeedbackDialog } from "./FeedbackDialog";

const ctx: FeedbackContext = { file: "Bench", edited: false, mode: "Model", tool: "Select", selection: 0, status: null, lastError: null };
const note = () => screen.getByRole("textbox", { name: "Note" }) as HTMLTextAreaElement;
const saveButton = () => screen.getByRole("button", { name: "Save to Log" }) as HTMLButtonElement;

describe("the Log Feedback dialog", () => {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  const open = (context = ctx) => render(<FeedbackDialog context={context} onSaved={onSaved} onClose={onClose} />);
  beforeEach(() => {
    localStorage.clear();
    onSaved.mockClear();
    onClose.mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  /** Save whatever a test left in the box, so the kept draft does not reach the next one. */
  const flush = async () => {
    fireEvent.change(note(), { target: { value: "end" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  };

  it("needs a note before it can save, and puts the cursor in the box", async () => {
    open();
    expect(document.activeElement).toBe(note());
    expect(saveButton().disabled).toBe(true);
    fireEvent.change(note(), { target: { value: "   " } });
    expect(saveButton().disabled).toBe(true);
    await flush();
  });

  it("saves the note and the kind chosen", async () => {
    open();
    fireEvent.change(screen.getByRole("combobox", { name: "Kind" }), { target: { value: "Problem" } });
    fireEvent.change(note(), { target: { value: "It froze" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(localStorage.getItem("sawhorse.feedback")).toMatch(/· Problem\n\n> It froze/);
  });

  it("saves with Cmd+Enter", async () => {
    open();
    fireEvent.change(note(), { target: { value: "Quick one" } });
    fireEvent.keyDown(note(), { key: "Enter", metaKey: true });
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  });

  it("starts as a problem while an error is on the status line", async () => {
    open({ ...ctx, status: "No.", lastError: "No." });
    expect((screen.getByRole("combobox", { name: "Kind" }) as HTMLSelectElement).value).toBe("Problem");
    await flush();
  });

  it("keeps the note in the box when it cannot be written", async () => {
    open();
    localStorage.setItem("sawhorse.feedback", "x".repeat(1_000_000));
    fireEvent.change(note(), { target: { value: "Keep me" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/not saved, and it is still here/));
    expect(note().value).toBe("Keep me");
    expect(onSaved).not.toHaveBeenCalled();
    localStorage.clear();
    await flush();
  });

  it("closing without saving keeps the note for next time, and saving clears it", async () => {
    open();
    fireEvent.change(note(), { target: { value: "Half a thought" } });
    fireEvent.keyDown(note(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    cleanup();
    open();
    expect(note().value).toBe("Half a thought");
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    cleanup();
    open();
    expect(note().value).toBe("");
  });

  it("keeps the app's keys out while typing", () => {
    const outer = vi.fn();
    window.addEventListener("keydown", outer);
    open();
    fireEvent.keyDown(note(), { key: "l" });
    window.removeEventListener("keydown", outer);
    expect(outer).not.toHaveBeenCalled();
  });
});
