#!/usr/bin/env bash
set -euo pipefail
base="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
mkdir -p "$base/Sync.app/Contents/MacOS" "$base/Sync.app/Contents/Resources"
swiftc -framework Cocoa -O -o "$base/Sync.app/Contents/MacOS/Sync" "$base/SyncGUI.swift"
/usr/bin/plutil -lint "$base/Sync.app/Contents/Info.plist"
printf 'Built %s\n' "$base/Sync.app"
