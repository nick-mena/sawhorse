import { beforeEach, describe, expect, it } from "vitest";
import { ORBIT_SPEED, setTrackpadOrbitSpeed, trackpadOrbitSpeed } from "./navPrefs";

describe("trackpad orbit speed", () => {
  beforeEach(() => localStorage.clear());

  it("starts at half a mouse drag's speed and keeps what is set", () => {
    expect(trackpadOrbitSpeed()).toBe(50);
    setTrackpadOrbitSpeed(120);
    expect(trackpadOrbitSpeed()).toBe(120);
  });

  it("a stored value out of range or unreadable cannot make the view unusable", () => {
    setTrackpadOrbitSpeed(100000);
    expect(trackpadOrbitSpeed()).toBe(ORBIT_SPEED.max);
    setTrackpadOrbitSpeed(0);
    expect(trackpadOrbitSpeed()).toBe(ORBIT_SPEED.min);
    localStorage.setItem("sawhorse.trackpadOrbitSpeed", "fast");
    expect(trackpadOrbitSpeed()).toBe(ORBIT_SPEED.standard);
  });
});
