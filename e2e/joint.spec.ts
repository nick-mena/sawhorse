import { expect, test, type Page } from "@playwright/test";

// The Joint tool on the real kernel: a part cuts another and stays; Ctrl+click adds; a
// refusal says why and changes nothing.
import { at, box, clickAt, point, ready, selectAt, solids, type } from "./helpers";

const hint = (page: Page) => page.locator("#hint");

/** A 12 x 12 x 6 in block and a copy of it 6 in along green, overlapping it by half. */
async function overlappingBlocks(page: Page, distance = "6") {
  const vp = await ready(page);
  await box(page);
  await page.keyboard.press("m");
  await page.keyboard.press("Control");
  await clickAt(page, [0, 0, 0], "endpoint", 1, 1);
  await page.keyboard.press("ArrowLeft");
  await point(page, [0, 5, 0]);
  await type(page, distance);
  await expect(vp).toHaveAttribute("data-objects", "2");
  await page.keyboard.press("Space");
  await page.keyboard.press("Escape");
  await page.locator('[data-tool="joint"]').click();
  return vp;
}

test("a part cuts another and stays; one undo puts it back", async ({ page }) => {
  const vp = await overlappingBlocks(page);
  await selectAt(page, [6, 15, 6], "object");
  await expect(hint(page)).toContainText("Cutting with");
  await selectAt(page, [6, 3, 6], "object");
  await expect(hint(page)).toContainText("Cut solid 1 with solid 2");
  await expect(vp).toHaveAttribute("data-objects", "2");
  const [cut, cutter] = await solids(page);
  expect(cut.volume).toBeCloseTo(12 * 6 * 6, 3);
  expect(cutter.volume).toBeCloseTo(12 * 12 * 6, 3);
  await page.keyboard.press("Control+z");
  expect((await solids(page))[0].volume).toBeCloseTo(12 * 12 * 6, 3);
});

test("Ctrl+click adds the parts into one", async ({ page }) => {
  const vp = await overlappingBlocks(page);
  await selectAt(page, [6, 15, 6], "object");
  const [x, y] = await at(page, [6, 3, 6], 1, -1);
  await page.keyboard.down("Control");
  await page.mouse.click(x, y);
  await page.keyboard.up("Control");
  await expect(hint(page)).toContainText("Added solid 2 into solid 1");
  await expect(vp).toHaveAttribute("data-objects", "1");
  expect((await solids(page))[0].volume).toBeCloseTo(12 * 18 * 6, 3);
});

test("parts that do not overlap are refused in words", async ({ page }) => {
  const vp = await overlappingBlocks(page, "24");
  await selectAt(page, [6, 30, 6], "object");
  await selectAt(page, [6, 3, 6], "object");
  await expect(hint(page)).toContainText("do not overlap");
  await expect(vp).toHaveAttribute("data-objects", "2");
});

test("Edit > Add Parts Together joins what is selected", async ({ page }) => {
  const vp = await overlappingBlocks(page);
  await page.keyboard.press("Space");
  await page.keyboard.press("Control+a");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("menuitem", { name: "Add Parts Together" }).click();
  await expect(hint(page)).toContainText("Added 2 parts into one");
  await expect(vp).toHaveAttribute("data-objects", "1");
});
