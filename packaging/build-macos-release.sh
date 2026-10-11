#!/usr/bin/env bash
set -euo pipefail
base="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
python_bin="${CLAUDESYNC_PYTHON:-python3}"
arch="${CLAUDESYNC_ARCH:-$(uname -m)}"
case "$arch" in
  x86_64) arch="x64" ;;
  arm64|aarch64) arch="arm64" ;;
esac
"$python_bin" -c 'import shutil, sys; [shutil.rmtree(path, ignore_errors=True) for path in sys.argv[1:] if __import__("os").path.isdir(path)]' "$base/dist/macos"
# The release app is a self-contained PyInstaller bundle: users do not need a
# separate Python installation. The source tree still keeps the native AppKit
# build for local Mac development.
CLAUDESYNC_PYTHON="$python_bin" "$base/packaging/build-portable.sh"
out="$base/dist/macos/ClaudeSync"
mkdir -p "$out"
cp -R "$base/dist/ClaudeSync.app" "$out/ClaudeSync.app"
cp "$base/dist/ClaudeSyncCLI" "$out/ClaudeSyncCLI"
cp "$base/Sync.command" "$base/README.md" "$base/README.zh-CN.md" "$base/LICENSE" "$out/"
cp "$base/config.example.json" "$out/"
chmod +x "$out/Sync.command"
(cd "$base/dist/macos" && zip -qry "../ClaudeSync-macos-$arch.zip" ClaudeSync)
if command -v hdiutil >/dev/null 2>&1; then
  hdiutil create -volname ClaudeSync -srcfolder "$out" -ov -format UDZO "$base/dist/ClaudeSync-macos-$arch.dmg" >/dev/null
fi
printf 'macOS packages are in %s\n' "$base/dist"
