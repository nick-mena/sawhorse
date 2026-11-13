import { expect, test, type Page } from "@playwright/test";
import { ready, solids } from "./helpers";

// The CNC workspace, end to end: draw, check, bring in, keep, reopen.
const open = async (page: Page) => {
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.getByRole("menuitem", { name: /CNC/ }).click();
  await expect(page.getByRole("dialog", { name: "CNC drawing" })).toBeVisible();
  const b = (await page.getByTestId("cnc-board").boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const click = async (page: Page, x: number, y: number) => {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
};
const curve = async (page: Page, x: number, y: number, dx: number, dy: number) => {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
};
const IN_PX = 1200 * 0.0254; // the board opens at 1200 pixels a metre
const part = (page: Page) => page.locator(".cnc-panel section").first();
const bringIn = (page: Page) => page.getByRole("button", { name: "Bring In", exact: true });

test("a curved outline with a hole becomes one watertight part that follows the cursor", async ({ page }) => {
  const vp = await ready(page);
  const c = await open(page);
  await expect(bringIn(page)).toBeDisabled();
  await click(page, c.x - 150, c.y + 80);
  await curve(page, c.x, c.y - 100, 90, 0);
  await click(page, c.x + 150, c.y + 80);
  await expect(part(page)).toContainText("Still drawing");
  await click(page, c.x - 150, c.y + 80);
  await expect(part(page)).toContainText("Ready to bring in: 1 part");
  await page.keyboard.press("c");
  await page.mouse.move(c.x, c.y + 10);
  await page.mouse.down();
  await page.mouse.move(c.x + 25, c.y + 10, { steps: 3 });
  await page.mouse.up();
  await expect(part(page)).toContainText("1 part, 1 hole");
  await bringIn(page).click();
  await expect(page.getByRole("dialog", { name: "CNC drawing" })).toBeHidden();
  await expect(vp).toHaveAttribute("data-objects", "1");
  await expect(vp).toHaveAttribute("data-watertight", "true");
  await expect(page.locator("#hint")).toContainText("Moving");
  const s = await solids(page);
  expect(s[0].max[2] - s[0].min[2]).toBeCloseTo(0.75, 3);
  // Curved walls blend into one surface; only the corners and the two faces' rims are hard.
  const edges = await page.evaluate(() => (window as unknown as { __sawhorse: { edgeCounts(): { hard: number; soft: number } } }).__sawhorse.edgeCounts());
  expect(edges.soft).toBeGreaterThan(20);
  await page.keyboard.press("Escape");
  // The drawing and the part are one undo step.
  await page.keyboard.press("Control+z");
  await expect(vp).toHaveAttribute("data-objects", "0");
});

test("a shape crossing another says so, and Bring In waits for the fix", async ({ page }) => {
  await ready(page);
  const c = await open(page);
  await page.keyboard.press("r");
  await curve(page, c.x - 100, c.y - 60, 200, 120);
  await curve(page, c.x + 50, c.y, 200, 120);
  await expect(part(page)).toContainText("cross or touch");
  await expect(bringIn(page)).toBeDisabled();
  await page.keyboard.press("Control+z");
  await expect(part(page)).toContainText("Ready to bring in");
  await expect(bringIn(page)).toBeEnabled();
});

test("Close keeps the drawing with the model and reopening shows it, and model keys stay out", async ({ page }) => {
  await ready(page);
  const c = await open(page);
  await page.keyboard.press("r");
  await curve(page, c.x - 100, c.y - 60, 200, 120);
  // m is the model's Move: inside the workspace it must do nothing.
  await page.keyboard.press("m");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "CNC drawing" })).toBeHidden();
  await expect(page.locator("#hint")).toContainText("Kept the drawing");
  await expect(page.locator('.rail .tool[aria-pressed="true"] small')).not.toHaveText("Move");
  await open(page);
  await expect(part(page)).toContainText("Ready to bring in: 1 part");
});

test("mirror: a half drawn on the center line closes into a part", async ({ page }) => {
  await ready(page);
  const c = await open(page);
  await page.getByLabel("Mirror about a center line").check();
  // The view starts centred on x = 0, so the middle of the board is the line.
  await page.keyboard.press("l");
  await click(page, c.x, c.y + 80);
  await click(page, c.x + 120, c.y);
  await click(page, c.x, c.y - 80);
  await page.keyboard.press("Enter");
  await expect(part(page)).toContainText("Ready to bring in: 1 part");
});

test("a reference image scales to a real size and comes back with the drawing", async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await ready(page);
  const c = await open(page);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==", "base64");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add Image…" }).click();
  await (await chooser).setFiles({ name: "horse.png", mimeType: "image/png", buffer: png });
  await expect(page.locator(".cnc-svg image")).toHaveCount(1);
  const before = Number(await page.locator(".cnc-svg image").getAttribute("width"));
  await page.getByRole("button", { name: "Set Scale" }).click();
  await click(page, c.x - 50, c.y);
  await click(page, c.x + 50, c.y);
  await page.getByLabel("Real distance").fill("12");
  await page.keyboard.press("Enter");
  await expect(page.locator(".cnc-status")).toContainText("to scale");
  await expect.poll(async () => Number(await page.locator(".cnc-svg image").getAttribute("width"))).not.toBe(before);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "CNC drawing" })).toBeHidden();
  await open(page);
  await expect(page.locator(".cnc-svg image")).toHaveCount(1);
  await expect(page.locator(".cnc-panel")).not.toContainText("not in this model");
});

const nodesOf = async (page: Page) => page.locator(".cnc-node").count();

test("the Curve tool runs through clicks; the Node tool bends a line", async ({ page }) => {
  await ready(page);
  const c = await open(page);
  await page.keyboard.press("u");
  await click(page, c.x - 150, c.y + 60);
  await click(page, c.x, c.y - 90);
  await click(page, c.x + 150, c.y + 60);
  await page.mouse.move(c.x - 150, c.y + 60);
  await click(page, c.x - 150, c.y + 60);
  await expect(part(page)).toContainText("Ready to bring in: 1 part");
  const before = await page.locator(".cnc-path").getAttribute("d");
  expect(before).toContain("C");
  await page.keyboard.press("n");
  // The bottom of the shape; dragging it bends the line without moving the points.
  const on = await page.locator(".cnc-path").evaluate((el) => {
    const path = el as SVGPathElement;
    const q = path.getPointAtLength(path.getTotalLength() * 0.83);
    const box = path.ownerSVGElement!.getBoundingClientRect();
    return { x: box.x + q.x, y: box.y + q.y };
  });
  await page.mouse.move(on.x, on.y);
  await page.mouse.down();
  await page.mouse.move(on.x, on.y + 70, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => page.locator(".cnc-path").getAttribute("d")).not.toBe(before);
  expect(await nodesOf(page)).toBe(3);
});

test("the Pencil makes a closed stroke a shape with a handful of points", async ({ page }) => {
  await ready(page);
  const c = await open(page);
  await page.keyboard.press("b");
  await page.mouse.move(c.x + 100, c.y);
  await page.mouse.down();
  for (let i = 1; i <= 60; i++) {
    const a = (i / 60) * 2 * Math.PI;
    await page.mouse.move(c.x + 100 * Math.cos(a), c.y + 100 * Math.sin(a));
  }
  await page.mouse.up();
  await expect(part(page)).toContainText("Ready to bring in: 1 part");
  await page.keyboard.press("n");
  const n = await nodesOf(page);
  expect(n).toBeGreaterThan(1);
  expect(n).toBeLessThan(20);
});

test("the panel resizes a selected shape exactly, and a corner rounds to a radius", async ({ page }) => {
  await ready(page);
  const c = await open(page);
  await page.keyboard.press("r");
  await curve(page, c.x - 100, c.y - 50, 200, 100);
  await page.keyboard.press("Space");
  await click(page, c.x, c.y);
  await page.getByRole("textbox", { name: "Width", exact: true }).fill("24");
  await page.getByRole("textbox", { name: "Height", exact: true }).focus();
  await expect(page.locator(".cnc-size")).toContainText("24");
  // Enter in a panel field leaves the tool keys working.
  await page.getByRole("textbox", { name: "Height", exact: true }).press("Enter");
  await page.keyboard.press("n");
  const corner = await page.locator(".cnc-node").nth(1).boundingBox();
  await click(page, corner!.x + 3.5, corner!.y + 3.5);
  await page.getByPlaceholder("radius").fill("1");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect.poll(() => nodesOf(page)).toBe(5);
  await expect(part(page)).toContainText("Ready to bring in");
});

test("after Round corner, with Enter or Apply, the tool keys still work", async ({ page }) => {
  await ready(page);
  const c = await open(page);
  await page.keyboard.press("r");
  await curve(page, c.x - 100, c.y - 50, 200, 100);
  await page.keyboard.press("n");
  const corner = await page.locator(".cnc-node").nth(1).boundingBox();
  await click(page, corner!.x + 3.5, corner!.y + 3.5);
  await page.getByPlaceholder("radius").fill("1");
  await page.getByPlaceholder("radius").press("Enter");
  await expect.poll(() => nodesOf(page)).toBe(5);
  // The rounded point is gone, and its field with it; the keys still reach the tools.
  await page.keyboard.press("l");
  await expect(page.locator('.cnc-rail .tool[aria-pressed="true"] small')).toHaveText("Line");
  await page.keyboard.press("n");
  const next = await page.locator(".cnc-node").nth(3).boundingBox();
  await click(page, next!.x + 3.5, next!.y + 3.5);
  await page.getByPlaceholder("radius").fill("1");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect.poll(() => nodesOf(page)).toBe(6);
  await page.keyboard.press("a");
  await expect(page.locator('.cnc-rail .tool[aria-pressed="true"] small')).toHaveText("Arc");
});

test("a new tool starts with its own hint, and a refusal reads once", async ({ page }) => {
  await ready(page);
  const c = await open(page);
  const status = page.getByRole("status").filter({ hasText: /\./ }).first();
  await page.keyboard.press("t");
  await page.keyboard.press("Control");
  await expect(page.locator(".cnc-status")).toContainText("Measure only: nothing is added");
  await page.keyboard.press("l");
  await expect(page.locator(".cnc-status")).not.toContainText("Measure only");
  // A held angle's note goes with the line.
  await click(page, c.x, c.y);
  await vcb(page, "<45");
  await expect(page.locator(".cnc-status")).toContainText("Held at 45°");
  await page.keyboard.press("c");
  await expect(page.locator(".cnc-status")).not.toContainText("Held");
  // A refusal: "Can't do that." once, then why.
  await page.keyboard.press("t");
  await click(page, c.x, c.y);
  await vcb(page, "3");
  await expect(page.locator(".cnc-status")).toContainText("Can't do that. ");
  await expect(page.locator(".cnc-status")).not.toContainText("..");
  void status;
});

test("the drawing stays put under the pointer when the hint below it wraps", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 800 });
  await ready(page);
  await open(page);
  const settled = () => page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  await settled();
  const axisY = async () => (await page.getByTestId("cnc-board").boundingBox())!.y + Number(await page.locator(".cnc-axis").nth(1).getAttribute("y1"));
  const footer = async () => (await page.locator(".cnc-status").boundingBox())!.height;
  await page.keyboard.press("l");
  const shortHint = await footer();
  const before = await axisY();
  await page.keyboard.press("t");
  // At this width the Tape's hint and its switch take two lines.
  await expect.poll(footer).toBeGreaterThan(shortHint);
  await settled();
  expect(await axisY()).toBeCloseTo(before, 1);
});

test("Bring In names the part after the drawing", async ({ page }) => {
  await ready(page);
  const c = await open(page);
  await page.keyboard.press("r");
  await curve(page, c.x - 100, c.y - 50, 200, 100);
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Rocker");
  await page.getByRole("textbox", { name: "Name", exact: true }).press("Enter");
  await bringIn(page).click();
  await expect(page.getByRole("dialog", { name: "CNC drawing" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator(".outliner, [data-testid=outliner]").first()).toContainText("Rocker");
});


test("Tape: a reference line off the axis at a typed distance, that drawing snaps to and that is kept", async ({ page }) => {
  await ready(page);
  const c = await open(page);
  await page.keyboard.press("t");
  await click(page, c.x + 200, c.y);
  await page.mouse.move(c.x + 200, c.y - 60);
  await page.getByLabel("Distance", { exact: true }).fill("3");
  await page.keyboard.press("Enter");
  const ref = page.locator(".cnc-ref");
  await expect(ref).toHaveCount(1);
  const y = Number(await ref.getAttribute("y1"));
  expect(y).toBeCloseTo((await page.getByTestId("cnc-board").boundingBox())!.height / 2 - 3 * IN_PX, 1);
  // A corner dropped three pixels off the line lands on it.
  const top = (await page.getByTestId("cnc-board").boundingBox())!.y;
  await page.keyboard.press("r");
  await curve(page, c.x - 80, top + y + 3, 160, 60);
  const d = (await page.locator(".cnc-path").getAttribute("d"))!;
  expect(Number(d.split(" ")[1].split("L")[0])).toBeCloseTo(y, 1);
  await expect(part(page)).toContainText("Ready to bring in: 1 part");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await open(page);
  await expect(page.locator(".cnc-ref")).toHaveCount(1);
  // Select takes it; Delete removes it, and undo brings it back.
  await page.keyboard.press("Space");
  // Reopening fits the view to the drawing, so the line has moved on screen.
  const board = (await page.getByTestId("cnc-board").boundingBox())!;
  await click(page, board.x + 12, top + Number(await page.locator(".cnc-ref").getAttribute("y1")));
  await expect(page.getByRole("button", { name: "Delete Line" })).toBeVisible();
  await page.keyboard.press("Delete");
  await expect(page.locator(".cnc-ref")).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".cnc-ref")).toHaveCount(1);
});

test("Tape: Reference line mode adds lines; a tap of Ctrl switches to Measure only, which adds nothing", async ({ page }) => {
  await ready(page);
  const c = await open(page);
  await page.keyboard.press("r");
  await curve(page, c.x - 100, c.y - 50, 200, 100);
  await page.keyboard.press("t");
  await expect(page.getByRole("radio", { name: "Reference line" })).toBeChecked();
  // Pressed on the top edge and dragged away: a parallel line.
  await curve(page, c.x + 20, c.y - 50, 0, -40);
  await expect(page.locator(".cnc-ref")).toHaveCount(1);
  await expect(page.locator(".cnc-status")).toContainText("Reference line");
  // Corner to corner: a reference line through both.
  await click(page, c.x - 100, c.y - 50);
  await click(page, c.x + 100, c.y + 50);
  await expect(page.locator(".cnc-ref")).toHaveCount(2);
  // A tap of Ctrl: measure only.
  await page.keyboard.press("Control");
  await expect(page.getByRole("radio", { name: "Measure only" })).toBeChecked();
  await click(page, c.x - 100, c.y - 50);
  await click(page, c.x + 100, c.y - 50);
  await expect(page.locator(".cnc-tape-label")).toBeVisible();
  await expect(page.locator(".cnc-status")).toContainText("across");
  // From an edge: the distance square to it, and still nothing added.
  await click(page, c.x - 40, c.y + 50);
  await click(page, c.x + 10, c.y - 30);
  await expect(page.locator(".cnc-status")).toContainText("square to that line");
  await expect(page.locator(".cnc-ref")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(page.locator(".cnc-tape-label")).toHaveCount(0);
  // The switch works by clicking too, and the choice is kept for next time.
  await page.getByRole("radio", { name: "Reference line" }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await open(page);
  await page.keyboard.press("t");
  await expect(page.getByRole("radio", { name: "Reference line" })).toBeChecked();
});

test("the feedback shortcut opens the log over the CNC workspace and records where it was", async ({ page }) => {
  await ready(page);
  await open(page);
  await page.keyboard.press("l");
  await page.keyboard.press("Control+Shift+F");
  const box = page.getByRole("dialog", { name: "Log Feedback" });
  await expect(box).toBeVisible();
  await page.keyboard.type("Tape was confusing");
  await page.keyboard.press("Control+Enter");
  await expect(box).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "CNC drawing" })).toBeVisible();
  await expect(page.locator(".cnc-status")).toContainText("Added to your feedback log.");
  const log = await page.evaluate(() => localStorage.getItem("sawhorse.feedback"));
  expect(log).toContain("> Tape was confusing");
  expect(log).toContain("- Working in: CNC, Line tool");
});

// ---- the model's controls ------------------------------------------------------------------

const box = async (page: Page, c: { x: number; y: number }, dx = 0) => {
  await page.keyboard.press("r");
  await curve(page, c.x - 100 + dx, c.y - 50, 200, 100);
};
const vcb = async (page: Page, text: string) => {
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
};
const paths = (page: Page) => page.locator(".cnc-path").count();
const selected = (page: Page) => page.locator(".cnc-path.sel").count();

test("Select: click, Shift adds, Ctrl toggles, a window and a crossing box, Delete", async ({ page }) => {
  await ready(page);
  const c = await open(page);
  await box(page, c, -160);
  await box(page, c, 160);
  await page.keyboard.press("Space");
  await click(page, c.x - 160, c.y - 50);
  await expect.poll(() => selected(page)).toBe(1);
  await page.keyboard.down("Shift");
  await click(page, c.x + 160, c.y - 50);
  await page.keyboard.up("Shift");
  await expect.poll(() => selected(page)).toBe(2);
  await page.keyboard.down("Control");
  await click(page, c.x + 160, c.y - 50);
  await page.keyboard.up("Control");
  await expect.poll(() => selected(page)).toBe(1);
  await page.keyboard.press("Escape");
  await expect.poll(() => selected(page)).toBe(0);
  // Left to right takes what is wholly inside: only the left box.
  await curve(page, c.x - 290, c.y - 80, 280, 160);
  await expect(page.locator(".cnc-status")).toContainText("Window selection: 1 shape");
  // Right to left takes what it touches: both.
  await curve(page, c.x + 80, c.y + 80, -200, -160);
  await expect(page.locator(".cnc-status")).toContainText("Crossing selection: 2 shapes");
  await page.keyboard.press("Delete");
  await expect.poll(() => paths(page)).toBe(0);
  await page.keyboard.press("Control+z");
  await expect.poll(() => paths(page)).toBe(2);
});

test("Erase opens a shape where a line goes; Line joins to it and closes it again", async ({ page }) => {
  await ready(page);
  const c = await open(page);
  await box(page, c);
  await page.keyboard.press("e");
  await click(page, c.x, c.y + 50);
  await expect(part(page)).toContainText("open");
  await page.keyboard.press("l");
  await click(page, c.x - 100, c.y + 50);
  await click(page, c.x + 100, c.y + 50);
  await expect(page.locator(".cnc-status")).toContainText("closed");
  await expect(part(page)).toContainText("Ready to bring in: 1 part");
  await expect.poll(() => paths(page)).toBe(1);
});

test("Line takes a typed length; Arc takes a typed radius", async ({ page }) => {
  await ready(page);
  const c = await open(page);
  await page.keyboard.press("l");
  await click(page, c.x - 100, c.y);
  await page.mouse.move(c.x, c.y, { steps: 2 });
  await vcb(page, "10");
  await page.keyboard.press("Escape");
  // The board opens at 1200 pixels a metre: 10 in is 304.8 pixels.
  expect(await page.locator(".cnc-path").first().evaluate((el) => (el as SVGPathElement).getTotalLength())).toBeCloseTo(10 * IN_PX, 0);
  await page.keyboard.press("a");
  await click(page, c.x - 60, c.y + 120);
  await click(page, c.x + 60, c.y + 120);
  await page.mouse.move(c.x, c.y + 160, { steps: 2 });
  await vcb(page, "3r");
  await expect(page.locator(".cnc-status")).toContainText("Arc drawn");
  await expect.poll(() => paths(page)).toBe(2);
});

test("Move: pick up and type a distance; a tap of Ctrl copies, and x3 makes an array", async ({ page }) => {
  await ready(page);
  const c = await open(page);
  await box(page, c);
  await page.keyboard.press("Space");
  await page.keyboard.press("Escape");
  await page.keyboard.press("m");
  await click(page, c.x - 100, c.y - 50);
  await page.mouse.move(c.x - 40, c.y - 50, { steps: 3 });
  await vcb(page, "12");
  await expect(page.locator(".cnc-status")).toContainText("Moved 12");
  await page.keyboard.press("Control");
  await click(page, c.x + 30, c.y - 50);
  await page.mouse.move(c.x + 30, c.y - 120, { steps: 3 });
  await vcb(page, "6");
  await expect(page.locator(".cnc-status")).toContainText("Copied 6");
  await expect.poll(() => paths(page)).toBe(2);
  await vcb(page, "x3");
  await expect.poll(() => paths(page)).toBe(4);
  // One undo takes the array back to where the copy began.
  await page.keyboard.press("Control+z");
  await expect.poll(() => paths(page)).toBe(1);
});

test("Rotate turns by a typed angle; Scale drags a grip; Offset makes a typed inset", async ({ page }) => {
  await ready(page);
  const c = await open(page);
  await box(page, c);
  await page.keyboard.press("q");
  await click(page, c.x, c.y);
  await click(page, c.x + 80, c.y);
  await vcb(page, "90");
  await expect(page.locator(".cnc-status")).toContainText("Turned 90");
  await expect(page.locator(".cnc-size")).toContainText(/× ~? ?\d/);
  const turned = await page.locator(".cnc-size").innerText();
  await page.keyboard.press("s");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Space");
  await click(page, c.x, c.y - 100);
  await page.keyboard.press("s");
  const grip = page.locator(".cnc-box-handle").nth(7);
  const g = (await grip.boundingBox())!;
  await curve(page, g.x + 4, g.y + 4, 40, 40);
  await expect(page.locator(".cnc-status")).toContainText("Scaled");
  expect(await page.locator(".cnc-size").innerText()).not.toBe(turned);
  await page.keyboard.press("f");
  await click(page, c.x, c.y);
  await page.mouse.move(c.x + 5, c.y + 5, { steps: 2 });
  await vcb(page, "1");
  await expect(page.locator(".cnc-status")).toContainText("Offset 1");
  await expect.poll(() => paths(page)).toBe(2);
  await expect(part(page)).toContainText("1 hole");
});

test("the model's keys reach the matching tools, and its Copy and Paste work here", async ({ page }) => {
  await ready(page);
  const c = await open(page);
  for (const [key, label] of [["Space", "Select"], ["e", "Erase"], ["l", "Line"], ["a", "Arc"], ["m", "Move"], ["q", "Rotate"], ["s", "Scale"], ["f", "Offset"], ["t", "Tape"]] as const) {
    await page.keyboard.press(key);
    await expect(page.locator('.cnc-rail .tool[aria-pressed="true"] small')).toHaveText(label);
  }
  // P is Push/Pull in the model, and does nothing here.
  await page.keyboard.press("p");
  await expect(page.locator('.cnc-rail .tool[aria-pressed="true"] small')).toHaveText("Tape");
  await box(page, c);
  await page.keyboard.press("Space");
  await click(page, c.x, c.y - 50);
  await page.keyboard.press("Control+c");
  await page.mouse.move(c.x + 200, c.y + 150);
  await page.keyboard.press("Control+v");
  await expect.poll(() => paths(page)).toBe(2);
});

test("with Snap to the grid on, an arc's ends land on the grid, and a line moved by its end does too", async ({ page }) => {
  await ready(page);
  const c = await open(page);
  // Ticking the box keeps its focus; the tool keys must still work.
  await page.getByLabel("Snap to the grid").check();
  await page.keyboard.press("a");
  await expect(page.locator(".cnc-status")).toContainText("Arc.");
  const lines = await page.locator(".cnc-grid line").evaluateAll((ls) => ls.map((l) => ({ x: Number(l.getAttribute("x1")), y: Number(l.getAttribute("y1")), upright: l.getAttribute("x1") === l.getAttribute("x2") })));
  const xs = lines.filter((l) => l.upright).map((l) => l.x);
  const ys = lines.filter((l) => !l.upright).map((l) => l.y);
  const ends = async () => {
    const n = ((await page.locator(".cnc-path").last().getAttribute("d"))!.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    return [[n[0], n[1]], [n[n.length - 2], n[n.length - 1]]];
  };
  const onGrid = ([x, y]: number[]) => xs.some((g) => Math.abs(g - x) < 0.05) && ys.some((g) => Math.abs(g - y) < 0.05);
  await click(page, c.x - 63, c.y + 47);
  await click(page, c.x + 58, c.y + 41);
  await click(page, c.x + 3, c.y + 90);
  await expect(page.locator(".cnc-status")).toContainText("Arc drawn");
  for (const end of await ends()) expect(onGrid(end), `arc end ${end}`).toBe(true);
  // A line drawn off the grid, then moved by its end onto the grid.
  await page.getByLabel("Snap to the grid").uncheck();
  await page.keyboard.press("l");
  await click(page, c.x - 61, c.y - 83);
  await click(page, c.x + 37, c.y - 129);
  await page.keyboard.press("Escape");
  expect(onGrid((await ends())[0])).toBe(false);
  await page.getByLabel("Snap to the grid").check();
  await page.keyboard.press("m");
  await click(page, c.x - 61, c.y - 83);
  await click(page, c.x - 20, c.y - 20);
  expect(onGrid((await ends())[0])).toBe(true);
});

// ---- the protractor and angles, as AutoCAD's dynamic input and polar tracking ----------------

const segments = async (page: Page) => {
  const n = ((await page.locator(".cnc-path").last().getAttribute("d"))!.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  const pts: [number, number][] = [];
  for (let i = 0; i + 1 < n.length; i += 2) pts.push([n[i], n[i + 1]]);
  return pts;
};
/** A segment's length (pixels) and angle (degrees, counterclockwise from the right, as on screen). */
const polar = (a: [number, number], b: [number, number]) => ({ l: Math.hypot(b[0] - a[0], b[1] - a[1]), deg: (Math.atan2(a[1] - b[1], b[0] - a[0]) * 180) / Math.PI });

test("Line: 10<30 typed, then Tab from length to angle, and the protractor tracks 15 degree steps", async ({ page }) => {
  await ready(page);
  const c = await open(page);
  await page.keyboard.press("l");
  await click(page, c.x - 200, c.y + 150);
  await page.mouse.move(c.x, c.y + 40, { steps: 3 });
  await expect(page.locator(".cnc-protractor.aim")).toBeVisible();
  await vcb(page, "10<30");
  let p = await segments(page);
  let s = polar(p[0], p[1]);
  expect(s.l).toBeCloseTo(10 * IN_PX, 0);
  expect(s.deg).toBeCloseTo(30, 1);
  // Five inches at -45: the length, Tab, the angle, Enter.
  await page.mouse.move(c.x + 100, c.y + 200, { steps: 3 });
  await page.keyboard.type("5");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Angle", { exact: true })).toBeFocused();
  await page.keyboard.type("-45");
  await page.keyboard.press("Enter");
  p = await segments(page);
  s = polar(p[1], p[2]);
  expect(s.l).toBeCloseTo(5 * IN_PX, 0);
  expect(s.deg).toBeCloseTo(-45, 1);
  // An aim three pixels off 60 degrees lands on it.
  const from = p[2];
  const board = (await page.getByTestId("cnc-board").boundingBox())!;
  const r = 160;
  const t = (60 * Math.PI) / 180;
  await click(page, board.x + from[0] + r * Math.cos(t) + 3, board.y + from[1] - r * Math.sin(t));
  p = await segments(page);
  expect(polar(p[2], p[3]).deg).toBeCloseTo(60, 2);
  // With the protractor off, the same aim is left where it is.
  await page.getByLabel("Protractor", { exact: true }).uncheck();
  const f2 = p[3];
  await page.mouse.move(board.x + f2[0] + r * Math.cos(t) + 3, board.y + f2[1] - r * Math.sin(t), { steps: 3 });
  await expect(page.locator(".cnc-protractor.aim")).toHaveCount(0);
  await click(page, board.x + f2[0] + r * Math.cos(t) + 3, board.y + f2[1] - r * Math.sin(t));
  p = await segments(page);
  expect(Math.abs(polar(p[3], p[4]).deg - 60)).toBeGreaterThan(0.5);
});

test("Line: a length held with Tab shows in its box when Tab comes back to it", async ({ page }) => {
  await ready(page);
  const c = await open(page);
  await page.keyboard.press("l");
  await click(page, c.x, c.y);
  await page.mouse.move(c.x + 100, c.y - 20, { steps: 3 });
  await page.keyboard.type("4");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Angle", { exact: true })).toBeFocused();
  await page.keyboard.type("20");
  await page.keyboard.press("Tab");
  const length = page.getByLabel("Length", { exact: true });
  await expect(length).toBeFocused();
  await expect(length).toHaveValue(/^~? ?4/);
  // Typing replaces it.
  await page.keyboard.type("6");
  await page.keyboard.press("Enter");
  const p = await segments(page);
  const s = polar(p[0], p[1]);
  expect(s.l).toBeCloseTo(6 * IN_PX, 0);
  expect(s.deg).toBeCloseTo(20, 1);
});

test("Tape: a reference line through a point at a typed angle, and one at an angle to an edge", async ({ page }) => {
  await ready(page);
  const c = await open(page);
  const refAngle = async (i: number) => {
    const l = page.locator(".cnc-ref").nth(i);
    const [x1, y1, x2, y2] = await Promise.all(["x1", "y1", "x2", "y2"].map(async (k) => Number(await l.getAttribute(k))));
    const deg = (Math.atan2(y1 - y2, x2 - x1) * 180) / Math.PI;
    return ((deg % 180) + 180) % 180;
  };
  await page.keyboard.press("t");
  await click(page, c.x + 150, c.y - 120);
  await vcb(page, "<30");
  await expect(page.locator(".cnc-ref")).toHaveCount(1);
  expect(await refAngle(0)).toBeCloseTo(30, 1);
  await expect(page.locator(".cnc-status")).toContainText("30°");
  // Off a rectangle's top edge: Tab to the angle, 45 to that edge.
  await page.keyboard.press("r");
  await curve(page, c.x - 260, c.y + 40, 200, 100);
  await page.keyboard.press("t");
  await click(page, c.x - 160, c.y + 40);
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Angle", { exact: true })).toBeFocused();
  await page.keyboard.type("45");
  await page.keyboard.press("Enter");
  await expect(page.locator(".cnc-ref")).toHaveCount(2);
  expect(await refAngle(1)).toBeCloseTo(45, 1);
});
