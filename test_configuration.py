"""Tests for the shared first-run setup validator."""
from pathlib import Path
import tempfile
import unittest
import uuid

from claude_sync.configuration import build_config, save_config


class ConfigurationTest(unittest.TestCase):
    def test_build_and_save_config_are_atomic(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "sessions"
            projects = Path(folder) / "projects"
            projects.mkdir()
            org_a, org_b = uuid.uuid4(), uuid.uuid4()
            account_a, account_b = uuid.uuid4(), uuid.uuid4()
            first = root / str(org_a) / str(account_a)
            second = root / str(org_b) / str(account_b)
            first.mkdir(parents=True)
            second.mkdir(parents=True)
            data = build_config(root, first, second, projects, "Work", "Personal")
            target = save_config(Path(folder) / "tool", data)
            self.assertEqual(target.read_text(encoding="utf-8").count("Work"), 1)
            self.assertEqual(data["accounts"][0]["scope"], f"{org_a}/{account_a}")

    def test_accounts_must_be_two_different_organizations(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "sessions"
            projects = Path(folder) / "projects"
            projects.mkdir()
            org = uuid.uuid4()
            first = root / str(org) / str(uuid.uuid4())
            second = root / str(org) / str(uuid.uuid4())
            first.mkdir(parents=True)
            second.mkdir(parents=True)
            with self.assertRaises(ValueError):
                build_config(root, first, second, projects, "A", "B")


if __name__ == "__main__":
    unittest.main()
