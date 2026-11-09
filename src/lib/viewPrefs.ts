// What the 3D view shows besides the model, kept per device (the View menu).

const KEYS = { stats: "sawhorse.view.stats", legend: "sawhorse.view.legend" };
export type ViewInfo = keyof typeof KEYS;

export function viewInfoShown(which: ViewInfo): boolean {
  try {
    return localStorage.getItem(KEYS[which]) !== "off";
  } catch {
    return true;
  }
}

export function setViewInfoShown(which: ViewInfo, shown: boolean): void {
  try {
    localStorage.setItem(KEYS[which], shown ? "on" : "off");
  } catch {
    /* a per-device convenience only */
  }
}
