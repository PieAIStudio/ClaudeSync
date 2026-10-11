"""Shared first-run configuration validation and atomic persistence."""
from __future__ import annotations

import os
from pathlib import Path
import re
import tempfile

from .storage import encode

UUID = re.compile(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\Z")
MIN_ACCOUNTS = 2
# The normal path is automatic discovery. This is only a guard against an
# accidentally selected parent directory containing thousands of UUID folders.
MAX_ACCOUNTS = 50


def discover_account_specs(session_root):
    """Discover account scopes below ``organization/account`` directories."""
    root = Path(session_root).expanduser().resolve()
    if not root.is_dir():
        return []
    specs = []
    for organization in sorted(root.iterdir(), key=lambda item: item.name.casefold()):
        if not organization.is_dir() or not UUID.fullmatch(organization.name):
            continue
        for account in sorted(organization.iterdir(), key=lambda item: item.name.casefold()):
            if account.is_dir() and UUID.fullmatch(account.name):
                specs.append({"path": account, "label": "账号 %d" % (len(specs) + 1)})
    return specs


def discover_config(session_root, projects_root):
    """Build a config from all visible local accounts without changing them."""
    specs = discover_account_specs(session_root)
    if len(specs) < MIN_ACCOUNTS:
        raise ValueError("自动发现到的账号少于 2 个；请在设置中手动添加账号目录。")
    return build_config_for_accounts(session_root, specs, projects_root)


def build_config_for_accounts(session_root, account_specs, projects_root):
    """Validate a multi-account setup and return the stable config dictionary.

    ``account_specs`` is a sequence of ``{"path": ..., "label": ...}``
    dictionaries. Keeping this validation in one place lets the Tk and browser
    setup screens share the same rules while the old two-account helper stays
    available to scripts that already import it.
    """
    root = Path(session_root).expanduser().resolve()
    projects = Path(projects_root).expanduser().resolve()
    specs = list(account_specs or [])
    if not MIN_ACCOUNTS <= len(specs) <= MAX_ACCOUNTS:
        raise ValueError("至少需要 2 个账号，账号数量过多时请缩小索引根目录范围。")
    if not root.is_dir():
        raise ValueError("会话索引根目录必须是已经存在的文件夹。")
    if not projects.is_dir():
        raise ValueError("正文目录不存在；请先选择正确的 projects 文件夹。")
    parsed = []
    seen_labels = set()
    seen_scopes = set()
    for index, spec in enumerate(specs, start=1):
        if not isinstance(spec, dict):
            raise ValueError("第 %d 个账号设置格式无法识别。" % index)
        directory_value = spec.get("path", spec.get("directory", ""))
        directory = Path(directory_value).expanduser().resolve()
        if not directory.is_dir():
            raise ValueError("第 %d 个账号目录必须是已经存在的文件夹。" % index)
        label = str(spec.get("label") or ("账号 %d" % index)).strip()
        if not label:
            raise ValueError("第 %d 个账号名称不能为空。" % index)
        label_key = label.casefold()
        if label_key in seen_labels:
            raise ValueError("账号名称不能重复：%s。" % label)
        seen_labels.add(label_key)
        try:
            parts = directory.relative_to(root).parts
        except ValueError as exc:
            raise ValueError("第 %d 个账号目录必须位于会话索引根目录里面。" % index) from exc
        if len(parts) != 2 or not all(UUID.fullmatch(part) for part in parts):
            raise ValueError("第 %d 个账号目录必须是根目录下的两层 UUID 目录。" % index)
        scope = "/".join(parts)
        scope_key = scope.casefold()
        if scope_key in seen_scopes:
            raise ValueError("账号目录不能重复：%s。" % directory)
        seen_scopes.add(scope_key)
        parsed.append({"label": label, "scope": scope})
    return {
        "version": 1,
        "session_root": str(root),
        "projects_root": str(projects),
        "accounts": parsed,
    }


def build_config(session_root, account_a, account_b, projects_root, label_a, label_b):
    """Backward-compatible two-account setup helper."""
    return build_config_for_accounts(
        session_root,
        [{"path": account_a, "label": label_a}, {"path": account_b, "label": label_b}],
        projects_root,
    )


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
