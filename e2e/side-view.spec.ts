import { expect, test, type Page } from "@playwright/test";
import { box, clickAt, near, point, ready, solids, type } from "./helpers";

// Level views (feedback log, 2026-11-09): with the ground edge-on there is nothing to land on,
// so a line in the Right view showed no preview and the click was lost.
const hint = (page: Page) => page.locator("#hint");
const hardEdges = (page: Page) => page.evaluate(() => (window as unknown as { __sawhorse: { edgeCounts(): { hard: number } } }).__sawhorse.edgeCounts().hard);
const right = async (page: Page) => {
  await page.getByRole("button", { name: "Right", exact: true }).first().click();
  await page.waitForTimeout(400);
};
const centre = async (page: Page) => {
  const b = (await page.locator("#cv").boundingBox())!;
  return [b.x + b.width / 2, b.y + b.height / 2];
};
const clickPx = async (page: Page, x: number, y: number) => {
  await page.mouse.move(x, y, { steps: 3 });
  await expect.poll(() => page.locator("main.vp").getAttribute("data-inference")).not.toBeNull();
  await page.waitForTimeout(120);
  await page.mouse.click(x, y);
  await page.waitForTimeout(150);
};

test("a line chain over empty space in the Right view is drawn and stays", async ({ page }) => {
  await ready(page);
  await right(page);
  await page.keyboard.press("l");
  const [cx, cy] = await centre(page);
  await clickPx(page, cx - 100, cy - 60);
  await expect(hint(page)).toContainText("Line started");
  const before = await hardEdges(page);
  await clickPx(page, cx + 80, cy - 90);
  await expect.poll(() => hardEdges(page)).toBeGreaterThan(before);
  // Level with its start would have put the rest on a plane this view cannot reach.
  await clickPx(page, cx + 80, cy + 40);
  const two = await hardEdges(page);
  expect(two).toBeGreaterThan(before + 1);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  expect(await hardEdges(page)).toBe(two);
});

test("a circle over empty space in the Right view faces you", async ({ page }) => {
  await ready(page);
  await right(page);
  await page.keyboard.press("c");
  const [cx, cy] = await centre(page);
  await clickPx(page, cx, cy - 60);
  await clickPx(page, cx + 60, cy - 60);
  await expect(hint(page)).toContainText("Circle");
  expect(await hardEdges(page)).toBeGreaterThan(0);
});

test("a line stopped partway across a face is kept when Esc ends it, in one undo", async ({ page }) => {
  await ready(page);
  await box(page);
  await right(page);
  await page.keyboard.press("l");
  const before = await hardEdges(page);
  for (const q of [[12, 3, 2], [12, 8, 2], [12, 8, 4]] as [number, number, number][]) {
    await clickAt(page, q, /.*/, 0, 0);
    await page.waitForTimeout(200);
  }
  await expect(hint(page)).toContainText("keeps the line");
  expect(await hardEdges(page)).toBe(before);
  await page.keyboard.press("Escape");
  await expect.poll(() => hardEdges(page)).toBe(before + 2);
  await expect(hint(page)).toContainText("Kept the line");
  await page.keyboard.press("Control+z");
  await expect.poll(() => hardEdges(page)).toBe(before);
});

test("a tap of Ctrl makes Push/Pull pull out a new face", async ({ page }) => {
  const vp = await ready(page);
  await box(page);
  await expect(vp).toHaveAttribute("data-objects", "1");
  await page.keyboard.press("p");
  await clickAt(page, [6, 6, 6], "on-face", 1, 1);
  await expect(hint(page)).toContainText(process.platform === "darwin" ? "Tap Cmd" : "Tap Ctrl");
  await page.keyboard.press("Control");
  await expect(hint(page)).toContainText("New face");
  await point(page, [6, 6, 9]);
  await type(page, "2");
  await expect(hint(page)).toContainText("Pulled a new face");
  const s = await solids(page);
  near(s[0].max, [12, 12, 8]);
  // The seam: more edges than the 12 of a plain box.
  expect(await hardEdges(page)).toBeGreaterThan(12);
});
