import { expect, test } from "@playwright/test";
import { ready } from "./helpers";

const dialog = "Log Feedback";

test("Help > Log Feedback adds a note with the app's state, and the shortcut opens it too", async ({ page }) => {
  await ready(page);
  await page.getByRole("button", { name: "Help", exact: true }).click();
  await page.getByRole("menuitem", { name: /Log Feedback/ }).click();
  const box = page.getByRole("dialog", { name: dialog });
  await expect(box).toBeVisible();
  await expect(box.getByRole("button", { name: "Save to Log" })).toBeDisabled();

  // Typing goes to the note, not to the tools underneath.
  await page.keyboard.type("Rect was slow");
  await expect(page.locator(".tool[aria-pressed=true]")).toHaveAttribute("data-tool", "select");
  await box.getByRole("button", { name: "Save to Log" }).click();
  await expect(box).toHaveCount(0);
  await expect(page.getByRole("status").first()).toContainText("Added to your feedback log.");

  await page.keyboard.press("Control+Shift+F");
  await expect(box).toBeVisible();
  await page.keyboard.type("Second note");
  await page.keyboard.press("Control+Enter");
  await expect(box).toHaveCount(0);

  const log = await page.evaluate(() => localStorage.getItem("sawhorse.feedback"));
  expect(log).toContain("> Rect was slow");
  expect(log).toContain("> Second note");
  expect(log).toContain("- Working in: Model, Select tool");
  expect(log).toContain("- App: browser");
});
