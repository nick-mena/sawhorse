import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trackpadOrbitSpeed } from "../lib/navPrefs";
import { SettingsDialog } from "./SettingsDialog";

const dialog = () => render(<SettingsDialog url={null} status="off" onUrl={() => {}} onRecheck={() => {}} onClose={() => {}} />);

describe("Settings: trackpad orbit speed", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("on a Mac the slider shows the speed and saves a change at once", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    dialog();
    const slider = screen.getByRole("slider", { name: "Trackpad orbit speed" }) as HTMLInputElement;
    expect(slider.value).toBe("50");
    expect(screen.getByTestId("orbit-speed").textContent).toBe("50%");
    fireEvent.change(slider, { target: { value: "75" } });
    expect(screen.getByTestId("orbit-speed").textContent).toBe("75%");
    expect(trackpadOrbitSpeed()).toBe(75);
  });

  it("off the Mac, where a swipe does not orbit, there is no slider", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
    dialog();
    expect(screen.queryByRole("slider")).toBeNull();
  });
});
