# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is the owner of this fork, working on a Mac, often on a trackpad. Design decisions serve that person's workflow first.

Upstream Sawhorse is built for woodworkers and makers, many of whom already know SketchUp. They remain the wider audience the product was shaped for, but they are secondary in this fork.

## Product Purpose

Sawhorse is a free, local-first, open-source push/pull 3D modeler. You draw a shape, push it up, and type exact sizes like `3/4` as you go. It works out a cut list and lays parts out on real sheets and boards as you draw, opens SketchUp files, and exports watertight files for printing and CNC.

Success in this fork is a tool its owner can trust with real work on a Mac. Losing or silently changing someone's work is the worst failure the product can have.

This fork is a personal Mac build. It keeps the Sawhorse name and stays close to `sawhorse3d/sawhorse`.

## Positioning

Modeling, cut lists, nesting and shop files in one free tool, with no account, subscription or tracking, and with models that stay on the person's own machine.

## Operating Context

- Used as a desktop app on macOS through Tauri 2, on Apple Silicon. The same React interface also runs as a browser build.
- Input is a Mac trackpad and keyboard, with a mouse also supported. Keys are SketchUp-2017 defaults, and sizes are typed mid-gesture into the Value Control Box.
- Work is saved as `.shz` files on the person's own disk. Output goes to cut lists, nesting diagrams, drawing sheets, and files for slicers, CNC and lasers.

## Capabilities and Constraints

- Current capabilities and the "Not yet" list are kept in `README.md`, and measured limits in `docs/LIMITS.md`. Sawhorse is an alpha, and these documents say so plainly.
- Windows and Linux code paths stay working, but no effort goes into them in this fork.
- The interface must keep working offline, with no network or account.
- The security invariants in `AGENTS.md` are binding, including the two content security policies.
- The clean-room rules in `docs/CLEANROOM.md` are binding. Sawhorse keeps its own glyphs, layout and inference colours and does not copy SketchUp's look (ADR-0003).
- Mac trackpad support so far: two-finger swipe orbits, Shift+swipe pans, Cmd+swipe and pinch zoom, with orbit speed in Edit > Settings.

## Brand Commitments

- The name is Sawhorse.
- Refusals and messages are full sentences a woodworker can read.
- Public claims say only what is true, including what the product cannot do yet.

## Evidence on Hand

- Upstream site and captures: `site/index.html`, `site/img/`, `site/media/demo.webm`.
- Approved interface mock: `docs/mock/sawhorse-mock.html`.
- User guide: `docs/USER-GUIDE.md`. Upstream issue triage: `docs/reviews/2026-11-08-baseline-review.md`.
- This fork has no users, testimonials or adoption figures of its own, and none should be invented.

## Product Principles

1. Trust comes first. A person's work is never lost or quietly changed, and a failure is stated plainly.
2. After trust, a great Mac feel wins. Trackpad, menus and system behaviour should feel at home on macOS, even where that differs from other platforms.
3. Serve the owner's real workflow before imagined audiences.
4. Stay close to upstream, so that the fork remains easy to keep current. Differences should be deliberate and worth maintaining.
5. Say what is true. Limits are shown, not hidden.
