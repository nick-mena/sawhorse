// Settings (lane 15, Edit > Settings…): the trackpad's orbit speed on a Mac, and the render
// service's address. Renders are off until one is set and answers its health check; one line
// says which it is.
import { useState } from "react";
import { checkServiceUrl, gateLine, type GateStatus } from "../credits/gate";
import { useDialogFocus } from "./useDialogFocus";
import { ORBIT_SPEED, setTrackpadOrbitSpeed, swipeOrbits, trackpadOrbitSpeed } from "../lib/navPrefs";

export interface SettingsDialogProps {
  url: string | null;
  status: GateStatus;
  onUrl: (url: string | null) => void;
  onRecheck: () => void;
  onClose: () => void;
}

export function SettingsDialog({ url, status, onUrl, onRecheck, onClose }: SettingsDialogProps) {
  const [text, setText] = useState(url ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [orbitSpeed, setOrbitSpeed] = useState(trackpadOrbitSpeed);
  const dialog = useDialogFocus();
  const save = () => {
    const r = checkServiceUrl(text);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setErr(null);
    setText(r.url);
    onUrl(r.url || null);
  };
  return (
    <section
      ref={dialog}
      className="name-dialog settings-dialog"
      role="dialog"
      aria-label="Settings"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onClose();
      }}
    >
      <header>
        <b>Settings</b>
      </header>
      {swipeOrbits() ? (
        <>
          <h5>Navigation</h5>
          <label>
            <span>Trackpad orbit speed</span>
            <input
              type="range"
              aria-label="Trackpad orbit speed"
              min={ORBIT_SPEED.min}
              max={ORBIT_SPEED.max}
              step={ORBIT_SPEED.step}
              value={orbitSpeed}
              onChange={(e) => {
                const v = Number(e.currentTarget.value);
                setOrbitSpeed(v);
                setTrackpadOrbitSpeed(v);
              }}
            />
            <span data-testid="orbit-speed">{orbitSpeed}%</span>
          </label>
          <p className="note">How far a two-finger swipe turns the model, against a mouse drag of the same distance. Starts at {ORBIT_SPEED.standard}%.</p>
        </>
      ) : null}
      <h5>Renders</h5>
      <label>
        <span>Render service</span>
        <input
          aria-label="Render service address"
          value={text}
          size={34}
          placeholder="https://render.example.com"
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
      </label>
      {err ? <p className="note err">{err}</p> : null}
      <p className="note" data-testid="render-gate" data-status={status}>
        {gateLine(status, url)}
      </p>
      <div className="btnrow">
        <button type="button" className="btn primary" onClick={save}>
          Save
        </button>
        <button type="button" className="btn" disabled={!url} onClick={onRecheck} title="Ask the service again">
          Check again
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setText("");
            setErr(null);
            onUrl(null);
          }}
        >
          Clear
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Done
        </button>
      </div>
      <p className="note">Saved on this device only. A render sends the current view (depth, edges and a clay image) and your prompt to that service; nothing else leaves the app.</p>
    </section>
  );
}
