# ClaudeSync（中文）

**先看清楚，再做选择；确认安全后才同步。**

[English](README.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Português](README.pt-BR.md)

ClaudeSync 帮你整理同一台电脑上两个 Claude 账号的 **本地 Claude Code 会话列表**。它只做一件事：告诉你能补什么、为什么跳过；标题冲突直接在表格里选；Claude 完全停止后才写入。

![ClaudeSync 界面预览](docs/images/claudesync-preview.svg)

> **它不是云端迁移工具。** 不登录、不读取密码、不上传对话，也不搬运 Artifact。它只整理指向本地 JSONL 正文的本地会话索引。

## 亮点

- 没有后台自动同步、退出钩子、定时任务或登录切号。
- 一个页面看状态、数量、跳过原因和标题选择。
- 两边都手动改过标题时，每个会话一行，可选账号 A、账号 B 或跳过。
- Claude 运行时拒绝写入；写入前备份索引，写入后再次校验。
- Mac 继续用原生窗口；Windows/Linux 使用共享的 Python/Tk 窗口。
- 同步核心只用 Python 标准库。

## 安装包

打开 [GitHub Releases](https://github.com/PieAIStudio/ClaudeSync/releases/latest) 下载对应文件：

| 平台 | 安装包 |
| --- | --- |
| macOS Apple 芯片 | `ClaudeSync-macos-arm64.dmg` 或 `.zip` |
| macOS Intel | `ClaudeSync-macos-x64.dmg` 或 `.zip` |
| Windows 10/11 64 位 | `ClaudeSync-windows-x64-setup.exe` |
| Debian/Ubuntu 64 位 | `ClaudeSync-linux-amd64.deb` |
| 其他 Linux 64 位 | `ClaudeSync-linux-amd64.tar.gz` |

安装版带有简体中文、English、日本語、Español、Português 五种界面语言。Linux 没有 Tk 时会自动打开本机浏览器界面；Mac 安装包自带 Python，不需要另外安装 Python。源码方式仍可按下面步骤运行。

## 三分钟开始

```sh
git clone https://github.com/PieAIStudio/ClaudeSync.git
cd ClaudeSync
```

源码运行需要 Python 3.9+。打开方式：

| 系统 | 打开 |
| --- | --- |
| macOS | 安装版打开 `ClaudeSync.app`；源码目录双击 `Sync.command` |
| Windows | 双击 `Sync.bat` |
| Linux | 运行 `./Sync.sh` |
| 任意系统 | 运行 `python sync_gui.py` |

第一次打开时选择：包含两个账号目录的根目录、账号 A/B 目录、保存 JSONL 正文的 `projects` 目录。设置保存为本地 `config.json`，不会进入 Git。

然后按这个顺序：

1. 点“重新检查”（只读）。
2. 看顶部状态和报告。
3. 红色“需要选择”行直接选账号 A、账号 B 或跳过，不会再弹第二个冲突窗口。
4. 结束 Claude 当前工作后，点“同步安全项”；也可以点“关闭 Claude 并同步”让工具请求正常退出。
5. 重新打开 Claude，手动检查 Code 列表。登录和切换账号仍由你完成。

最后的确认框只确认真正的写入/关闭动作，不负责选择标题。

## 标题规则

相同标题不处理；手动标题对自动标题时安全复制；两边不同的手动标题等待你的选择；两个自动标题不同则不猜测。旧版工具加的“来自账号 X 的分支”会被清掉，新分支入口直接使用原始标题。

## 同步范围

可能新增缺失的本地索引、分支入口，或按安全规则更新标题。不会改 JSONL 正文、已有入口、删除/归档标记、定时任务、项目路径、Artifact、评论监控、连接器、远程会话、密码、Cookie 或登录状态。

## 命令

```sh
python sync_sessions.py --check       # 只读检查
python sync_sessions.py --sync        # Claude 已完全关闭后同步
python sync_sessions.py --close-sync  # 请求正常退出后同步
```

退出码 0 表示命令完成；是否真的写入请看报告。退出码 1 表示结构/文件/校验错误，2 表示 Claude 仍在运行、旧自动同步存在或已有另一个 ClaudeSync，130 表示取消。

## 隐私、备份与开发

工具离线运行，不调用云端登录 API。`config.json`、`reports/`、`backups/`、`sync-state.json` 和 Mac 构建目录已加入忽略；报告可能含项目路径、标题和账号标识，不要公开上传。写入前会备份索引并生成 manifest，中断后可重跑且不会覆盖已有文件。

维护边界见 [ARCHITECTURE.md](ARCHITECTURE.md)，测试方法见 [CONTRIBUTING.md](CONTRIBUTING.md)，许可证见 [LICENSE](LICENSE)。

```sh
python -m unittest -v test_sessions test_platforms
python -m compileall -q sync_gui.py sync_sessions.py claude_sync
./build-macos-app.sh       # 可选：构建 Mac 原生窗口
```
