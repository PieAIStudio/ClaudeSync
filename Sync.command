#!/bin/zsh
# macOS launcher. Double-click opens the shared multi-account GUI; CLI flags use
# the same Python core. The optional native AppKit build remains available for
# local experiments but is not the default entry point.
set -u
tool_dir="${0:A:h}"
export PYTHONDONTWRITEBYTECODE=1
python_bin="$(command -v python3 || true)"
if [[ $# -eq 0 ]]; then
  if [[ -x "$tool_dir/ClaudeSync.app/Contents/MacOS/ClaudeSync" ]]; then
    exec /usr/bin/open -a "$tool_dir/ClaudeSync.app"
  fi
  if [[ -n "$python_bin" ]]; then
    exec "$python_bin" "$tool_dir/sync_gui.py"
  fi
  if [[ -x "$tool_dir/Sync.app/Contents/MacOS/Sync" ]]; then
    exec /usr/bin/open -a "$tool_dir/Sync.app"
  fi
  echo "ClaudeSync 需要 Python 3，或请使用发布版 ClaudeSync.app。" >&2
  exit 1
fi
if [[ -x "$tool_dir/ClaudeSyncCLI" ]]; then
  exec "$tool_dir/ClaudeSyncCLI" "$@"
fi
exec "$python_bin" "$tool_dir/sync_sessions.py" "$@"
