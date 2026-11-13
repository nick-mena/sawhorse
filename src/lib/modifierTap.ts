// A tap of Ctrl (Cmd on a Mac) or Alt is a tool's option: Move copies, Scale goes about the
// centre, Move folds. Only a tap counts: the key goes down alone and comes up with nothing
// pressed in between. Answering on the way down turned Cmd+C, Cmd+S or Cmd+Tab into a tap as
// well, so Move would quietly start copying.
import { isMac } from "./keys";

type Press = Pick<KeyboardEvent, "key" | "repeat" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

/** Control and Alt everywhere; Meta only on a Mac, where it stands in for Control. */
export function tapOf(key: string): "ctrl" | "alt" | null {
  if (key === "Control" || (key === "Meta" && isMac())) return "ctrl";
  if (key === "Alt") return "alt";
  return null;
}

/**
 * The longest press, in milliseconds, that is still a tap. Holding Ctrl while deciding what to
 * do and then letting go is not a request to switch modes (SketchUp's tap is quick too).
 */
export const TAP_MS = 500;

export class ModifierTap {
  private key: string | null = null;
  private at = 0;

  /** Every key press. `allowed` is false where the key is not the model's (typing in a field). */
  press(e: Press, allowed: boolean, now = performance.now()): void {
    if (e.repeat && e.key === this.key) return;
    const alone = [e.ctrlKey, e.metaKey, e.altKey, e.shiftKey].filter(Boolean).length === 1;
    this.key = allowed && !e.repeat && alone && tapOf(e.key) ? e.key : null;
    this.at = now;
  }

  /** A key coming up: the option it taps, if this completes a quick tap. */
  release(key: string, now = performance.now()): "ctrl" | "alt" | null {
    const tapped = key === this.key && now - this.at <= TAP_MS ? tapOf(key) : null;
    this.key = null;
    return tapped;
  }

  /** A mouse press or release, or the window losing focus (Cmd+Tab never comes back up here). */
  cancel(): void {
    this.key = null;
  }
}
