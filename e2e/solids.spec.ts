import { expect, test, type Page } from "@playwright/test";

// Tools > Union, Subtract, Intersect and Split on the real kernel, each one undo step.
import { box, clickAt, point, ready, selectAt, solids, type } from "./helpers";

const hint = (page: Page) => page.locator("#hint");

/** A 12 x 12 x 6 in block and a copy 6 in along green, overlapping it by half, then the
 * solid tool in `mode` from the Tools menu. */
async function overlapping(page: Page, mode: string) {
  const vp = await ready(page);
  await box(page);
  await page.keyboard.press("m");
  await page.keyboard.press("Control");
  await clickAt(page, [0, 0, 0], "endpoint", 1, 1);
  await page.keyboard.press("ArrowLeft");
  await point(page, [0, 5, 0]);
  await type(page, "6");
  await expect(vp).toHaveAttribute("data-objects", "2");
  await page.keyboard.press("Space");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: mode, exact: true }).click();
  await expect(hint(page)).toContainText(`${mode}:`);
  return vp;
}

test("Union joins the two blocks into one", async ({ page }) => {
  const vp = await overlapping(page, "Union");
  await selectAt(page, [6, 15, 6], "object");
  await selectAt(page, [6, 3, 6], "object");
  await expect(hint(page)).toContainText("Joined solid 2 into solid 1");
  await expect(vp).toHaveAttribute("data-objects", "1");
  expect((await solids(page))[0].volume).toBeCloseTo(12 * 18 * 6, 3);
});

test("Subtract cuts one out of the other and takes it away; one undo puts both back", async ({ page }) => {
  const vp = await overlapping(page, "Subtract");
  await selectAt(page, [6, 15, 6], "object");
  await selectAt(page, [6, 3, 6], "object");
  await expect(hint(page)).toContainText("Cut solid 2 out of solid 1");
  await expect(vp).toHaveAttribute("data-objects", "1");
  expect((await solids(page))[0].volume).toBeCloseTo(12 * 6 * 6, 3);
  await page.keyboard.press("Control+z");
  await expect(vp).toHaveAttribute("data-objects", "2");
});

test("Intersect keeps only the overlap", async ({ page }) => {
  const vp = await overlapping(page, "Intersect");
  await selectAt(page, [6, 15, 6], "object");
  await selectAt(page, [6, 3, 6], "object");
  await expect(hint(page)).toContainText("Kept only where");
  await expect(vp).toHaveAttribute("data-objects", "1");
  expect((await solids(page))[0].volume).toBeCloseTo(12 * 6 * 6, 3);
});

test("Split leaves three parts; Alt steps to the next mode", async ({ page }) => {
  const vp = await overlapping(page, "Intersect");
  await page.keyboard.press("Alt");
  await expect(hint(page)).toContainText("Split:");
  await selectAt(page, [6, 15, 6], "object");
  await selectAt(page, [6, 3, 6], "object");
  await expect(hint(page)).toContainText("3 parts now");
  await expect(vp).toHaveAttribute("data-objects", "3");
  const vols = (await solids(page)).map((s) => s.volume).sort((a, b) => a - b);
  for (const v of vols) expect(v).toBeCloseTo(6 * 12 * 6, 3);
});
