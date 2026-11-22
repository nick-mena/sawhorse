import { expect, test } from "@playwright/test";

import { ready } from "./helpers";

// What the 2026-11-21 UI audit measured cut off: the menus, the tool rail and the status line
// on short and narrow windows. Each check fails if the thing it names leaves the window.

const inWindow = (r: { top: number; bottom: number; left: number; right: number }, w: number, h: number) =>
  r.top >= 0 && r.left >= 0 && r.bottom <= h && r.right <= w;

test("at 1024 x 700 every tool is on screen and the Edit menu and its Units submenu stay in the window", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  await ready(page);
  const rail = await page.locator(".rail").evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
  expect(rail.sh, "the rail has to scroll to show every tool").toBeLessThanOrEqual(rail.ch);

  await page.getByRole("navigation", { name: "Menu" }).getByRole("button", { name: "Edit", exact: true }).click();
  const edit = page.getByRole("menu", { name: "Edit" });
  await edit.getByRole("menuitem", { name: "Units" }).click();
  const units = page.getByRole("menu", { name: "Units" });
  await expect(units).toBeVisible();
  for (const m of [edit, units]) {
    const r = await m.evaluate((el) => el.getBoundingClientRect().toJSON());
    expect(inWindow(r, 1024, 700), `${await m.getAttribute("aria-label")} menu leaves the window`).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(700);
});

test("at 860 x 600 the status line and its measurement box are on screen", async ({ page }) => {
  await page.setViewportSize({ width: 860, height: 600 });
  await ready(page);
  const r = await page.locator(".vcb").evaluate((el) => el.getBoundingClientRect().toJSON());
  expect(r.bottom).toBeLessThanOrEqual(600);
  await expect(page.getByLabel("Value")).toBeInViewport();
});
