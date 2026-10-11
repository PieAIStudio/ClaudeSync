#!/usr/bin/env python3
"""Compatibility entry point; implementation is in claude_sync.core."""
import sys
from claude_sync import core

if __name__ == "__main__":
    try:
        sys.exit(core.main())
    except (KeyboardInterrupt, EOFError):
        print("\n操作取消。若在写入阶段中断，请检查 backups 中最新 manifest。")
        sys.exit(130)
else:
    sys.modules[__name__] = core
