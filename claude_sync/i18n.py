"""Small UI language registry; sync reports remain Chinese for stable diagnostics."""
import json
from pathlib import Path

LANGUAGES = {
    "zh-CN": "简体中文",
    "en": "English",
    "ja": "日本語",
    "es": "Español",
    "pt-BR": "Português",
}
DEFAULT = "zh-CN"
TEXT = {
    "zh-CN": {
        "app": "ClaudeSync", "subtitle": "手动、可检查、跨平台的本地会话同步", "status": "当前状态",
        "metrics": ["可新增会话", "可更新标题", "标题需选择", "本次跳过"], "title_detail": "标题明细（冲突在这里选，不弹窗）", "report": "检查报告",
        "check": "重新检查", "sync": "同步安全项", "close_sync": "关闭 Claude 并同步", "open_report": "打开最新报告", "copy": "复制摘要",
        "setup": "第一次使用 ClaudeSync", "save_setup": "保存设置并检查", "choose": "选择…", "exit": "退出", "language": "界面语言",
        "can_sync": "可以同步安全项", "need_close": "需要先关闭 Claude", "no_work": "没有需要自动处理的项目", "checking": "正在检查…", "syncing": "正在同步…",
        "conflict_hint": "标题冲突已列在上方；默认跳过，选择后再同步。", "read_only": "只读检查完成；本次不会写入。",
    },
    "en": {
        "app": "ClaudeSync", "subtitle": "Manual, inspectable, cross-platform local session sync", "status": "Current status",
        "metrics": ["Sessions to add", "Titles to update", "Title choices", "Skipped"], "title_detail": "Title details (choose conflicts here)", "report": "Check report",
        "check": "Check again", "sync": "Sync safe items", "close_sync": "Close Claude and sync", "open_report": "Open latest report", "copy": "Copy summary",
        "setup": "Set up ClaudeSync", "save_setup": "Save settings and check", "choose": "Choose…", "exit": "Exit", "language": "Interface language",
        "can_sync": "Ready to sync safe items", "need_close": "Claude must be closed first", "no_work": "Nothing needs automatic handling", "checking": "Checking…", "syncing": "Syncing…",
        "conflict_hint": "Title conflicts are listed above; choose one before syncing.", "read_only": "Read-only check complete; nothing was written.",
    },
    "ja": {
        "app": "ClaudeSync", "subtitle": "手動で確認できるクロスプラットフォーム同期", "status": "現在の状態",
        "metrics": ["追加するセッション", "更新するタイトル", "タイトル選択", "スキップ"], "title_detail": "タイトル詳細（ここで衝突を選択）", "report": "チェックレポート",
        "check": "再チェック", "sync": "安全な項目を同期", "close_sync": "Claude を閉じて同期", "open_report": "最新レポートを開く", "copy": "概要をコピー",
        "setup": "ClaudeSync の初期設定", "save_setup": "保存してチェック", "choose": "選択…", "exit": "終了", "language": "表示言語",
        "can_sync": "安全な項目を同期できます", "need_close": "先に Claude を閉じてください", "no_work": "自動処理する項目はありません", "checking": "チェック中…", "syncing": "同期中…",
        "conflict_hint": "タイトルの衝突は上に表示されています。選択してから同期してください。", "read_only": "読み取り専用チェック完了。書き込みはありません。",
    },
    "es": {
        "app": "ClaudeSync", "subtitle": "Sincronización local manual, clara y multiplataforma", "status": "Estado actual",
        "metrics": ["Sesiones para añadir", "Títulos para actualizar", "Elecciones de título", "Omitidos"], "title_detail": "Detalles de títulos (elige aquí los conflictos)", "report": "Informe de comprobación",
        "check": "Comprobar de nuevo", "sync": "Sincronizar elementos seguros", "close_sync": "Cerrar Claude y sincronizar", "open_report": "Abrir último informe", "copy": "Copiar resumen",
        "setup": "Configurar ClaudeSync", "save_setup": "Guardar y comprobar", "choose": "Elegir…", "exit": "Salir", "language": "Idioma de la interfaz",
        "can_sync": "Listo para sincronizar elementos seguros", "need_close": "Primero debes cerrar Claude", "no_work": "No hay nada que procesar automáticamente", "checking": "Comprobando…", "syncing": "Sincronizando…",
        "conflict_hint": "Los conflictos de título están arriba; elige uno antes de sincronizar.", "read_only": "Comprobación de solo lectura terminada; no se escribió nada.",
    },
    "pt-BR": {
        "app": "ClaudeSync", "subtitle": "Sincronização local manual, clara e multiplataforma", "status": "Estado atual",
        "metrics": ["Sessões para adicionar", "Títulos para atualizar", "Escolhas de título", "Ignorados"], "title_detail": "Detalhes dos títulos (escolha conflitos aqui)", "report": "Relatório de verificação",
        "check": "Verificar novamente", "sync": "Sincronizar itens seguros", "close_sync": "Fechar Claude e sincronizar", "open_report": "Abrir relatório mais recente", "copy": "Copiar resumo",
        "setup": "Configurar ClaudeSync", "save_setup": "Salvar e verificar", "choose": "Escolher…", "exit": "Sair", "language": "Idioma da interface",
        "can_sync": "Pronto para sincronizar itens seguros", "need_close": "Feche o Claude primeiro", "no_work": "Nada precisa de tratamento automático", "checking": "Verificando…", "syncing": "Sincronizando…",
        "conflict_hint": "Os conflitos de título estão acima; escolha antes de sincronizar.", "read_only": "Verificação somente leitura concluída; nada foi escrito.",
    },
}


def load(base):
    path = Path(base) / "preferences.json"
    try:
        value = json.loads(path.read_text(encoding="utf-8")).get("language")
        return value if value in LANGUAGES else DEFAULT
    except (OSError, ValueError, TypeError):
        return DEFAULT


def save(base, language):
    if language not in LANGUAGES:
        language = DEFAULT
    path = Path(base) / "preferences.json"
    path.write_text(json.dumps({"version": 1, "language": language}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if path.exists() and hasattr(path, "chmod"):
        try:
            path.chmod(0o600)
        except OSError:
            pass
    return language


def text(language, key):
    return TEXT.get(language, TEXT[DEFAULT]).get(key, TEXT[DEFAULT].get(key, key))
