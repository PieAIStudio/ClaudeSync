#!/usr/bin/env python3
"""Portable GUI dispatcher.

Use Tk when the Python distribution includes it. If Tk is unavailable (common
on minimal Linux installations), use ClaudeSync's local browser GUI instead.
Both interfaces call the same CLI and report files.
"""
import sys

try:
    import tkinter  # noqa: F401
except (ImportError, ModuleNotFoundError):
    from sync_web import main
else:
    from sync_gui_tk import main


if __name__ == "__main__":
    main()
