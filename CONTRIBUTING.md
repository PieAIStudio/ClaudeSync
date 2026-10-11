# Contributing

Keep the project small and readable. The safe boundary is:

- `claude_sync/core.py` owns the sync plan, safety checks, and report.
- `claude_sync/titles.py` owns title provenance and conflict policy.
- `claude_sync/platforms.py` owns OS paths, process checks, and graceful quit.
- `claude_sync/storage.py` owns atomic files, snapshots, and locks.
- `sync_gui.py` dispatches to the Tk GUI or the browser fallback; `sync_gui_tk.py` and
  `sync_web.py` own the two shared GUI implementations.
- `claude_sync/configuration.py` owns automatic account discovery, fallback setup
  validation, and atomic saving. The normal path must not make users enter
  accounts one by one.

Before a pull request:

```sh
python -m unittest -v test_sessions test_platforms test_configuration
python -m compileall -q claudesync.py sync_gui.py sync_gui_tk.py sync_web.py sync_sessions.py claude_sync
```

Tests use temporary directories only. Never run them against a real Claude data
directory, and never commit local configuration or reports.
