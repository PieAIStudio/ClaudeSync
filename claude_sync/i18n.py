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

# Text used by the setup fallback and the inline decision table. Keeping these
# labels beside the main UI vocabulary prevents one language from quietly
# falling back to Chinese when the account count grows.
EXTRA = {
    "zh-CN": {
        "setup_hint": "工具会先自动发现本机账号；只有发现不完整时才需要补充目录。不会读取密码、Cookie 或云端。",
        "session_root": "会话索引根目录", "projects_root": "正文目录",
        "session_root_help": "选择包含账号目录的 claude-code-sessions 文件夹",
        "projects_root_help": "默认使用 ~/.claude/projects；改过 CLAUDE_CONFIG_DIR 时选择对应目录",
        "accounts_section": "账号补救设置（通常不需要操作）", "account_prefix": "账号",
        "add_account": "＋ 添加账号", "remove_account": "删除",
        "read_order": "阅读顺序：先看状态，再看标题明细。标题冲突直接在表格中选择；只有同步按钮会写入本地索引。",
        "checking_detail": "正在读取索引和正文；不会写入 Claude 数据。",
        "syncing_detail": "正在做最后一次文件检查；请不要打开 Claude。",
        "close_detail": "只读检查完成；可以使用“关闭 Claude 并同步”。",
        "sync_complete": "同步完成", "sync_complete_detail": "本地索引已完成文件校验；请手动打开 Claude 检查列表。",
        "no_work_detail": "可继续查看报告中的跳过项和云端资源说明。", "report_failed": "检查未完成",
        "summary_copied": "摘要已复制", "no_report": "还没有报告", "check_first": "请先点击“重新检查”。",
        "title_status": {"same": "标题一致", "safe": "可统一标题", "normalize": "清理旧标记", "conflict": "需要选择", "auto_difference": "不猜测"},
        "title_action": {"same": "无变化", "safe": "唯一手动标题", "normalize": "去掉旧标记", "conflict": "多个手动标题", "auto_difference": "自动标题不同"},
        "skip": "跳过", "titles_by_account": "各账号标题", "title_choice": "选择", "table_headings": ["状态", "会话", "各账号标题", "处理", "选择"], "settings": "修改目录设置", "choose_account": "选择账号目录", "setup_saved_hint": "保存后会先做只读检查；只有同步按钮会写入本地索引。", "confirm_sync_title": "确认操作", "sync_summary": "本次将新增 %s 个入口，更新 %s 个标题，保留 %s 个标题冲突。", "close_summary": "先请求 Claude 正常退出，等待它完全结束，再执行同步；完成后尝试重新打开。", "cloud_boundary": "不会复制聊天正文，不会登录或切换账号。",
    },
    "en": {
        "setup_hint": "ClaudeSync discovers local accounts first. Add folders here only when discovery is incomplete. It never reads passwords, cookies, or cloud data.",
        "session_root": "Session index root", "projects_root": "Transcript folder",
        "session_root_help": "Choose the claude-code-sessions folder containing account folders",
        "projects_root_help": "Usually ~/.claude/projects; choose the matching folder when CLAUDE_CONFIG_DIR was changed",
        "accounts_section": "Account fallback settings (usually not needed)", "account_prefix": "Account",
        "add_account": "＋ Add account", "remove_account": "Remove",
        "read_order": "Read the status first, then title details. Choose conflicts in the table; only sync buttons write local indexes.",
        "checking_detail": "Reading indexes and transcripts; Claude data will not be written.", "syncing_detail": "Running the final file check; keep Claude closed.",
        "close_detail": "Read-only check complete; use Close Claude and sync.", "sync_complete": "Sync complete", "sync_complete_detail": "Local indexes passed file verification; open Claude and check the list.",
        "no_work_detail": "Read the report for skipped items and cloud-resource limits.", "report_failed": "Check did not finish", "summary_copied": "Summary copied", "no_report": "No report yet", "check_first": "Click Check again first.",
        "title_status": {"same": "Titles match", "safe": "Can unify", "normalize": "Clean old marker", "conflict": "Needs choice", "auto_difference": "No guess"},
        "title_action": {"same": "No change", "safe": "One manual title", "normalize": "Remove marker", "conflict": "Multiple manual titles", "auto_difference": "Different automatic titles"},
        "skip": "Skip", "titles_by_account": "Titles by account", "title_choice": "Choice", "table_headings": ["Status", "Session", "Titles by account", "Action", "Choice"], "settings": "Edit folder settings", "choose_account": "Choose account folder", "setup_saved_hint": "The first step after saving is read-only; only sync buttons write local indexes.", "confirm_sync_title": "Confirm action", "sync_summary": "This will add %s entries, update %s titles, and keep %s title conflicts.", "close_summary": "Claude will be asked to close gracefully before the sync, then reopen if possible.", "cloud_boundary": "Conversation bodies are not copied, and login or account switching stays manual.",
    },
    "ja": {
        "setup_hint": "ローカルアカウントを先に自動検出します。見つからない場合だけフォルダーを追加してください。パスワードや Cookie、クラウドデータは読みません。",
        "session_root": "索引ルート", "projects_root": "本文フォルダー", "session_root_help": "アカウントフォルダーを含む claude-code-sessions を選択", "projects_root_help": "通常は ~/.claude/projects。CLAUDE_CONFIG_DIR を変更した場合は対応するフォルダーを選択",
        "accounts_section": "アカウントの補助設定（通常は不要）", "account_prefix": "アカウント", "add_account": "＋ アカウントを追加", "remove_account": "削除",
        "read_order": "状態を確認してからタイトル詳細を見ます。衝突は表内で選択し、同期ボタンだけが索引を書き換えます。", "checking_detail": "索引と本文を読み取っています。Claude のデータは変更しません。", "syncing_detail": "最後のファイルチェック中です。Claude を閉じてください。", "close_detail": "読み取り専用チェック完了。「Claude を閉じて同期」を使えます。", "sync_complete": "同期完了", "sync_complete_detail": "ローカル索引の検証が完了しました。Claude を開いて一覧を確認してください。", "no_work_detail": "スキップ項目とクラウド制限はレポートで確認できます。", "report_failed": "チェック未完了", "summary_copied": "概要をコピーしました", "no_report": "レポートはまだありません", "check_first": "先に「再チェック」を押してください。",
        "title_status": {"same": "一致", "safe": "統一可能", "normalize": "古い印を削除", "conflict": "選択が必要", "auto_difference": "推測しない"}, "title_action": {"same": "変更なし", "safe": "手動タイトル1つ", "normalize": "印を削除", "conflict": "手動タイトル複数", "auto_difference": "自動タイトルが異なる"}, "skip": "スキップ", "titles_by_account": "アカウント別タイトル", "title_choice": "選択", "table_headings": ["状態", "セッション", "アカウント別タイトル", "処理", "選択"], "settings": "フォルダー設定を変更", "choose_account": "アカウントフォルダーを選択", "setup_saved_hint": "保存後は読み取り専用チェックを行います。書き込むのは同期ボタンだけです。", "confirm_sync_title": "操作を確認", "sync_summary": "%s 件の入口を追加し、%s 件のタイトルを更新し、%s 件の衝突を保留します。", "close_summary": "Claude を正常終了してから同期し、可能なら再起動します。", "cloud_boundary": "会話本文はコピーせず、ログインとアカウント切替は手動です。",
    },
    "es": {
        "setup_hint": "ClaudeSync descubre primero las cuentas locales. Añade carpetas aquí solo si faltan. Nunca lee contraseñas, cookies ni datos en la nube.", "session_root": "Raíz de índices", "projects_root": "Carpeta de transcripciones", "session_root_help": "Elige claude-code-sessions, que contiene las carpetas de cuentas", "projects_root_help": "Normalmente ~/.claude/projects; elige la carpeta correspondiente si cambiaste CLAUDE_CONFIG_DIR", "accounts_section": "Configuración de respaldo de cuentas (normalmente no hace falta)", "account_prefix": "Cuenta", "add_account": "＋ Añadir cuenta", "remove_account": "Eliminar", "read_order": "Lee primero el estado y después los títulos. Elige conflictos en la tabla; solo los botones de sincronización escriben índices.", "checking_detail": "Leyendo índices y transcripciones; no se escribirán datos de Claude.", "syncing_detail": "Comprobación final de archivos; mantén Claude cerrado.", "close_detail": "Comprobación de solo lectura terminada; usa Cerrar Claude y sincronizar.", "sync_complete": "Sincronización terminada", "sync_complete_detail": "Los índices locales pasaron la verificación; abre Claude y revisa la lista.", "no_work_detail": "Consulta el informe para los elementos omitidos y los límites de recursos en la nube.", "report_failed": "La comprobación no terminó", "summary_copied": "Resumen copiado", "no_report": "Aún no hay informe", "check_first": "Pulsa Comprobar de nuevo primero.", "title_status": {"same": "Coinciden", "safe": "Se puede unificar", "normalize": "Limpiar marca", "conflict": "Requiere elección", "auto_difference": "No adivinar"}, "title_action": {"same": "Sin cambios", "safe": "Un título manual", "normalize": "Quitar marca", "conflict": "Varios títulos manuales", "auto_difference": "Títulos automáticos distintos"}, "skip": "Omitir", "titles_by_account": "Títulos por cuenta", "title_choice": "Elección", "table_headings": ["Estado", "Sesión", "Títulos por cuenta", "Acción", "Elección"], "settings": "Editar carpetas", "choose_account": "Elegir carpeta de cuenta", "setup_saved_hint": "Después de guardar se hace una comprobación de solo lectura; solo los botones de sincronización escriben.", "confirm_sync_title": "Confirmar acción", "sync_summary": "Se añadirán %s entradas, se actualizarán %s títulos y se mantendrán %s conflictos.", "close_summary": "Se solicitará el cierre normal de Claude antes de sincronizar y se intentará abrirlo después.", "cloud_boundary": "No se copian conversaciones y el inicio de sesión o cambio de cuenta sigue siendo manual.",
    },
    "pt-BR": {
        "setup_hint": "O ClaudeSync descobre as contas locais primeiro. Adicione pastas aqui apenas se a descoberta estiver incompleta. Senhas, cookies e dados da nuvem nunca são lidos.", "session_root": "Raiz dos índices", "projects_root": "Pasta de transcrições", "session_root_help": "Escolha claude-code-sessions, que contém as pastas das contas", "projects_root_help": "Normalmente ~/.claude/projects; escolha a pasta correspondente se CLAUDE_CONFIG_DIR mudou", "accounts_section": "Configuração alternativa de contas (normalmente não é necessária)", "account_prefix": "Conta", "add_account": "＋ Adicionar conta", "remove_account": "Remover", "read_order": "Leia o status e depois os títulos. Escolha conflitos na tabela; somente os botões de sincronização escrevem índices.", "checking_detail": "Lendo índices e transcrições; os dados do Claude não serão alterados.", "syncing_detail": "Executando a verificação final; mantenha o Claude fechado.", "close_detail": "Verificação somente leitura concluída; use Fechar Claude e sincronizar.", "sync_complete": "Sincronização concluída", "sync_complete_detail": "Os índices locais passaram pela verificação; abra o Claude e confira a lista.", "no_work_detail": "Veja no relatório os itens ignorados e os limites de recursos na nuvem.", "report_failed": "A verificação não terminou", "summary_copied": "Resumo copiado", "no_report": "Ainda não há relatório", "check_first": "Clique primeiro em Verificar novamente.", "title_status": {"same": "Iguais", "safe": "Pode unificar", "normalize": "Limpar marca", "conflict": "Precisa escolher", "auto_difference": "Não adivinhar"}, "title_action": {"same": "Sem alteração", "safe": "Um título manual", "normalize": "Remover marca", "conflict": "Vários títulos manuais", "auto_difference": "Títulos automáticos diferentes"}, "skip": "Ignorar", "titles_by_account": "Títulos por conta", "title_choice": "Escolha", "table_headings": ["Status", "Sessão", "Títulos por conta", "Ação", "Escolha"], "settings": "Editar pastas", "choose_account": "Escolher pasta da conta", "setup_saved_hint": "Depois de salvar, a primeira verificação é somente leitura; apenas os botões de sincronização gravam.", "confirm_sync_title": "Confirmar ação", "sync_summary": "Serão adicionadas %s entradas, atualizados %s títulos e mantidos %s conflitos.", "close_summary": "O Claude será solicitado a fechar normalmente antes da sincronização e será reaberto se possível.", "cloud_boundary": "As conversas não são copiadas e login ou troca de conta continuam manuais.",
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
    return (TEXT.get(language, TEXT[DEFAULT]).get(key)
            if key in TEXT.get(language, TEXT[DEFAULT])
            else EXTRA.get(language, EXTRA[DEFAULT]).get(key, EXTRA[DEFAULT].get(key, key)))
