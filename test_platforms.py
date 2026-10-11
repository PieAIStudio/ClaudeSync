"""Small platform-adapter tests; no real Claude process is touched."""
import json
import os
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

from claude_sync.platforms import Environment, process_state
from claude_sync.storage import exclusive_lock


class PlatformAdapterTest(unittest.TestCase):
    def test_windows_process_listing_blocks_desktop_and_cli(self):
        payload = json.dumps([
            {"ProcessId": 7, "Name": "Claude.exe", "ExecutablePath": r"C:\\Users\\me\\AppData\\Local\\AnthropicClaude\\claude.exe", "CommandLine": "Claude.exe"},
            {"ProcessId": 8, "Name": "node.exe", "ExecutablePath": r"C:\\Program Files\\node.exe", "CommandLine": r"node C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js"},
            {"ProcessId": 9, "Name": "chrome-native-host.exe", "ExecutablePath": r"C:\\Claude\\chrome-native-host.exe", "CommandLine": ""},
        ])
        with patch("claude_sync.platforms.subprocess.run", return_value=SimpleNamespace(stdout=payload)):
            writers, automatic = process_state("win32")
        self.assertEqual({row["pid"] for row in writers}, {7, 8})
        self.assertEqual(automatic, [])
        self.assertTrue(next(row for row in writers if row["pid"] == 7)["desktop"])

    def test_environment_uses_explicit_cross_platform_roots(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            session_root = root / "sessions"
            projects = root / "projects"
            env = Environment(root / "tool", root / "home", platform_name="win32",
                              session_root=session_root, projects_root=projects)
            self.assertEqual(env.root, session_root)
            self.assertEqual(env.projects, projects)

    def test_explicit_test_home_does_not_leak_process_environment_paths(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {
            "XDG_CONFIG_HOME": str(Path(folder) / "shared-config"),
            "CLAUDE_CONFIG_DIR": str(Path(folder) / "shared-claude"),
            "CLAUDESYNC_SESSION_ROOT": str(Path(folder) / "shared-sessions"),
        }):
            home = Path(folder) / "isolated-home"
            env = Environment(Path(folder) / "tool", home, platform_name="linux")
            self.assertEqual(env.desktop, home / ".config/Claude")
            self.assertEqual(env.root, home / ".config/Claude/claude-code-sessions")
            self.assertEqual(env.projects, home / ".claude/projects")

    def test_lock_is_non_reentrant(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / ".lock"
            with exclusive_lock(path):
                with self.assertRaises(BlockingIOError):
                    with exclusive_lock(path):
                        pass


if __name__ == "__main__":
    unittest.main()
