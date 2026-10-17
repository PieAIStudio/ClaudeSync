// Shared by every help button; keep each explanation to at most two sentences.
// Scope is based on our scanner and adapter, not uninspected Desktop internals.
export const termMessages = {
  helpFor: ['了解{term}', 'About {term}', '{term}について', 'Acerca de {term}', 'Sobre {term}'],
  unknownEmailLabel: ['待识别邮箱', 'Email unknown', 'メール未確認', 'Correo sin identificar', 'E-mail não identificado'],
  scheduledCountLabel: ['定时运行', 'Task runs', '定期実行', 'Ejecuciones', 'Execuções'],
  oldCountLabel: ['旧副本', 'Old copies', '旧コピー', 'Copias antiguas', 'Cópias antigas'],
  archivedCountLabel: ['归档', 'Archived', '保管済み', 'Archivadas', 'Arquivadas'],
  deletedCountLabel: ['删除标记', 'Deleted notes', '削除の印', 'Notas de borrado', 'Notas de exclusão'],
  tipCode: ['这里整理 Claude 桌面版「Code」里的会话。网页和手机上的普通聊天、Cowork 不在这里。', 'These are sessions from Code in Claude Desktop, including linked cloud Code sessions. Regular web and mobile chats and Cowork are not included.', 'Claude デスクトップの「Code」のセッションを整理します。Web・スマホの通常チャットと Cowork は対象外です。', 'Aquí se organizan las sesiones de Code en Claude Desktop, incluidas las de Code vinculadas en la nube. No incluye chats normales de web o móvil ni Cowork.', 'Aqui ficam as sessões de Code do Claude Desktop, incluindo as de Code vinculadas na nuvem. Conversas comuns da web ou do celular e Cowork ficam de fora.'],
  tipVisible: ['侧边栏里正常能看到的会话，像摆在桌上的文件。', 'Sessions normally shown in the sidebar, like papers on your desk.', 'サイドバーに普段表示されるセッションで、机の上の書類のようなものです。', 'Son las sesiones que ves normalmente en la barra lateral, como papeles sobre tu escritorio.', 'São as sessões que aparecem normalmente na barra lateral, como papéis sobre a mesa.'],
  tipArchived: ['你收进抽屉的会话。还在，只是不在桌上。', 'Sessions you put away in a drawer. Still there, just not on your desk.', '引き出しにしまったセッションです。机の上にはなくても、残っています。', 'Sesiones guardadas en un cajón. Siguen ahí, solo que no están sobre la mesa.', 'Sessões guardadas na gaveta. Continuam lá, só não estão sobre a mesa.'],
  tipScheduled: ['定时任务每跑一次，就自动生成一个会话。像闹钟每天自动写的一页，不是你自己开的。', 'Each scheduled run creates a session automatically. Like an alarm writing a new page each day, not one you opened yourself.', '定期タスクの実行ごとに自動でできるセッションです。目覚ましが毎日書く一ページのように、自分で開いたものではありません。', 'Cada ejecución programada crea una sesión automáticamente. Como una alarma que escribe una página cada día, no la abriste tú.', 'Cada execução agendada cria uma sessão automaticamente. É como um alarme que escreve uma página por dia, não foi você que abriu.'],
  tipOldOrganization: ['这是当前组织以外的会话索引，切换组织后可能遗留，像旧办公室里的文件卡片。“清理旧组织副本”保留当前副本和共享正文，独有的先归档搬回，再把旧卡片送废纸篓。', 'Indexes left outside the current organization, sometimes after a switch, like old office cards. Cleanup preserves current copies and shared text, returns unique sessions archived, and moves old cards to Trash.', '組織の切り替え後などに以前の組織に残る一覧データで、古いオフィスのカードのようなものです。整理では現在のコピーと共有本文を残し、唯一のものを保管して戻してから旧カードをゴミ箱へ移します。', 'Son índices fuera de la organización actual, a veces tras un cambio, como fichas de una oficina anterior. La limpieza guarda las copias actuales y el texto compartido, archiva las únicas y lleva las fichas viejas a la papelera.', 'São índices fora da organização atual, às vezes após trocar de organização, como fichas de um escritório antigo. A limpeza preserva cópias atuais e texto compartilhado, traz as únicas arquivadas e move as fichas antigas para a Lixeira.'],
  tipDeleted: ['这里是删过、但本机仍有副本的会话，想带回来可勾选后点“同步所选”。没有亲手选择时，保留删除记录，避免批量整理把旧会话悄悄带回。', 'These deleted sessions still have local copies; select one and Sync selected to bring it back. Deletion notes remain for bulk operations to prevent accidental resurrection.', '削除済みでもコピーが残るセッションです。選択して同期すると戻せますが、一括整理では削除記録を保持し、意図しない復活を防ぎます。', 'Estas sesiones borradas aún tienen copias locales; selecciónalas y sincroniza para recuperarlas. Las operaciones masivas conservan las notas para evitar recuperaciones accidentales.', 'Estas sessões excluídas ainda têm cópias locais; selecione e sincronize para trazê-las de volta. Operações em lote mantêm as notas para evitar restaurações acidentais.'],
  tipUnverified: ['还没确认这个账号现在用哪个组织，所以暂不计数，也不往里同步。在桌面版切到这个账号，再点「重新检查」。', 'We have not confirmed which organization this account uses, so there is no main count or sync into it yet. Switch to this account in Claude Desktop, then Refresh.', 'このアカウントで使う組織が未確認なので、件数は出さず、同期先にもしません。Claude デスクトップでこのアカウントに切り替え、再読み込みしてください。', 'Aún no sabemos qué organización usa esta cuenta, así que no damos una cifra principal ni sincronizamos hacia ella. Cambia a esta cuenta en Claude Desktop y pulsa Actualizar.', 'Ainda não confirmamos qual organização esta conta usa, então não mostramos a contagem principal nem sincronizamos para ela. Mude para esta conta no Claude Desktop e clique em Atualizar.'],
  tipUnknownEmail: ['本机有这个账号的文件夹，但还不知道是哪个邮箱。', 'There is a folder for this account on this computer, but its email is still unknown.', 'この端末にアカウントのフォルダーはありますが、メールアドレスはまだ不明です。', 'Hay una carpeta de esta cuenta en el equipo, pero aún no sabemos su correo.', 'Existe uma pasta desta conta no computador, mas ainda não sabemos o e-mail.'],
  tipOldCleanup: ['重复的旧副本放进废纸篓；独有的先归档搬回，就像搬家先收好旧柜里的文件。', 'Old duplicates go to Trash; unique ones come back archived, like packing papers from an old cabinet.', '重複した旧コピーはゴミ箱へ、唯一のものは保管して戻します。古い棚の書類を片付けるようなものです。', 'Los duplicados van a la papelera; los únicos vuelven archivados, como guardar papeles de un armario viejo.', 'As cópias repetidas vão para a Lixeira; as únicas voltam arquivadas, como guardar papéis de um armário antigo.'],
} as const satisfies Record<string, readonly [string, string, string, string, string]>;

export const termTips = {
  code: { label: 'sessions', body: 'tipCode' },
  visible: { label: 'visibleGroup', body: 'tipVisible' },
  archived: { label: 'archived', body: 'tipArchived' },
  scheduled: { label: 'scheduledGroup', body: 'tipScheduled' },
  oldOrganization: { label: 'oldOrganizationGroup', body: 'tipOldOrganization' },
  deleted: { label: 'deletedGroup', body: 'tipDeleted' },
  unverified: { label: 'unverifiedGroup', body: 'tipUnverified' },
  unknownEmail: { label: 'unknownEmailLabel', body: 'tipUnknownEmail' },
  oldCleanup: { label: 'cleanupOldButton', body: 'tipOldCleanup' },
} as const;
export type HelpTerm = keyof typeof termTips;
