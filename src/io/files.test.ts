// Lane 16 (C6): a file is measured before it is read. A dropped or chosen file over its
// limit is refused by its size, without its bytes ever being read.
import { afterEach, describe, expect, it, vi } from "vitest";
import { askUnsaved, checkSize, guardTauriClose, FileTooLarge, MAX_READ_BYTES, readBrowserFile, readLimit } from "./files";

const dialog = vi.hoisted(() => ({ message: vi.fn<(message: string, options?: object) => Promise<string>>() }));
vi.mock("@tauri-apps/plugin-dialog", () => dialog);
type CloseEvent = { preventDefault(): void };
const win = vi.hoisted(() => ({ handler: null as null | ((e: { preventDefault(): void }) => Promise<void>) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: async (h: (e: CloseEvent) => Promise<void>) => {
      win.handler = h;
      return () => undefined;
    },
  }),
}));

/** A File that says it is `size` bytes and fails the test if it is read. */
function claimed(name: string, size: number) {
  const read = vi.fn(async () => new ArrayBuffer(0));
  return { file: { name, size, arrayBuffer: read } as unknown as File, read };
}

describe("reading files", () => {
  it("each kind of file has its limit", () => {
    expect(readLimit("Bench.shz")).toBe(MAX_READ_BYTES.shz);
    expect(readLimit("plugin.zip")).toBe(MAX_READ_BYTES.zip);
    expect(readLimit("chair.skp")).toBe(MAX_READ_BYTES.import);
    expect(readLimit("part.STL")).toBe(MAX_READ_BYTES.import);
  });

  it("a file over its limit is refused by its size, never read", async () => {
    const { file, read } = claimed("huge.stl", MAX_READ_BYTES.import + 1);
    await expect(readBrowserFile(file)).rejects.toBeInstanceOf(FileTooLarge);
    expect(read).not.toHaveBeenCalled();
    const doc = claimed("huge.shz", 3 * 1024 * 1024 * 1024);
    await expect(readBrowserFile(doc.file)).rejects.toThrow("Sawhorse reads documents of at most 512 MB");
    expect(doc.read).not.toHaveBeenCalled();
  });

  it("a file within its limit is read", async () => {
    const { file, read } = claimed("ok.obj", 1024);
    const r = await readBrowserFile(file);
    expect(read).toHaveBeenCalledOnce();
    expect(r.name).toBe("ok.obj");
  });

  it("checkSize names the file, its size and the limit", () => {
    expect(() => checkSize("C/models/big.zip", 100 * 1024 * 1024)).toThrow("big.zip is 100 MB; Sawhorse reads plugin packages of at most 64 MB");
    expect(() => checkSize("small.zip", 1024)).not.toThrow();
  });
});

// The desktop's dialog plugin makes window.confirm a Promise, truthy whatever the answer, to
// code that does not wait (upstream #32): work was replaced without asking.
describe("asking about unsaved changes", () => {
  const w = window as unknown as Record<string, unknown>;
  afterEach(() => {
    delete w.__TAURI_INTERNALS__;
    dialog.message.mockReset();
  });

  it("in the browser is window.confirm: discard or stay", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await expect(askUnsaved("Bench", "opening another")).resolves.toBe("cancel");
    confirm.mockReturnValue(true);
    await expect(askUnsaved("Bench", "opening another")).resolves.toBe("discard");
    confirm.mockRestore();
    expect(dialog.message).not.toHaveBeenCalled();
  });

  it("on the desktop offers Save, Don't Save and Cancel, names the file, and waits", async () => {
    w.__TAURI_INTERNALS__ = {};
    let answer: ((button: string) => void) | null = null;
    dialog.message.mockImplementation(() => new Promise<string>((r) => (answer = r)));
    const asked = askUnsaved("Bench", "quitting");
    let settled = false;
    void asked.then(() => (settled = true));
    await vi.waitFor(() => expect(dialog.message).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);
    const [text, options] = dialog.message.mock.calls[0];
    expect(text).toContain("Bench");
    expect(options).toMatchObject({ buttons: { yes: "Save", no: "Don't Save", cancel: "Cancel" } });
    answer!("Cancel");
    await expect(asked).resolves.toBe("cancel");
  });

  it("reads the buttons by their words or the plugin's names", async () => {
    w.__TAURI_INTERNALS__ = {};
    for (const [button, result] of [["Save", "save"], ["Yes", "save"], ["Don't Save", "discard"], ["No", "discard"], ["Cancel", "cancel"]]) {
      dialog.message.mockResolvedValue(button);
      await expect(askUnsaved("Bench", "quitting")).resolves.toBe(result);
    }
  });
});

describe("closing the desktop window", () => {
  const w = window as unknown as Record<string, unknown>;
  const save = vi.fn<() => Promise<boolean>>();
  afterEach(() => {
    delete w.__TAURI_INTERNALS__;
    dialog.message.mockReset();
    save.mockReset();
  });

  async function close(dirty: boolean): Promise<boolean> {
    w.__TAURI_INTERNALS__ = {};
    await guardTauriClose(() => dirty, () => "Bench", save);
    const preventDefault = vi.fn();
    await win.handler!({ preventDefault });
    return preventDefault.mock.calls.length === 0;
  }

  it("closes without a question when nothing is unsaved", async () => {
    expect(await close(false)).toBe(true);
    expect(dialog.message).not.toHaveBeenCalled();
  });

  it("stays open on Cancel", async () => {
    dialog.message.mockResolvedValue("Cancel");
    expect(await close(true)).toBe(false);
  });

  it("closes on Don't Save, without saving", async () => {
    dialog.message.mockResolvedValue("Don't Save");
    expect(await close(true)).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });

  it("saves on Save, and closes once it has", async () => {
    dialog.message.mockResolvedValue("Save");
    save.mockResolvedValue(true);
    expect(await close(true)).toBe(true);
    expect(save).toHaveBeenCalledOnce();
  });

  it("stays open when the save fails or is cancelled", async () => {
    dialog.message.mockResolvedValue("Save");
    save.mockResolvedValue(false);
    expect(await close(true)).toBe(false);
  });

  it("never traps the person: a question that fails lets the window close", async () => {
    dialog.message.mockRejectedValue(new Error("no dialog"));
    expect(await close(true)).toBe(true);
  });
});

