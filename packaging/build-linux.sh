#!/usr/bin/env bash
set -euo pipefail
base="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
python_bin="${CLAUDESYNC_PYTHON:-python3}"
CLAUDESYNC_PYTHON="$python_bin" "$base/packaging/build-portable.sh"
"$python_bin" -c 'import shutil, sys; [shutil.rmtree(path, ignore_errors=True) for path in sys.argv[1:] if __import__("os").path.isdir(path)]' "$base/dist/linux" "$base/dist/tarroot"
mkdir -p "$base/dist/linux/claudesync/DEBIAN" "$base/dist/linux/claudesync/opt/claudesync" "$base/dist/linux/claudesync/usr/share/applications"
cp "$base/dist/ClaudeSync" "$base/dist/linux/claudesync/opt/claudesync/ClaudeSync"
cp "$base/dist/ClaudeSyncCLI" "$base/dist/linux/claudesync/opt/claudesync/ClaudeSyncCLI"
chmod +x "$base/dist/linux/claudesync/opt/claudesync"/*
cat > "$base/dist/linux/claudesync/DEBIAN/control" <<EOF
Package: claudesync
Version: 1.3.0
Section: utils
Priority: optional
Architecture: amd64
Maintainer: PieAI <PIEAI@hotmail.com>
Description: Safe, manual local Claude session index sync
 A small GUI and CLI that shows a plan before it writes local indexes.
EOF
cat > "$base/dist/linux/claudesync/usr/share/applications/claudesync.desktop" <<EOF
[Desktop Entry]
Name=ClaudeSync
Comment=Safe local Claude session sync
Exec=/opt/claudesync/ClaudeSync
Terminal=false
Type=Application
Categories=Utility;
EOF
if command -v dpkg-deb >/dev/null 2>&1; then
  dpkg-deb --build "$base/dist/linux/claudesync" "$base/dist/ClaudeSync-linux-amd64.deb" >/dev/null
fi
mkdir -p "$base/dist/tarroot/ClaudeSync"
cp "$base/dist/ClaudeSync" "$base/dist/ClaudeSyncCLI" "$base/README.md" "$base/LICENSE" "$base/dist/tarroot/ClaudeSync/"
tar -C "$base/dist/tarroot" -czf "$base/dist/ClaudeSync-linux-amd64.tar.gz" ClaudeSync
printf 'Linux packages are in %s\n' "$base/dist"
