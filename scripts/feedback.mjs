// Prints the feedback log's entries that have not been reviewed, and the short list of what
// is still open, so a review costs what is new and not the whole history. The log itself is
// the app's and is only ever read here; how far review has got is kept in a file beside it.
//
//   npm run feedback                 what is new, and what is open
//   npm run feedback -- --mark       everything so far has been reviewed
//   npm run feedback -- --mark 20    the first 20 entries have been reviewed
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DIR = process.env.SAWHORSE_FEEDBACK_DIR ?? join(homedir(), "Library/Application Support/app.sawhorse.desktop");
const LOG = join(DIR, "feedback-log.md");
const REVIEWED = join(DIR, "feedback-reviewed.json");
const OPEN = join(DIR, "feedback-open.md");
/** Most entries printed at once; the rest wait for the next review. */
const MAX_SHOWN = 25;

const read = (path) => (existsSync(path) ? readFileSync(path, "utf8") : "");
// A note's own lines are quoted with "> ", so a heading at the start of a line is always the app's.
const entries = read(LOG).split(/^(?=## \d{4}-\d{2}-\d{2} \d{2}:\d{2} · )/m).filter((e) => e.startsWith("## "));

function reviewedCount() {
  try {
    const n = JSON.parse(read(REVIEWED)).entries;
    return Number.isInteger(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

const args = process.argv.slice(2);
if (args[0] === "--mark") {
  const n = args[1] === undefined ? entries.length : Number(args[1]);
  if (!Number.isInteger(n) || n < 0 || n > entries.length) {
    console.error(`--mark takes a whole number from 0 to ${entries.length}.`);
    process.exit(1);
  }
  writeFileSync(REVIEWED, `${JSON.stringify({ entries: n })}\n`);
  console.log(`Reviewed ${n} of ${entries.length} entries.`);
  process.exit(0);
}
if (args.length) {
  console.error("Usage: npm run feedback [-- --mark [count]]");
  process.exit(1);
}

let done = reviewedCount();
if (done > entries.length) {
  console.log(`The log has ${entries.length} entries but ${done} were marked reviewed, so it was replaced. Showing all of it.\n`);
  done = 0;
}
const fresh = entries.slice(done);
console.log(`${fresh.length} new of ${entries.length} entries.`);
for (const e of fresh.slice(0, MAX_SHOWN)) console.log(`\n${e.replace(/\n*---\s*$/, "").trim()}`);
if (fresh.length > MAX_SHOWN) console.log(`\n${fresh.length - MAX_SHOWN} more after these. Mark these reviewed to see them.`);
const open = read(OPEN).trim();
if (open) console.log(`\nStill open:\n${open}`);
