import { expect, test, type Page } from "@playwright/test";

// The Joint tool on the real kernel: a part cuts another and stays; Ctrl+click adds; a
// refusal says why and changes nothing.
import { at, box, clickAt, hover, IN, point, ready, selectAt, solids, type } from "./helpers";
import { buildShz, openShz } from "./shz";

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

// ADR-0015 step 1: a named joint on the real kernel. A 1-3/4 in leg and a 3/4 x 3 in rail
// butted against it; Alt steps the tool to Mortise and Tenon, and the defaults cut a
// 1/4 x 2-1/2 x 1-3/16 in tenon and its mortise, listed in the Attributes pane.
test("Mortise and Tenon cuts both boards with woodworker's defaults and lists the joint", async ({ page }) => {
  const rect = (apply: (op: object) => Record<string, unknown>, z: number, x0: number, x1: number, y0: number, y1: number, h: number) => {
    const drawn = apply({ op: "draw", target: { on: "plane", origin: [0, 0, z * IN], normal: [0, 0, 1] }, points: [[x0 * IN, y0 * IN, z * IN], [x1 * IN, y0 * IN, z * IN], [x1 * IN, y1 * IN, z * IN], [x0 * IN, y1 * IN, z * IN]], closed: true });
    apply({ op: "extrude", sketch: drawn.sketch, region: drawn.inside, distance: h * IN });
  };
  const shz = await buildShz((apply) => {
    rect(apply, 0, 0, 1.75, 0, 1.75, 28);
    rect(apply, 20, 1.75, 11.75, 0.5, 1.25, 3);
  });
  await openShz(page, shz, 2, "leg-and-rail.shz");
  const vp = page.locator("main.vp");
  await page.locator('[data-tool="joint"]').click();
  await page.keyboard.press("Alt");
  await expect(hint(page)).toContainText("tenon");
  await selectAt(page, [6, 0.9, 23], "object");
  await selectAt(page, [0.9, 0.9, 28], "object");
  await expect(hint(page)).toContainText("Mortise and tenon");
  await expect(vp).toHaveAttribute("data-objects", "2");
  const tenon = 0.25 * 2.5 * 1.1875;
  const [leg, rail] = await solids(page);
  expect(leg.volume).toBeCloseTo(1.75 * 1.75 * 28 - tenon, 3);
  expect(rail.volume).toBeCloseTo(0.75 * 3 * 10 + tenon, 3);
  await page.keyboard.press("Space");
  await hover(page, [0.9, 0.9, 28], /face|object/, 0, 0, "data-hover");
  const [lx, ly] = await at(page, [0.9, 0.9, 28]);
  await page.mouse.dblclick(lx, ly);
  await expect(vp).toHaveAttribute("data-selection", "1");
  await page.getByRole("tab", { name: "Attributes" }).click();
  await expect(page.getByTestId("attr-joints")).toContainText("Mortise");
  // One undo step puts both boards back.
  await page.locator("main.vp").focus();
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await solids(page)).map((s) => Math.round(s.volume * 1000) / 1000)).toEqual([85.75, 22.5]);
});
