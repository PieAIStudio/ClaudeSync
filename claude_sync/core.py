#!/usr/bin/env python3
"""Portable sync engine for Claude local Code session indexes. No network."""
# Maintainer map:
#   file primitives / snapshots -> title policy -> build_plan -> apply_plan
#   -> report / graceful-close helpers -> CLI.  Keep GUI logic in SyncGUI.swift.
# The public entry points are Sync.app, Sync.command, and this module's
# --check/--sync/--close-sync flags; changing them is a compatibility change.
import argparse
from collections import defaultdict, Counter
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import time
import uuid

from .storage import (Snapshot, clean, digest, encode, exclusive_lock, plain_directory,
                      publish_new, read_regular, replace_existing, write_owned)
from .platforms import (Environment, app_version, automatic_sync_state,
                        default_data_directory, process_state, request_claude_quit, runtime_base)

from .titles import (load_tool_state, save_tool_state, legacy_branch_title,
                     title_origin, title_update_record, make_title_action)

VERSION = "1.1.0"
ZONE = timezone(timedelta(hours=8))
UUID = re.compile(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\Z")
LOCAL = re.compile(r"local_([0-9a-f-]{36})\.json\Z")
PORTABLE = frozenset("""sessionId cliSessionId priorCliSessionIds cwd originCwd
worktreePath branchName gitBranch createdAt lastActivityAt model title titleSource
titleTurn isArchived isStarred completedTurns effort effortInherited
lastAssistantUuid rewindEdges transcriptModelStates""".split())
REMOTE = ("remoteTarget", "sshConnectionId", "sshConfig", "wslConfig",
          "cloudSessionId", "remoteSessionId", "violinBow")
STATUS = {
    "add": "将新增", "branch": "将新增分支入口", "present": "已有同一正文",
    "planned": "本次已计划同一正文", "archived": "跳过：源会话已归档",
    "target_archived": "跳过：目标已归档", "scheduled": "跳过：定时任务记录",
    "deleted": "跳过：账号有删除标记", "remote": "跳过：远程或云端记录",
    "missing_text": "跳过：正文或历史链缺失", "bad_text": "跳过：正文检查未通过",
    "missing_project": "跳过：工作目录不存在", "id_collision": "跳过：新入口 ID 冲突",
}
TITLE_STATUS = {
    "same": "标题一致",
    "safe": "可安全同步标题",
    "normalize": "可统一标题",
    "selected_source": "已选择来源标题",
    "selected_target": "已保留目标标题",
    "keep_target": "目标账号是手动标题，保留目标",
    "conflict": "两边都是手动标题，需要选择",
    "auto_difference": "都是自动标题，不猜测",
}


class SyncInterrupted(RuntimeError):
    def __init__(self, message, created, backup):
        super().__init__(message)
        self.result = {"created": list(created), "titles_updated": [], "backup": str(backup), "verified": False,
                       "after_counts": None, "remaining_eligible": None}


def now():
    return datetime.now(ZONE)


def config(env):
    raw = read_regular(env.base / "config.json")
    data = json.loads(raw)
    for key, attribute in (("session_root", "session_root"), ("projects_root", "projects_root")):
        value = data.get(key)
        if value is not None:
            if not isinstance(value, str) or not value.strip():
                raise ValueError("config.json 的 %s 必须是非空路径。" % key)
            setattr(env, attribute, Path(value).expanduser())
    accounts = data.get("accounts", [])
    if len(accounts) != 2 or any(not isinstance(a, dict) for a in accounts):
        raise ValueError("config.json 必须指定两个账号。")
    for account in accounts:
        parts = str(account.get("scope", "")).split("/")
        if len(parts) != 2 or not all(UUID.fullmatch(p) for p in parts):
            raise ValueError("账号 scope 格式错误。")
        if not isinstance(account.get("label"), str) or not account["label"].strip():
            raise ValueError("账号 label 不能为空。")
    if accounts[0]["scope"].split("/")[0] == accounts[1]["scope"].split("/")[0]:
        raise ValueError("需要两个不同账号，不能只配置同一账号的两个组织。")
    if accounts[0]["label"] == accounts[1]["label"]:
        raise ValueError("两个账号的显示名称需要不同。")
    return data, raw


def load_title_resolutions(path):
    if not path:
        return {}
    value = json.loads(read_regular(Path(path)))
    if not isinstance(value, dict) or value.get("version") != 1 or not isinstance(value.get("choices"), dict):
        raise ValueError("标题选择文件格式无法识别。")
    allowed = {"source", "target", "skip"}
    choices = {str(k): str(v) for k, v in value["choices"].items() if str(v) in allowed}
    return choices


def take_snapshot(env, accounts):
    """Include all orgs' deletion markers and membership under both accounts."""
    plain_directory(env.root)
    files, directories = {}, {}
    for account in accounts:
        plain_directory(env.root / account["scope"])
        account_dir = env.root / account["scope"].split("/")[0]
        plain_directory(account_dir)
        members = sorted(account_dir.iterdir())
        directories[account_dir.relative_to(env.root).as_posix()] = tuple(p.name for p in members)
        for org_dir in members:
            if not UUID.fullmatch(org_dir.name):
                raise ValueError("出现未知账号目录结构：" + str(org_dir))
            plain_directory(org_dir)
            members = sorted(org_dir.iterdir())
            directories[org_dir.relative_to(env.root).as_posix()] = tuple(p.name for p in members)
            for path in members:
                relative = path.relative_to(env.root).as_posix()
                files[relative] = read_regular(path)
    return Snapshot(files, directories)


def assert_snapshot(env, accounts, expected):
    actual = take_snapshot(env, accounts)
    if actual != expected:
        raise RuntimeError("检查后会话、归档或删除记录发生变化；停止写入，请完全退出后重试。")


def validate_record(name, data):
    match = LOCAL.fullmatch(name)
    if (not match or not UUID.fullmatch(match[1]) or not isinstance(data, dict)
            or data.get("sessionId") != name[:-5]):
        raise ValueError("无法识别的本地会话结构：" + name)
    if any(data.get(k) for k in REMOTE):
        return  # Never copy remote records; their CLI handle can have another format.
    if (not UUID.fullmatch(str(data.get("cliSessionId", "")))
            or not isinstance(data.get("cwd"), str) or not Path(data["cwd"]).is_absolute()):
        raise ValueError("无法识别的本地会话结构：" + name)
    for key in ("isArchived", "isStarred"):
        if key in data and not isinstance(data[key], bool):
            raise ValueError("会话布尔字段格式改变：" + name + " / " + key)
    for key in ("title", "model"):
        if key in data and not isinstance(data[key], str):
            raise ValueError("会话文本字段格式改变：" + name + " / " + key)
    prior = data.get("priorCliSessionIds", [])
    if not isinstance(prior, list) or any(not isinstance(s, str) or not UUID.fullmatch(s) for s in prior):
        raise ValueError("历史正文 ID 格式改变：" + name)
    edges = data.get("rewindEdges", [])
    if not isinstance(edges, list):
        raise ValueError("分支关系格式改变：" + name)
    for edge in edges:
        if not isinstance(edge, dict) or any(not UUID.fullmatch(str(edge.get(k, "")))
                                             for k in ("id", "parent", "child")):
            raise ValueError("分支关系字段格式改变：" + name)
        if "cwd" in edge and (not isinstance(edge["cwd"], str) or not Path(edge["cwd"]).is_absolute()):
            raise ValueError("分支工作目录格式改变：" + name)
    states = data.get("transcriptModelStates", {})
    if not isinstance(states, dict) or any(not UUID.fullmatch(k) or not isinstance(v, dict)
                                           for k, v in states.items()):
        raise ValueError("历史模型状态格式改变：" + name)


def history_ids(data):
    ids = {data["cliSessionId"], *data.get("priorCliSessionIds", [])}
    for edge in data.get("rewindEdges", []):
        ids.update((edge["parent"], edge["child"]))
    ids.update(data.get("transcriptModelStates", {}))
    return ids


def fingerprint(path):
    s = path.stat()
    return (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns)


def inspect_text(path):
    """Bounded JSONL sampling, not a claim that the entire history is intact."""
    if path.resolve() != path.absolute() or not stat.S_ISREG(path.lstat().st_mode):
        raise ValueError("正文路径包含符号链接或不是普通文件")
    before = fingerprint(path)
    if not before[2]:
        raise ValueError("正文文件为空")
    sample_size = 1024 * 1024
    with path.open("rb") as stream:
        prefix = stream.read(sample_size)
        stream.seek(max(0, before[2] - sample_size))
        tail = stream.read(sample_size)
    lines = prefix.splitlines()
    if before[2] > sample_size and not prefix.endswith(b"\n"):
        lines = lines[:-1]
    if not lines:
        raise ValueError("首行超过检查上限，无法可靠识别正文")
    parsed = [json.loads(line) for line in lines[:32] if line.strip()]
    if not parsed or any(not isinstance(line, dict) for line in parsed):
        raise ValueError("JSONL 首部格式错误")
    ending = tail.rstrip(b"\r\n").split(b"\n")[-1]
    if before[2] <= sample_size or b"\n" in tail.rstrip(b"\r\n"):
        if not isinstance(json.loads(ending), dict):
            raise ValueError("JSONL 尾部格式错误")
    else:
        raise ValueError("最后一行超过检查上限，无法可靠识别正文")
    summary = False
    for row in parsed:
        if row.get("type") != "user":
            continue
        message = row.get("message", {})
        content = message.get("content", "") if isinstance(message, dict) else ""
        if isinstance(content, list):
            content = " ".join(c.get("text", "") for c in content
                               if isinstance(c, dict) and isinstance(c.get("text"), str))
        if isinstance(content, str) and content:
            summary = bool(row.get("isCompactSummary")) or "This session is being continued from a previous" in content
            break
    if fingerprint(path) != before:
        raise ValueError("正文正在变化；完全退出 Claude/Code 后重试")
    return {"path": str(path), "bytes": before[2], "fingerprint": list(before),
            "summary_at_start": summary, "check": "首尾抽样；未全文解析"}


def portable_record(data, session_id=None, title=None):
    copied = {k: v for k, v in data.items() if k in PORTABLE}
    if session_id:
        copied["sessionId"] = session_id
        copied["isStarred"] = False
    if title:
        copied["title"] = title
    copied.update(permissionMode="default", enabledMcpTools={}, remoteMcpServersConfig=[],
                  alwaysAllowedReasons=[], sessionPermissionUpdates=[], spawnSeed={})
    return encode(copied)


def build_plan(env, resolutions=None):
    cfg, cfg_raw = config(env)
    tool_state = load_tool_state(env)
    accounts = cfg["accounts"]
    snapshot = take_snapshot(env, accounts)
    records, archived, tombstones = {}, {}, {}
    others = []
    for account in accounts:
        scope = account["scope"]
        records[scope] = {}
        archived[scope] = set()
        tombstones[scope] = set()
        prefix = scope.split("/")[0] + "/"
        for relative, raw in snapshot.files.items():
            p = Path(relative)
            if relative.startswith(prefix) and p.name.startswith("deleted_"):
                tombstones[scope].add(p.name[8:])
            if p.parent.as_posix() != scope:
                continue
            if p.name == "archived-sessions.idx":
                value = json.loads(raw)
                if not isinstance(value, dict) or value.get("v") != 1 or not isinstance(value.get("archived"), list):
                    raise ValueError("无法识别归档索引：" + relative)
                if any(not isinstance(v, str) for v in value["archived"]):
                    raise ValueError("归档索引内容无效：" + relative)
                archived[scope].update(value["archived"])
            elif p.name.startswith("local_"):
                data = json.loads(raw)
                validate_record(p.name, data)
                records[scope][p.name] = data
            elif not p.name.startswith("deleted_") and p.name != "scheduled-tasks.json":
                others.append({"account": account["label"], "filename": p.name,
                               "reason": "非普通本地 Code 索引，不同步"})
    plain_directory(env.projects)
    text_index = defaultdict(list)
    for path in env.projects.glob("*/*.jsonl"):
        if UUID.fullmatch(path.stem):
            text_index[path.stem].append(path)
    texts = {}
    for scope in records:
        for data in records[scope].values():
            if data.get("scheduledTaskId") or data.get("isArchived") or any(data.get(k) for k in REMOTE):
                continue
            for session_id in sorted(history_ids(data)):
                if session_id in texts:
                    continue
                paths = text_index[session_id]
                if not paths:
                    texts[session_id] = {"error": "缺少正文"}
                elif len(paths) != 1:
                    texts[session_id] = {"error": "多个项目目录含同一正文 ID，不能猜测"}
                else:
                    try:
                        texts[session_id] = inspect_text(paths[0])
                    except (OSError, ValueError) as exc:
                        texts[session_id] = {"error": str(exc), "path": str(paths[0])}
    entries, plan, title_actions, title_plan = [], [], [], []
    def is_archived(scope, data):
        return bool(data.get("isArchived")) or data["sessionId"] in archived[scope]
    for source, target in ((accounts[0], accounts[1]), (accounts[1], accounts[0])):
        ss, ts = source["scope"], target["scope"]
        target_heads = {d["cliSessionId"]: (target_name, d) for target_name, d in records[ts].items()
                        if UUID.fullmatch(str(d.get("cliSessionId", ""))) and not any(d.get(k) for k in REMOTE)}
        planned_heads = set()
        for name, data in sorted(records[ss].items()):
            title = data.get("title") or "未命名会话"
            entry = {"title": title, "source": source["label"], "target": target["label"],
                     "source_path": ss + "/" + name, "cliSessionId": data.get("cliSessionId"),
                     "notes": [], "status": "present"}
            entries.append(entry)
            same_pair = target_heads.get(data.get("cliSessionId"))
            same_name, same = same_pair if same_pair else (None, None)
            name_match = records[ts].get(name)
            all_ids = (history_ids(data) if not any(data.get(k) for k in REMOTE) else set()) | {data["sessionId"], data["sessionId"][6:]}
            if data.get("scheduledTaskId"):
                entry["status"] = "scheduled"
            elif is_archived(ss, data):
                entry["status"] = "archived"
            elif any(data.get(k) for k in REMOTE):
                entry["status"] = "remote"
            elif all_ids & (tombstones[ss] | tombstones[ts]):
                entry["status"] = "deleted"
            elif (same and is_archived(ts, same)) or (name_match and is_archived(ts, name_match)):
                entry["status"] = "target_archived"
            elif same:
                if same.get("title") != title:
                    action = make_title_action(
                        data, same, source["label"], target["label"],
                        ss + "/" + name, ts + "/" + same_name, tool_state, resolutions)
                    title_actions.append(action)
                    if action["status"] in ("safe", "normalize", "selected_source"):
                        title_plan.append(action)
                    entry["title_action"] = action["status"]
                    entry["title"] = action["source_title"]
                    entry["notes"].extend(action["notes"])
                    entry["notes"].append("当前：%s；目标：%s" %
                                         (action["source_title"], action["target_title"]))
            elif data["cliSessionId"] in planned_heads:
                entry["status"] = "planned"
            elif not Path(data["cwd"]).is_dir():
                entry["status"] = "missing_project"
                entry["notes"].append(data["cwd"])
            else:
                errors = [(i, texts[i]["error"]) for i in sorted(history_ids(data)) if "error" in texts[i]]
                if errors:
                    entry["status"] = "missing_text" if all(e == "缺少正文" for _, e in errors) else "bad_text"
                    entry["notes"].extend(i + "：" + e for i, e in errors)
                    continue
                dest_name, copied_title, dest_id = name, None, None
                if name_match:
                    # Two heads are kept separately; never choose a winner from timestamps.
                    dest_id = "local_" + str(uuid.uuid5(uuid.NAMESPACE_URL,
                                "claude-session-sync:" + ts + ":" + data["cliSessionId"]))
                    dest_name = dest_id + ".json"
                    copied_title = None
                    entry["status"] = "branch"
                    entry["notes"].append("原入口指向不同正文；保留原入口，新增同名分支入口")
                else:
                    entry["status"] = "add"
                target_path = ts + "/" + dest_name
                generated_ids = {dest_name[:-5], dest_name[6:-5]}
                if generated_ids & (tombstones[ss] | tombstones[ts]):
                    entry["status"] = "deleted"
                    continue
                if dest_name[:-5] in archived[ts]:
                    entry["status"] = "target_archived"
                    continue
                if target_path in snapshot.files:
                    entry["status"] = "id_collision"
                    continue
                raw = portable_record(data, dest_id, copied_title)
                entry["target_path"] = target_path
                entry["copied_title"] = title
                entry["dropped_fields"] = sorted(set(data) - PORTABLE)
                plan.append({"entry": entry, "raw": raw})
                planned_heads.add(data["cliSessionId"])
            for session_id in sorted(all_ids - {data["sessionId"], data["sessionId"][6:]}):
                text = texts.get(session_id, {})
                if "error" in text and entry["status"] == "present":
                    entry["notes"].append("已有入口的正文风险：" + session_id + " / " + text["error"])
            current_text = texts.get(data.get("cliSessionId"), {})
            if current_text.get("summary_at_start"):
                entry["notes"].append("当前正文从压缩摘要继续；同步不把它自动还原为原对话")
            if isinstance(data.get("cwd"), str) and not Path(data["cwd"]).is_dir():
                note = "工作目录不存在：" + data["cwd"]
                if note not in entry["notes"]:
                    entry["notes"].append(note)
            entry["cloud_links_omitted"] = any(data.get(k) for k in
                ("publishedArtifacts", "bridgeSessionIds", "enabledMcpTools", "remoteMcpServersConfig"))
    counts = {a["label"]: {"all_local": len(records[a["scope"]]),
              "ordinary": sum(not d.get("scheduledTaskId") and not is_archived(a["scope"], d) and not any(d.get(k) for k in REMOTE)
                              for d in records[a["scope"]].values()),
              "will_add": sum(p["entry"]["target"] == a["label"] for p in plan),
              "will_update_titles": sum(p["target"] == a["label"] for p in title_plan)} for a in accounts}
    return {"config": cfg, "config_raw": cfg_raw, "snapshot": snapshot,
            "records": records, "entries": entries, "plan": plan,
            "title_actions": title_actions, "title_plan": title_plan, "texts": texts,
            "counts": counts, "other_files": others, "tool_state": tool_state}


def preflight(env):
    blockers, warnings = [], []
    writers, automatic = process_state(env.platform_name)
    if writers:
        blockers.append("Claude Desktop/Code 仍运行（%d 个相关进程）；请先结束任务并完全退出应用。" % len(writers))
    if automatic:
        blockers.append("发现旧自动同步进程，必须先停用。PID：" + str(automatic))
    automatic_blockers, disabled = automatic_sync_state(env)
    blockers.extend(automatic_blockers)
    alt = os.environ.get("CLAUDE_CONFIG_DIR")
    expected_config = env.projects.parent.resolve()
    if alt and Path(alt).expanduser().resolve() != expected_config:
        blockers.append("CLAUDE_CONFIG_DIR 与配置的正文目录不一致，请先在设置中确认正文目录。")
    version = app_version(env)
    if version == "unknown":
        warnings.append("无法读取 Desktop 版本；仍会逐项检查存储结构。")
    last_account = None
    try:
        settings = json.loads((env.desktop / "config.json").read_bytes())
        last_account = settings.get("lastKnownAccountUuid")
    except (OSError, ValueError):
        warnings.append("无法读取上次账号缓存；请根据目录末尾和会话数量确认账号。")
    return {"blockers": blockers, "warnings": warnings, "writers": writers,
            "app_version": version, "last_account_hint": last_account,
            "automatic_disabled": disabled and not automatic}


def require_stopped(env):
    state = preflight(env)
    if state["blockers"]:
        raise RuntimeError("；".join(state["blockers"]))


def assert_texts(texts):
    for text in texts.values():
        if "fingerprint" in text and fingerprint(Path(text["path"])) != tuple(text["fingerprint"]):
            raise RuntimeError("正文在检查后发生变化，停止写入：" + text["path"])


def apply_plan(env, scan, guard=None):
    guard = guard or (lambda: require_stopped(env))
    guard()
    assert_snapshot(env, scan["config"]["accounts"], scan["snapshot"])
    assert_texts(scan["texts"])
    if read_regular(env.base / "config.json") != scan["config_raw"]:
        raise RuntimeError("工具账号配置发生变化，停止写入。")
    if not scan["plan"] and not scan.get("title_plan"):
        return {"created": [], "titles_updated": [], "backup": None, "verified": True,
                "after_counts": scan["counts"], "remaining_eligible": 0}
    backup = env.base / "backups" / now().strftime("%Y%m%d-%H%M%S-%f")
    backup.mkdir(parents=True, mode=0o700)
    for relative, raw in scan["snapshot"].files.items():
        path = backup / "before" / relative
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        publish_new(path, raw)
        if digest(path.read_bytes()) != digest(raw):
            raise RuntimeError("备份校验失败，尚未同步。")
    manifest = {"version": 2, "time": now().isoformat(), "state": "prepared",
                "before_sha256": {p: digest(raw) for p, raw in scan["snapshot"].files.items()},
                "planned": [{"source": p["entry"]["source_path"],
                             "target": p["entry"]["target_path"], "sha256": digest(p["raw"])} for p in scan["plan"]],
                "title_updates": [{"source": p["source_path"], "target": p["target_path"],
                                   "before_sha256": digest(scan["snapshot"].files[p["target_path"]]),
                                   "after_sha256": digest(p["raw"])} for p in scan.get("title_plan", [])],
                "created": [], "titles_updated": [], "transcripts": scan["texts"]}
    manifest_path = backup / "manifest.json"
    write_owned(manifest_path, encode(manifest))
    expected = scan["snapshot"]
    try:
        for item in scan["plan"]:
            guard()
            assert_snapshot(env, scan["config"]["accounts"], expected)
            assert_texts(scan["texts"])
            if read_regular(env.base / "config.json") != scan["config_raw"]:
                raise RuntimeError("工具账号配置发生变化，停止后续写入。")
            target = item["entry"]["target_path"]
            publish_new(env.root / target, item["raw"])
            expected = expected.with_added(target, item["raw"])
            manifest["created"].append(target)
            write_owned(manifest_path, encode(manifest))
        for item in scan.get("title_plan", []):
            guard()
            assert_snapshot(env, scan["config"]["accounts"], expected)
            assert_texts(scan["texts"])
            target = item["target_path"]
            before = expected.files.get(target)
            if before is None:
                raise RuntimeError("标题目标入口不存在，停止标题更新：" + target)
            replace_existing(env.root / target, item["raw"], expected=before)
            expected = expected.with_replaced(target, item["raw"])
            manifest["titles_updated"].append(target)
            write_owned(manifest_path, encode(manifest))
        guard()
        assert_snapshot(env, scan["config"]["accounts"], expected)
        assert_texts(scan["texts"])
        after = build_plan(env)
        if after["plan"] or after.get("title_plan"):
            raise RuntimeError("同步后仍有可补齐记录或标题更新，保留备份并检查报告。")
        save_tool_state(env, after)
        manifest.update(state="verified", verified_at=now().isoformat())
        write_owned(manifest_path, encode(manifest))
        return {"created": manifest["created"], "titles_updated": manifest["titles_updated"],
                "backup": str(backup), "verified": True,
                "after_counts": after["counts"], "remaining_eligible": 0}
    except BaseException as exc:
        manifest.update(state="interrupted", error=type(exc).__name__ + ": " + str(exc))
        write_owned(manifest_path, encode(manifest))
        interrupted = SyncInterrupted("同步中断；已新增 %d 条、更新 %d 个标题；已有未处理数据未覆盖。可重跑。备份：%s；原因：%s" %
                                      (len(manifest["created"]), len(manifest["titles_updated"]), backup, exc),
                                      manifest["created"], backup)
        interrupted.result["titles_updated"] = manifest["titles_updated"]
        raise interrupted from exc


def render(scan, state, result=None, error=None):
    lines = ["Claude Desktop 本地 Code 会话 · 手动同步", "时间：" + now().isoformat(timespec="seconds"),
             "没有后台同步；不会退出、打开或切换 Claude 账号。", ""]
    lines.append("条件检查：")
    lines.append("  自动同步：" + ("已停用" if state["automatic_disabled"] else "未能确认已停用"))
    lines.append("  Claude Desktop 版本：" + state["app_version"])
    if state["blockers"]:
        lines.extend("  [不满足] " + clean(v) for v in state["blockers"])
    else:
        lines.append("  [满足] 未发现 Claude Desktop/Code 写入进程。")
    lines.extend("  [注意] " + clean(v) for v in state["warnings"])
    if scan:
        cfg = scan["config"]
        if state["app_version"] != cfg.get("reviewed_app_version"):
            lines.append("  [注意] 应用版本不同于本工具初次核对版本；只校验已识别结构，应用内显示仍须核对。")
        hint = next((a["label"] for a in cfg["accounts"]
                     if a["scope"].split("/")[0] == state["last_account_hint"]), "未知或未配置账号")
        lines.append("  上次登录缓存：" + clean(hint) + "（本地提示，不能证明实时登录或切号已完成）")
        lines.append("  切号顺序：推荐同步完成后打开并切号；已切过也可以，仍需完全退出后同步。")
        lines.append("  写入前再次检查进程、稳定状态和文件变化；运行期间请勿打开 Claude/Code。")
        lines.extend(["", "账号与同步方向："])
        for account in cfg["accounts"]:
            counts = scan["counts"][account["label"]]
            if result and result.get("verified"):
                lines.append("  %s（账号目录末尾 %s）：同步前 %d 条；新增 %d；标题更新 %d；同步后 %d 条普通未归档索引。" %
                             (clean(account["label"]), account["scope"].split("/")[0][-6:],
                              counts["ordinary"],
                              sum(p.startswith(account["scope"] + "/") for p in result.get("created", [])),
                              sum(p.startswith(account["scope"] + "/") for p in result.get("titles_updated", [])),
                              result["after_counts"][account["label"]]["ordinary"]))
            elif result:
                added = sum(p.startswith(account["scope"] + "/") for p in result["created"])
                updated = sum(p.startswith(account["scope"] + "/") for p in result.get("titles_updated", []))
                lines.append("  %s：同步前 %d 条；已实际新增 %d 个入口、更新 %d 个标题，整体校验尚未完成。" %
                             (clean(account["label"]), counts["ordinary"], added, updated))
            else:
                lines.append("  %s（账号目录末尾 %s）：普通未归档索引 %d 条；将新增 %d 个入口、更新 %d 个标题。" %
                             (clean(account["label"]), account["scope"].split("/")[0][-6:],
                              counts["ordinary"], counts["will_add"], counts["will_update_titles"]))
        created = set(result.get("created", [])) if result else set()
        additions = [e for e in scan["entries"] if e["status"] in ("add", "branch")]
        skipped = [e for e in scan["entries"] if e["status"] not in ("add", "branch", "present", "planned")]
        lines.extend(["", "本次新增（%d 个入口）：" % len(additions)])
        if not additions:
            lines.append("  无。")
        for entry in additions:
            status = STATUS[entry["status"]]
            if entry.get("target_path") in created:
                status = "已新增并验证" if result.get("verified") else "已新增，整体校验未完成"
            lines.append("  [%s] %s → %s：%s" % (status, clean(entry["source"]), clean(entry["target"]), clean(entry["title"])))
            lines.extend("      " + clean(note) for note in entry["notes"])
        lines.extend(["", "本次未同步（%d 条记录；保留原因如下）：" % len(skipped)])
        if not skipped:
            lines.append("  无。")
        for entry in skipped:
            lines.append("  [%s] %s → %s：%s" % (STATUS[entry["status"]], clean(entry["source"]), clean(entry["target"]), clean(entry["title"])))
            lines.extend("      " + clean(note) for note in entry["notes"])
        title_actions = scan.get("title_actions", [])
        title_conflicts = [a for a in title_actions if a["status"] == "conflict"]
        updated_titles = set(result.get("titles_updated", [])) if result else set()
        lines.extend(["", "标题处理（%d 个差异；安全规则只更新手动标题 → 自动标题）：" % len(title_actions)])
        if not title_actions:
            lines.append("  无标题差异。")
        for action in title_actions:
            label = TITLE_STATUS[action["status"]]
            if action.get("target_path") in updated_titles:
                label = "已更新并验证"
            lines.append("  [%s] %s → %s：%s → %s" %
                         (label, clean(action["source"]), clean(action["target"]),
                          clean(action["source_title"]), clean(action["target_title"])))
            lines.extend("      " + clean(note) for note in action["notes"])
        if title_conflicts:
            lines.append("  提示：两边都是手动标题，本次不覆盖；以后可增加明确的 A→B 或 B→A 选择。")
        aligned = defaultdict(list)
        for entry in scan["entries"]:
            if entry["status"] in ("present", "planned"):
                aligned[entry["cliSessionId"]].append(entry)
        lines.extend(["", "已有相同正文（%d 个正文 ID，不重复添加）：" % len(aligned)])
        for entries in aligned.values():
            titles = list(dict.fromkeys(clean(e["title"]) for e in entries))
            lines.append("  [已有] " + " / ".join(titles))
            notes = list(dict.fromkeys(note for e in entries for note in e["notes"]))
            lines.extend("      " + clean(note) for note in notes)
        for other in scan["other_files"]:
            lines.append("  [范围外] " + clean(other["account"]) + " / " + clean(other["filename"]))
        lines.extend(["", "同步边界：", "  同步本机普通 Code 的入口及可识别的历史/分支关系；正文仍引用同一份本地 JSONL。",
                      "  不覆盖旧入口；标题只按安全规则更新，收藏/归档不改，不合并两条分支。",
                      "  不迁移普通 Chat、Cowork、云端/SSH 会话、Artifact、评论监控、连接器、定时任务或登录凭证。",
                      "  这些云端资源需要原账号访问，或在新账号重新发布/连接；正文中的旧引用仍可能报错。",
                      "  删除/归档/定时任务等记录会保留差异，因此两个账号的总数未必相同。",
                      "  正文已检查存在、非空、首尾抽样和文件状态；未完整解析全文，不能保证应用显示每条旧消息。",
                      "  应用里的可见性、实际续聊及云端权限：仍需你打开后确认。"])
    lines.append("")
    if error:
        lines.append("结果：未完成。" + clean(error))
        if result and result.get("backup"):
            lines.append("本次备份：" + result["backup"])
        lines.append("下一步：按错误提示处理，保持 Claude/Code 关闭后重跑；不要用旧备份覆盖整个目录。")
    elif result and result.get("verified"):
        lines.append("结果：已新增 %d 个入口；新增内容、所有原索引、删除/归档记录及正文状态均通过文件校验。" % len(result["created"]))
        if result["backup"]:
            lines.append("本次备份：" + result["backup"])
        lines.append("下一步：手动打开 Claude → 登录/切到目标账号 → 检查 Code 列表和分支入口。")
    elif state["blockers"]:
        lines.append("结果：只读检查完成，当前不能同步；Claude 数据未修改。")
        lines.append("下一步：结束工作 → ⌘Q 完全退出 → 重新运行 Sync.command。")
    else:
        lines.append("结果：只读检查完成；尚未写入 Claude 数据。")
        lines.append("下一步：确认上述计划后同步；完成前保持 Claude/Code 关闭。")
    return "\n".join(lines) + "\n"


def render_result(scan, result):
    lines = ["同步完成：新增 %d 个入口，更新 %d 个标题。" %
             (len(result["created"]), len(result.get("titles_updated", [])))]
    for account, counts in result["after_counts"].items():
        lines.append("  " + clean(account) + "：现在有 %d 条普通未归档索引。" % counts["ordinary"])
    lines.extend(["[通过] 新增索引与标题更新均符合计划，已有索引及删除/归档记录原样保留。",
                  "[通过] 正文文件状态未变化，没有剩余符合条件但未补齐的入口。",
                  "[待应用确认] 手动打开 Claude、切到目标账号，检查 Code 列表及新分支入口。",
                  "云端资源及跳过项仍保持报告中列出的限制。"])
    if result["backup"]:
        lines.append("备份：" + result["backup"])
    return "\n".join(lines) + "\n"


def save_report(env, scan, state, result=None, error=None, directory=None):
    directory = directory or env.base / "reports" / now().strftime("%Y%m%d-%H%M%S-%f")
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    public_titles = []
    if scan:
        for action in scan.get("title_actions", []):
            public_titles.append({k: v for k, v in action.items() if k not in ("raw", "before_raw")})
    public_scan = ({k: scan[k] for k in ("entries", "counts", "texts", "other_files")} |
                   {"title_actions": public_titles}) if scan else None
    data = {"tool_version": VERSION, "time": now().isoformat(), "preflight": state,
            "scan": public_scan, "result": result, "error": error}
    text = render(scan, state, result, error)
    write_owned(directory / "report.txt", text.encode())
    write_owned(directory / "report.json", encode(data))
    write_owned(env.base / "reports/latest.txt", text.encode())
    write_owned(env.base / "reports/latest.json", encode({**data, "report_directory": str(directory)}))
    return directory


def wait_for_claude_stopped(timeout=60, platform_name=None):
    """Wait for graceful Desktop/Code shutdown without killing anything."""
    def current_processes():
        return process_state() if platform_name is None else process_state(platform_name)

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        writers, automatic = current_processes()
        if not writers and not automatic:
            return
        time.sleep(0.5)
    writers, automatic = current_processes()
    detail = "；".join([
        "仍有 %d 个 Claude/Code 相关进程" % len(writers) if writers else "",
        "仍有自动同步进程" if automatic else "",
    ]).strip("；")
    raise RuntimeError("Claude 没有在 %d 秒内完全退出，已停止同步；没有强制结束进程。%s" %
                       (timeout, (" " + detail) if detail else ""))


def close_claude_and_wait(env):
    """Gracefully quit Claude when needed, then return a fresh safe preflight."""
    state = preflight(env)
    writers = state.get("writers", [])
    if writers:
        request_claude_quit(env)
        wait_for_claude_stopped(platform_name=env.platform_name)
    fresh = preflight(env)
    if fresh.get("blockers"):
        raise RuntimeError("关闭后仍不满足同步条件：" + "；".join(fresh["blockers"]))
    return fresh


def main(argv=None):
    parser = argparse.ArgumentParser(description="检查、预览和手动补齐两个账号的本地 Claude Desktop Code 会话。默认先检查，再由你选择。")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="只检查并保存逐条报告，不写 Claude 数据")
    mode.add_argument("--sync", action="store_true", help="通过检查后同步并验证；不等待输入，不启动 Claude")
    mode.add_argument("--close-sync", action="store_true", help="请求 Claude 正常退出，等待结束后同步；不强制结束进程")
    parser.add_argument("--title-resolutions", help="标题冲突选择 JSON 文件，仅用于 --sync 或 --close-sync")
    args = parser.parse_args(argv)
    os.umask(0o077)
    env = Environment(runtime_base())
    lock = exclusive_lock(env.base / ".sync.lock")
    try:
        lock.__enter__()
    except BlockingIOError:
        print("已有另一个同步窗口运行。本次未检查或写入 Claude 数据。")
        return 2
    try:
        scan, state, result, error, directory = None, None, None, None, None
        try:
            state = preflight(env)
            resolutions = load_title_resolutions(args.title_resolutions)
            if args.close_sync:
                print("正在请求 Claude 正常退出；不会强制结束进程…", flush=True)
                state = close_claude_and_wait(env)
                print("Claude 已完全退出，正在检查账号索引和本地正文…", flush=True)
                scan = build_plan(env, resolutions)
                print(render(scan, state), end="", flush=True)
                directory = save_report(env, scan, state)
                result = apply_plan(env, scan)
                print("\n" + render_result(scan, result), end="", flush=True)
                return_code = 0
            else:
                print("正在检查账号索引和本地正文…", flush=True)
                scan = build_plan(env, resolutions)
                print(render(scan, state), end="", flush=True)
                directory = save_report(env, scan, state)
                if state["blockers"]:
                    return_code = 2
                elif args.check:
                    return_code = 0
                else:
                    proceed = args.sync
                    if not proceed and sys.stdin.isatty():
                        proceed = input("\n按上述计划同步？输入 y 并回车；直接回车只检查：").strip().lower() == "y"
                    if proceed:
                        require_stopped(env)
                        time.sleep(1)  # Two stopped observations plus unchanged snapshot.
                        result = apply_plan(env, scan)
                        print("\n" + render_result(scan, result), end="", flush=True)
                    return_code = 0
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as exc:
            error = str(exc)
            result = getattr(exc, "result", result)
            if state:
                try:
                    state = preflight(env)
                except (OSError, ValueError, subprocess.SubprocessError):
                    pass
            state = state or {"blockers": ["系统检查未完成"], "warnings": [], "writers": [],
                              "app_version": "未知", "last_account_hint": None, "automatic_disabled": False}
            print("\n" + render(scan, state, result, error), end="", flush=True)
            return_code = 1
        directory = save_report(env, scan, state, result, error, directory)
        print("\n本次完整报告：" + str(directory / "report.txt"))
        print("最新报告：" + str(env.base / "reports/latest.txt"))
        return return_code
    finally:
        lock.__exit__(None, None, None)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (KeyboardInterrupt, EOFError):
        print("\n操作取消。若在写入阶段中断，请检查本目录 backups 中最新 manifest，并重跑命令。")
        sys.exit(130)
