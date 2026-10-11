# Changelog

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
