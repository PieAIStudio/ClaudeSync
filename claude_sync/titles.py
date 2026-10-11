"""Title provenance, legacy-marker cleanup, and explicit conflict choices."""
from datetime import datetime, timezone
import json
import re
from .storage import encode, read_regular, write_owned

MANUAL_TITLE_SOURCES = frozenset(("user", "tool"))
TOOL_BRANCH_TITLE = re.compile(r"^(.*?)（来自 .+ 的分支）\Z")


def now():
    return datetime.now(timezone.utc).astimezone()


def load_tool_state(env):
    path = env.base / "sync-state.json"
    if not path.exists():
        return {"version": 1, "generated_titles": {}, "last_seen": {}}
    try:
        data = json.loads(read_regular(path))
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        raise ValueError("同步状态文件无法读取，请先备份后处理：%s" % exc)
    if not isinstance(data, dict) or data.get("version") != 1:
        raise ValueError("同步状态文件版本无法识别，请先备份后处理。")
    if not isinstance(data.get("generated_titles", {}), dict) or not isinstance(data.get("last_seen", {}), dict):
        raise ValueError("同步状态文件结构无法识别，请先备份后处理。")
    return data


def save_tool_state(env, scan):
    state = load_tool_state(env)
    generated = dict(state.get("generated_titles", {}))
    last_seen = {}
    for account in scan["config"]["accounts"]:
        scope = account["scope"]
        for data in scan["records"].get(scope, {}).values():
            key = scope + "/" + data["sessionId"]
            last_seen[key] = {
                "title": data.get("title") or "未命名会话",
                "titleSource": data.get("titleSource") or "auto",
                "seenAt": now().isoformat(),
            }
            if TOOL_BRANCH_TITLE.search(str(data.get("title") or "")) and not data.get("previousTitles"):
                generated[data["sessionId"]] = {
                    "title": data.get("title"), "seenAt": now().isoformat(), "reason": "branch-copy"
                }
    state = {"version": 1, "updatedAt": now().isoformat(),
             "generated_titles": generated, "last_seen": last_seen}
    write_owned(env.base / "sync-state.json", encode(state))


def legacy_branch_title(data, tool_state=None):
    title = str(data.get("title") or "").strip()
    generated = (tool_state or {}).get("generated_titles", {}).get(data.get("sessionId"), {})
    if generated.get("title") == title:
        match = TOOL_BRANCH_TITLE.match(title)
        if match:
            return match.group(1)
    match = TOOL_BRANCH_TITLE.fullmatch(title)
    if match and not data.get("previousTitles"):
        return match.group(1)
    return None


def title_origin(data, tool_state=None):
    """Return the title's useful origin without trusting activity timestamps.

    Older versions of this tool marked copied branch titles as user titles in
    Claude's index. Recognize that visible marker as tool-generated so it is
    never allowed to overwrite a real user rename.
    """
    if legacy_branch_title(data, tool_state) is not None:
        return "legacy_generated"
    if data.get("titleSource") in MANUAL_TITLE_SOURCES:
        return "manual"
    return "auto"


def title_update_record(target, source):
    """Change only target title metadata; keep account-specific fields intact."""
    copied = json.loads(encode(target))
    old_title = copied.get("title")
    new_title = source.get("title") or "未命名会话"
    copied["title"] = new_title
    copied["titleSource"] = source.get("titleSource") if source.get("titleSource") in MANUAL_TITLE_SOURCES else "user"
    previous = copied.get("previousTitles")
    if not isinstance(previous, list):
        previous = []
    if old_title and old_title != new_title and old_title not in previous:
        previous.append(old_title)
    copied["previousTitles"] = previous
    completed = copied.get("completedTurns")
    if isinstance(completed, int) and completed >= 0:
        copied["titleTurn"] = completed
    return encode(copied)


def make_title_action(source, target, source_scope, target_scope, source_path, target_path,
                      tool_state=None, resolutions=None):
    source_title = source.get("title") or "未命名会话"
    target_title = target.get("title") or "未命名会话"
    source_legacy = legacy_branch_title(source, tool_state)
    target_legacy = legacy_branch_title(target, tool_state)
    effective_source_title = source_legacy or source_title
    effective_target_title = target_legacy or target_title
    base = {
        "source": source_scope,
        "target": target_scope,
        "source_path": source_path,
        "target_path": target_path,
        "source_title": effective_source_title,
        "target_title": effective_target_title,
        "source_title_source": source.get("titleSource") or "auto",
        "target_title_source": target.get("titleSource") or "auto",
        "source_origin": title_origin(source, tool_state),
        "target_origin": title_origin(target, tool_state),
        "cliSessionId": source.get("cliSessionId"),
        "notes": [],
    }
    if target_legacy is not None:
        if effective_source_title == effective_target_title:
            base["status"] = "normalize"
            base["notes"].append("去掉旧的同步分支标记，标题恢复为统一文本")
            base["raw"] = title_update_record(target, {
                "title": effective_target_title,
                "titleSource": "user",
            })
            base["before_raw"] = None
            return base
        base["status"] = "normalize"
        base["notes"].append("去掉旧的同步分支标记，不用它覆盖另一边标题")
        base["raw"] = title_update_record(target, {
            "title": effective_target_title,
            "titleSource": "user",
        })
        base["before_raw"] = None
        return base
    if effective_source_title == effective_target_title:
        choice = (resolutions or {}).get(target_path)
        if choice == "source":
            base["status"] = "selected_source"
            base["notes"].append("已选择来源标题")
            base["raw"] = title_update_record(target, source)
            base["before_raw"] = None
        elif choice == "target":
            base["status"] = "selected_target"
            base["notes"].append("已选择保留目标标题")
        else:
            base["status"] = "same"
        return base
    if source_title == target_title:
        base["status"] = "same"
    elif base["source_origin"] == "manual" and base["target_origin"] != "manual":
        base["status"] = "safe"
        base["notes"].append("来源是手动标题，目标是自动标题；只更新目标标题")
    elif base["source_origin"] != "manual" and base["target_origin"] == "manual":
        base["status"] = "keep_target"
        base["notes"].append("目标已经是手动标题，不用自动标题覆盖")
    elif base["source_origin"] == "manual" and base["target_origin"] == "manual":
        base["status"] = "conflict"
        base["notes"].append("两边都像是人工改过，程序不猜测哪一个更重要")
    else:
        base["status"] = "auto_difference"
        base["notes"].append("两边都是自动标题，程序不根据活动时间猜测")
    choice = (resolutions or {}).get(target_path)
    if base["status"] == "conflict" and choice in ("source", "target", "skip"):
        if choice == "source":
            base["status"] = "selected_source"
            base["notes"] = ["已选择来源标题"]
            base["raw"] = title_update_record(target, source)
            base["before_raw"] = None
        elif choice == "target":
            base["status"] = "selected_target"
            base["notes"] = ["已选择保留目标标题"]
        else:
            base["notes"] = ["已选择跳过此冲突"]
    if base["status"] in ("safe", "selected_source"):
        base["raw"] = title_update_record(target, source)
        base["before_raw"] = None
    return base
