import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocState, MaterialDef } from "../kernel/types";
import { MaterialsPane } from "./MaterialsPane";

const units = "m" as const;

const state = {
  materials: [{ name: "Oak", color: [200, 160, 110, 255], texture: "assets/oak.png", held: true, size: [0.6096, 0.3048], size_set: true, rotation: 0, offset: [0, 0] }],
} as unknown as DocState;

function setup() {
  const onDefine = vi.fn<(d: MaterialDef) => void>();
  render(<MaterialsPane state={state} library={[]} swatch={() => null} active={{ from: "model", name: "Oak" }} onActive={() => {}} onRemovePaint={() => {}} onDefine={onDefine} onRename={() => {}} onDelete={() => {}} onImport={() => {}} onPosition={null} units={units} />);
  return onDefine;
}

afterEach(cleanup);

const commit = (label: string, value: string) => {
  const el = screen.getByLabelText(label);
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
};

describe("texture scale inputs", () => {
  it("shows a material's scale against its nominal width", () => {
    setup();
    expect((screen.getByLabelText("Texture scale percent") as HTMLInputElement).value).toBe("200");
  });

  it("scales width and height together", () => {
    const onDefine = setup();
    commit("Texture scale percent", "100");
    expect(onDefine.mock.calls[0][0].size).toEqual([0.3048, 0.1524]);
  });

  it("commits a slider drag once, on release", () => {
    const onDefine = setup();
    const slider = screen.getByLabelText("Texture scale slider");
    fireEvent.change(slider, { target: { value: "150" } });
    fireEvent.change(slider, { target: { value: "100" } });
    expect(onDefine).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider);
    expect(onDefine).toHaveBeenCalledTimes(1);
  });

  it("refuses a scale of zero and changes nothing", () => {
    const onDefine = setup();
    commit("Texture scale percent", "0");
    expect(onDefine).not.toHaveBeenCalled();
    expect(screen.getByText("Scale is a percentage above zero.")).toBeTruthy();
  });

  it("links width and height until proportions are unlocked", () => {
    const onDefine = setup();
    commit("Texture width", "1.2192 m");
    expect(onDefine.mock.calls[0][0].size![1]).toBeCloseTo(0.6096, 6);
  });

  it("changes one side alone with proportions unlocked", () => {
    const onDefine = setup();
    fireEvent.click(screen.getByRole("button", { name: "Keep proportions" }));
    commit("Texture width", "1.2192 m");
    expect(onDefine.mock.calls[0][0].size![1]).toBeCloseTo(0.3048, 6);
  });

  it("slides the texture with offset fields", () => {
    const onDefine = setup();
    commit("Texture offset X", "0.1 m");
    expect(onDefine.mock.calls[0][0].offset![0]).toBeCloseTo(0.1, 6);
  });
});
