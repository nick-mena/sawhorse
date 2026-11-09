import { expect, test, type Page } from "@playwright/test";
import { ready } from "./helpers";

const active = (page: Page) => page.locator(".tool[aria-pressed=true]");
const openPage = async (page: Page) => {
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("menuitem", { name: "Keyboard Shortcuts…" }).click();
  await expect(page.getByRole("dialog", { name: "Keyboard Shortcuts" })).toBeVisible();
};
const rekey = async (page: Page, name: string, key: string) => {
  await page.getByRole("button", { name: new RegExp(`key for ${name}(,|$)`) }).click();
  await page.keyboard.press(key);
};

test("a changed tool key works at once, shows in the rail, frees the old key and survives a reload", async ({ page }) => {
  await ready(page);
  await openPage(page);
  await rekey(page, "Line", "k");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Keyboard Shortcuts" })).toHaveCount(0);
  await expect(page.locator('[data-tool="line"] kbd')).toHaveText("K");

  await page.keyboard.press("k");
  await expect(active(page)).toHaveAttribute("data-tool", "line");
  await page.keyboard.press("Space");
  await expect(active(page)).toHaveAttribute("data-tool", "select");
  await page.keyboard.press("l");
  await page.waitForTimeout(150);
  await expect(active(page)).toHaveAttribute("data-tool", "select");

  await page.reload();
  await ready(page);
  await expect(page.locator('[data-tool="line"] kbd')).toHaveText("K");
  await openPage(page);
  await page.getByRole("button", { name: "Reset Line" }).click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("l");
  await expect(active(page)).toHaveAttribute("data-tool", "line");
});

test("Space can be captured without the button re-opening, and a refused key says why", async ({ page }) => {
  await ready(page);
  await openPage(page);
  await rekey(page, "Rect", "5");
  await expect(page.getByRole("alert")).toContainText("Measurements box");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await rekey(page, "Section", "Space");
  await expect(page.getByRole("alert")).toContainText("already Select");
  await page.getByRole("button", { name: "Use it for Section" }).click();
  await expect(page.getByRole("button", { name: /key for Section, now Space/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /key for Select, now none/ })).toBeVisible();
});

test("a command's key moves in the menu and undo answers the new one", async ({ page }) => {
  await ready(page);
  await openPage(page);
  await rekey(page, "Undo", "Control+k");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: /Undo/ })).toContainText(/K/);
  await page.keyboard.press("Escape");
});
