# Changelog

## v2 local compatibility fix (unreleased, 2026-10-14)

- Recognize Claude Desktop's native `backlog/tasks.json` task directory so account and chat checks can finish.
- Preserve task bytes, exclude tasks from chat counts and operations, and detect task changes before writing; unknown structures and symlinks remain blocked.
- Verify macOS Claude Desktop's current email independently from CLI login; add only the verified current account's previously omitted local folders with a configuration backup.
- Keep local lists available on identity failures, reject login changes during verification and retain only verified UUID/email/organization bindings; no credential refresh or persistence.
- Use the profile-verified organization for local counts and management, so old active copies cannot override current archives.
- Remember verified organization bindings from both local and cloud checks, refresh when returning to local, and keep cleaned accounts empty after switching away instead of showing old copies again.
- Replace ambiguous entry removal with state-aware selected-chat deletion: short confirmation, scoped account/count, no deletion preview/backup/undo, exclusive main transcript removal and shared-history checks.
- Add a separate current-account cloud Code list and multi-select deletion adapter for observed idle Remote Control records, with account/state checks and readback; no task-settings calls, credential refresh or automatic deletion retry.

## v2 local preview (unreleased, 2026-10-12)

- TypeScript/React/Electron is now the only current source runtime, with Swimmer brand kits.
- Deduplicated account/session lists, search, filters, multi-selection, selected sync, keep-only, archive/unarchive, rename and stars.
- Previewed removal, native deletion markers, private byte backups and guarded recovery.
- Split scanning, catalog, planning, transactions, platform services and typed IPC; retired obsolete Python/Tk/Web entries and packagers.
- Fixed packaged sandboxed preload loading by bundling it as CommonJS; verified live account/session IPC in the local app.
- Kept review buttons visible in long previews and placed readable operation errors beside the actions.
- Verified account filtering, selection, review/cancel and compact desktop layout on macOS; real session files remained unchanged.
- Public v1 release history below remains unchanged. No public release was performed.


## 1.3.3 — 2026-10-11

- Made Sync.command prefer the current packaged Sync.app before the Python fallback.

## 1.3.2 — 2026-10-11

- Removed the obsolete native AppKit entry and build recipe.
- Made the Sync.app entry use the shared multi-account GUI.

## 1.3.1 — 2026-10-11

- Localized automatically generated account labels when switching the Tk GUI language.

## 1.3.0 — 2026-10-11

- Added automatic discovery and refresh of multiple local Claude account scopes.
- Added a deduplicated multi-account union plan and one-row title choices across all accounts.
- Made a chosen title apply to newly created entries in the same sync.
- Added localized multi-account setup, browser fallback, README screenshots, and flow diagrams.

## 1.1.2 — 2026-10-11

- Fixed title-conflict choices in the shared Tk GUI on Windows and Linux.
- Added a smoke check for the conflict-resolution file path.

## 1.1.1 — 2026-10-11

- Fixed cross-platform CI compilation on Windows PowerShell.
- Kept the six-platform test matrix green for Python 3.9 and 3.12.

## 1.1.0 — 2026-10-11

- Renamed the project directory to `ClaudeSync`.
- Added Windows and Linux path/process/lock adapters.
- Added a portable Tk GUI with first-run directory setup and inline title choices.
- Kept the existing native macOS AppKit GUI and compatibility CLI.
- Split storage, platform, title, and sync responsibilities into small modules.
- Added public documentation, diagrams, multilingual guides, and CI.
