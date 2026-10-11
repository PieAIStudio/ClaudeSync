#!/bin/zsh
# macOS launcher. Double-click opens native AppKit; CLI flags use Python core.
set -u
tool_dir="${0:A:h}"
export PYTHONDONTWRITEBYTECODE=1
python_bin="$(command -v python3 || true)"
if [[ $# -eq 0 ]]; then
  if [[ -x "$tool_dir/ClaudeSync.app/Contents/MacOS/ClaudeSync" ]]; then
    exec /usr/bin/open -a "$tool_dir/ClaudeSync.app"
  fi
  if [[ -x "$tool_dir/Sync.app/Contents/MacOS/Sync" ]]; then
    exec /usr/bin/open -a "$tool_dir/Sync.app"
  fi
  exec "$python_bin" "$tool_dir/sync_gui.py"
fi
if [[ -x "$tool_dir/ClaudeSyncCLI" ]]; then
  exec "$tool_dir/ClaudeSyncCLI" "$@"
fi
exec "$python_bin" "$tool_dir/sync_sessions.py" "$@"
