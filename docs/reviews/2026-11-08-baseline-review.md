# Baseline review, 2026-11-08

Reviewed commit `bf2c9f0` (`nick-mena/sawhorse`, identical to `sawhorse3d/sawhorse` main). Scope is the macOS desktop app on Apple Silicon: the Tauri shell, the shared web front end, the kernel, and the plugin system. Windows and Linux paths were noted only where they affect the Mac.

## How it was checked

| Step | Method |
|---|---|
| Clone | No checkout until the tree was inspected. Hooks, LFS filters and submodules off. |
| Tree | 679 regular files; no symlinks, submodules, repo-level `.claude`, `.vscode`, `.envrc`, `.npmrc` or `.cargo`. |
| Secrets | Pattern scan of the tree and all 283 commits. None found. |
| Obfuscation | Sweep of tracked text for bidi and invisible characters, encoded blobs, overlong lines. Only three deliberate CSV byte-order marks. |
| Dependencies | All 783 locked packages against OSV. Lockfiles: every npm entry has an integrity hash from the npm registry; every crate is from crates.io; no git dependencies. |
| Install scripts | Only `fsevents` has one. Installed with `--ignore-scripts` regardless. |
| Native code | `src-tauri` read in full. No `unsafe` in any first-party Rust. One `build.rs`, the standard Tauri one. |
| Sandbox, IPC, parsers | Plugin host, lockdown, source check, zip handling, file flows, CSP and capabilities read by hand. |
| Outbound network | All hosts in shipped code listed. Only loopback, placeholders and the project's own links. No telemetry. |
| `openskp` | The niche runtime dependency that parses untrusted files. Tarball hash matches the lockfile; no install script. Its `fs` use is in Node-only branches. |

Not covered: the kernel's geometry code was reviewed through its tests rather than line by line. The 524 Tauri crates were checked by provenance and advisories, not read. `render-service` is a separate repository and is not here. No exploit was executed; findings below come from reading the code unless a test is cited.

## Security

**Verdict: no malicious code, backdoor, data exfiltration or exposed secret. Safe to build and run.** The design is careful: a narrow capability list, path scoping, a key that stays in the Keychain, and a three-layer plugin sandbox. Nothing below is an emergency, and all of it needs either a hostile file or an already compromised page.

| # | Severity | Finding | Where | Fix |
|---|---|---|---|---|
| S1 | Medium | Vulnerable parsers on untrusted files. `zip` 8.6.0 has nine advisories, one rated critical, and `quick-xml` 0.39.4 has two. The app only reads in memory inside the WASM worker and never calls `extract`, so the file-write advisories are out of reach; what remains is a hang or crash of the worker, which the kernel client restarts. | `crates/Cargo.toml` | Bump `zip` to at least 9.0.5 and `quick-xml` to at least 0.41. |
| S2 | Low | Plugins can save macOS launchers. `.webloc`, `.inetloc`, `.fileloc`, `.tool`, `.scpt` and `.applescript` are not blocked, though the Windows equivalents are. The user still sees a Save dialog. | `src/plugins/manager.ts:43` | Add them. |
| S3 | Low | `open_external` allows loopback in release builds, and `dev/checkout/../..` escapes the path check. | `src-tauri/device-key/src/lib.rs:216` | Gate loopback on `cfg!(debug_assertions)`; refuse `..`. |
| S4 | Low | A plugin's file name can hold U+2028, which ends the `//# sourceURL` comment the sandbox appends after the AST check. That text runs unchecked. Lockdown and CSP still contain it: `eval` and `fetch` are gone and only same-origin or blob imports load. | `src/plugins/sandbox.worker.ts:68`, `src/plugins/zip.ts:27` | Add `  ` to `BAD_SEGMENT`, or drop the suffix. |
| S5 | Low | `open_plugin_folder` calls `open_path` with no scope check. Manifest ids may end in `.app`, and macOS treats such a folder as an application. Plugin installs write no executable bit, so it fails to launch rather than running. | `src-tauri/src/lib.rs:76` | Use `reveal_item_in_dir`. |
| S6 | Low | The desktop CSP omits `base-uri` and `form-action`, which do not fall back to `default-src`. The browser build sets them. | `src-tauri/tauri.conf.json` | Align the two. |
| S7 | Low | `allow-appdata-write-recursive` also grants `remove`, `rename` and `truncate` on every in-scope path, including files the person picked. A compromised page could delete those, not just overwrite them. | `src-tauri/capabilities/default.json` | Accept, or split into a narrower permission set. |
| S8 | Low | `write_atomic` uses a predictable sibling name and follows a symlink planted there. It also writes `.bak` and `.saving` outside the fs scope. | `src-tauri/safe-save/src/lib.rs:63` | Create with `O_EXCL` and a random suffix. |
| S9 | Low | Release workflows pin third-party actions by tag and run with `contents: write`. Relevant only if Actions are enabled on the fork. | `.github/workflows/release.yml` | Pin by commit SHA. |

Advisories that do not apply: `glib`, `proc-macro-error` and the `zbus`/`zvariant` family are absent from the macOS build (`cargo tree --target aarch64-apple-darwin`). `undici` is a test-only dependency through jsdom. `tokio` ships, but the advisory concerns `AsyncFd`, which first-party code does not use; 1.53.3 is a patch bump.

## Upstream issues

23 open: 17 issues and 6 PRs. The ones that matter on a Mac:

| Issue | State here | Notes |
|---|---|---|
| [#21](https://github.com/sawhorse3d/sawhorse/issues/21), [#35](https://github.com/sawhorse3d/sawhorse/issues/35) Save refused | **Root cause found, reproduced** | See B1. The worst bug in the project: work cannot be saved. |
| [#34](https://github.com/sawhorse3d/sawhorse/issues/34) Save refused after the cabinet generator | Same error, **flow not reproduced** | A native run of the default cabinet saves. B1 may not be the whole story; retest in the real app after fixing it. |
| [#32](https://github.com/sawhorse3d/sawhorse/issues/32) Open and New discard work unasked | Confirmed by reading | See B2. Fix is in open [PR #28](https://github.com/sawhorse3d/sawhorse/pull/28). |
| [#27](https://github.com/sawhorse3d/sawhorse/issues/27) "Sawhorse.app is damaged" | Probable cause, not tested | Release `.dmg`s have no signature that survives bundling, and Apple Silicon requires one. Ad-hoc signing (`bundle.macOS.signingIdentity: "-"`) is the usual fix. Local builds are not quarantined, so a build from this repo should open. |
| [#15](https://github.com/sawhorse3d/sawhorse/issues/15), [#16](https://github.com/sawhorse3d/sawhorse/issues/16) `.skp` import | Open | `openskp` 1.5.0 now exists; re-run the sweep before bumping. |
| [#7](https://github.com/sawhorse3d/sawhorse/issues/7), [#9](https://github.com/sawhorse3d/sawhorse/issues/9), [#12](https://github.com/sawhorse3d/sawhorse/issues/12) Selection and drawing | Open | Platform-independent. Open PRs [#23](https://github.com/sawhorse3d/sawhorse/pull/23) and [#24](https://github.com/sawhorse3d/sawhorse/pull/24) touch nearby behaviour. |
| [#8](https://github.com/sawhorse3d/sawhorse/issues/8), [#11](https://github.com/sawhorse3d/sawhorse/issues/11) Performance | Open | Quadratic costs on many curves and sketch edges. |
| [#14](https://github.com/sawhorse3d/sawhorse/issues/14), [#19](https://github.com/sawhorse3d/sawhorse/issues/19), [#25](https://github.com/sawhorse3d/sawhorse/issues/25), [#26](https://github.com/sawhorse3d/sawhorse/issues/26) Features | Open | Agent harness, furniture library, joints, metric stock. |
| [#31](https://github.com/sawhorse3d/sawhorse/issues/31) | Does not apply | Linux only; macOS's Save panel adds the extension. |

## Code review

| # | Severity | Finding | Where | Fix |
|---|---|---|---|---|
| B1 | **High** | **Models that had a solid removed cannot be saved.** `model_hash` writes each solid's public id, and `from_snapshot` allocates fresh ones, so any gap changes the hash and the read-back check refuses. Draw two boards, delete the first: Save fails with "the model differs". Also hit after a collapse and re-extrude or an explode (2 of 265 golden steps). | `crates/kernel/src/hash.rs:399`, `snapshot.rs:1395`, `crates/wasm-api/src/lib.rs:741` | Compare against the model after its own snapshot round trip, or keep ids stable across a save. Changing the hash means regenerating every golden, so the first is smaller. |
| B2 | **High** | **Open and New discard unsaved work without asking on the desktop.** `tauri-plugin-dialog` makes `window.confirm` asynchronous, so a Promise reads as "yes", and `dialog:allow-message` is not granted. | `src/App.tsx:598` | Take PR #28. |
| B3 | Medium | Quitting has no unsaved-changes guard (no `onCloseRequested` or `beforeunload`). Autosave offers the work back on next launch, which softens this. | `src/App.tsx` | Prompt on close when dirty. |
| B4 | Medium | Edits made while a save is in progress are marked saved. The bytes are taken before the Save dialog; `savedLogLen` and `markClean` read the state after it. | `src/App.tsx:773` | Capture the log length and hash before `saveShz`. |
| B5 | Medium | `write_atomic` drops the original file's permissions, replaces a symlink instead of writing through it, and refuses the whole save when the `.bak` cannot be written. It also never syncs the directory after the rename. | `src-tauri/safe-save/src/lib.rs:58` | Copy the mode, resolve the link, treat the backup as best effort, sync the parent. |
| B6 | Medium | `save_file_atomic` is a synchronous command, so it runs on the main thread. Writing, `F_FULLFSYNC` and reading back a large model stalls the UI. `device_sign` likewise waits on any Keychain prompt. | `src-tauri/src/lib.rs:90` | `#[tauri::command(async)]`. |
| B7 | Medium | The desktop CSP limits `connect-src` to one loopback port. Plugins granted `net`, and any render service address other than `127.0.0.1:8787`, fail on the desktop while the browser build allows them. | `src-tauri/tauri.conf.json` | Decide the policy, then match it. |
| B8 | Low | On the desktop, `preopen.go` reports success before `open_external` has answered, so a refusal is lost and the fallback link never shows. | `src/components/RenderPane.tsx:81` | Await it. |
| B9 | Low | Plugin uninstall checks `dir.startsWith(root)` with no separator or `..` check. The same file has a correct `inside()` helper. | `src/plugins/platform.ts` | Reuse it. |
| B10 | Structural | macOS is never compiled or tested in CI: `tauri-check` is Linux-only and e2e runs the browser build, which is why B2 and #27 shipped. | `.github/workflows/ci.yml` | Add a `macos-14` shell check. |
| B11 | Structural | `src/App.tsx` is 2,931 lines holding file flows, kernel state and UI. The file flows are the part with the bugs, and cannot be unit tested inside the component. | `src/App.tsx` | Extract a document-session module first. |

## Status after the stability pass (2026-11-08)

Fixed, in order of risk to people's work: B1, B2, B5, B6, B4, B3, S1, #27, B8, B9, and the symlink half of S8. For B1 the read-back check stays strict: it allows for fresh ids only, and a file that really differs is still refused (`read_back_difference`, `crates/kernel/src/hash.rs`).

Evidence: with the old check restored, the browser tests for B1 failed; with the fix they pass, including the #34 flow (a blank save, the default cabinet, then replacing it). The sequence fuzzer now requires every state to rebuild from its snapshot: 20,000 random sessions, 312,204 accepted ops, no failure.

Not verified in a real desktop window: the discard and quit dialogs and the Cmd+Q menu item. They have unit tests against a stand-in for the Tauri API and they compile. Ad-hoc signing has not been tested on a real downloaded `.dmg`.

Still open:

- **B7, a policy decision:** whether plugins granted `net`, and non-default render services, may reach the network on the desktop. Widening `connect-src` is a security trade-off.
- B10 (macOS in CI) and B11 (extracting file flows from `App.tsx`).
- S2 to S7 and S9: low-severity hardening, not stability.
- New, low: node and solid ids change when a file is reopened, so an id a plugin kept in the document can point at a different item. The cabinet generator's "Update selected cabinet" relies on one.
- `undici` (test-only, through jsdom) still has advisories.

## Test results

| Suite | Result |
|---|---|
| Vitest with the WASM kernel | 800 passed, 2 skipped, 9 recorded known gaps |
| Playwright e2e on real Chrome and the WASM kernel | 130 passed, 9 skipped (private or generated `.skp` corpus) |
| Rust workspace (`crates/`) | 609 passed, 0 failed, 3 ignored |
| Sequence fuzzer | 20,000 sequences, 0 failures |
| Clippy, rustfmt, type check, production build | Clean; provenance and test-hook checks pass |
| Desktop shell on macOS arm64 | Clippy clean with `-D warnings` |
| `sawhorse-device-key`, `sawhorse-safe-save` | 15 passed, 1 ignored (needs the real Keychain) |
| A full `tauri build`, a real desktop session | **Not run** |

Known gaps are recorded as `it.fails`, so each goes red when fixed.
