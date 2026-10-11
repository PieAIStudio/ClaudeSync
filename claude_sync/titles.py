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


def title_candidate(data, label, scope, path, tool_state=None):
    """Return the display and provenance facts used by a multi-account group."""
    raw_title = data.get("title") or "未命名会话"
    legacy = legacy_branch_title(data, tool_state)
    return {
        "label": label,
        "scope": scope,
        "path": path,
        "data": data,
        "title": legacy or raw_title,
        "origin": title_origin(data, tool_state),
        "legacy": legacy is not None,
    }


def _selected_scope(cli_session_id, candidates, resolutions):
    """Resolve a group choice, including the old per-path v1 format."""
    resolutions = resolutions or {}
    groups = resolutions.get("groups", {}) if isinstance(resolutions, dict) else {}
    paths = resolutions.get("paths", {}) if isinstance(resolutions, dict) else {}
    selected = groups.get(cli_session_id)
    if selected in (None, "skip"):
        selected = None if selected != "skip" else "skip"
    if selected not in (None, "skip"):
        for candidate in candidates:
            if selected in (candidate["scope"], candidate["label"]):
                return candidate["scope"]
        return None
    if selected == "skip":
        return "skip"
    inferred = set()
    if paths:
        for candidate in candidates:
            choice = paths.get(candidate["path"])
            if choice == "target":
                inferred.add(candidate["scope"])
            elif choice == "source":
                others = [other for other in candidates if other["scope"] != candidate["scope"]]
                if len(others) == 1:
                    inferred.add(others[0]["scope"])
        if len(inferred) == 1:
            return next(iter(inferred))
    return None


def make_title_group(cli_session_id, candidates, tool_state=None, resolutions=None):
    """Build one title decision group and its per-account update actions.

    A group is the unit shown in the GUI. It lets a user choose any account's
    hand-written title once, then applies that decision to every other account
    that needs the same title. The returned actions remain per target path so
    backup, atomic replacement, and verification stay unchanged.
    """
    candidates = sorted(candidates, key=lambda item: item["scope"])
    effective_titles = {candidate["title"] for candidate in candidates}
    manual_titles = {candidate["title"] for candidate in candidates if candidate["origin"] == "manual"}
    if len(effective_titles) <= 1:
        chosen_scope = next((candidate["scope"] for candidate in candidates if not candidate["legacy"]), candidates[0]["scope"])
        group_status = "normalize" if any(candidate["legacy"] for candidate in candidates) else "same"
    elif len(manual_titles) == 1:
        chosen_scope = next(candidate["scope"] for candidate in candidates if candidate["title"] in manual_titles)
        group_status = "safe"
    elif len(manual_titles) > 1:
        chosen_scope = _selected_scope(cli_session_id, candidates, resolutions)
        group_status = "conflict"
    else:
        chosen_scope = None
        group_status = "auto_difference"
    if group_status == "conflict" and chosen_scope == "skip":
        chosen_scope = None
    chosen = next((candidate for candidate in candidates if candidate["scope"] == chosen_scope), None)
    actions = []
    for candidate in candidates:
        if group_status == "same" and not candidate["legacy"]:
            continue
        default_source = next((other for other in candidates if other["scope"] != candidate["scope"]), candidates[0])
        source = chosen or default_source
        target_title = candidate["title"]
        source_title = source["title"]
        action = {
            "source": source["label"],
            "target": candidate["label"],
            "source_scope": source["scope"],
            "target_scope": candidate["scope"],
            "source_path": source["path"],
            "target_path": candidate["path"],
            "source_title": source_title,
            "target_title": target_title,
            "source_title_source": source["data"].get("titleSource") or "auto",
            "target_title_source": candidate["data"].get("titleSource") or "auto",
            "source_origin": source["origin"],
            "target_origin": candidate["origin"],
            "cliSessionId": cli_session_id,
            "notes": [],
        }
        if group_status == "normalize":
            if not candidate["legacy"] and target_title == source_title:
                continue
            action["status"] = "normalize"
            action["notes"].append("去掉旧的同步分支标记，标题恢复为统一文本")
            normalized = dict(source["data"])
            normalized["title"] = source_title
            normalized["titleSource"] = "user"
            action["raw"] = title_update_record(candidate["data"], normalized)
        elif group_status == "safe":
            if target_title == source_title and not candidate["legacy"]:
                action["status"] = "same"
            else:
                action["status"] = "safe"
                action["notes"].append("唯一手动标题优先于自动标题；只更新需要统一的账号")
                action["raw"] = title_update_record(candidate["data"], source["data"])
        elif group_status == "auto_difference":
            action["status"] = "auto_difference"
            action["notes"].append("两边都是自动标题；多个账号时同样不根据活动时间猜测")
        elif group_status == "conflict":
            if chosen is None:
                action["status"] = "conflict"
                action["notes"].append("多个账号都有不同的手动标题，等待选择")
            elif candidate["scope"] == chosen["scope"] and target_title == source_title and not candidate["legacy"]:
                action["status"] = "selected_target"
                action["notes"].append("已选择此账号标题；此账号不需要改写")
            else:
                action["status"] = "selected_source"
                action["notes"].append("已选择此账号标题，更新其他需要统一的账号")
                action["raw"] = title_update_record(candidate["data"], source["data"])
        actions.append(action)
    options = [{key: candidate[key] for key in ("label", "scope", "title", "origin", "legacy")}
               for candidate in candidates]
    return {
        "cliSessionId": cli_session_id,
        "status": "conflict" if group_status == "conflict" and chosen is None else group_status,
        "choice": chosen_scope,
        "selected_title": chosen["title"] if chosen else None,
        "options": options,
        "actions": actions,
    }


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
