import { expect, test, type Page } from "@playwright/test";

// Loop Cut on the real kernel: a ring of edges around a block, placed by a click or by a
// typed distance, moved by typing again, and pushed as a band of its own.
import { at, box, hover, ready, solids, type } from "./helpers";

const hint = (page: Page) => page.locator("#hint");

test("a click rings the block, typing moves the ring, one undo takes it away", async ({ page }) => {
  const vp = await ready(page);
  await box(page);
  await expect(vp).toHaveAttribute("data-parts", "6");
  await page.keyboard.press("k");
  // On the top face, close to its far edge along red: the ring runs across that edge.
  await hover(page, [4, 11, 6], "object", 0, 0, "data-hover");
  const [x, y] = await at(page, [4, 11, 6]);
  await page.mouse.click(x, y);
  await expect(hint(page)).toContainText("Loop cut solid 1");
  await expect(vp).toHaveAttribute("data-parts", "10");
  const volume = (await solids(page))[0].volume;
  expect(volume).toBeCloseTo(12 * 12 * 6, 3);
  await type(page, "3");
  await expect(hint(page)).toContainText("3 in from the end");
  await expect(vp).toHaveAttribute("data-parts", "10");
  await page.keyboard.press("Control+z");
  await expect(vp).toHaveAttribute("data-parts", "6");
});

test("/3 divides the edge into three with two rings, in one undo step", async ({ page }) => {
  const vp = await ready(page);
  await box(page);
  await page.keyboard.press("k");
  await hover(page, [4, 11, 6], "object", 0, 0, "data-hover");
  await type(page, "/3");
  await expect(hint(page)).toContainText("2 rings, 3 equal parts");
  await expect(vp).toHaveAttribute("data-parts", "14");
  await page.keyboard.press("Control+z");
  await expect(vp).toHaveAttribute("data-parts", "6");
});

test("a band between two rings pushes out on its own", async ({ page }) => {
  const vp = await ready(page);
  await box(page);
  await page.keyboard.press("k");
  await hover(page, [4, 11, 6], "object", 0, 0, "data-hover");
  await type(page, "/3");
  await expect(vp).toHaveAttribute("data-parts", "14");
  // The middle third of the top face, raised an inch: a bead across the block.
  await page.keyboard.press("p");
  await hover(page, [6, 6, 6], "on-face", 0, 0);
  const [x, y] = await at(page, [6, 6, 6]);
  await page.mouse.click(x, y);
  await type(page, "1");
  await expect(hint(page)).toContainText("Pulled 1 in");
  expect((await solids(page))[0].volume).toBeCloseTo(12 * 12 * 6 + 4 * 12 * 1, 3);
});
