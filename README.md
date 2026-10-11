# ClaudeSync

**See it first. Choose the title. Sync only when it is safe.**

[中文](README.zh-CN.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Português](README.pt-BR.md)

ClaudeSync helps people who use two Claude accounts on one computer keep their **local Claude Code session lists** understandable. It does one small job well: show what can be copied, show what cannot, let you choose title conflicts in the table, and write only after Claude has stopped.

![ClaudeSync interface preview](docs/images/claudesync-preview.svg)

> **Not a cloud migration tool.** It does not log in, copy passwords, upload conversations, or move Artifacts. It aligns local session indexes that point to local JSONL transcripts.

## Why people use it

- **No surprise automation.** There is no login hook, exit hook, watcher, timer, or background sync.
- **One readable screen.** Status, counts, skipped items, and title choices are visible together.
- **Human decides conflicts.** If both accounts have different hand-written titles, choose Account A, Account B, or Skip in the same row.
- **Safe by default.** A running Claude process blocks writes. The tool makes a byte-checked backup before changing indexes and verifies after writing.
- **Mac stays simple.** The existing native AppKit window is kept. Windows and Linux use the shared Python/Tk window.
- **No third-party runtime dependency.** The sync core uses Python’s standard library.

![Four steps: check, choose, sync, verify](docs/images/flow.svg)

## What is supported

| System | GUI | Local session sync | Close and reopen Claude |
| --- | --- | --- | --- |
| macOS | Self-contained shared GUI; source build also keeps native AppKit | Yes | Yes, graceful request only |
| Windows | Shared Tk | Yes | Yes, graceful window-close request only |
| Linux | Shared Tk | Yes, when the local Claude data layout exists | Reopen may need a manual launch |

Claude’s official session documentation says transcripts are normally under `~/.claude/projects` and that `CLAUDE_CONFIG_DIR` can change that location. Claude Desktop’s supported platforms and Linux packaging can change, so the tool lets you select the directories instead of guessing. See [Claude Code sessions](https://code.claude.com/docs/en/sessions) and [Claude Desktop](https://code.claude.com/docs/en/desktop).

## Download an installer

Open the [latest GitHub Release](https://github.com/PieAIStudio/ClaudeSync/releases/latest) and choose one file:

| Platform | File | What it does |
| --- | --- | --- |
| macOS Apple silicon | `ClaudeSync-macos-arm64.dmg` or `.zip` | Self-contained GUI app |
| macOS Intel | `ClaudeSync-macos-x64.dmg` or `.zip` | Self-contained GUI app |
| Windows 10/11 64-bit | `ClaudeSync-windows-x64-setup.exe` | Small installer with Start menu shortcut |
| Debian/Ubuntu Linux 64-bit | `ClaudeSync-linux-amd64.deb` | Installs the app launcher and CLI |
| Other Linux 64-bit | `ClaudeSync-linux-amd64.tar.gz` | Portable folder; run `ClaudeSync` |

The installed GUI includes a language selector for 简体中文, English, 日本語, Español, and Português. If a Linux distribution does not include Tk, the same package opens the browser-based local GUI automatically. The Mac release bundles Python, so a separate Python installation is not needed. macOS may show its normal first-run confirmation for an unsigned community app.

## Start in three minutes

### 1. Install or get the folder

For the simplest setup, install a release package above. For development, download this repository as a ZIP or clone it. Python 3.9 or newer is enough.

```sh
git clone https://github.com/PieAIStudio/ClaudeSync.git
cd ClaudeSync
```

No account data is included in the repository.

### 2. Open the small GUI

| System | Open |
| --- | --- |
| macOS | Open `ClaudeSync.app` from the release, or double-click `Sync.command` in the source folder |
| Windows | Double-click `Sync.bat` |
| Linux | Run `./Sync.sh` |
| Any system | Run `python sync_gui.py` |

On first launch, choose:

1. the folder containing both account scopes (`claude-code-sessions`);
2. the Account A and Account B folders inside it;
3. the `projects` folder that contains the local JSONL transcripts.

The setup screen writes a private `config.json` beside the tool. It is ignored by Git.

### 3. Follow the screen

1. Click **Check** (重新检查). This is read-only.
2. Read the counts and the report.
3. For a red **Needs choice** row, select **Account A**, **Account B**, or **Skip** directly in the row. There is no second conflict window.
4. Finish the current Claude task. Then click **Sync safe items** (同步安全项), or click **Close Claude and sync** when you want the tool to request a graceful close for you.
5. Open Claude yourself and check the Code list. Login and account switching remain manual.

The last confirmation dialog is for the actual write/close action. It is not a title picker.

## Title behavior

- Same title → no change.
- Hand-written title versus an automatic/empty title → copy the hand-written title safely.
- Two different hand-written titles → show one conflict row; you choose the winner or skip.
- Two different automatic titles → do not guess from activity time.
- Old ClaudeSync labels such as `Title（来自账号 A 的分支）` → remove the old tool marker and keep the original title.
- New branch entries → use the original title exactly; no long generated marker is added.

The choice is made once per `cliSessionId`, even when the same conversation appears in both directions.

## What it changes and what it leaves alone

**May change after your confirmation**

- Add a missing local session index entry in the other account scope.
- Add a branch index entry when the same local entry points to different transcript heads.
- Update a title when the rule says it is safe, or when you explicitly choose one.

**Does not change**

- JSONL conversation bodies: they are referenced, never copied, joined, or rewritten.
- Existing index entries, deletion markers, archives, scheduled tasks, or project paths.
- Cloud Artifacts, comment monitors, connectors, remote/SSH sessions, login credentials, or cookies.

A successful local sync does not prove that a cloud resource is available in the other account. Re-publish or reconnect it there when needed.

## Command line

```sh
# Read-only plan and report
python sync_sessions.py --check

# Apply a checked plan when Claude is already fully closed
python sync_sessions.py --sync

# Gracefully ask Claude to close, wait, then apply the plan
python sync_sessions.py --close-sync
```

Exit codes:

- `0`: check or sync completed; read the report for the actual result.
- `1`: structure, file, or verification error.
- `2`: Claude is running, an old automatic process is present, or another ClaudeSync instance holds the lock.
- `130`: cancelled.

## Privacy and recovery

ClaudeSync is offline. It does not call a cloud login API. The repository ignores `config.json`, `reports/`, `backups/`, `sync-state.json`, and the local Mac build. Keep those files private: reports can contain project paths, titles, and account identifiers.

Before a write, ClaudeSync creates a timestamped index backup and a manifest. If an operation is interrupted, run the check again; already-created files are detected and existing files are not overwritten. Do not restore a whole backup folder over Claude’s data.

## Project map

- `claude_sync/core.py` — plan, safety checks, write, verify, report.
- `claude_sync/titles.py` — title provenance and choices.
- `claude_sync/platforms.py` — OS paths, process checks, graceful close.
- `claude_sync/storage.py` — atomic files, snapshots, locks.
- `sync_gui.py` — shared GUI.
- `SyncGUI.swift` — optional native Mac GUI.
- `ARCHITECTURE.md` — maintainer map in plain language.
- `config.example.json` — safe configuration shape.

The repository keeps `sync_sessions.py` as a compatibility entry point, so older shortcuts do not break after the folder was renamed to `ClaudeSync`.

## Test and build

```sh
python -m unittest -v test_sessions test_platforms test_configuration
python -m py_compile claudesync.py sync_gui.py sync_gui_tk.py sync_web.py sync_sessions.py claude_sync/*.py
```

Build a local portable package (install `packaging/requirements.txt` first):

```sh
python -m pip install -r packaging/requirements.txt
./packaging/build-portable.sh       # current OS GUI + CLI
./packaging/build-linux.sh           # Linux .deb + .tar.gz
./packaging/build-macos-release.sh   # macOS .dmg + .zip
```

Build the optional native Mac AppKit window locally:

```sh
./build-macos-app.sh
```

Tests only use temporary directories. They never use your real Claude data.

## Contributing and license

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing the boundaries. See [SECURITY.md](SECURITY.md) for privacy and issue-reporting guidance. ClaudeSync is released under the [MIT License](LICENSE).
