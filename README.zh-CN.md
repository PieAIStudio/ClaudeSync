# ClaudeSync（中文）

**先看清楚，再做选择；确认安全后才同步。**

[English](README.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Português](README.pt-BR.md)

ClaudeSync 用来整理同一台电脑上 **两个或更多 Claude 账号** 的本地 Claude Code 会话列表。它会自动发现本机账号目录，先显示计划，再让你在同一页面选择标题，Claude 完全停止后才写入。**角色：**目前免费分享、自用优先；**技术：**Python 桌面 GUI/命令行，并带本地浏览器回退界面；**状态：**v1.3.2 已公开发布。

![ClaudeSync 界面预览](docs/images/claudesync-preview.svg)

> **它是本地索引工具，不是云端迁移工具。** 不登录、不读取密码、不上传对话，也不搬运云端 Artifact。

## 为什么简单

- **先自动发现。** 打开后先扫描本地会话根目录，找到的账号会自动出现在列表里。只有发现不完整时，才打开“账号补救设置”。
- **一个页面看清楚。** 账号、数量、跳过原因和标题选择放在一起。
- **一个冲突只做一次决定。** 可以选任意账号的手动标题，也可以跳过；选择会应用到需要更新的其他账号。
- **没有后台自动化。** 没有退出钩子、监听器、定时器、登录钩子，也不会自动切号。
- **写入前后都检查。** Claude 运行时禁止写入；写入前备份索引，写入后再次校验。
- **各平台共用一套规则。** macOS、Windows、Linux 使用同一个同步核心；Linux 没有 Tk 时自动使用本地浏览器界面。

![四步流程：检查、选择、同步、确认](docs/images/flow.svg)

## 支持情况

| 系统 | 界面 | 本地会话同步 | 关闭并重新打开 Claude |
| --- | --- | --- | --- |
| macOS | 自带 GUI 安装版 | 支持 | 只请求正常退出 |
| Windows | Tk 图形界面 | 支持 | 只请求正常关闭窗口 |
| Linux | Tk 或本地浏览器界面 | 本地布局存在时支持 | 重新打开可能需要手动启动 |

Claude 官方文档说明，本地正文通常位于 `~/.claude/projects`，也可以通过 `CLAUDE_CONFIG_DIR` 改变位置。ClaudeSync 会让你确认目录，不会盲猜。[Claude 会话文档](https://code.claude.com/docs/en/sessions) · [Claude Desktop](https://code.claude.com/docs/en/desktop)

## 下载安装版

打开 [GitHub 最新 Release](https://github.com/PieAIStudio/ClaudeSync/releases/latest)：

| 平台 | 下载文件 |
| --- | --- |
| macOS Apple 芯片 | `ClaudeSync-macos-arm64.dmg` 或 `.zip` |
| macOS Intel | `ClaudeSync-macos-x64.dmg` 或 `.zip` |
| Windows 10/11 64 位 | `ClaudeSync-windows-x64-setup.exe` |
| Debian/Ubuntu 64 位 | `ClaudeSync-linux-amd64.deb` |
| 其他 Linux 64 位 | `ClaudeSync-linux-amd64.tar.gz` |

界面支持简体中文、English、日本語、Español、Português。macOS 安装版自带 Python，不需要另外安装。

## 三步使用

### 1. 打开 ClaudeSync

安装对应平台的安装包并启动。第一次使用时，ClaudeSync 会自动扫描本地会话根目录，发现的账号会自动加入列表。

如果发现不完整，再打开“账号补救设置”添加或删除目录。正常使用不需要逐个填写账号。

### 2. 检查并选择

1. 点“重新检查”，这是只读操作。
2. 看数量和报告。
3. 红色“需要选择”行会列出所有账号标题；选一个账号，或选“跳过”。

### 3. Claude 停止后同步

先结束 Claude 当前工作。点“同步安全项”，或者点“关闭 Claude 并同步”让工具请求正常退出。完成后手动打开 Claude 检查 Code 列表。登录和切号仍由你完成。

## 多账号怎么工作

每个配置账号都是平等的目标。ClaudeSync 会生成安全的本地并集：一个会话可以补到其他账号，但同一个 `cliSessionId` 在同一个目标账号只会新增一次。多个账号已经有这个会话时，会保留已有入口。

任意账号存在删除标记时，该会话不会被重新补回。归档、定时任务、远程、工作目录不存在和正文缺失的记录仍会显示原因，并跳过复制。

## 标题规则

- 标题相同：不处理。
- 一个账号是手动标题、其他是自动标题：提供手动标题作为安全选择。
- 多个账号的手动标题不同：每个会话一行，选择任意账号标题或跳过。
- 多个自动标题不同：不根据活动时间猜测。
- 旧版工具生成的分支标记：恢复原始标题，不再添加新标记。
- 你选中的标题也会用于本次新建的入口。

## 边界、备份与恢复

工具可能新增缺失的本地索引、确定性的分支入口和明确选择的标题更新。不会改 JSONL 正文、已有入口、删除/归档记录、项目路径、Artifact、评论监控、连接器、远程会话、凭证或 Cookie。

写入前会生成私有的时间戳备份和 manifest。操作中断后重新点“重新检查”即可；已有入口会被识别，不会覆盖原文件。`config.json`、`reports/` 和 `backups/` 可能包含本机路径、标题和账号标识，请保持私有。

## 命令行

```sh
python sync_sessions.py --check       # 只读检查
python sync_sessions.py --sync        # Claude 关闭后同步
python sync_sessions.py --close-sync  # 请求正常退出后同步
```

退出码 `0` 表示命令完成，请看报告确认结果；`1` 表示结构、文件或校验错误；`2` 表示 Claude 仍在运行、旧自动同步仍在运行或已有另一个 ClaudeSync；`130` 表示取消。

## 项目结构

- `claude_sync/core.py`：账号发现、多账号计划、安全检查、写入、校验和命令行。
- `claude_sync/configuration.py`：自动发现、补救设置校验和原子保存。
- `claude_sync/titles.py`：标题来源、分组选择和旧标记清理。
- `claude_sync/platforms.py`：各平台路径、进程检查和正常退出。
- `sync_gui_tk.py` / `sync_web.py`：共享图形界面和浏览器回退界面。
- `docs/multi-account-roadmap.md`：维护者路线图和安全边界。
- `ARCHITECTURE.md`：面向维护者的简明地图。

## 开发检查

```sh
python -m unittest -v test_sessions test_platforms test_configuration
python -m compileall -q claudesync.py sync_gui.py sync_gui_tk.py sync_web.py sync_sessions.py claude_sync
```

测试只使用临时目录，不会读取真实 Claude 数据。更多信息见 [CONTRIBUTING.md](CONTRIBUTING.md)、[SECURITY.md](SECURITY.md) 和 [MIT License](LICENSE)。
