"""Shared first-run configuration validation and atomic persistence."""
from __future__ import annotations

import os
from pathlib import Path
import re
import tempfile

from .storage import encode

UUID = re.compile(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\Z")


def build_config(session_root, account_a, account_b, projects_root, label_a, label_b):
    """Validate setup form values and return the stable config dictionary."""
    root = Path(session_root).expanduser().resolve()
    first = Path(account_a).expanduser().resolve()
    second = Path(account_b).expanduser().resolve()
    projects = Path(projects_root).expanduser().resolve()
    if not root.is_dir() or not first.is_dir() or not second.is_dir():
        raise ValueError("会话根目录、账号 A 和账号 B 都必须是已经存在的文件夹。")
    try:
        first_parts = first.relative_to(root).parts
        second_parts = second.relative_to(root).parts
    except ValueError as exc:
        raise ValueError("两个账号目录必须位于所选会话根目录里面。") from exc
    if (len(first_parts) != 2 or len(second_parts) != 2
            or not all(UUID.fullmatch(part) for part in first_parts + second_parts)
            or first_parts[0].lower() == second_parts[0].lower()):
        raise ValueError("账号目录必须是根目录下的两层 UUID 目录，并且属于不同组织。")
    if not projects.is_dir():
        raise ValueError("正文目录不存在；请先选择正确的 projects 文件夹。")
    first_label = str(label_a or "账号 A").strip() or "账号 A"
    second_label = str(label_b or "账号 B").strip() or "账号 B"
    if first_label == second_label:
        raise ValueError("两个账号名称需要不同。")
    return {
        "version": 1,
        "session_root": str(root),
        "projects_root": str(projects),
        "accounts": [
            {"label": first_label, "scope": "/".join(first_parts)},
            {"label": second_label, "scope": "/".join(second_parts)},
        ],
    }


def save_config(base, data):
    """Write config.json atomically and return its path."""
    target_base = Path(base)
    target_base.mkdir(parents=True, exist_ok=True)
    target = target_base / "config.json"
    fd, name = tempfile.mkstemp(prefix=".config-", dir=str(target_base))
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(encode(data))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, target)
    finally:
        if os.path.exists(name):
            os.unlink(name)
    if os.name != "nt":
        target.chmod(0o600)
    return target
