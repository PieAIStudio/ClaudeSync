"""Atomic local file operations, snapshots, and cross-platform mutual exclusion."""
from contextlib import contextmanager
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import tempfile

MAX_INDEX = 10 * 1024 * 1024


def encode(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def clean(value):
    return re.sub(r"[\x00-\x1f\x7f-\x9f]", " ", str(value))


def plain_directory(path):
    if not path.is_dir() or path.resolve() != path.absolute():
        raise ValueError("目录不存在或包含符号链接：" + str(path))


def read_regular(path, limit=MAX_INDEX):
    if not stat.S_ISREG(path.lstat().st_mode):
        raise ValueError("不是普通文件，停止写入：" + str(path))
    with path.open("rb") as stream:
        raw = stream.read(limit + 1)
    if len(raw) > limit:
        raise ValueError("索引文件过大，停止写入：" + str(path))
    return raw


def publish_new(path, raw):
    """Link a flushed temp file; never overwrite an existing destination."""
    fd, name = tempfile.mkstemp(prefix=".session-sync-", dir=str(path.parent))
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.link(name, path)
    finally:
        os.unlink(name)


def replace_existing(path, raw, expected=None):
    current = read_regular(path)
    if expected is not None and current != expected:
        raise RuntimeError("目标会话在检查后发生变化，停止标题更新：" + str(path))
    write_owned(path, raw)


def write_owned(path, raw):
    """Atomic replacement; call on Claude files only through replace_existing."""
    fd, name = tempfile.mkstemp(prefix=".claudesync-", dir=str(path.parent))
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


@contextmanager
def exclusive_lock(path):
    """Use one nonblocking lock per data directory on Windows and POSIX."""
    with path.open("a+b") as lock:
        if os.name == "nt":
            import msvcrt
            lock.seek(0, os.SEEK_END)
            if lock.tell() == 0:
                lock.write(b"\0")
                lock.flush()
            lock.seek(0)
            try:
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError as exc:
                raise BlockingIOError("another ClaudeSync operation is running") from exc
            try:
                yield
            finally:
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            try:
                yield
            finally:
                fcntl.flock(lock, fcntl.LOCK_UN)


@dataclass
class Snapshot:
    files: dict
    directories: dict

    def with_added(self, path, raw):
        files = {**self.files, path: raw}
        directories = dict(self.directories)
        parent, name = str(PurePosixPath(path).parent), PurePosixPath(path).name
        directories[parent] = tuple(sorted((*directories[parent], name)))
        return Snapshot(files, directories)

    def with_replaced(self, path, raw):
        if path not in self.files:
            raise KeyError(path)
        return Snapshot({**self.files, path: raw}, dict(self.directories))
