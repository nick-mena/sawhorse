// Sawhorse's shortcuts are written with Ctrl and the app answers Cmd as well.
// On a Mac the words on screen follow what the person's hands should press.

export function isMac(): boolean {
  return /Mac/.test(navigator.platform);
}

const MAC_MODIFIERS: [string, string][] = [
  ["Alt", "⌥"],
  ["Shift", "⇧"],
  ["Ctrl", "⌘"],
];

/** A shortcut as a menu shows it: "Ctrl+Shift+S", or "⇧⌘S" on a Mac. */
export function shortcutLabel(keys: string): string {
  if (!isMac()) return keys;
  const parts = keys.split("+");
  const key = parts.pop()!;
  if (!parts.length || parts.some((m) => !MAC_MODIFIERS.some(([name]) => name === m))) return keys;
  return `${MAC_MODIFIERS.filter(([name]) => parts.includes(name)).map(([, glyph]) => glyph).join("")}${key}`;
}

/** A sentence that names Ctrl, for the status line, tooltips and notes. */
export function platformText(text: string): string {
  return isMac() ? text.replace(/\bCtrl\b/g, "Cmd") : text;
}
