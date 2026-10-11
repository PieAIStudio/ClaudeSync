#!/usr/bin/env python3
"""Small cross-platform GUI for ClaudeSync.

The Mac native AppKit window remains the default on this machine; this Tk GUI
is the shared Windows/Linux entry and a portable fallback for macOS.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from claude_sync.configuration import build_config, save_config
from claude_sync.platforms import Environment, reopen_claude, runtime_base
from claude_sync.i18n import LANGUAGES, load as load_language, save as save_language, text as tr
from claude_sync.storage import encode

BASE = runtime_base()
PYTHON = sys.executable


class ClaudeSyncGUI(tk.Tk):
    def __init__(self, setup=False):
        super().__init__()
        self.title("ClaudeSync · Claude 会话同步")
        self.geometry("1180x780")
        self.minsize(900, 620)
        self.configure(bg="#f5f7fb")
        self.configure_styles()
        self.language = load_language(BASE)
        self.actions = []
        self.choices = {}
        self.process = None
        self.vars = {}
        if setup or not (BASE / "config.json").exists():
            self.show_setup()
        else:
            self.show_main()
            self.after(120, self.check)

    def t(self, key):
        return tr(self.language, key)

    def change_language(self, _event=None):
        selected = self.language_var.get()
        self.language = save_language(BASE, next((code for code, label in LANGUAGES.items() if label == selected), selected))
        if hasattr(self, "show_main") and (BASE / "config.json").exists():
            self.show_main()
            self.load_report()
        else:
            self.show_setup()

    def configure_styles(self):
        style = ttk.Style(self)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.configure("Title.TLabel", font=("TkDefaultFont", 20, "bold"), foreground="#172033")
        style.configure("Muted.TLabel", foreground="#5e6b82")
        style.configure("Card.TLabelframe", padding=12)
        style.configure("Metric.TLabel", font=("TkDefaultFont", 18, "bold"), foreground="#172033")
        style.configure("Danger.TLabel", foreground="#b42318")
        style.configure("Good.TLabel", foreground="#087443")
        style.configure("Accent.TButton", padding=(14, 8))

    def clear(self):
        for child in self.winfo_children():
            child.destroy()

    def show_setup(self):
        self.clear()
        outer = ttk.Frame(self, padding=28)
        outer.pack(fill="both", expand=True)
        language_bar = ttk.Frame(outer)
        language_bar.pack(fill="x", anchor="e")
        ttk.Label(language_bar, text=self.t("language")).pack(side="right", padx=(8, 4))
        self.language_var = tk.StringVar(value=LANGUAGES[self.language])
        language_menu = ttk.Combobox(language_bar, textvariable=self.language_var, values=list(LANGUAGES.values()), state="readonly", width=14)
        language_menu.pack(side="right")
        language_menu.bind("<<ComboboxSelected>>", self.change_language)
        ttk.Label(outer, text=self.t("setup"), style="Title.TLabel").pack(anchor="w")
        ttk.Label(outer, text="告诉工具两个账号的本地索引目录。工具只读取这些目录和 ~/.claude/projects，不会读取密码、Cookie 或云端。", style="Muted.TLabel", wraplength=850).pack(anchor="w", pady=(8, 22))
        card = ttk.LabelFrame(outer, text="1 · 选择本机目录", style="Card.TLabelframe")
        card.pack(fill="x", anchor="n")
        self.vars = {name: tk.StringVar() for name in ("session_root", "account_a", "account_b", "projects_root", "label_a", "label_b")}
        self.vars["label_a"].set("账号 A")
        self.vars["label_b"].set("账号 B")
        fields = [
            ("会话索引根目录", "session_root", "选择包含两个账号目录的 claude-code-sessions 文件夹"),
            ("账号 A 目录", "account_a", "选择根目录下的 组织 UUID/账号 UUID 文件夹"),
            ("账号 B 目录", "account_b", "选择另一个账号的同级文件夹"),
            ("正文目录", "projects_root", "默认使用 ~/.claude/projects；如你改过 CLAUDE_CONFIG_DIR，再选择对应 projects 文件夹"),
        ]
        for row, (label, key, help_text) in enumerate(fields):
            ttk.Label(card, text=label, width=16).grid(row=row, column=0, sticky="w", pady=7)
            ttk.Entry(card, textvariable=self.vars[key], width=76).grid(row=row, column=1, sticky="ew", padx=8, pady=7)
            ttk.Button(card, text=self.t("choose"), command=lambda k=key: self.choose(k)).grid(row=row, column=2, pady=7)
            ttk.Label(card, text=help_text, style="Muted.TLabel").grid(row=row, column=3, sticky="w", padx=(12, 0), pady=7)
        card.columnconfigure(1, weight=1)
        ttk.Separator(outer).pack(fill="x", pady=20)
        names = ttk.LabelFrame(outer, text="2 · 给两个账号起容易认的名字", style="Card.TLabelframe")
        names.pack(fill="x", anchor="n")
        ttk.Label(names, text="账号 A").grid(row=0, column=0, sticky="w", pady=7)
        ttk.Entry(names, textvariable=self.vars["label_a"], width=28).grid(row=0, column=1, sticky="w", padx=8)
        ttk.Label(names, text="账号 B").grid(row=1, column=0, sticky="w", pady=7)
        ttk.Entry(names, textvariable=self.vars["label_b"], width=28).grid(row=1, column=1, sticky="w", padx=8)
        ttk.Label(outer, text="保存后工具会先做只读检查。没有点击“同步安全项”或“关闭 Claude 并同步”，不会改会话文件。", style="Muted.TLabel", wraplength=850).pack(anchor="w", pady=(22, 10))
        buttons = ttk.Frame(outer)
        buttons.pack(anchor="w")
        ttk.Button(buttons, text=self.t("save_setup"), style="Accent.TButton", command=self.save_setup).pack(side="left")
        ttk.Button(buttons, text=self.t("exit"), command=self.destroy).pack(side="left", padx=10)

    def choose(self, key):
        chosen = filedialog.askdirectory(title="选择 " + key)
        if chosen:
            self.vars[key].set(chosen)

    def save_setup(self):
        try:
            data = build_config(
                self.vars["session_root"].get(), self.vars["account_a"].get(),
                self.vars["account_b"].get(), self.vars["projects_root"].get(),
                self.vars["label_a"].get(), self.vars["label_b"].get())
            save_config(BASE, data)
        except (OSError, ValueError) as exc:
            messagebox.showerror("设置未保存", str(exc))
            return
        self.show_main()
        self.check()

    def show_main(self):
        self.clear()
        outer = ttk.Frame(self, padding=22)
        outer.pack(fill="both", expand=True)
        top = ttk.Frame(outer)
        top.pack(fill="x")
        self.language_var = tk.StringVar(value=LANGUAGES[self.language])
        language_menu = ttk.Combobox(top, textvariable=self.language_var, values=list(LANGUAGES.values()), state="readonly", width=14)
        language_menu.pack(side="right")
        language_menu.bind("<<ComboboxSelected>>", self.change_language)
        ttk.Label(top, text=self.t("language")).pack(side="right", padx=(8, 4))
        ttk.Label(top, text=self.t("app"), style="Title.TLabel").pack(side="left")
        ttk.Label(top, text=self.t("subtitle"), style="Muted.TLabel").pack(side="left", padx=16, pady=7)
        ttk.Button(top, text="修改目录设置", command=self.show_setup).pack(side="right")

        status = ttk.LabelFrame(outer, text=self.t("status"), style="Card.TLabelframe")
        status.pack(fill="x", pady=(16, 10))
        self.status_var = tk.StringVar(value="正在检查…")
        self.detail_var = tk.StringVar(value="")
        self.account_var = tk.StringVar(value="")
        self.status_label = ttk.Label(status, textvariable=self.status_var, font=("TkDefaultFont", 14, "bold"))
        self.status_label.pack(anchor="w")
        ttk.Label(status, textvariable=self.detail_var, style="Muted.TLabel").pack(anchor="w", pady=(4, 0))
        ttk.Label(status, textvariable=self.account_var, style="Muted.TLabel").pack(anchor="w", pady=(4, 0))

        metrics = ttk.Frame(outer)
        metrics.pack(fill="x", pady=(0, 10))
        self.metric_vars = {}
        for key, label in (("add", "可新增会话"), ("title", "可更新标题"), ("conflict", "标题需选择"), ("skip", "本次跳过")):
            card = ttk.LabelFrame(metrics, text=label, style="Card.TLabelframe")
            card.pack(side="left", fill="x", expand=True, padx=(0, 8))
            var = tk.StringVar(value="—")
            self.metric_vars[key] = var
            ttk.Label(card, textvariable=var, style="Metric.TLabel").pack(anchor="w")
        ttk.Label(outer, text="阅读顺序：先看状态，再看标题明细。标题冲突直接在表格右侧选择；只有两个同步按钮会写入本地索引。", style="Muted.TLabel").pack(anchor="w", pady=(0, 8))

        title_box = ttk.LabelFrame(outer, text=self.t("title_detail"), style="Card.TLabelframe")
        title_box.pack(fill="both", expand=True, pady=(0, 10))
        self.title_canvas = tk.Canvas(title_box, background="#ffffff", highlightthickness=0)
        self.title_scroll = ttk.Scrollbar(title_box, orient="vertical", command=self.title_canvas.yview)
        self.title_canvas.configure(yscrollcommand=self.title_scroll.set)
        self.title_canvas.pack(side="left", fill="both", expand=True)
        self.title_scroll.pack(side="right", fill="y")
        self.rows_frame = ttk.Frame(self.title_canvas)
        self.canvas_window = self.title_canvas.create_window((0, 0), window=self.rows_frame, anchor="nw")
        self.rows_frame.bind("<Configure>", lambda _e: self.title_canvas.configure(scrollregion=self.title_canvas.bbox("all")))
        self.title_canvas.bind("<Configure>", lambda e: self.title_canvas.itemconfigure(self.canvas_window, width=e.width))

        report_box = ttk.LabelFrame(outer, text=self.t("report"), style="Card.TLabelframe")
        report_box.pack(fill="both", expand=True)
        self.report_text = tk.Text(report_box, height=8, wrap="word", state="disabled", font=("TkDefaultFont", 10), relief="flat")
        self.report_text.pack(fill="both", expand=True, padx=8, pady=8)
        buttons = ttk.Frame(outer)
        buttons.pack(fill="x", pady=(10, 0))
        self.check_button = ttk.Button(buttons, text=self.t("check"), command=self.check)
        self.sync_button = ttk.Button(buttons, text=self.t("sync"), command=lambda: self.confirm_sync(False), state="disabled")
        self.close_button = ttk.Button(buttons, text=self.t("close_sync"), command=lambda: self.confirm_sync(True), state="disabled")
        for button in (self.check_button, self.sync_button, self.close_button):
            button.pack(side="left", padx=(0, 8))
        ttk.Button(buttons, text=self.t("open_report"), command=self.open_report).pack(side="left", padx=(8, 8))
        ttk.Button(buttons, text=self.t("copy"), command=self.copy_report).pack(side="left")

    def set_report(self, text):
        self.report_text.configure(state="normal")
        self.report_text.delete("1.0", "end")
        self.report_text.insert("1.0", text)
        self.report_text.configure(state="disabled")

    def check(self):
        if self.process:
            return
        self.set_busy(True)
        self.status_var.set(self.t("checking"))
        self.detail_var.set("正在读取索引和正文；不会写入 Claude 数据。")
        self.run_cli(["--check"], False)

    def confirm_sync(self, close_first):
        if not self.actions:
            messagebox.showinfo("没有检查结果", "请先点击“重新检查”。")
            return
        choices = self.make_resolutions()
        summary = "本次会新增 %s 个入口，更新 %s 个安全标题，保留 %s 个标题冲突。" % tuple(self.metric_vars[k].get() for k in ("add", "title", "conflict"))
        if close_first:
            summary = "先请求 Claude 正常退出，等待它完全结束，再执行同步；完成后尝试重新打开。\n\n" + summary
        if messagebox.askyesno("确认操作", summary + "\n\n不会复制聊天正文，不会登录或切换账号。"):
            self.set_busy(True)
            args = ["--close-sync" if close_first else "--sync"]
            if choices:
                args += ["--title-resolutions", choices]
            self.status_var.set("正在关闭 Claude…" if close_first else "正在同步…")
            self.detail_var.set("正在做最后一次文件检查；请不要打开 Claude。")
            self.run_cli(args, close_first, choices)
        elif choices:
            try:
                Path(choices).unlink()
            except OSError:
                pass

    def make_resolutions(self):
        conflicts = [a for a in self.actions if a.get("status") == "conflict"]
        if not conflicts:
            return None
        grouped = {}
        for action in conflicts:
            grouped.setdefault(action.get("cliSessionId", "unknown"), []).append(action)
        choices = {}
        for session, actions in grouped.items():
            selected = self.choices.get(session, "skip")
            first = actions[0]
            source = first.get("source", "")
            target = first.get("target", "")
            chosen = "source" if selected == source else "target" if selected == target else "skip"
            for action in actions:
                path = action.get("target_path")
                if not path:
                    continue
                if chosen == "skip":
                    choices[path] = "skip"
                elif chosen == "source" and action.get("source") == selected:
                    choices[path] = "source"
                elif chosen == "target" and action.get("target") == selected:
                    choices[path] = "target"
        fd, name = tempfile.mkstemp(prefix="claudesync-title-resolutions-", suffix=".json")
        with os.fdopen(fd, "wb") as stream:
            stream.write(encode({"version": 1, "choices": choices}))
        return name

    def run_cli(self, args, close_first, resolution=None):
        command = ([sys.executable] if getattr(sys, "frozen", False)
                   else [PYTHON, str(BASE / "sync_sessions.py")]) + args
        try:
            # The report files are the UI's source of truth. Do not pipe the
            # verbose report through a child-process pipe that could fill up.
            self.process = subprocess.Popen(command, cwd=str(BASE), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except OSError as exc:
            self.process = None
            self.set_busy(False)
            messagebox.showerror("无法运行同步核心", str(exc))
            return
        self.after(150, lambda: self.poll_process(close_first, resolution))

    def poll_process(self, close_first, resolution):
        if not self.process:
            return
        if self.process.poll() is None:
            self.after(150, lambda: self.poll_process(close_first, resolution))
            return
        code = self.process.returncode
        self.process = None
        if resolution:
            try:
                Path(resolution).unlink()
            except OSError:
                pass
        self.load_report(code == 0)
        if close_first:
            try:
                reopen_claude(Environment(BASE))
            except Exception:
                pass

    def load_report(self, verified=False):
        try:
            data = json.loads((BASE / "reports/latest.json").read_text(encoding="utf-8"))
            text = (BASE / "reports/latest.txt").read_text(encoding="utf-8")
        except (OSError, ValueError) as exc:
            self.set_busy(False)
            self.status_var.set("检查未完成")
            self.detail_var.set(str(exc))
            return
        self.set_report(text)
        scan = data.get("scan") or {}
        preflight = data.get("preflight") or {}
        counts = scan.get("counts") or {}
        actions = scan.get("title_actions") or []
        self.actions = actions
        additions = sum(int(v.get("will_add", 0)) for v in counts.values())
        titles = sum(int(v.get("will_update_titles", 0)) for v in counts.values())
        conflicts = len({a.get("cliSessionId") for a in actions if a.get("status") == "conflict"})
        entries = scan.get("entries") or []
        skipped = sum(e.get("status") not in {"add", "branch", "present", "planned"} for e in entries)
        for key, value in (("add", additions), ("title", titles), ("conflict", conflicts), ("skip", skipped)):
            self.metric_vars[key].set(str(value))
        self.account_var.set("已检查账号：" + " / ".join(sorted(counts)) if counts else "")
        self.render_title_rows(actions)
        blockers = preflight.get("blockers") or []
        if verified and data.get("result", {}).get("verified"):
            self.status_var.set("同步完成")
            self.detail_var.set("本地索引已完成文件校验；请手动打开 Claude 检查列表。")
        elif blockers:
            self.status_var.set(self.t("need_close"))
            self.detail_var.set(self.t("read_only") + " " + self.t("close_sync"))
        elif additions or titles:
            self.status_var.set(self.t("can_sync"))
            self.detail_var.set(self.t("conflict_hint"))
        else:
            self.status_var.set(self.t("no_work"))
            self.detail_var.set("可继续查看报告中的跳过项和云端资源说明。")
        self.set_busy(False)
        self.close_button.configure(state="normal" if blockers else "disabled")
        self.sync_button.configure(state="normal" if not blockers and (additions or titles) else "disabled")

    def render_title_rows(self, actions):
        for child in self.rows_frame.winfo_children():
            child.destroy()
        headings = ["状态", "会话", "来源标题", "目标标题", "处理", "选择"]
        widths = [14, 16, 28, 28, 22, 30]
        for column, (heading, width) in enumerate(zip(headings, widths)):
            ttk.Label(self.rows_frame, text=heading, font=("TkDefaultFont", 10, "bold"), width=width).grid(row=0, column=column, sticky="w", padx=5, pady=(4, 7))
        seen_conflicts = set()
        visible_row = 1
        for action in actions:
            status = action.get("status", "")
            session = action.get("cliSessionId", "")
            if status == "conflict" and session in seen_conflicts:
                continue
            if status == "conflict":
                seen_conflicts.add(session)
            row = visible_row
            visible_row += 1
            labels = {"same": "标题一致", "safe": "可安全同步", "normalize": "可统一标题", "conflict": "需要选择", "auto_difference": "不猜测", "keep_target": "保留目标"}
            action_text = {"same": "无变化", "safe": "将更新目标", "normalize": "去掉旧标记", "conflict": "两边都手动改过", "auto_difference": "两个都是自动标题", "keep_target": "保留目标标题"}
            values = [labels.get(status, status), str(session)[:12] + "…", action.get("source_title", ""), action.get("target_title", ""), action_text.get(status, status)]
            for column, value in enumerate(values):
                ttk.Label(self.rows_frame, text=value, width=widths[column]).grid(row=row, column=column, sticky="w", padx=5, pady=3)
            if status == "conflict":
                variable = tk.StringVar(value=self.choices.get(session, "skip"))
                self.choices[session] = variable.get()
                for index, label in enumerate((action.get("source", "账号 A"), action.get("target", "账号 B"), "跳过")):
                    ttk.Radiobutton(self.rows_frame, text=label, value=label, variable=variable,
                                    command=lambda s=session, v=variable: self.choices.__setitem__(s, v.get())).grid(row=row, column=5, sticky="w", padx=(2 + index * 85, 0))

    def set_busy(self, busy):
        state = "disabled" if busy else "normal"
        self.check_button.configure(state=state)
        if busy:
            self.sync_button.configure(state="disabled")
            self.close_button.configure(state="disabled")

    def open_report(self):
        report = BASE / "reports/latest.txt"
        if not report.exists():
            messagebox.showinfo("还没有报告", "请先检查。")
            return
        if os.name == "nt":
            os.startfile(report)  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(report)])
        else:
            subprocess.Popen([shutil.which("xdg-open") or "cat", str(report)])

    def copy_report(self):
        self.clipboard_clear()
        self.clipboard_append(self.report_text.get("1.0", "end"))
        self.status_var.set("摘要已复制")


def main():
    try:
        app = ClaudeSyncGUI(setup="--setup" in sys.argv)
        app.mainloop()
    except tk.TclError as exc:
        print("无法打开 GUI：%s" % exc, file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
