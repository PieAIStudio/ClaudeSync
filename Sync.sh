#!/usr/bin/env sh
set -eu
base=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
python3 "$base/sync_gui.py" "$@"
