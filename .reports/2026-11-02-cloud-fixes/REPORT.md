# ClaudeSync cloud review fixes (2026-11-02)

Branch `fix/cloud-review-20261102`, made from `origin/main` at `193203d`.
Not merged. No PR. `main` not touched. No deploys, workflows, packaging or release builds.
No Keychain items, real accounts or real session data were read or changed. All checks used synthetic fixtures.

## Status of each finding

The review (2026-10-31) was made against `7445855`. Before fixing anything, I checked every finding against `origin/main` (`193203d`). For the four confirmed bugs I re-ran the original scratch probes against the new code.

| # | Finding (short) | Status on origin/main | Evidence |
|---|---|---|---|
| 1 | Keychain read through `/usr/bin/security`: "Always Allow" opens Claude's key to every process | **Changed, still open → fixed on this branch** | `db6ca8c` replaced the CLI with an in-process addon, so "Always Allow" now trusts the ClaudeSync binary instead. But Electron's default fuses were still on, so any same-user program could start that trusted binary as plain Node (`ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`, `--inspect`) and read the item without a prompt. Fixed here in `290bec7`. |
| 2 | Delete moves transcripts to the Trash, then fails with an error that hides it | **Fixed on main** (`bb0f7e9`) | Probe: guard fails after the Trash move → error is now `errorDeleteInterrupted` with `moved: <file>.jsonl`, `applied: 0`. |
| 3 | A second live organization is treated as "old" and cleaned up | **Fixed on main** (`fb2d397`, test `9d8cc2f`) | Probe: the live org's sessions are now `unverified`; the cleanup plan is empty. Only explicit retirement evidence makes an org "old". |
| 4 | 3-second Keychain timeout includes the human prompt; re-prompts on every refresh | **Fixed on main** (`b9bdb8a`, `db6ca8c`) | Code: no app timeout on the native read; the result (including a denial) is reused until the Desktop login changes. |
| 5 | Stale lock blocks all writes after a crash + PID reuse; raw `EPERM` | **Fixed on main** for the reported case (`3f517a4`) | Probe: a live unrelated PID and a pre-boot lock are both reclaimed. Leftover below. |
| 6 | Restore refused after an unrelated settings change | **Fixed on main** (`f82443f`) | Probe: after adding an unrelated scope, the restore plan builds (2 changes). |
| 7 | Process scans and rescans block the Electron main thread for each file | **Fixed on main** (`020150d`) | Code: async scans at most once a second plus at boundaries; the write loop yields between steps. |
| 8 | CSP set by header hook does not apply to `file://` pages | **Fixed on main** (`b2f5c26`, test `15d7155`) | Code + existing test: strict CSP `<meta>` in `index.html`; renderer permissions denied. |

## What changed on this branch

One commit, `290bec7` `fix(security): turn off Electron run-as-Node fuses in packaged app`:

- `electron/packaging-security.test.ts` (new): fails unless the packaged build turns off the `runAsNode`, `enableNodeOptionsEnvironmentVariable` and `enableNodeCliInspectArguments` fuses. It also checks that the unsigned arm64 build sets `resetAdHocDarwinSignature` (an edited, unsigned binary would be killed on Apple silicon).
- `package.json` → `build.electronFuses` with those four settings. Nothing in the app uses these switches. The UI smoke test already removes `ELECTRON_RUN_AS_NODE`, and fuses only affect the packaged app, not `pnpm dev` or tests.
- `SECURITY.md`: one sentence explaining why the fuses are off.

No UI layout or styling changes. Nothing is hard-deleted; deletion behavior is unchanged.

## Tests run and results

Environment: Linux cloud container, Node 22.23.4 (repo asks for Node 24; pnpm warns only), pnpm 11.22.0. Installed with `pnpm install --frozen-lockfile --ignore-scripts`, so the Electron binary was not downloaded and the app was not launched.

| Check | Result |
|---|---|
| New test before the fix | 2 failed, as expected (`expected undefined ...`) |
| New test after the fix | 2 passed |
| `pnpm test` (full unit suite) | 31 files, **293 passed** (origin/main baseline: 30 files, 291 passed) |
| `pnpm typecheck` | passed |
| Lint | **No lint script exists** in `package.json` and no linter is configured. Ran `git diff --check` instead: clean |
| electron-builder config schema (`validateConfiguration` from app-builder-lib 26.15.2, no packaging) | valid. A deliberately misspelled fuse key is rejected, so the check is real. |
| Push-gate checks for the changed paths (run one by one) | `git diff --check` ok; `doc-gov`/`pro-gov --help` ok; `pnpm typecheck` ok; `node scripts/test-related.mjs` ok (2/2); `vitest run src/term-copy.test.ts src/error-copy.test.ts` ok (53/53); `pnpm build` (electron-vite compile only, not packaging) ok |
| Push-gate governance check | The two symlink assertions pass; `../../docs/governance/...` is missing because this clone is outside the MatrixAPPs monorepo. Environment-only failure. |
| `pnpm test:ui --grep 'fixed renderer smoke'` | Repo config: 5 failed only because Playwright 1.64.1 expects a different Chromium build than the container has. Same tests with a scratch config pointing at the installed Chromium (repo files unchanged): **5 passed**. |
| Re-check probes for findings 2, 3, 5, 6 against origin/main | All behave as described in the table above. The probes live outside the repo. |

## What is left

1. **Mac packaging check for the fuses (needs the Owner's Mac; not a release).** Run `pnpm package:mac:dir`, then `npx @electron/fuses read --app dist/electron/mac-arm64/ClaudeSync.app`. Confirm RunAsNode, NODE_OPTIONS and inspect are disabled. Launch the app normally and check that it opens and Refresh works. Then `ELECTRON_RUN_AS_NODE=1 dist/electron/mac-arm64/ClaudeSync.app/Contents/MacOS/ClaudeSync -e "console.log('node')"` must **not** print `node`. If the app does not launch, revert `290bec7`.
2. **Lock leftover (deliberate on main, not changed).** If the lock's PID belongs to another user's live process in the same boot, writes stay blocked with `errorLockOwnerUnavailable` until a reboot or a manual delete of `.claudesync.lock`. Main's test "explains an inaccessible lock owner" sets this behavior on purpose, so I did not override it. A possible follow-up: on `EPERM`, fall through to the existing `ps -p` name check.
3. **Old-copy cleanup is now effectively off.** Nothing records retirement evidence yet (SECURITY.md says so). This is the safe side of finding 3, but the cleanup feature cannot run until a way to mark an org as retired exists.
4. **Optional hardening, not done:** the asar integrity / `onlyLoadAppFromAsar` fuses. They protect against editing the app bundle, but mean little until the app is properly signed; they need their own Mac test.
5. **Decrypted tokens now stay in main-process memory for the app run** (reused to avoid repeated Keychain prompts). Documented in SECURITY.md; noted only.
6. **Push gate and this report:** `.reports/**` is gitignored and not in `scripts/check-map.json`. The pre-push gate (if installed via lefthook) would flag this file as an unmapped path. The hook is not installed in this cloud clone; the file was force-added because the task asked for it on the branch.
