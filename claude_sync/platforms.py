"""OS paths and process control. No session data is changed here."""
from dataclasses import dataclass, field
import json
import os
from pathlib import Path
import plistlib
import re
import signal
import subprocess
import sys

LABEL = "local.claude-session-sync.on-exit"


def desktop_directory(home=None, platform_name=None):
    home = home or Path.home()
    platform_name = platform_name or sys.platform
    if platform_name == "darwin":
        return home / "Library/Application Support/Claude"
    if platform_name == "win32":
        return Path(os.environ.get("APPDATA", str(home / "AppData/Roaming"))) / "Claude"
    return Path(os.environ.get("XDG_CONFIG_HOME", str(home / ".config"))) / "Claude"


def default_data_directory():
    if sys.platform == "darwin":
        return Path.home() / "Library/Application Support/ClaudeSync"
    if sys.platform == "win32":
        return Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData/Local"))) / "ClaudeSync"
    return Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local/share"))) / "ClaudeSync"




def runtime_base():
    """Writable runtime directory for source mode and frozen installers."""
    if getattr(sys, "frozen", False):
        return default_data_directory()
    return Path(__file__).resolve().parent.parent

def application_path(home=None, platform_name=None):
    home = home or Path.home()
    platform_name = platform_name or sys.platform
    if platform_name == "darwin":
        for path in (Path("/Applications/Claude.app"), home / "Applications/Claude.app"):
            if path.exists():
                return path
        return Path("/Applications/Claude.app")
    if platform_name == "win32":
        root = Path(os.environ.get("LOCALAPPDATA", str(home / "AppData/Local")))
        for path in (root / "AnthropicClaude/claude.exe", root / "Programs/Claude/Claude.exe"):
            if path.exists():
                return path
        return root / "AnthropicClaude/claude.exe"
    return Path("/usr/bin/claude-desktop")


@dataclass
class Environment:
    base: Path
    home: Path = field(default_factory=Path.home)
    app: Path = field(default_factory=application_path)
    platform_name: str = field(default_factory=lambda: sys.platform)
    session_root: Path = None
    projects_root: Path = None

    @property
    def desktop(self):
        return desktop_directory(self.home, self.platform_name)

    @property
    def root(self):
        if self.session_root:
            return Path(self.session_root).expanduser()
        override = os.environ.get("CLAUDESYNC_SESSION_ROOT")
        if override:
            return Path(override).expanduser()
        candidates = (
            self.desktop / "claude-code-sessions",
            self.desktop / "claude-code" / "sessions",
            self.desktop / "sessions",
        )
        return next((path for path in candidates if path.exists()), candidates[0])

    @property
    def projects(self):
        if self.projects_root:
            return Path(self.projects_root).expanduser()
        config_dir = os.environ.get("CLAUDE_CONFIG_DIR")
        if config_dir:
            return Path(config_dir).expanduser() / "projects"
        return self.home / ".claude/projects"


def process_state(platform_name=None):
    """Fail closed if an OS process listing cannot be obtained.

    Windows uses CIM rather than localized tasklist columns. POSIX uses both
    executable names and arguments, so renamed bundled CLI binaries still block.
    """
    platform_name = platform_name or sys.platform
    if platform_name == "win32":
        script = "Get-CimInstance Win32_Process | Select-Object ProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress"
        result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
                                check=True, capture_output=True, text=True, timeout=20,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        rows = json.loads(result.stdout or "[]")
        if isinstance(rows, dict):
            rows = [rows]
        processes = [(int(row["ProcessId"]), row.get("ExecutablePath") or row.get("Name") or "",
                      row.get("CommandLine") or "") for row in rows]
    else:
        result = subprocess.run(["/bin/ps", "-axo", "pid=,comm="], check=True,
                                capture_output=True, text=True, timeout=20)
        args = subprocess.run(["/bin/ps", "-axo", "pid=,args="], check=True,
                              capture_output=True, text=True, timeout=20)
        arguments = {}
        for line in args.stdout.splitlines():
            parts = line.strip().split(None, 1)
            if len(parts) == 2 and parts[0].isdigit():
                arguments[int(parts[0])] = parts[1]
        processes = []
        for line in result.stdout.splitlines():
            parts = line.strip().split(None, 1)
            if len(parts) == 2 and parts[0].isdigit():
                pid = int(parts[0])
                processes.append((pid, parts[1], arguments.get(pid, "")))
    writers, automatic = [], []
    for pid, command, argument in processes:
        normalized = re.sub(r"/+", "/", command.replace("\\", "/").lower())
        basename = normalized.rsplit("/", 1)[-1]
        args_lower = re.sub(r"/+", "/", argument.replace("\\", "/").lower())
        if normalized.endswith("/contents/helpers/chrome-native-host"):
            continue
        desktop = ("/claude.app/" in normalized or basename in ("claude", "claude.exe", "claude-desktop")
                   or basename.startswith("claude helper") or "/anthropicclaude/" in normalized)
        cli = ("/claude/claude-code/" in normalized or "/.local/share/claude/versions/" in normalized
               or (basename.startswith(("node", "bun")) and "/@anthropic-ai/claude-code/" in args_lower))
        if desktop or cli:
            writers.append({"pid": pid, "name": basename, "desktop": desktop and not cli})
        if basename.startswith("python") and any(marker in args_lower
                                                 for marker in ("/claude-session-sync/watch_exit.py",
                                                                "/claude-session-sync/auto_sync.py",
                                                                "/claudesync/watch_exit.py",
                                                                "/claudesync/auto_sync.py")):
            automatic.append(pid)
    return writers, automatic


def automatic_sync_state(env):
    """Retain the old Mac LaunchAgent gate; other OSes have no such agent."""
    if env.platform_name != "darwin":
        return [], True
    blockers = []
    installed = env.home / "Library/LaunchAgents" / (LABEL + ".plist")
    if installed.exists() or installed.is_symlink():
        blockers.append("旧自动同步自启配置仍存在：" + str(installed))
    service = "gui/%d/%s" % (os.getuid(), LABEL)
    result = subprocess.run(["/bin/launchctl", "print", service], capture_output=True, text=True, timeout=20)
    if result.returncode == 0:
        blockers.append("旧自动同步 LaunchAgent 仍加载。")
    elif "Could not find service" not in result.stderr:
        blockers.append("无法确认自动同步已卸载：" + result.stderr.strip())
    return blockers, not blockers


def app_version(env):
    if env.platform_name == "darwin":
        try:
            return plistlib.loads((env.app / "Contents/Info.plist").read_bytes())["CFBundleShortVersionString"]
        except (OSError, ValueError, KeyError):
            pass
    # Schema validation is authoritative; do not infer compatibility from a version.
    return "unknown"


def request_claude_quit(env=None):
    """Request normal Desktop shutdown. Never force-kill Desktop or CLI."""
    platform_name = env.platform_name if env else sys.platform
    if platform_name == "darwin":
        script = 'tell application id "com.anthropic.claudefordesktop" to quit'
        result = subprocess.run(["/usr/bin/osascript", "-e", script],
                                capture_output=True, text=True, check=False, timeout=20)
    elif platform_name == "win32":
        script = "Get-Process -Name Claude -ErrorAction SilentlyContinue | ForEach-Object { [void]$_.CloseMainWindow() }"
        result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
                                capture_output=True, text=True, check=False, timeout=20,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    else:
        writers, _ = process_state(platform_name)
        for process in writers:
            if process.get("desktop"):
                os.kill(process["pid"], signal.SIGTERM)
        return
    if result.returncode != 0:
        raise RuntimeError("无法请求 Claude 正常退出：" + (result.stderr or result.stdout or "unknown error").strip())


def reopen_claude(env):
    """Open Desktop only after an explicit GUI close-and-sync action."""
    if env.platform_name == "darwin":
        subprocess.Popen(["open", "-a", str(env.app)])
    elif env.platform_name == "win32":
        if not env.app.is_file():
            raise RuntimeError("未找到 Claude，请手动重新打开。")
        subprocess.Popen([str(env.app)])
    else:
        import shutil
        executable = shutil.which("claude-desktop")
        if not executable:
            raise RuntimeError("未找到 Claude Desktop 启动入口，请手动重新打开。")
        subprocess.Popen([executable], start_new_session=True)
