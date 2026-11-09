import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useDialogFocus } from "./useDialogFocus";

function Dialog({ auto }: { auto?: boolean }) {
  const ref = useDialogFocus();
  return (
    <section ref={ref} role="dialog" aria-label="Test">
      <input aria-label="first" autoFocus={auto} />
      <button type="button" disabled>
        off
      </button>
      <button type="button">last</button>
    </section>
  );
}

function Page({ auto }: { auto?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(!open)}>
        opener
      </button>
      {open ? <Dialog auto={auto} /> : null}
    </>
  );
}

const open = (auto?: boolean) => {
  render(<Page auto={auto} />);
  const opener = screen.getByText("opener");
  opener.focus();
  fireEvent.click(opener);
  return opener;
};

describe("dialog focus", () => {
  afterEach(cleanup);

  it("takes focus when it opens and is marked modal", () => {
    open();
    const d = screen.getByRole("dialog");
    expect(document.activeElement).toBe(d);
    expect(d.getAttribute("aria-modal")).toBe("true");
  });

  it("leaves an autofocused field its focus", () => {
    open(true);
    expect(document.activeElement).toBe(screen.getByLabelText("first"));
  });

  it("Tab wraps at both ends, over disabled buttons, and stays inside", () => {
    open(true);
    const [first, last] = [screen.getByLabelText("first"), screen.getByText("last")];
    last.focus();
    expect(fireEvent.keyDown(last, { key: "Tab" })).toBe(false);
    expect(document.activeElement).toBe(first);
    expect(fireEvent.keyDown(first, { key: "Tab", shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(last);
  });

  it("Shift+Tab from the dialog itself goes to its last control, and Tab inside is left alone", () => {
    open();
    const d = screen.getByRole("dialog");
    fireEvent.keyDown(d, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText("last"));
    const first = screen.getByLabelText("first");
    first.focus();
    expect(fireEvent.keyDown(first, { key: "Tab" })).toBe(true);
  });

  it("gives focus back when it closes", () => {
    const opener = open();
    (document.activeElement as HTMLElement).blur();
    fireEvent.click(opener);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
