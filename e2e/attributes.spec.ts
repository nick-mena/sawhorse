import { expect, test, type Page } from "@playwright/test";

// The Attributes pane, the viewport bar and the top bar's panel buttons on the real kernel.
import { at, box, hover, ready, solids } from "./helpers";

const hint = (page: Page) => page.locator("#hint");

/** A 36 x 8 x 3 in board, selected whole. */
async function board(page: Page) {
  const vp = await ready(page);
  await box(page, "36,8", "3");
  await page.keyboard.press("Space");
  await hover(page, [18, 4, 3], /face|object/, 0, 0, "data-hover");
  const [x, y] = await at(page, [18, 4, 3]);
  await page.mouse.dblclick(x, y);
  await expect(vp).toHaveAttribute("data-selection", "1");
  return vp;
}

test("Attributes shows the selection's size and place, and typing changes them in one undo step each", async ({ page }) => {
  await board(page);
  const pane = page.getByTestId("attributes");
  await expect(pane.getByLabel("Size x")).toHaveValue("36");
  await expect(pane.getByLabel("Name")).toHaveAttribute("placeholder", "solid 1");

  await pane.getByLabel("Size x").fill("24");
  await pane.getByLabel("Size x").press("Enter");
  await expect(hint(page)).toContainText("Made solid 1 24 in along x");
  let [s] = await solids(page);
  expect(s.max[0] - s.min[0]).toBeCloseTo(24, 4);
  expect(s.min[0]).toBeCloseTo(0, 4);

  await pane.getByLabel("Position z").fill("10");
  await pane.getByLabel("Position z").press("Enter");
  await expect(pane.getByLabel("Position z")).toHaveValue("10");
  [s] = await solids(page);
  expect(s.min[2]).toBeCloseTo(10, 4);

  await pane.getByLabel("Name").fill("Seat rail");
  await pane.getByLabel("Name").press("Enter");
  await expect(hint(page)).toContainText("Renamed it 'Seat rail'");

  await pane.getByLabel("Size y").fill("0");
  await pane.getByLabel("Size y").press("Enter");
  await expect(hint(page)).toContainText("more than zero");

  // Esc leaves the field; then each change undoes on its own: the name, then the move.
  await pane.getByLabel("Size y").press("Escape");
  await page.keyboard.press("Control+z");
  await expect(pane.getByLabel("Name")).toHaveValue("");
  await page.keyboard.press("Control+z");
  await expect(pane.getByLabel("Position z")).toHaveValue("0");
});

test("the viewport bar switches what the view draws, and the panel buttons put the panel away", async ({ page }) => {
  await ready(page);
  const bar = page.getByRole("toolbar", { name: "Viewport" });
  const grid = bar.getByRole("button", { name: "Grid" });
  await expect(grid).toHaveAttribute("aria-pressed", "true");
  await grid.click();
  await expect(grid).toHaveAttribute("aria-pressed", "false");
  await expect(hint(page)).toContainText("Grid hidden");

  await bar.getByRole("button", { name: "X-ray" }).click();
  await expect(bar.getByRole("button", { name: "X-ray" })).toHaveAttribute("aria-pressed", "true");

  // The views moved here from the top bar.
  await bar.getByRole("button", { name: "Top", exact: true }).click();
  await expect(page.locator("main.vp")).toHaveAttribute("data-view", "top");

  const side = page.getByRole("complementary", { name: "Panels" });
  const dock = page.getByRole("button", { name: "Attributes" });
  await expect(dock).toHaveAttribute("aria-pressed", "true");
  await dock.click();
  await expect(side).toBeHidden();
  await page.getByRole("button", { name: "Outliner" }).click();
  await expect(side).toBeVisible();
  await expect(page.getByRole("tab", { name: "Outliner" })).toHaveAttribute("aria-selected", "true");

  await bar.getByRole("button", { name: "Viewport Panels" }).click();
  await page.getByRole("menuitem", { name: "Hide Side Panel" }).click();
  await expect(side).toBeHidden();
});
