import { expect, test } from "@playwright/test";

// Copy, Cut and Paste, and the Cmd key they share with Move's tap: a shortcut held with Cmd
// is not a tap of Cmd. Paste hands what was copied to Move, so it follows the cursor until a
// click puts it down, in one undo step.
import { box, clickAt, point, ready, selectAt, solids, type } from "./helpers";

const COPY = "ControlOrMeta+c";
const CUT = "ControlOrMeta+x";
const PASTE = "ControlOrMeta+v";

test("a shortcut held with Cmd does not turn Move into a copy", async ({ page }) => {
  const vp = await ready(page);
  await box(page);
  await page.keyboard.press("m");
  await page.keyboard.press("Meta+k");
  await expect(page.locator("#hint")).not.toContainText("Copying");
  await clickAt(page, [12, 0, 6], "endpoint");
  await point(page, [20, 0, 6]);
  await type(page, "24");
  await expect(page.locator("#hint")).toContainText("Moved solid 1 24 in");
  await expect(vp).toHaveAttribute("data-objects", "1");
});

test("Copy, then Paste follows the cursor; a click places it, in one undo step", async ({ page }) => {
  const vp = await ready(page);
  await box(page);
  await page.keyboard.press("Space");
  // A face is selected; a face cannot be copied alone, so its solid is.
  await selectAt(page, [6, 6, 6], "face");
  await page.keyboard.press(COPY);
  const hint = page.locator("#hint");
  await expect(hint).toContainText("Copied solid 1");
  await page.keyboard.press(PASTE);
  await expect(hint).toContainText("Pasting solid 1");
  await expect(vp).toHaveAttribute("data-objects", "1");
  await clickAt(page, [36, 0, 0], "grid", 1, 1);
  await expect(vp).toHaveAttribute("data-objects", "2");
  await expect(hint).toContainText("Pasted solid 1");
  const s = await solids(page);
  expect(s[1].min[0]).toBeGreaterThan(20);
  await expect(vp).toHaveAttribute("data-selection", "1");
  // Paste again: the same thing, another copy.
  await page.keyboard.press(PASTE);
  await clickAt(page, [36, 36, 0], /grid|axis-|on-face/, 1, 1);
  await expect(vp).toHaveAttribute("data-objects", "3");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(vp).toHaveAttribute("data-objects", "2");
});

test("Esc during a paste leaves the model as it was", async ({ page }) => {
  const vp = await ready(page);
  await box(page);
  await page.keyboard.press("Space");
  await selectAt(page, [6, 6, 6], "face");
  await page.keyboard.press(COPY);
  await page.keyboard.press(PASTE);
  await point(page, [36, 0, 0]);
  await page.keyboard.press("Escape");
  await expect(vp).toHaveAttribute("data-objects", "1");
  await expect(page.locator("#hint")).not.toContainText("Pasting");
});

test("Cut stays until it is pasted, then moves there, once", async ({ page }) => {
  const vp = await ready(page);
  await box(page);
  await page.keyboard.press("Space");
  await selectAt(page, [6, 6, 6], "face");
  await page.keyboard.press(CUT);
  const hint = page.locator("#hint");
  await expect(hint).toContainText("Cut solid 1");
  await expect(vp).toHaveAttribute("data-objects", "1");
  await page.keyboard.press(PASTE);
  await clickAt(page, [36, 0, 0], "grid", 1, 1);
  await expect(hint).toContainText("Moved solid 1");
  await expect(vp).toHaveAttribute("data-objects", "1");
  expect((await solids(page))[0].min[0]).toBeGreaterThan(20);
  await page.keyboard.press(PASTE);
  await expect(hint).toContainText("Nothing to paste");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await solids(page))[0].min[0]).toBeCloseTo(0, 6);
});

test("a group copies whole, from the Edit menu", async ({ page }) => {
  const vp = await ready(page);
  await box(page);
  await page.keyboard.press("Space");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+g");
  await expect(page.locator("#hint")).toContainText("Grouped");
  const edit = page.getByRole("button", { name: "Edit", exact: true });
  await edit.click();
  await page.getByRole("menuitem", { name: /^Copy/ }).click();
  await edit.click();
  await page.getByRole("menuitem", { name: /^Paste/ }).click();
  await clickAt(page, [36, 0, 0], "grid", 1, 1);
  await expect(page.locator("#hint")).toContainText("Pasted");
  await expect(vp).toHaveAttribute("data-objects", "2");
  const groups = await page.evaluate(() => (window as unknown as { __sawhorse: { graph(): { nodes: { kind: string }[] } } }).__sawhorse.graph().nodes.filter((n) => n.kind === "group").length);
  expect(groups).toBe(2);
});

test("text left highlighted does not get in the way once the model is clicked", async ({ page }) => {
  await ready(page);
  await box(page);
  await page.keyboard.press("Space");
  await page.evaluate(() => window.getSelection()?.selectAllChildren(document.querySelector("#hint")!));
  await selectAt(page, [6, 6, 6], "face");
  await page.keyboard.press(COPY);
  await expect(page.locator("#hint")).toContainText("Copied solid 1");
});
