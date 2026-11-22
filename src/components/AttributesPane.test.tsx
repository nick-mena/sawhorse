// The Attributes fields: Esc backs out, and Enter then leaving the field sends once.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocState } from "../kernel/types";
import { AttributesPane } from "./AttributesPane";

afterEach(cleanup);

const IN = 0.0254;
const state = {
  solids: [{ id: 1, number: 1, min: [0, 0, 0], max: [36 * IN, 8 * IN, 3 * IN], volume: 1 }],
  object_info: [{ id: 1, name: null, tag: null, material: null }],
  materials: [],
  tags: {},
  graph: { nodes: [], definitions: [], leaves: [], context: null },
} as unknown as DocState;

function pane() {
  const apply = vi.fn(async () => null);
  render(<AttributesPane state={state} selection={[{ kind: "object", object: 1 }]} units="frac-in" apply={apply} onError={() => {}} />);
  return apply;
}

describe("Attributes fields", () => {
  it("Esc puts the field back and sends nothing", () => {
    const apply = pane();
    const f = screen.getByLabelText("Size x");
    (f as HTMLInputElement).focus();
    fireEvent.change(f, { target: { value: "50" } });
    // The handler's own blur() fires in the same event, before React renders again.
    fireEvent.keyDown(f, { key: "Escape" });
    expect(apply).not.toHaveBeenCalled();
    expect((f as HTMLInputElement).value).toBe("36");
  });

  it("Enter, then leaving the field before the model answers, sends the change once", () => {
    const apply = pane();
    const f = screen.getByLabelText("Position x");
    (f as HTMLInputElement).focus();
    fireEvent.change(f, { target: { value: "10" } });
    fireEvent.keyDown(f, { key: "Enter" });
    (f as HTMLInputElement).blur();
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
