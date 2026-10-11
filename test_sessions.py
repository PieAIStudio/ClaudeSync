"""Isolated data-integrity tests. Never use the real Claude directories."""
import contextlib
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import uuid

import sync_sessions as sync


class ManualSyncTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name).resolve()
        self.base = self.home / "tool"
        self.base.mkdir()
        self.env = sync.Environment(self.base, self.home, self.home / "Claude.app")
        self.accounts = [{"label": label, "scope": str(uuid.uuid4()) + "/" + str(uuid.uuid4())}
                         for label in ("账号 A", "账号 B")]
        (self.base / "config.json").write_bytes(sync.encode({"accounts": self.accounts}))
        for account in self.accounts:
            (self.env.root / account["scope"]).mkdir(parents=True)
        self.project = self.home / "project"
        self.project.mkdir()
        self.text_dir = self.env.projects / "project"
        self.text_dir.mkdir(parents=True)

    def tearDown(self):
        self.tmp.cleanup()

    def record(self, account=0, **values):
        data = {"sessionId": "local_" + str(uuid.uuid4()), "cliSessionId": str(uuid.uuid4()),
                "cwd": str(self.project), "title": "测试会话", "isArchived": False,
                "createdAt": 123, "lastActivityAt": 456}
        data.update(values)
        path = self.env.root / self.accounts[account]["scope"] / (data["sessionId"] + ".json")
        path.write_bytes(sync.encode(data))
        self.transcript(data["cliSessionId"])
        return path, data

    def transcript(self, session_id, message="原始消息"):
        path = self.text_dir / (session_id + ".jsonl")
        if not path.exists():
            path.write_bytes((json.dumps({"type": "user", "message": {"content": message}}, ensure_ascii=False) + "\n").encode())
        return path

    def plan(self):
        return sync.build_plan(self.env)

    def apply(self, scan=None, guard=None):
        return sync.apply_plan(self.env, scan or self.plan(), guard=guard or (lambda: None))

    def test_union_backups_body_and_original_bytes_are_preserved(self):
        self.record()
        self.record(1)
        before = sync.take_snapshot(self.env, self.accounts)
        body_before = {p: p.read_bytes() for p in self.text_dir.iterdir()}
        scan = self.plan()
        self.assertEqual(len(scan["plan"]), 2)
        result = self.apply(scan)
        self.assertTrue(result["verified"])
        for relative, raw in before.files.items():
            self.assertEqual((self.env.root / relative).read_bytes(), raw)
            self.assertEqual((Path(result["backup"]) / "before" / relative).read_bytes(), raw)
        for path, raw in body_before.items():
            self.assertEqual(path.read_bytes(), raw)
        self.assertEqual(self.plan()["plan"], [])
        self.assertIsNone(self.apply()["backup"])

    def test_two_heads_create_separate_entries_with_history_not_overwrite(self):
        path, first = self.record()
        second_id = str(uuid.uuid4())
        edge = {"id": str(uuid.uuid4()), "parent": first["cliSessionId"], "child": second_id,
                "at": 12345, "cwd": str(self.project), "forkPoint": str(uuid.uuid4())}
        other, second = self.record(1, sessionId=first["sessionId"], cliSessionId=second_id,
                                     priorCliSessionIds=[first["cliSessionId"]], rewindEdges=[edge],
                                     transcriptModelStates={first["cliSessionId"]: {"model": "test-model"}})
        before = {p: p.read_bytes() for p in (path, other)}
        scan = self.plan()
        self.assertEqual([e["status"] for e in scan["entries"]], ["branch", "branch"])
        source_second = next(p for p in scan["plan"] if p["entry"]["source"] == "账号 B")
        copied = json.loads(source_second["raw"])
        self.assertEqual(copied["rewindEdges"], [edge])
        self.assertEqual(copied["transcriptModelStates"], second["transcriptModelStates"])
        self.assertNotEqual(copied["sessionId"], first["sessionId"])
        self.assertEqual(copied["title"], "测试会话")
        self.assertNotIn("来自", copied["title"])
        self.apply(scan)
        self.assertEqual(self.plan()["plan"], [])
        for p, raw in before.items():
            self.assertEqual(p.read_bytes(), raw)

    def test_duplicate_primary_cli_id_preserves_local_titles(self):
        _, first = self.record(title="一个标题")
        self.record(1, cliSessionId=first["cliSessionId"], title="另一个标题")
        scan = self.plan()
        self.assertEqual(scan["plan"], [])
        self.assertTrue(all(e["status"] == "present" for e in scan["entries"]))
        self.assertEqual({a["status"] for a in scan["title_actions"]}, {"auto_difference"})
        self.assertTrue(any("两边都是自动标题" in note for note in scan["entries"][0]["notes"]))

    def test_manual_title_replaces_auto_title_and_preserves_old_title(self):
        _, first = self.record(title="清晰的新标题", titleSource="user", completedTurns=4)
        target, second = self.record(1, cliSessionId=first["cliSessionId"], title="旧自动标题",
                                     titleSource="auto", completedTurns=8)
        scan = self.plan()
        self.assertEqual(len(scan["title_plan"]), 1)
        action = scan["title_plan"][0]
        self.assertEqual(action["status"], "safe")
        result = self.apply(scan)
        self.assertEqual(result["titles_updated"], [action["target_path"]])
        updated = json.loads(target.read_bytes())
        self.assertEqual(updated["title"], "清晰的新标题")
        self.assertEqual(updated["titleSource"], "user")
        self.assertEqual(updated["previousTitles"], ["旧自动标题"])
        self.assertEqual(updated["titleTurn"], 8)
        self.assertEqual(self.plan()["title_plan"], [])
        self.assertEqual(len(self.plan()["title_actions"]), 0)

    def test_two_manual_titles_are_reported_without_overwrite(self):
        a_path, first = self.record(title="A 的手动标题", titleSource="user")
        b_path, _ = self.record(1, cliSessionId=first["cliSessionId"], title="B 的手动标题", titleSource="user")
        before = b_path.read_bytes()
        scan = self.plan()
        self.assertEqual({a["status"] for a in scan["title_actions"]}, {"conflict"})
        self.assertEqual(scan["title_plan"], [])
        self.assertEqual(self.apply(scan)["backup"], None)
        self.assertEqual(b_path.read_bytes(), before)

    def test_manual_conflict_resolution_can_choose_source_title(self):
        a_path, first = self.record(title="A 的手动标题", titleSource="user")
        b_path, _ = self.record(1, cliSessionId=first["cliSessionId"], title="B 的手动标题", titleSource="user")
        initial = self.plan()
        actions = [a for a in initial["title_actions"] if a["status"] == "conflict"]
        self.assertEqual(len(actions), 2)
        resolutions = {}
        for action in actions:
            resolutions[action["target_path"]] = "source" if action["source"] == "账号 A" else "target"
        scan = sync.build_plan(self.env, resolutions)
        self.assertEqual({a["status"] for a in scan["title_actions"]}, {"selected_source", "selected_target"})
        result = self.apply(scan)
        self.assertEqual(len(result["titles_updated"]), 1)
        self.assertEqual(json.loads(a_path.read_bytes())["title"], "A 的手动标题")
        self.assertEqual(json.loads(b_path.read_bytes())["title"], "A 的手动标题")

    def test_tool_generated_branch_title_never_beats_real_title(self):
        _, first = self.record(title="真实标题", titleSource="user")
        branch_title = "真实标题（来自 账号 A 的分支）"
        second_path, _ = self.record(1, cliSessionId=first["cliSessionId"], title=branch_title, titleSource="user")
        scan = self.plan()
        self.assertIn("normalize", {a["status"] for a in scan["title_actions"]})
        self.assertEqual(len(scan["title_plan"]), 1)
        result = self.apply(scan)
        self.assertEqual(result["titles_updated"], [scan["title_plan"][0]["target_path"]])
        self.assertEqual(json.loads(second_path.read_bytes())["title"], "真实标题")

    def test_tombstones_in_other_org_and_prior_id_prevent_resurrection(self):
        prior_id = str(uuid.uuid4())
        _, data = self.record(priorCliSessionIds=[prior_id])
        org = self.env.root / self.accounts[1]["scope"].split("/")[0] / str(uuid.uuid4())
        org.mkdir()
        (org / ("deleted_" + prior_id)).write_text("123")
        self.assertEqual(self.plan()["entries"][0]["status"], "deleted")
        self.assertEqual(self.plan()["plan"], [])

    def test_generated_branch_tombstone_is_respected(self):
        _, first = self.record()
        self.record(1, sessionId=first["sessionId"])
        scan = self.plan()
        target = self.env.root / scan["plan"][0]["entry"]["target_path"]
        (target.parent / ("deleted_" + target.stem)).write_text("123")
        self.assertEqual(self.plan()["entries"][0]["status"], "deleted")

    def test_archive_side_index_and_target_archive_prevent_reappearance(self):
        _, first = self.record()
        (self.env.root / self.accounts[0]["scope"] / "archived-sessions.idx").write_bytes(
            sync.encode({"v": 1, "archived": [first["sessionId"]]}))
        self.assertEqual(self.plan()["entries"][0]["status"], "archived")
        self.record(1, **first)
        scan = self.plan()
        self.assertEqual(next(e for e in scan["entries"] if e["source"] == "账号 B")["status"], "target_archived")
        self.assertEqual(scan["plan"], [])

    def test_scheduled_remote_and_archived_are_skipped(self):
        self.record(scheduledTaskId="keep-running")
        self.record(sshConfig={"host": "example"})
        self.record(isArchived=True)
        scan = self.plan()
        self.assertEqual({e["status"] for e in scan["entries"]}, {"scheduled", "remote", "archived"})
        self.assertEqual(scan["plan"], [])

    def test_missing_primary_or_prior_text_is_not_copied(self):
        _, first = self.record()
        (self.text_dir / (first["cliSessionId"] + ".jsonl")).unlink()
        self.record(priorCliSessionIds=[str(uuid.uuid4())])
        self.assertEqual(self.plan()["plan"], [])
        self.assertTrue(all(e["status"] == "missing_text" for e in self.plan()["entries"]))

    def test_missing_work_folder_is_reported(self):
        self.record(cwd=str(self.home / "missing"))
        scan = self.plan()
        self.assertEqual(scan["entries"][0]["status"], "missing_project")
        self.assertEqual(scan["plan"], [])

    def test_bad_tail_and_ambiguous_transcript_are_skipped(self):
        _, first = self.record()
        (self.text_dir / (first["cliSessionId"] + ".jsonl")).write_text('{"type":"user"}\n{"type":')
        self.assertEqual(self.plan()["entries"][0]["status"], "bad_text")
        (self.text_dir / (first["cliSessionId"] + ".jsonl")).write_text('{"type":"user"}\n')
        other = self.env.projects / "other"
        other.mkdir()
        (other / (first["cliSessionId"] + ".jsonl")).write_text('{"type":"user"}\n')
        self.assertEqual(self.plan()["entries"][0]["status"], "bad_text")

    def test_summary_is_explained_without_mutating_text(self):
        _, data = self.record()
        path = self.text_dir / (data["cliSessionId"] + ".jsonl")
        path.unlink()
        self.transcript(data["cliSessionId"], "This session is being continued from a previous conversation.")
        scan = self.plan()
        self.assertTrue(scan["texts"][data["cliSessionId"]]["summary_at_start"])
        self.assertTrue(any("压缩摘要" in n for n in scan["entries"][0]["notes"]))

    def test_new_records_drop_cloud_credentials_and_reset_permissions(self):
        self.record(publishedArtifacts=[{"id": "cloud"}], bridgeSessionIds=["private"],
                    remoteMcpServersConfig=[{"token": "secret"}], enabledMcpTools={"server": ["tool"]},
                    promptAppendSnapshot={"private": "secret"}, permissionMode="bypassPermissions",
                    pendingActions=["do-not-run"], unknownSecret="secret")
        copied = json.loads(self.plan()["plan"][0]["raw"])
        self.assertNotIn("publishedArtifacts", copied)
        self.assertNotIn("bridgeSessionIds", copied)
        self.assertNotIn("pendingActions", copied)
        self.assertNotIn("unknownSecret", copied)
        self.assertNotIn("promptAppendSnapshot", copied)
        self.assertEqual(copied["permissionMode"], "default")
        self.assertEqual(copied["remoteMcpServersConfig"], [])
        self.assertEqual(copied["enabledMcpTools"], {})

    def test_unknown_schema_aborts_globally(self):
        path, data = self.record()
        data["priorCliSessionIds"] = "unexpected"
        path.write_bytes(sync.encode(data))
        with self.assertRaises(ValueError):
            self.plan()

    def test_empty_accounts_are_valid_noop(self):
        scan = self.plan()
        self.assertEqual(scan["plan"], [])
        self.assertTrue(self.apply(scan)["verified"])

    def test_changed_original_blocks_before_any_addition(self):
        path, data = self.record()
        scan = self.plan()
        data["title"] = "changed"
        path.write_bytes(sync.encode(data))
        with self.assertRaises(RuntimeError):
            self.apply(scan)
        self.assertEqual(len(list(self.env.root.glob("*/*/local_*.json"))), 1)

    def test_new_deletion_marker_after_plan_blocks_writing(self):
        path, data = self.record()
        scan = self.plan()
        (path.parent / ("deleted_" + data["cliSessionId"])).write_text("123")
        with self.assertRaises(RuntimeError):
            self.apply(scan)
        self.assertEqual(len(list(self.env.root.glob("*/*/local_*.json"))), 1)

    def test_changed_transcript_and_config_block_writing(self):
        _, data = self.record()
        scan = self.plan()
        with (self.text_dir / (data["cliSessionId"] + ".jsonl")).open("ab") as stream:
            stream.write(b'{"type":"assistant"}\n')
        with self.assertRaises(RuntimeError):
            self.apply(scan)
        scan = self.plan()
        (self.base / "config.json").write_bytes(sync.encode({"accounts": list(reversed(self.accounts))}))
        with self.assertRaises(RuntimeError):
            self.apply(scan)

    def test_restart_mid_batch_preserves_originals_and_can_resume(self):
        self.record()
        self.record(1)
        scan = self.plan()
        original = dict(scan["snapshot"].files)
        count = 0
        def guard():
            nonlocal count
            count += 1
            if count == 3:
                raise RuntimeError("Claude reopened")
        with self.assertRaisesRegex(RuntimeError, "已新增 1 条"):
            self.apply(scan, guard)
        for p, raw in original.items():
            self.assertEqual((self.env.root / p).read_bytes(), raw)
        self.assertEqual(len(self.plan()["plan"]), 1)
        self.apply()
        self.assertEqual(self.plan()["plan"], [])

    def test_publish_new_never_overwrites(self):
        path, _ = self.record()
        raw = path.read_bytes()
        with self.assertRaises(FileExistsError):
            sync.publish_new(path, b"replacement")
        self.assertEqual(path.read_bytes(), raw)

    def test_symlinked_indexes_and_transcripts_are_rejected(self):
        path, data = self.record()
        body = self.text_dir / (data["cliSessionId"] + ".jsonl")
        original = body.read_bytes()
        actual = self.home / "outside.jsonl"
        actual.write_bytes(original)
        body.unlink()
        body.symlink_to(actual)
        self.assertEqual(self.plan()["plan"], [])
        path.unlink()
        path.symlink_to(actual)
        with self.assertRaises(ValueError):
            self.plan()

    def test_process_detection_ignores_browser_host_blocks_cli_and_auto(self):
        commands = ("1 /Applications/Claude.app/Contents/Helpers/chrome-native-host\n"
                    "2 /Applications/Claude.app/Contents/MacOS/Claude\n"
                    "3 /Users/test/.local/bin/claude\n"
                    "4 /opt/homebrew/bin/python3\n"
                    "5 /opt/homebrew/bin/node\n"
                    "6 /Users/test/.local/share/claude/versions/2.1.300\n")
        args = ("4 /opt/homebrew/bin/python3 /Users/test/.local/share/claude-session-sync/watch_exit.py\n"
                "5 node /opt/lib/node_modules/@anthropic-ai/claude-code/cli.js\n")
        with patch.object(sync.subprocess, "run", side_effect=[SimpleNamespace(stdout=commands), SimpleNamespace(stdout=args)]):
            writers, automatic = sync.process_state("darwin")
        self.assertEqual({p["pid"] for p in writers}, {2, 3, 5, 6})
        self.assertEqual(automatic, [4])

    def test_running_guard_creates_no_backup_and_no_record(self):
        self.record()
        def guard():
            raise RuntimeError("running")
        with self.assertRaises(RuntimeError):
            self.apply(guard=guard)
        self.assertFalse((self.base / "backups").exists())
        self.assertEqual(len(list(self.env.root.glob("*/*/local_*.json"))), 1)

    def test_remote_handle_does_not_need_local_transcript_format(self):
        path, data = self.record(sshConfig={"host": "example"})
        data.pop("cliSessionId")
        data.pop("cwd")
        path.write_bytes(sync.encode(data))
        scan = self.plan()
        self.assertEqual(scan["entries"][0]["status"], "remote")
        self.assertEqual(scan["plan"], [])

    def test_command_sync_has_persisted_postconditions_and_counts(self):
        self.record()
        state = {"blockers": [], "warnings": [], "writers": [], "app_version": "test",
                 "last_account_hint": None, "automatic_disabled": True}
        with patch.object(sync, "Environment", return_value=self.env), \
             patch.object(sync, "preflight", return_value=state), \
             patch.object(sync.time, "sleep"), contextlib.redirect_stdout(io.StringIO()):
            code = sync.main(["--sync"])
        self.assertEqual(code, 0)
        report = json.loads((self.base / "reports/latest.json").read_bytes())
        self.assertTrue(report["result"]["verified"])
        self.assertEqual(report["result"]["remaining_eligible"], 0)
        self.assertEqual(report["result"]["after_counts"]["账号 B"]["ordinary"], 1)
        self.assertIn("同步后 1 条", (self.base / "reports/latest.txt").read_text(encoding="utf-8"))

    def test_command_sync_while_running_only_reports_and_never_writes(self):
        self.record()
        state = {"blockers": ["Claude running"], "warnings": [], "writers": [{"pid": 1}],
                 "app_version": "test", "last_account_hint": None, "automatic_disabled": True}
        with patch.object(sync, "Environment", return_value=self.env), \
             patch.object(sync, "preflight", return_value=state), contextlib.redirect_stdout(io.StringIO()):
            code = sync.main(["--sync"])
        self.assertEqual(code, 2)
        self.assertFalse((self.base / "backups").exists())
        self.assertEqual(len(list(self.env.root.glob("*/*/local_*.json"))), 1)
        self.assertIsNone(json.loads((self.base / "reports/latest.json").read_bytes())["result"])

    def test_command_check_while_stopped_does_not_write(self):
        self.record()
        state = {"blockers": [], "warnings": [], "writers": [], "app_version": "test",
                 "last_account_hint": None, "automatic_disabled": True}
        with patch.object(sync, "Environment", return_value=self.env), \
             patch.object(sync, "preflight", return_value=state), contextlib.redirect_stdout(io.StringIO()):
            code = sync.main(["--check"])
        self.assertEqual(code, 0)
        self.assertFalse((self.base / "backups").exists())
        self.assertEqual(len(list(self.env.root.glob("*/*/local_*.json"))), 1)

    def test_report_serializes_title_actions_without_binary_payloads(self):
        _, first = self.record(title="A 标题", titleSource="user")
        self.record(1, cliSessionId=first["cliSessionId"], title="B 标题", titleSource="user")
        state = {"blockers": [], "warnings": [], "writers": [], "app_version": "test",
                 "last_account_hint": None, "automatic_disabled": True}
        scan = self.plan()
        directory = sync.save_report(self.env, scan, state)
        report = json.loads((directory / "report.json").read_bytes())
        actions = report["scan"]["title_actions"]
        self.assertEqual(actions[0]["status"], "conflict")
        self.assertNotIn("raw", actions[0])
        self.assertNotIn("before_raw", actions[0])

    def test_request_claude_quit_uses_graceful_bundle_command(self):
        calls = []
        with patch.object(sync.subprocess, "run", side_effect=lambda *args, **kwargs: calls.append((args, kwargs)) or
                                                       SimpleNamespace(returncode=0, stdout="", stderr="")):
            sync.request_claude_quit(SimpleNamespace(platform_name="darwin"))
        self.assertEqual(calls[0][0][0], ["/usr/bin/osascript", "-e",
                                          'tell application id "com.anthropic.claudefordesktop" to quit'])
        self.assertFalse(calls[0][1].get("check", False))

    def test_request_claude_quit_does_not_hide_failure(self):
        with patch.object(sync.subprocess, "run", return_value=SimpleNamespace(
                returncode=1, stdout="", stderr="AppleScript denied")):
            with self.assertRaisesRegex(RuntimeError, "AppleScript denied"):
                sync.request_claude_quit(SimpleNamespace(platform_name="darwin"))

    def test_wait_for_claude_stopped_accepts_graceful_exit(self):
        states = iter([([{"pid": 1}], []), ([], [])])
        with patch.object(sync, "process_state", side_effect=lambda: next(states)), \
             patch.object(sync.time, "sleep"):
            sync.wait_for_claude_stopped(timeout=2)

    def test_second_command_is_blocked_by_another_window_lock(self):
        # Exercise the cross-platform lock without starting a second interpreter.
        with sync.exclusive_lock(self.base / ".sync.lock"):
            with patch.object(sync, "Environment", return_value=self.env):
                with contextlib.redirect_stdout(io.StringIO()) as output:
                    code = sync.main(["--check"])
        self.assertEqual(code, 2)
        self.assertIn("已有另一个同步窗口", output.getvalue())
        self.assertFalse((self.base / "reports").exists())

    def test_command_interruption_report_names_actual_written_entries(self):
        self.record()
        self.record(1)
        state = {"blockers": [], "warnings": [], "writers": [], "app_version": "test",
                 "last_account_hint": None, "automatic_disabled": True}
        with patch.object(sync, "Environment", return_value=self.env), \
             patch.object(sync, "preflight", return_value=state), \
             patch.object(sync, "require_stopped", side_effect=[None, None, None, RuntimeError("reopened")]), \
             patch.object(sync.time, "sleep"), contextlib.redirect_stdout(io.StringIO()):
            code = sync.main(["--sync"])
        self.assertEqual(code, 1)
        report = json.loads((self.base / "reports/latest.json").read_bytes())
        self.assertFalse(report["result"]["verified"])
        self.assertEqual(len(report["result"]["created"]), 1)
        self.assertIn("已新增，整体校验未完成", (self.base / "reports/latest.txt").read_text(encoding="utf-8"))
        self.assertEqual(len(list((self.base / "reports").glob("*/report.txt"))), 1)


class MultiAccountSyncTest(unittest.TestCase):
    """The union and title-choice behavior for three configured accounts."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name).resolve()
        self.base = self.home / "tool"
        self.base.mkdir()
        self.env = sync.Environment(self.base, self.home, self.home / "Claude.app")
        self.accounts = [{"label": "账号 %s" % letter,
                          "scope": str(uuid.uuid4()) + "/" + str(uuid.uuid4())}
                         for letter in ("A", "B", "C")]
        (self.base / "config.json").write_bytes(sync.encode({"accounts": self.accounts}))
        for account in self.accounts:
            (self.env.root / account["scope"]).mkdir(parents=True)
        self.project = self.home / "project"
        self.project.mkdir()
        (self.env.projects / "project").mkdir(parents=True)

    def tearDown(self):
        self.tmp.cleanup()

    def record(self, account=0, **values):
        data = {"sessionId": "local_" + str(uuid.uuid4()), "cliSessionId": str(uuid.uuid4()),
                "cwd": str(self.project), "title": "测试会话", "isArchived": False,
                "createdAt": 123, "lastActivityAt": 456}
        data.update(values)
        path = self.env.root / self.accounts[account]["scope"] / (data["sessionId"] + ".json")
        path.write_bytes(sync.encode(data))
        transcript = self.env.projects / "project" / (data["cliSessionId"] + ".jsonl")
        if not transcript.exists():
            transcript.write_text('{"type":"user","message":{"content":"原始消息"}}\n', encoding="utf-8")
        return path, data

    def plan(self, resolutions=None):
        return sync.build_plan(self.env, resolutions)

    def apply(self, scan):
        return sync.apply_plan(self.env, scan, guard=lambda: None)

    def test_three_accounts_receive_a_deduplicated_union(self):
        self.record(0, title="来自 A")
        self.record(1, title="来自 B")
        scan = self.plan()
        self.assertEqual(len(scan["plan"]), 4)
        self.assertEqual({label: value["will_add"] for label, value in scan["counts"].items()},
                         {"账号 A": 1, "账号 B": 1, "账号 C": 2})
        result = self.apply(scan)
        self.assertTrue(result["verified"])
        for account in self.accounts:
            files = list((self.env.root / account["scope"]).glob("local_*.json"))
            self.assertEqual(len(files), 2)
        self.assertEqual(self.plan()["plan"], [])

    def test_missing_config_is_auto_discovered_before_check(self):
        (self.base / "config.json").unlink()
        self.record(0, title="来自 A")
        self.record(1, title="来自 B")
        scan = self.plan()
        self.assertTrue((self.base / "config.json").exists())
        self.assertEqual(len(scan["config"]["accounts"]), 3)

    def test_new_account_folder_is_discovered_on_a_later_check(self):
        extra = self.env.root / str(uuid.uuid4()) / str(uuid.uuid4())
        extra.mkdir(parents=True)
        scan = self.plan()
        self.assertEqual(len(scan["config"]["accounts"]), 4)
        self.assertTrue(any(account["scope"] == "/".join(extra.relative_to(self.env.root).parts)
                           for account in scan["config"]["accounts"]))

    def test_three_account_title_conflict_can_choose_any_account(self):
        _, first = self.record(0, title="A 的标题", titleSource="user")
        self.record(1, cliSessionId=first["cliSessionId"], title="B 的标题", titleSource="user")
        self.record(2, cliSessionId=first["cliSessionId"], title="C 的标题", titleSource="user")
        initial = self.plan()
        self.assertEqual(len(initial["title_groups"]), 1)
        group = initial["title_groups"][0]
        self.assertEqual({item["label"] for item in group["options"]}, {"账号 A", "账号 B", "账号 C"})
        chosen = self.plan({"groups": {first["cliSessionId"]: self.accounts[2]["scope"]}})
        self.assertEqual(len(chosen["title_plan"]), 2)
        self.assertEqual({item["status"] for item in chosen["title_actions"]},
                         {"selected_source", "selected_target"})
        result = self.apply(chosen)
        self.assertTrue(result["verified"])
        for account in self.accounts:
            path = next((self.env.root / account["scope"]).glob("local_*.json"))
            self.assertEqual(json.loads(path.read_bytes())["title"], "C 的标题")

    def test_selected_title_is_used_for_a_new_account_entry(self):
        _, first = self.record(0, title="A 的标题", titleSource="user")
        self.record(1, cliSessionId=first["cliSessionId"], title="B 的标题", titleSource="user")
        chosen = self.plan({"groups": {first["cliSessionId"]: self.accounts[0]["scope"]}})
        new_entry = next(item for item in chosen["plan"]
                         if item["entry"]["target"] == "账号 C")
        self.assertEqual(json.loads(new_entry["raw"])["title"], "A 的标题")
        self.apply(chosen)
        for account in self.accounts:
            path = next((self.env.root / account["scope"]).glob("local_*.json"))
            self.assertEqual(json.loads(path.read_bytes())["title"], "A 的标题")


if __name__ == "__main__":
    unittest.main()
