#!/usr/bin/env bash
set -euo pipefail
base="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
out="$base/dist"
python_bin="${CLAUDESYNC_PYTHON:-python3}"

# Use Python for cleanup so the same script stays easy to audit on every Unix
# runner and does not rely on a shell-specific destructive command.
"$python_bin" -c 'import shutil, sys; [shutil.rmtree(path, ignore_errors=True) for path in sys.argv[1:] if __import__("os").path.isdir(path)]' "$out" "$base/build"
mkdir -p "$out"
"$python_bin" -m PyInstaller --noconfirm --clean --onefile --windowed --name ClaudeSync --distpath "$out" --workpath "$base/build/gui" "$base/claudesync.py"
"$python_bin" -m PyInstaller --noconfirm --clean --onefile --console --name ClaudeSyncCLI --distpath "$out" --workpath "$base/build/cli" "$base/claudesync.py"
printf 'Portable binaries are in %s\n' "$out"
