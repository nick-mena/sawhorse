import { defineConfig, devices } from "@playwright/test";
import base, { TIMED } from "./playwright.config";

// The whole suite plus the stress group (e2e/model-cap.spec.ts, e2e/model-counts.spec.ts).
// Run this only when asked: npm run e2e:stress.
//
// Lane 16b: the stress specs run after every other spec, one at a time, so no other browser
// shares the machine while they measure it. On a four-CPU CI runner, model-cap's Materials
// pane measured 15.7 s once while the spec beside it built and deflated a 90 MB scene.json;
// its calibration, taken a moment before, could not know. See docs/DEVELOPMENT.md,
// "Responsiveness bounds in the end-to-end tests".
const channel = process.env.PW_CHANNEL || undefined;

export default defineConfig({
  ...base,
  projects: [...(base.projects ?? []), { name: "chromium-timed", testMatch: TIMED, dependencies: ["chromium"], workers: 1, use: { ...devices["Desktop Chrome"], channel, viewport: { width: 1440, height: 900 } } }],
});
