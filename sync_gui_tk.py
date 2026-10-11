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

from claude_sync.configuration import MAX_ACCOUNTS, build_config_for_accounts, discover_config, save_config
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
        self.title_groups = []
        self.choices = {}
        self.account_rows = []
        self.process = None
        self.vars = {}
        if setup:
            self.show_setup()
        elif not (BASE / "config.json").exists() and not self.try_auto_configure():
            self.show_setup()
        else:
            self.show_main()
            self.after(120, self.check)

    def try_auto_configure(self):
        """Use visible local scopes as the default; setup is the fallback."""
        try:
            env = Environment(BASE)
            data = discover_config(env.root, env.projects)
            save_config(BASE, data)
            return True
        except (OSError, ValueError):
            return False

    def t(self, key):
        return tr(self.language, key)

    def display_account_label(self, label, index):
        value = str(label or "")
        if any(value.startswith(prefix) and value[len(prefix):].isdigit()
               for prefix in ("账号 ", "Account ", "アカウント ", "Cuenta ", "Conta ")):
            return self.t("account_prefix") + " " + str(index + 1)
        return value

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
        ttk.Label(outer, text=self.t("setup_hint"), style="Muted.TLabel", wraplength=850).pack(anchor="w", pady=(8, 22))
        card = ttk.LabelFrame(outer, text="1 · 选择本机目录", style="Card.TLabelframe")
        card.pack(fill="x", anchor="n")
        self.vars = {name: tk.StringVar() for name in ("session_root", "projects_root")}
        existing = {}
        try:
            existing = json.loads((BASE / "config.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
        session_root = existing.get("session_root", "") if isinstance(existing, dict) else ""
        self.vars["session_root"].set(session_root)
        self.vars["projects_root"].set(existing.get("projects_root", "") if isinstance(existing, dict) else "")
        fields = [
            (self.t("session_root"), "session_root", self.t("session_root_help")),
            (self.t("projects_root"), "projects_root", self.t("projects_root_help")),
        ]
        for row, (label, key, help_text) in enumerate(fields):
            ttk.Label(card, text=label, width=16).grid(row=row, column=0, sticky="w", pady=7)
            ttk.Entry(card, textvariable=self.vars[key], width=76).grid(row=row, column=1, sticky="ew", padx=8, pady=7)
            ttk.Button(card, text=self.t("choose"), command=lambda k=key: self.choose(k)).grid(row=row, column=2, pady=7)
            ttk.Label(card, text=help_text, style="Muted.TLabel").grid(row=row, column=3, sticky="w", padx=(12, 0), pady=7)
        card.columnconfigure(1, weight=1)
        ttk.Separator(outer).pack(fill="x", pady=20)
        accounts_box = ttk.LabelFrame(outer, text=self.t("accounts_section"), style="Card.TLabelframe")
        accounts_box.pack(fill="x", anchor="n")
        self.account_rows = []
        loaded_accounts = existing.get("accounts", []) if isinstance(existing, dict) else []
        for account in loaded_accounts if isinstance(loaded_accounts, list) else []:
            if isinstance(account, dict):
                root = Path(session_root).expanduser() if session_root else Path()
                self.account_rows.append({
                    "label": tk.StringVar(value=self.display_account_label(account.get("label", ""), len(self.account_rows))),
                    "path": tk.StringVar(value=str(root / account["scope"]) if account.get("scope") else ""),
                })
        while len(self.account_rows) < 2:
            index = len(self.account_rows)
            self.account_rows.append({"label": tk.StringVar(value=self.t("account_prefix") + " " + str(index + 1)), "path": tk.StringVar()})
        self.accounts_box = accounts_box
        self.render_account_rows()
        ttk.Button(outer, text=self.t("add_account"), command=self.add_account_row).pack(anchor="w", pady=(8, 0))
        ttk.Label(outer, text=self.t("setup_saved_hint"), style="Muted.TLabel", wraplength=850).pack(anchor="w", pady=(22, 10))
        buttons = ttk.Frame(outer)
        buttons.pack(anchor="w")
        ttk.Button(buttons, text=self.t("save_setup"), style="Accent.TButton", command=self.save_setup).pack(side="left")
        ttk.Button(buttons, text=self.t("exit"), command=self.destroy).pack(side="left", padx=10)

    def render_account_rows(self):
        for child in self.accounts_box.winfo_children():
            child.destroy()
        for row, values in enumerate(self.account_rows):
            ttk.Label(self.accounts_box, text=self.t("account_prefix") + " %d" % (row + 1), width=9).grid(row=row, column=0, sticky="w", pady=6)
            ttk.Entry(self.accounts_box, textvariable=values["label"], width=18).grid(row=row, column=1, sticky="w", padx=(0, 8), pady=6)
            ttk.Entry(self.accounts_box, textvariable=values["path"], width=72).grid(row=row, column=2, sticky="ew", pady=6)
            ttk.Button(self.accounts_box, text=self.t("choose"), command=lambda item=values: self.choose_account(item)).grid(row=row, column=3, padx=8, pady=6)
        self.accounts_box.columnconfigure(2, weight=1)

    def add_account_row(self):
        if len(self.account_rows) >= MAX_ACCOUNTS:
            messagebox.showinfo("账号数量", "账号目录过多；请缩小索引根目录范围后再添加。")
            return
        index = len(self.account_rows)
        self.account_rows.append({"label": tk.StringVar(value=self.t("account_prefix") + " " + str(index + 1)), "path": tk.StringVar()})
        self.render_account_rows()

    def remove_account_row(self, index):
        if len(self.account_rows) <= 2:
            return
        self.account_rows.pop(index)
        self.render_account_rows()

    def choose_account(self, values):
        chosen = filedialog.askdirectory(title=self.t("choose_account"))
        if chosen:
            values["path"].set(chosen)

    def choose(self, key):
        chosen = filedialog.askdirectory(title="选择 " + key)
        if chosen:
            self.vars[key].set(chosen)

    def save_setup(self):
        try:
            data = build_config_for_accounts(
                self.vars["session_root"].get(),
                [{"path": values["path"].get(), "label": values["label"].get()}
                 for values in self.account_rows],
                self.vars["projects_root"].get())
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
        ttk.Button(top, text=self.t("settings"), command=self.show_setup).pack(side="right")

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
        for key, label in zip(("add", "title", "conflict", "skip"), self.t("metrics")):
            card = ttk.LabelFrame(metrics, text=label, style="Card.TLabelframe")
            card.pack(side="left", fill="x", expand=True, padx=(0, 8))
            var = tk.StringVar(value="—")
            self.metric_vars[key] = var
            ttk.Label(card, textvariable=var, style="Metric.TLabel").pack(anchor="w")
        ttk.Label(outer, text=self.t("read_order"), style="Muted.TLabel").pack(anchor="w", pady=(0, 8))

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
        self.detail_var.set(self.t("checking_detail"))
        self.run_cli(["--check"], False)

    def confirm_sync(self, close_first):
        if not self.actions:
            messagebox.showinfo("没有检查结果", "请先点击“重新检查”。")
            return
        choices = self.make_resolutions()
        summary = self.t("sync_summary") % tuple(self.metric_vars[k].get() for k in ("add", "title", "conflict"))
        if close_first:
            summary = self.t("close_summary") + "\n\n" + summary
        if messagebox.askyesno(self.t("confirm_sync_title"), summary + "\n\n" + self.t("cloud_boundary")):
            self.set_busy(True)
            args = ["--close-sync" if close_first else "--sync"]
            if choices:
                args += ["--title-resolutions", choices]
            self.status_var.set("正在关闭 Claude…" if close_first else self.t("syncing"))
            self.detail_var.set(self.t("syncing_detail"))
            self.run_cli(args, close_first, choices)
        elif choices:
            try:
                Path(choices).unlink()
            except OSError:
                pass

    def make_resolutions(self):
        conflicts = [group for group in self.title_groups if group.get("status") == "conflict"]
        if not conflicts:
            return None
        groups = {group.get("cliSessionId", "unknown"): self.choices.get(group.get("cliSessionId", "unknown"), "skip")
                  for group in conflicts}
        fd, name = tempfile.mkstemp(prefix="claudesync-title-resolutions-", suffix=".json")
        with os.fdopen(fd, "wb") as stream:
            stream.write(encode({"version": 2, "groups": groups, "choices": {}}))
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
            self.status_var.set(self.t("report_failed"))
            self.detail_var.set(str(exc))
            return
        self.set_report(text)
        scan = data.get("scan") or {}
        preflight = data.get("preflight") or {}
        counts = scan.get("counts") or {}
        actions = scan.get("title_actions") or []
        self.actions = actions
        self.title_groups = scan.get("title_groups") or []
        additions = sum(int(v.get("will_add", 0)) for v in counts.values())
        titles = sum(int(v.get("will_update_titles", 0)) for v in counts.values())
        conflicts = len([group for group in self.title_groups if group.get("status") == "conflict"])
        entries = scan.get("entries") or []
        skipped = sum(e.get("status") not in {"add", "branch", "present", "planned"} for e in entries)
        for key, value in (("add", additions), ("title", titles), ("conflict", conflicts), ("skip", skipped)):
            self.metric_vars[key].set(str(value))
        self.account_var.set(self.t("account") + " / ".join(
            self.display_account_label(label, index) for index, label in enumerate(sorted(counts))) if counts else "")
        self.render_title_rows(actions)
        blockers = preflight.get("blockers") or []
        if verified and data.get("result", {}).get("verified"):
            self.status_var.set(self.t("sync_complete"))
            self.detail_var.set(self.t("sync_complete_detail"))
        elif blockers:
            self.status_var.set(self.t("need_close"))
            self.detail_var.set(self.t("close_detail"))
        elif additions or titles:
            self.status_var.set(self.t("can_sync"))
            self.detail_var.set(self.t("conflict_hint"))
        else:
            self.status_var.set(self.t("no_work"))
            self.detail_var.set(self.t("no_work_detail"))
        self.set_busy(False)
        self.close_button.configure(state="normal" if blockers else "disabled")
        self.sync_button.configure(state="normal" if not blockers and (additions or titles) else "disabled")

    def render_title_rows(self, actions):
        for child in self.rows_frame.winfo_children():
            child.destroy()
        groups = list(self.title_groups)
        if not groups and actions:
            fallback = {}
            for action in actions:
                key = action.get("cliSessionId", "unknown")
                row = fallback.setdefault(key, {
                    "cliSessionId": key,
                    "status": action.get("status", ""),
                    "options": [],
                })
                for label, title, scope in (
                    (action.get("source", ""), action.get("source_title", ""), action.get("source_scope", "")),
                    (action.get("target", ""), action.get("target_title", ""), action.get("target_scope", "")),
                ):
                    if label and not any(item.get("scope") == scope for item in row["options"]):
                        row["options"].append({"label": label, "scope": scope, "title": title})
            groups = list(fallback.values())
        headings = self.t("table_headings")
        widths = [14, 16, 70, 24, 40]
        for column, (heading, width) in enumerate(zip(headings, widths)):
            ttk.Label(self.rows_frame, text=heading, font=("TkDefaultFont", 10, "bold"),
                      width=width).grid(row=0, column=column, sticky="w", padx=5, pady=(4, 7))
        visible_row = 1
        status_labels = self.t("title_status")
        action_labels = self.t("title_action")
        for group in groups:
            status = group.get("status", "")
            session = group.get("cliSessionId", "")
            row = visible_row
            visible_row += 1
            options = group.get("options") or []
            titles = "；".join("%s：%s" % (self.display_account_label(item.get("label", ""), index), item.get("title", ""))
                              for index, item in enumerate(options))
            values = [status_labels.get(status, status), str(session)[:12] + "…",
                      titles, action_labels.get(status, status)]
            for column, value in enumerate(values):
                ttk.Label(self.rows_frame, text=value, width=widths[column]).grid(
                    row=row, column=column, sticky="w", padx=5, pady=3)
            if status == "conflict":
                variable = tk.StringVar(value=self.choices.get(session, group.get("choice") or "skip"))
                self.choices[session] = variable.get()
                radio_options = [(item.get("scope", ""), self.display_account_label(item.get("label", ""), index))
                                 for index, item in enumerate(options)]
                radio_options.append(("skip", self.t("skip")))
                for index, (value, label) in enumerate(radio_options):
                    ttk.Radiobutton(
                        self.rows_frame, text=label, value=value, variable=variable,
                        command=lambda s=session, v=variable: self.choices.__setitem__(s, v.get()),
                    ).grid(row=row, column=4, sticky="w", padx=(2 + index * 88, 0))

    def set_busy(self, busy):
        state = "disabled" if busy else "normal"
        self.check_button.configure(state=state)
        if busy:
            self.sync_button.configure(state="disabled")
            self.close_button.configure(state="disabled")

    def open_report(self):
        report = BASE / "reports/latest.txt"
        if not report.exists():
            messagebox.showinfo(self.t("no_report"), self.t("check_first"))
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
        self.status_var.set(self.t("summary_copied"))


def main():
    try:
        app = ClaudeSyncGUI(setup="--setup" in sys.argv)
        app.mainloop()
    except tk.TclError as exc:
        print("无法打开 GUI：%s" % exc, file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
