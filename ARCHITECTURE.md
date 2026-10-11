# ClaudeSync 维护地图

ClaudeSync 是一个本地、手动、可检查的会话索引工具。它不登录云端，不读取密码或 Cookie，也不复制聊天正文。用户先检查，再在标题冲突处选择，最后才允许写入。

## 公开入口

| 入口 | 适用平台 | 作用 |
| --- | --- | --- |
| `ClaudeSync.app` | macOS（发布安装包） | 自带运行时的 GUI，不需要另装 Python |
| `Sync.app` | macOS（本地构建） | 原生 AppKit 窗口；保留当前 Mac 使用体验 |
| `Sync.command` | macOS | 优先打开发布 GUI；源码目录则打开 `Sync.app`；带参数时运行 CLI |
| `Sync.bat` | Windows | 打开共享 Tk GUI |
| `Sync.sh` | Linux | 打开共享 Tk GUI |
| `python sync_gui.py` | 三个平台 | 共享 GUI；首次启动提供目录设置 |
| `python sync_sessions.py --check` | 三个平台 | 只读检查与报告 |
| `python sync_sessions.py --sync` | 三个平台 | 关闭应用后，按检查计划同步 |
| `python sync_sessions.py --close-sync` | 三个平台 | 请求应用正常退出后同步；不强制杀进程 |

`sync_sessions.py` 是兼容入口；真正的实现位于 `claude_sync/`。

## 文件职责

| 文件 | 唯一职责 |
| --- | --- |
| `claude_sync/core.py` | 配置校验、只读扫描、计划、原子应用、验证、报告和 CLI |
| `claude_sync/titles.py` | 标题来源判断、旧标记清理、标题冲突策略 |
| `claude_sync/platforms.py` | macOS/Windows/Linux 路径、进程检测、锁外的正常退出和重开 |
| `claude_sync/storage.py` | 普通文件读取、快照、原子文件、跨平台排他锁 |
| `sync_gui.py` | 跨平台 GUI；优先使用 Tk，没有 Tk 时切换到本机浏览器 |
| `sync_gui_tk.py` / `sync_web.py` | 三个平台 | 首次设置、同页标题选择、报告和语言切换 |
| `claude_sync/configuration.py` | 三个平台 | 共享首次设置校验和原子保存 |
| `SyncGUI.swift` | 可选的 macOS 原生 GUI；不复制同步规则 |
| `Sync.command` / `Sync.bat` / `Sync.sh` | 各平台薄启动器 |
| `test_sessions.py` | 临时目录中的会话安全、标题和报告测试 |
| `test_platforms.py` | Windows 进程适配、路径注入、锁行为测试 |
| `test_configuration.py` | 首次设置路径与原子配置测试 |
| `config.example.json` | 不含个人数据的设置样例；真实 `config.json` 永不提交 |

本地 `config.json`、`reports/`、`backups/`、`sync-state.json` 和 `Sync.app/` 被 `.gitignore` 排除。它们是机器状态或构建物，不是公共源码。

## 单向依赖

```text
GUI / launcher
      ↓
    core.py  ─────────────→  titles.py
      ↓                         ↓
 platforms.py  ←──────────  storage.py
      ↓
Claude 本地索引和 projects 正文（只在 apply_plan 写入索引）
```

平台模块不读取账号数据；存储模块不知道 Claude 规则；标题模块不执行文件写入。这样修改一个平台不会把同步判断复制到多个入口。

打包入口位于 `packaging/`：PyInstaller 生成 GUI/CLI，Windows 使用 Inno Setup，Linux 生成 `.deb` 和 `.tar.gz`，macOS 生成按架构区分的 `.dmg` 和 `.zip`。发布只由 GitHub Actions 读取 tag 触发，源码目录不会把本机配置打进安装包。

## 一次同步的流程

```text
1. preflight        看 Claude/Code 是否仍在写入，检查旧自动同步
2. build_plan       读取两个 scope、索引、归档/删除标记和正文首尾抽样
3. human choice     GUI 将每个冲突会话显示一行，A / B / 跳过
4. apply_plan       再次检查 → 逐字节备份 → 原子新增/标题更新 → 再读验证
5. save_report      保存中文文字报告和 JSON 报告
```

核心只新增缺失入口；不覆盖已有入口，不拼接或复制 JSONL。标题更新以检查时的目标字节为前置条件；文件变化就停止。任何异常都留下 manifest 和备份路径。

## 标题规则

- 相同标题：不处理。
- 手动标题对自动标题：安全地把手动标题复制到自动标题一侧。
- 两边都是手动且不同：状态为 `conflict`，等用户选择。
- 两边都是自动且不同：状态为 `auto_difference`，不猜测。
- 旧版本的“来自账号 X 的分支”标题：识别为工具标记，更新回原始标题。
- 新分支入口：复制原始标题，不添加工具标记。

GUI 的临时选择文件格式为：

```json
{"version": 1, "choices": {"scope/session.json": "source|target|skip"}}
```

它只是一次操作的输入，不是账号数据，也不应提交。

## 平台边界

默认路径由 `platforms.py` 计算，也可在 `config.json` 中用 `session_root` 和 `projects_root` 明确指定。Claude Code 官方文档说明正文默认位于 `~/.claude/projects`，并可由 `CLAUDE_CONFIG_DIR` 改变；因此不把一台机器的绝对路径写进源码。Desktop 的安装目录和退出方式由平台适配器负责。

Linux 支持本地数据和 CLI/Desktop 进程检查；如果发行版没有 Desktop 启动器，关闭后重开需要用户手动打开。工具不会声称能恢复云端 Artifact、评论监控、连接器或登录状态。

## 后续修改从哪里开始

- 标题策略：`claude_sync/titles.py` + `test_sessions.py`。
- 文件安全：`claude_sync/storage.py` 与 `apply_plan()`。
- Windows/Linux 行为：`claude_sync/platforms.py` + `test_platforms.py`。
- GUI 排版/选择：`sync_gui.py` 或 `SyncGUI.swift`；不要把同步规则复制进去。
- 命令或路径：同步更新启动器、README、样例配置和 CI。

验证顺序：

```sh
python -m unittest -v test_sessions test_platforms test_configuration
python -m compileall -q claudesync.py sync_gui.py sync_gui_tk.py sync_web.py sync_sessions.py claude_sync
```

macOS 原生窗口另需运行 `./build-macos-app.sh`。真实数据只做 `--check`，除非用户确认并且 Claude 已完全退出。

## 已知盲点

正文只做首尾抽样，不全文解析 JSONL；应用界面、云端权限和账号登录状态仍需用户打开 Claude 后确认。Claude 的内部索引格式可能随版本变化，遇到未知结构应停止写入并先更新适配器与测试。
