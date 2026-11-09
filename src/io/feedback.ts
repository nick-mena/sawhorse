// The feedback log (Help > Log Feedback…): notes kept together in one Markdown file, each with
// what the app was doing, to be read back all at once. On the desktop it lives in the app's own
// data folder, so it needs no new permission; the browser build keeps it in local storage.
import { download, isTauri } from "./files";

export const FEEDBACK_FILE = "feedback-log.md";
export const MAX_FEEDBACK_CHARS = 10_000;
const BROWSER_KEY = "sawhorse.feedback";
const MAX_BROWSER_CHARS = 1_000_000;

export type FeedbackKind = "Problem" | "Feedback";

export interface FeedbackContext {
  file: string;
  edited: boolean;
  mode: string;
  tool: string;
  selection: number;
  /** The status line when the log was opened. */
  status: string | null;
  /** The last refusal or error this session, which may have left the status line by now. */
  lastError: string | null;
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 500);
const two = (n: number) => String(n).padStart(2, "0");

function stamp(d: Date): string {
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** One entry. The note is quoted line by line, so nothing typed can pass for the log's own structure. */
export function feedbackEntry(kind: FeedbackKind, text: string, ctx: FeedbackContext, build: string, when: Date): string {
  const note = text
    .trim()
    .split(/\r?\n/)
    .map((l) => (l ? `> ${l}` : ">"));
  const facts = [
    `App: ${build}`,
    `File: ${oneLine(ctx.file)}${ctx.edited ? " (edited)" : ""}`,
    `Working in: ${ctx.mode}, ${ctx.tool} tool`,
    `Selected: ${ctx.selection}`,
    ...(ctx.status ? [`Status line: ${oneLine(ctx.status)}`] : []),
    ...(ctx.lastError ? [`Last error: ${oneLine(ctx.lastError)}`] : []),
  ].map((f) => `- ${f}`);
  return [`## ${stamp(when)} · ${kind}`, "", ...note, "", ...facts, "", "---", "", ""].join("\n");
}

async function desktopPaths(): Promise<{ dir: string; file: string }> {
  const { appDataDir, join } = await import("@tauri-apps/api/path");
  const dir = await appDataDir();
  return { dir, file: await join(dir, FEEDBACK_FILE) };
}

/** Where the log is, to show the person; null when it is inside the browser. */
export async function feedbackLocation(): Promise<string | null> {
  return isTauri() ? (await desktopPaths()).file : null;
}

/** Add an entry, or throw a sentence that says why it could not be kept. */
export async function appendFeedback(kind: FeedbackKind, text: string, ctx: FeedbackContext, when = new Date()): Promise<void> {
  if (isTauri()) {
    const [{ mkdir, writeTextFile }, { getVersion }, { dir, file }] = await Promise.all([import("@tauri-apps/plugin-fs"), import("@tauri-apps/api/app"), desktopPaths()]);
    const entry = feedbackEntry(kind, text, ctx, `${await getVersion()} desktop`, when);
    await mkdir(dir, { recursive: true });
    await writeTextFile(file, entry, { append: true });
    return;
  }
  const had = localStorage.getItem(BROWSER_KEY) ?? "";
  const next = had + feedbackEntry(kind, text, ctx, "browser", when);
  if (next.length > MAX_BROWSER_CHARS) throw new Error("The browser's feedback log is full. Download it, then clear this site's data to start a new one.");
  localStorage.setItem(BROWSER_KEY, next);
}

/** The browser build's way to get its log out. */
export function downloadBrowserFeedback(): void {
  download(FEEDBACK_FILE, new TextEncoder().encode(localStorage.getItem(BROWSER_KEY) ?? ""), "text/markdown");
}
