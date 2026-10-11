import Cocoa

private let ink = NSColor.labelColor
private let muted = NSColor.secondaryLabelColor
private let blue = NSColor.systemBlue
private let green = NSColor.systemGreen
private let amber = NSColor.systemOrange
private let red = NSColor.systemRed

private struct TitleRow {
    let status: String
    let session: String
    let source: String
    let target: String
    let action: String
    let kind: String
    let choiceKey: String?
    let choiceLabels: [String]?
}

private final class ResolutionControl: NSSegmentedControl {
    var resolutionKey = ""
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSTableViewDataSource, NSTableViewDelegate {
    private var window: NSWindow!
    private var statusLabel = NSTextField(labelWithString: "正在检查…")
    private var detailLabel = NSTextField(labelWithString: "")
    private var accountLabel = NSTextField(labelWithString: "")
    private var reportView = NSTextView()
    private var table = NSTableView()
    private var titleRows: [TitleRow] = []
    private var titleActions: [[String: Any]] = []
    private var resolutionChoices: [String: Int] = [:]
    private var metrics: [String: NSTextField] = [:]
    private var checkButton = NSButton(title: "重新检查", target: nil, action: nil)
    private var syncButton = NSButton(title: "同步安全项", target: nil, action: nil)
    private var closeSyncButton = NSButton(title: "关闭 Claude 并同步", target: nil, action: nil)
    private var reportButton = NSButton(title: "打开最新报告", target: nil, action: nil)
    private var copyButton = NSButton(title: "复制摘要", target: nil, action: nil)
    private var language = UserDefaults.standard.string(forKey: "ClaudeSyncLanguage") ?? "zh-CN"
    private var toolDirectory: URL {
        Bundle.main.bundleURL.deletingLastPathComponent()
    }
    private var reportURL: URL { toolDirectory.appendingPathComponent("reports/latest.txt") }
    private var jsonURL: URL { toolDirectory.appendingPathComponent("reports/latest.json") }

    private func localized(_ key: String) -> String {
        let table: [String: [String: String]] = [
            "zh-CN": ["app": "Claude 会话同步", "subtitle": "手动执行 · 不会自动退出 Claude，也不会自动切换账号", "status": "当前状态", "metrics": "这次会处理什么", "guide": "阅读顺序：先看当前状态，再看标题明细；只有“同步安全项”按钮会写入本地索引。标题冲突会保留，不会强行覆盖。", "titles": "标题明细", "report": "检查报告", "language": "界面语言"],
            "en": ["app": "Claude Session Sync", "subtitle": "Manual · inspectable · no automatic account switching", "status": "Current status", "metrics": "What this run will do", "guide": "Read the status first, then title details. Only the sync button writes local indexes.", "titles": "Title details", "report": "Check report", "language": "Language"],
            "ja": ["app": "Claude セッション同期", "subtitle": "手動実行 · 自動ログアウトや切替はしません", "status": "現在の状態", "metrics": "今回の処理", "guide": "状態を確認してからタイトル詳細を見てください。同期ボタンだけが書き込みます。", "titles": "タイトル詳細", "report": "チェックレポート", "language": "表示言語"],
            "es": ["app": "Claude Session Sync", "subtitle": "Manual · visible · sin cambio automático de cuenta", "status": "Estado actual", "metrics": "Qué hará esta ejecución", "guide": "Lee el estado y después los títulos. Solo el botón de sincronización escribe índices.", "titles": "Detalles de títulos", "report": "Informe de comprobación", "language": "Idioma"],
            "pt-BR": ["app": "Claude Session Sync", "subtitle": "Manual · visível · sem troca automática de conta", "status": "Estado atual", "metrics": "O que esta execução fará", "guide": "Leia o estado e depois os títulos. Somente o botão de sincronização escreve índices.", "titles": "Detalhes dos títulos", "report": "Relatório de verificação", "language": "Idioma"]
        ]
        return table[language]?[key] ?? table["zh-CN"]![key]!
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildWindow()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        check(nil)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    private func buildWindow() {
        let rect = NSRect(x: 0, y: 0, width: 1100, height: 820)
        window = NSWindow(contentRect: rect, styleMask: [.titled, .closable, .miniaturizable, .resizable],
                         backing: .buffered, defer: false)
        window.title = localized("app")
        window.minSize = NSSize(width: 900, height: 680)
        window.isReleasedWhenClosed = false

        let root = NSView()
        root.wantsLayer = true
        root.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
        window.contentView = root

        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.drawsBackground = false
        scroll.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(scroll)
        let content = NSView()
        content.translatesAutoresizingMaskIntoConstraints = false
        scroll.documentView = content
        NSLayoutConstraint.activate([
            scroll.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            scroll.topAnchor.constraint(equalTo: root.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            content.leadingAnchor.constraint(equalTo: scroll.contentView.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: scroll.contentView.trailingAnchor),
            content.topAnchor.constraint(equalTo: scroll.contentView.topAnchor),
            content.bottomAnchor.constraint(equalTo: scroll.contentView.bottomAnchor),
            content.widthAnchor.constraint(equalTo: scroll.contentView.widthAnchor)
        ])

        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 12
        stack.edgeInsets = NSEdgeInsets(top: 24, left: 26, bottom: 22, right: 26)
        stack.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            stack.topAnchor.constraint(equalTo: content.topAnchor),
            stack.bottomAnchor.constraint(equalTo: content.bottomAnchor)
        ])

        let title = NSTextField(labelWithString: localized("app"))
        title.font = NSFont.systemFont(ofSize: 25, weight: .bold)
        title.textColor = ink
        let subtitle = NSTextField(labelWithString: localized("subtitle"))
        subtitle.font = NSFont.systemFont(ofSize: 13)
        subtitle.textColor = muted
        let languageBar = NSStackView()
        languageBar.orientation = .horizontal
        languageBar.spacing = 8
        languageBar.addArrangedSubview(title)
        languageBar.addArrangedSubview(subtitle)
        let spacer = NSView()
        languageBar.addArrangedSubview(spacer)
        let languageLabel = NSTextField(labelWithString: localized("language"))
        languageLabel.textColor = muted
        languageBar.addArrangedSubview(languageLabel)
        let languageMenu = NSPopUpButton()
        languageMenu.addItems(withTitles: ["简体中文", "English", "日本語", "Español", "Português"])
        let languageCodes = ["zh-CN", "en", "ja", "es", "pt-BR"]
        languageMenu.selectItem(at: languageCodes.firstIndex(of: language) ?? 0)
        languageMenu.target = self
        languageMenu.action = #selector(languageChanged(_:))
        languageBar.addArrangedSubview(languageMenu)
        stack.addArrangedSubview(languageBar)

        let statusBox = makeBox(title: localized("status"))
        let statusStack = NSStackView()
        statusStack.orientation = .vertical
        statusStack.alignment = .leading
        statusStack.spacing = 5
        statusStack.translatesAutoresizingMaskIntoConstraints = false
        statusBox.contentView?.addSubview(statusStack)
        NSLayoutConstraint.activate([
            statusStack.leadingAnchor.constraint(equalTo: statusBox.contentView!.leadingAnchor, constant: 14),
            statusStack.trailingAnchor.constraint(equalTo: statusBox.contentView!.trailingAnchor, constant: -14),
            statusStack.topAnchor.constraint(equalTo: statusBox.contentView!.topAnchor, constant: 12),
            statusStack.bottomAnchor.constraint(equalTo: statusBox.contentView!.bottomAnchor, constant: -12)
        ])
        statusLabel.font = NSFont.systemFont(ofSize: 17, weight: .semibold)
        statusLabel.textColor = blue
        detailLabel.font = NSFont.systemFont(ofSize: 12)
        detailLabel.textColor = muted
        accountLabel.font = NSFont.systemFont(ofSize: 12)
        accountLabel.textColor = muted
        statusStack.addArrangedSubview(statusLabel)
        statusStack.addArrangedSubview(detailLabel)
        statusStack.addArrangedSubview(accountLabel)
        stack.addArrangedSubview(statusBox)
        statusBox.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -52).isActive = true

        let metricsBox = makeBox(title: localized("metrics"))
        let metricStack = NSStackView()
        metricStack.orientation = .horizontal
        metricStack.distribution = .fillEqually
        metricStack.translatesAutoresizingMaskIntoConstraints = false
        metricsBox.contentView?.addSubview(metricStack)
        NSLayoutConstraint.activate([
            metricStack.leadingAnchor.constraint(equalTo: metricsBox.contentView!.leadingAnchor, constant: 14),
            metricStack.trailingAnchor.constraint(equalTo: metricsBox.contentView!.trailingAnchor, constant: -14),
            metricStack.topAnchor.constraint(equalTo: metricsBox.contentView!.topAnchor, constant: 12),
            metricStack.bottomAnchor.constraint(equalTo: metricsBox.contentView!.bottomAnchor, constant: -12),
            metricStack.heightAnchor.constraint(equalToConstant: 54)
        ])
        for (key, label) in [("add", "可新增会话"), ("title", "可更新标题"), ("conflict", "标题需选择"), ("skip", "本次跳过")] {
            let column = NSStackView()
            column.orientation = .vertical
            column.alignment = .leading
            column.spacing = 3
            let value = NSTextField(labelWithString: "—")
            value.font = NSFont.monospacedDigitSystemFont(ofSize: 21, weight: .bold)
            value.textColor = ink
            let caption = NSTextField(labelWithString: label)
            caption.font = NSFont.systemFont(ofSize: 11)
            caption.textColor = muted
            column.addArrangedSubview(value)
            column.addArrangedSubview(caption)
            metricStack.addArrangedSubview(column)
            metrics[key] = value
        }
        stack.addArrangedSubview(metricsBox)
        metricsBox.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -52).isActive = true

        let guide = NSTextField(labelWithString: localized("guide"))
        guide.font = NSFont.systemFont(ofSize: 12)
        guide.textColor = muted
        guide.lineBreakMode = .byWordWrapping
        guide.maximumNumberOfLines = 2
        stack.addArrangedSubview(guide)
        guide.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -52).isActive = true

        let titleBox = makeBox(title: localized("titles"))
        let tableScroll = NSScrollView()
        tableScroll.hasVerticalScroller = true
        tableScroll.hasHorizontalScroller = true
        tableScroll.borderType = .bezelBorder
        tableScroll.translatesAutoresizingMaskIntoConstraints = false
        table.usesAlternatingRowBackgroundColors = true
        table.delegate = self
        table.dataSource = self
        table.rowHeight = 28
        table.headerView = NSTableHeaderView()
        for (identifier, heading, width) in [("status", "状态", 112), ("session", "会话", 132), ("source", "来源标题", 175), ("target", "目标标题", 175), ("action", "处理", 125), ("choice", "选择", 170)] {
            let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier(identifier))
            column.title = heading
            column.width = CGFloat(width)
            table.addTableColumn(column)
        }
        tableScroll.documentView = table
        titleBox.contentView?.addSubview(tableScroll)
        NSLayoutConstraint.activate([
            tableScroll.leadingAnchor.constraint(equalTo: titleBox.contentView!.leadingAnchor, constant: 12),
            tableScroll.trailingAnchor.constraint(equalTo: titleBox.contentView!.trailingAnchor, constant: -12),
            tableScroll.topAnchor.constraint(equalTo: titleBox.contentView!.topAnchor, constant: 12),
            tableScroll.bottomAnchor.constraint(equalTo: titleBox.contentView!.bottomAnchor, constant: -12),
            tableScroll.heightAnchor.constraint(equalToConstant: 180)
        ])
        stack.addArrangedSubview(titleBox)
        titleBox.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -52).isActive = true

        let reportBox = makeBox(title: localized("report"))
        let reportScroll = NSScrollView()
        reportScroll.hasVerticalScroller = true
        reportScroll.borderType = .bezelBorder
        reportScroll.translatesAutoresizingMaskIntoConstraints = false
        reportView.isEditable = false
        reportView.isSelectable = true
        reportView.font = NSFont.systemFont(ofSize: 12)
        reportView.textColor = ink
        reportView.backgroundColor = NSColor.textBackgroundColor
        reportView.textContainerInset = NSSize(width: 10, height: 10)
        reportScroll.documentView = reportView
        reportBox.contentView?.addSubview(reportScroll)
        NSLayoutConstraint.activate([
            reportScroll.leadingAnchor.constraint(equalTo: reportBox.contentView!.leadingAnchor, constant: 12),
            reportScroll.trailingAnchor.constraint(equalTo: reportBox.contentView!.trailingAnchor, constant: -12),
            reportScroll.topAnchor.constraint(equalTo: reportBox.contentView!.topAnchor, constant: 12),
            reportScroll.bottomAnchor.constraint(equalTo: reportBox.contentView!.bottomAnchor, constant: -12),
            reportScroll.heightAnchor.constraint(equalToConstant: 260)
        ])
        stack.addArrangedSubview(reportBox)
        reportBox.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -52).isActive = true

        let buttons = NSStackView()
        buttons.orientation = .horizontal
        buttons.spacing = 10
        checkButton.title = language == "en" ? "Check again" : "重新检查"
        syncButton.title = language == "en" ? "Sync safe items" : "同步安全项"
        closeSyncButton.title = language == "en" ? "Close Claude and sync" : "关闭 Claude 并同步"
        reportButton.title = language == "en" ? "Open latest report" : "打开最新报告"
        copyButton.title = language == "en" ? "Copy summary" : "复制摘要"
        checkButton.target = self
        checkButton.action = #selector(check(_:))
        syncButton.target = self
        syncButton.action = #selector(confirmSync(_:))
        closeSyncButton.target = self
        closeSyncButton.action = #selector(confirmCloseAndSync(_:))
        reportButton.target = self
        reportButton.action = #selector(openReport(_:))
        copyButton.target = self
        copyButton.action = #selector(copySummary(_:))
        syncButton.bezelStyle = .rounded
        closeSyncButton.bezelStyle = .rounded
        buttons.addArrangedSubview(checkButton)
        buttons.addArrangedSubview(syncButton)
        buttons.addArrangedSubview(closeSyncButton)
        buttons.addArrangedSubview(reportButton)
        buttons.addArrangedSubview(copyButton)
        stack.addArrangedSubview(buttons)
    }

    private func makeBox(title: String) -> NSBox {
        let box = NSBox()
        box.title = title
        box.titleFont = NSFont.systemFont(ofSize: 13, weight: .semibold)
        box.boxType = .primary
        box.cornerRadius = 8
        box.borderWidth = 1
        box.borderColor = NSColor.separatorColor
        box.translatesAutoresizingMaskIntoConstraints = false
        return box
    }

    @objc private func check(_ sender: Any?) {
        setBusy(true)
        setStatus("正在检查…", "正在读取会话索引和本地正文，请不要打开 Claude。", blue)
        runPython(arguments: ["--check"]) { [weak self] _ in self?.showLatestReport(afterSync: false) }
    }

    @objc private func languageChanged(_ sender: NSPopUpButton) {
        let codes = ["zh-CN", "en", "ja", "es", "pt-BR"]
        language = codes[max(0, min(sender.indexOfSelectedItem, codes.count - 1))]
        UserDefaults.standard.set(language, forKey: "ClaudeSyncLanguage")
        // Rebuild the small native window so every visible heading follows the
        // selected language without duplicating the sync/report logic.
        window.close()
        buildWindow()
        window.makeKeyAndOrderFront(nil)
        check(nil)
    }

    @objc private func confirmSync(_ sender: Any?) {
        showSyncConfirmation(closeFirst: false, resolutionURL: makeResolutionFile())
    }

    private func showSyncConfirmation(closeFirst: Bool, resolutionURL: URL?) {
        let add = metrics["add"]?.stringValue ?? "0"
        let title = metrics["title"]?.stringValue ?? "0"
        let conflicts = metrics["conflict"]?.stringValue ?? "0"
        let alert = NSAlert()
        alert.messageText = closeFirst ? "确认关闭 Claude 并同步" : "确认同步安全项"
        alert.informativeText = closeFirst
            ? "本次将先请求 Claude 正常退出，新增会话入口 \(add) 个，更新安全标题 \(title) 个，保留标题冲突 \(conflicts) 个，完成后重新打开 Claude。\n\n不会强制结束进程，不会改聊天正文，也不会自动登录或切换账号。"
            : "本次将新增会话入口 \(add) 个，更新安全标题 \(title) 个，保留标题冲突 \(conflicts) 个。\n\n不会改聊天正文，不会迁移云端 Artifact，也不会自动切换账号。"
        alert.addButton(withTitle: closeFirst ? "保存后继续" : "同步安全项")
        alert.addButton(withTitle: "取消")
        if alert.runModal() == .alertFirstButtonReturn {
            runSync(closeFirst: closeFirst, resolutionURL: resolutionURL)
        }
    }

    private func runSync(closeFirst: Bool, resolutionURL: URL?) {
        setBusy(true)
        if closeFirst {
            setStatus("正在关闭 Claude…", "正在请求正常退出；请不要再次打开 Claude。", amber)
        } else {
            setStatus("正在同步…", "正在写入并验证本地索引，请不要打开 Claude。", blue)
        }
        var arguments = [closeFirst ? "--close-sync" : "--sync"]
        if let resolutionURL {
            arguments += ["--title-resolutions", resolutionURL.path]
        }
        runPython(arguments: arguments) { [weak self] code in
            guard let self else { return }
            self.showLatestReport(afterSync: code == 0)
            if closeFirst {
                if code != 0 {
                    self.setStatus("同步未完成", "Claude 将重新打开；请查看报告中的原因。", red)
                }
                self.reopenClaude()
            }
            if let resolutionURL { try? FileManager.default.removeItem(at: resolutionURL) }
        }
    }

    @objc private func confirmCloseAndSync(_ sender: Any?) {
        showCloseConfirmation(resolutionURL: nil)
    }

    private func showCloseConfirmation(resolutionURL: URL?) {
        let alert = NSAlert()
        alert.messageText = "先确认当前 Claude 工作已保存"
        alert.informativeText = "这个按钮会请求 Claude 正常退出，等待后台进程完全结束，完成安全同步，然后重新打开 Claude。它不会强制结束进程，也不会自动登录或切换账号。\n\n如果 Claude 没有在等待时间内退出，操作会停止并保留报告。"
        alert.addButton(withTitle: "我已保存，继续")
        alert.addButton(withTitle: "取消")
        if alert.runModal() == .alertFirstButtonReturn {
            runSync(closeFirst: true, resolutionURL: resolutionURL ?? makeResolutionFile())
        } else if let resolutionURL {
            try? FileManager.default.removeItem(at: resolutionURL)
        }
    }

    private func makeResolutionFile() -> URL? {
        let conflicts = titleActions.filter { ($0["status"] as? String) == "conflict" }
        guard !conflicts.isEmpty else { return nil }
        var groups: [String: [[String: Any]]] = [:]
        for action in conflicts {
            let key = action["cliSessionId"] as? String ?? UUID().uuidString
            groups[key, default: []].append(action)
        }
        var choices: [String: String] = [:]
        for (key, actions) in groups {
            let first = actions.first!
            let source = first["source"] as? String ?? ""
            let target = first["target"] as? String ?? ""
            let selected = resolutionChoices[key] ?? 2
            let chosen = selected == 0 ? source : selected == 1 ? target : ""
            for action in actions {
                guard let path = action["target_path"] as? String else { continue }
                let actionSource = action["source"] as? String ?? ""
                let actionTarget = action["target"] as? String ?? ""
                if chosen.isEmpty {
                    choices[path] = "skip"
                } else if chosen == actionSource {
                    choices[path] = "source"
                } else if chosen == actionTarget {
                    choices[path] = "target"
                }
            }
        }
        do {
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("claude-session-sync-title-resolutions-\(UUID().uuidString).json")
            let data = try JSONSerialization.data(withJSONObject: ["version": 1, "choices": choices], options: [.prettyPrinted])
            try data.write(to: url, options: .atomic)
            return url
        } catch {
            let alertError = NSAlert()
            alertError.messageText = "无法保存标题选择"
            alertError.informativeText = error.localizedDescription
            alertError.runModal()
            return nil
        }
    }

    @objc private func openReport(_ sender: Any?) {
        if FileManager.default.fileExists(atPath: reportURL.path) {
            NSWorkspace.shared.open(reportURL)
        } else {
            let alert = NSAlert()
            alert.messageText = "还没有报告"
            alert.informativeText = "请先点击“重新检查”。"
            alert.runModal()
        }
    }

    @objc private func copySummary(_ sender: Any?) {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(reportView.string, forType: .string)
        setStatus("摘要已复制", "可以粘贴到聊天或备忘录中。", green)
    }

    private func setBusy(_ busy: Bool) {
        checkButton.isEnabled = !busy
        reportButton.isEnabled = !busy
        copyButton.isEnabled = !busy
        syncButton.isEnabled = false
        if busy {
            closeSyncButton.isEnabled = false
        }
    }

    private func setStatus(_ title: String, _ detail: String, _ color: NSColor) {
        statusLabel.stringValue = title
        statusLabel.textColor = color
        detailLabel.stringValue = detail
    }

    private func runPython(arguments: [String], completion: @escaping (Int32) -> Void) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
        process.arguments = [toolDirectory.appendingPathComponent("sync_sessions.py").path] + arguments
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try process.run()
                process.waitUntilExit()
                _ = pipe.fileHandleForReading.readDataToEndOfFile()
                DispatchQueue.main.async { completion(process.terminationStatus) }
            } catch {
                DispatchQueue.main.async { completion(1) }
            }
        }
    }

    private func showLatestReport(afterSync: Bool) {
        defer { setBusy(false) }
        guard let data = try? Data(contentsOf: jsonURL),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            setStatus("检查未完成", "没有读取到结构化报告，请打开终端检查错误。", red)
            return
        }
        let scan = json["scan"] as? [String: Any] ?? [:]
        let preflight = json["preflight"] as? [String: Any] ?? [:]
        let blockers = preflight["blockers"] as? [String] ?? []
        let counts = scan["counts"] as? [String: [String: Any]] ?? [:]
        let titleActions = scan["title_actions"] as? [[String: Any]] ?? []
        self.titleActions = titleActions
        let additions = counts.values.reduce(0) { $0 + (intValue($1["will_add"]) ?? 0) }
        let titleUpdates = counts.values.reduce(0) { $0 + (intValue($1["will_update_titles"]) ?? 0) }
        let conflicts = Set(titleActions.compactMap { action -> String? in
            guard (action["status"] as? String) == "conflict" else { return nil }
            return action["cliSessionId"] as? String
        }).count
        let entries = scan["entries"] as? [[String: Any]] ?? []
        let skipped = entries.filter {
            let status = $0["status"] as? String ?? ""
            return !["add", "branch", "present", "planned"].contains(status)
        }.count
        metrics["add"]?.stringValue = "\(additions)"
        metrics["title"]?.stringValue = "\(titleUpdates)"
        metrics["conflict"]?.stringValue = "\(conflicts)"
        metrics["skip"]?.stringValue = "\(skipped)"
        accountLabel.stringValue = "已检查账号：" + accountName(preflight: preflight, scan: scan)
        reportView.string = (try? String(contentsOf: reportURL, encoding: .utf8)) ?? "报告为空。"
        loadTitleRows(titleActions)
        let verified = ((json["result"] as? [String: Any])?["verified"] as? Bool) == true
        let hasClaudeBlocker = blockers.contains { $0.contains("Claude Desktop/Code 仍运行") }
        if afterSync && verified {
            let updated = ((json["result"] as? [String: Any])?["titles_updated"] as? [String])?.count ?? 0
            setStatus("同步完成", "本地索引和 \(updated) 个标题已完成文件校验；请手动打开 Claude 检查列表。", green)
        } else if !blockers.isEmpty {
            setStatus("需要先关闭 Claude", "只读检查完成；本次不会写入任何数据。", amber)
            closeSyncButton.isEnabled = hasClaudeBlocker
        } else if additions > 0 || titleUpdates > 0 {
            setStatus("可以同步安全项", "标题冲突会保留，不会强行覆盖。", green)
            syncButton.isEnabled = true
            closeSyncButton.isEnabled = false
        } else {
            setStatus("没有需要自动处理的项目", "标题冲突和云端资源仍会在报告中说明。", blue)
            closeSyncButton.isEnabled = false
        }
    }

    private func reopenClaude() {
        let appURL = URL(fileURLWithPath: "/Applications/Claude.app")
        NSWorkspace.shared.open(appURL)
    }

    private func intValue(_ value: Any?) -> Int? {
        if let value = value as? Int { return value }
        if let value = value as? NSNumber { return value.intValue }
        return nil
    }

    private func accountName(preflight: [String: Any], scan: [String: Any]) -> String {
        let labels = (scan["counts"] as? [String: Any])?.keys.sorted() ?? []
        if labels.isEmpty { return "未知" }
        return labels.joined(separator: " / ")
    }

    private func loadTitleRows(_ actions: [[String: Any]]) {
        resolutionChoices = [:]
        var rows: [TitleRow] = []
        var seenConflicts = Set<String>()
        for action in actions {
            let status = action["status"] as? String ?? ""
            let session = action["cliSessionId"] as? String ?? "未知"
            if status == "conflict" {
                if seenConflicts.contains(session) { continue }
                seenConflicts.insert(session)
                resolutionChoices[session] = 2
            }
            let label: String = [
                "same": "标题一致", "safe": "可安全同步", "normalize": "可统一标题",
                "selected_source": "已选择来源", "selected_target": "已保留目标",
                "keep_target": "保留目标", "conflict": "需要选择", "auto_difference": "不猜测"
            ][status] ?? status
            let actionText: String = [
                "same": "无变化", "safe": "将更新目标", "normalize": "去掉旧标记",
                "selected_source": "更新为来源标题", "selected_target": "保留目标标题",
                "keep_target": "保留目标标题", "conflict": "两边都手动改过", "auto_difference": "两个都是自动标题"
            ][status] ?? status
            rows.append(TitleRow(status: label,
                            session: String(session.prefix(12)) + "…",
                            source: action["source_title"] as? String ?? "",
                            target: action["target_title"] as? String ?? "",
                            action: actionText, kind: status,
                            choiceKey: status == "conflict" ? session : nil,
                            choiceLabels: status == "conflict" ? [action["source"] as? String ?? "账号 A",
                                                                  action["target"] as? String ?? "账号 B", "跳过"] : nil))
        }
        titleRows = rows
        table.reloadData()
    }

    func numberOfRows(in tableView: NSTableView) -> Int { titleRows.count }

    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        guard let identifier = tableColumn?.identifier.rawValue, row < titleRows.count else { return nil }
        let cell = NSTextField(labelWithString: "")
        cell.font = NSFont.systemFont(ofSize: 12)
        cell.lineBreakMode = .byTruncatingTail
        let item = titleRows[row]
        switch identifier {
        case "status": cell.stringValue = item.status
        case "session": cell.stringValue = item.session
        case "source": cell.stringValue = item.source
        case "target": cell.stringValue = item.target
        case "action": cell.stringValue = item.action
        case "choice":
            if let key = item.choiceKey {
                let control = ResolutionControl(labels: item.choiceLabels ?? ["账号 A", "账号 B", "跳过"], trackingMode: .selectOne,
                                                target: self, action: #selector(resolutionChanged(_:)))
                control.resolutionKey = key
                control.selectedSegment = resolutionChoices[key] ?? 2
                control.segmentStyle = .texturedRounded
                return control
            }
        default: break
        }
        cell.textColor = item.kind == "conflict" ? red : item.kind == "safe" ? green : ink
        return cell
    }

    @objc private func resolutionChanged(_ sender: ResolutionControl) {
        resolutionChoices[sender.resolutionKey] = sender.selectedSegment
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
