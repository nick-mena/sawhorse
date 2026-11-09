// What the macOS desktop build relies on and CI never runs: CI's Tauri job is Linux-only and
// the e2e suite drives the browser build. The first block guards the webview's native surface
// (AGENTS.md, Security invariants). `it.fails` records a known gap: it goes red when the gap
// is fixed, and then becomes a plain `it`.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BLOCKED_SAVE_EXTENSIONS } from "./plugins/manager";
import { filesFromEntries } from "./plugins/zip";

const json = (file: string) => JSON.parse(readFileSync(path.resolve(__dirname, "..", file), "utf8"));
const config = json("src-tauri/tauri.conf.json");
const permissions: string[] = json("src-tauri/capabilities/default.json").permissions;

function csp(): Map<string, string[]> {
  const parts = (config.app.security.csp as string).split(";").map((d) => d.trim().split(/\s+/));
  return new Map(parts.map(([name, ...values]) => [name, values]));
}

describe("the webview's native surface", () => {
  it("is exactly these permissions; widening it is a security decision", () => {
    expect([...permissions].sort()).toEqual([
      "core:default",
      "core:window:allow-destroy",
      "core:window:allow-set-title",
      "dialog:allow-message",
      "dialog:allow-open",
      "dialog:allow-save",
      "fs:allow-appdata-read-recursive",
      "fs:allow-appdata-write-recursive",
      "fs:allow-read-dir",
      "fs:allow-read-file",
      "fs:allow-write-file",
    ]);
  });

  it("loads scripts only from the app, and never evaluates text", () => {
    expect(csp().get("script-src")).toEqual(["'self'", "'wasm-unsafe-eval'", "blob:"]);
  });

  it("allows nothing but local origins to connect", () => {
    for (const src of csp().get("connect-src") ?? []) expect(src).toMatch(/^('self'|ipc:|http:\/\/ipc\.localhost|http:\/\/127\.0\.0\.1:\d+)$/);
  });

  it("signs the app ad hoc, so Apple Silicon does not call a download damaged (upstream #27)", () => {
    expect(config.bundle.macOS?.signingIdentity).toBe("-");
  });

  it("refuses the macOS programs and installers a plugin might save", () => {
    for (const ext of [".app", ".command", ".pkg", ".dmg", ".terminal", ".workflow", ".sh", ".zsh", ".dylib"]) expect(BLOCKED_SAVE_EXTENSIONS.has(ext), ext).toBe(true);
  });
});

describe("known gaps", () => {
  it.fails("the desktop policy locks base-uri and form-action, as the browser build's does", () => {
    expect(csp().get("base-uri")).toEqual(["'self'"]);
    expect(csp().get("form-action")).toEqual(["'none'"]);
  });

  it.fails("a plugin granted net can reach https hosts on the desktop", () => {
    expect(csp().get("connect-src")).toContain("https:");
  });

  // Each opens a URL, a file or a script when double-clicked in Finder, as .url and .lnk
  // do on Windows.
  it.fails.each([".webloc", ".inetloc", ".fileloc", ".tool", ".scpt", ".applescript"])("a plugin may not save %s", (ext) => {
    expect(BLOCKED_SAVE_EXTENSIONS.has(ext)).toBe(true);
  });

  // U+2028 ends a line comment, and sandbox.worker.ts writes the path into one after the
  // source check has run: text in a file name would be code the check never saw.
  it.fails("a plugin file name cannot hold a line separator", () => {
    expect(() => filesFromEntries({ "a b.js": new Uint8Array() })).toThrow();
  });
});
