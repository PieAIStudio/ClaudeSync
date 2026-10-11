#!/usr/bin/env python3
"""Installed ClaudeSync launcher: GUI with no arguments, CLI with flags."""
import sys
from claude_sync import core


def main():
    if any(arg.startswith("--") for arg in sys.argv[1:]):
        return core.main()
    from sync_gui import main as gui_main
    return gui_main()


if __name__ == "__main__":
    raise SystemExit(main() or 0)
