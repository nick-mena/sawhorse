// What every dialog owes the keyboard: focus goes in when it opens (a field that autofocuses
// keeps it), Tab stays inside, and focus goes back to where it was when it closes.
import { useEffect, useRef } from "react";

const FOCUSABLE = 'a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';

/** Put the returned ref on the dialog's outermost element. */
export function useDialogFocus() {
  const ref = useRef<HTMLElement>(null);
  // Read while rendering: by the first effect an autofocused field has already taken focus.
  const opener = useRef(document.activeElement);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.setAttribute("aria-modal", "true");
    root.tabIndex = -1;
    if (!root.contains(document.activeElement)) root.focus({ preventScroll: true });
    const trapTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const edge = e.shiftKey ? items[0] : items[items.length - 1];
      const at = document.activeElement;
      if (items.length && at !== edge && !(e.shiftKey && at === root)) return;
      e.preventDefault();
      (e.shiftKey ? items[items.length - 1] : items[0])?.focus();
    };
    root.addEventListener("keydown", trapTab);
    return () => {
      root.removeEventListener("keydown", trapTab);
      // Still in the page: React's development double run, not a close.
      if (root.isConnected) return;
      const back = opener.current;
      const now = document.activeElement;
      if (back instanceof HTMLElement && back !== document.body && back.isConnected && (!now || now === document.body)) back.focus({ preventScroll: true });
    };
  }, []);
  return ref;
}
