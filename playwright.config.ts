import { defineConfig, devices } from "@playwright/test";

// Local Windows runs use the installed Edge/Chrome (no browser download on a
// metered link): PW_CHANNEL=msedge npm run e2e. CI installs Playwright's Chromium.
const channel = process.env.PW_CHANNEL || undefined;
// PW_PORT lets parallel worktrees run their suites side by side without one reusing the
// other's preview server (reuseExistingServer is on locally).
const port = Number(process.env.PW_PORT || 4173);

// The stress group: the specs that time the window (frame gaps, refusals) at the model's
// limits. They take minutes and most of the machine, so a plain run leaves them out and they
// run only through playwright.stress.config.ts (npm run e2e:stress).
export const TIMED = /model-(cap|counts)\.spec\.ts$/;

// Lane 27: six workers locally. Playwright's default is half the CPUs (twelve on the 24-thread
// development machine), which passes on an idle machine but not beside other work: with 16
// threads of other load, three full runs at twelve workers failed 2, 1 and 3 specs (each a
// different interactive timing: a drag, a reload's kernel load, a refit), and three at six
// passed. CI keeps Playwright's default for its runner. Override with PW_WORKERS=<n> or
// --workers=<n> (docs/DEVELOPMENT.md).
const workers = process.env.PW_WORKERS ? Number(process.env.PW_WORKERS) : process.env.CI ? undefined : 6;

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  workers,
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", testIgnore: TIMED, use: { ...devices["Desktop Chrome"], channel, viewport: { width: 1440, height: 900 } } },
  ],
  // Lane 17: the specs run against their own build, the production build with the plugin
  // test hooks compiled in (dist-e2e/, scripts/e2e-serve.mjs); a release (npm run build, dist/)
  // has none. The build takes a minute or two, hence the timeout.
  webServer: {
    command: `node scripts/e2e-serve.mjs --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
});
