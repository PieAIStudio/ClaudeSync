"""Tests for the shared first-run setup validator."""
from pathlib import Path
import tempfile
import unittest
import uuid

from claude_sync.configuration import MAX_ACCOUNTS, build_config, build_config_for_accounts, save_config


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

    def test_accounts_can_share_an_organization(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "sessions"
            projects = Path(folder) / "projects"
            projects.mkdir()
            org = uuid.uuid4()
            first = root / str(org) / str(uuid.uuid4())
            second = root / str(org) / str(uuid.uuid4())
            first.mkdir(parents=True)
            second.mkdir(parents=True)
            data = build_config(root, first, second, projects, "A", "B")
            self.assertEqual(len(data["accounts"]), 2)

    def test_discover_config_finds_all_local_accounts(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "sessions"
            projects = Path(folder) / "projects"
            projects.mkdir()
            for _ in range(3):
                (root / str(uuid.uuid4()) / str(uuid.uuid4())).mkdir(parents=True)
            from claude_sync.configuration import discover_config
            data = discover_config(root, projects)
            self.assertEqual(len(data["accounts"]), 3)
            self.assertEqual([a["label"] for a in data["accounts"]],
                             ["账号 1", "账号 2", "账号 3"])

    def test_build_config_supports_three_accounts(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "sessions"
            projects = Path(folder) / "projects"
            projects.mkdir()
            specs = []
            for index in range(3):
                account = root / str(uuid.uuid4()) / str(uuid.uuid4())
                account.mkdir(parents=True)
                specs.append({"path": account, "label": "Account %d" % (index + 1)})
            data = build_config_for_accounts(root, specs, projects)
            self.assertEqual(len(data["accounts"]), 3)
            self.assertEqual([item["label"] for item in data["accounts"]],
                             ["Account 1", "Account 2", "Account 3"])

    def test_account_count_has_a_readable_upper_bound(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "sessions"
            projects = Path(folder) / "projects"
            projects.mkdir()
            specs = []
            for index in range(MAX_ACCOUNTS + 1):
                account = root / str(uuid.uuid4()) / str(uuid.uuid4())
                account.mkdir(parents=True)
                specs.append({"path": account, "label": "Account %d" % (index + 1)})
            with self.assertRaisesRegex(ValueError, "账号数量过多"):
                build_config_for_accounts(root, specs, projects)


if __name__ == "__main__":
    unittest.main()
