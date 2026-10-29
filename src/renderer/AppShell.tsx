import type { ReactNode } from 'react';
import { Callout, Icon, IconButton, Shell } from '@pieai/swimmer-ui-kit';
import { useTranslation } from './i18n';
import type { AppController } from './app-controller';
import { navItems, type Stage } from './app-types';

function Sidebar({ controller }: { controller: AppController }) {
  const t = useTranslation();
  const current = (stage: Stage) => controller.stage === stage || (stage === 'results' && controller.stage === 'review');
  return <><div className="shell-brand"><span className="shell-brand-mark"><Icon icon="check" /></span><strong>ClaudeSync</strong></div>
    <nav aria-label={t.t('sources')}>{navItems.map((item) => <button key={item.stage} type="button" data-current={current(item.stage)} onClick={() => controller.navigate(item.stage)}><Icon icon={item.icon} /><span>{t.t(item.label)}</span></button>)}</nav>
    <nav className="shell-sidebar-bottom" aria-label={t.t('settings')}><button type="button" data-current={controller.stage === 'backups'} onClick={() => void controller.openBackups()} disabled={!controller.workspace || controller.busy}><Icon icon="history" /><span>{t.t('backupTitle')}</span></button>
      <button type="button" data-current={controller.stage === 'settings'} onClick={() => controller.navigate('settings')}><Icon icon="settings" /><span>{t.t('settings')}</span></button></nav></>;
}

function MobileNav({ controller }: { controller: AppController }) {
  const t = useTranslation();
  return <nav className="mobile-nav-links" aria-label={t.t('sources')}>{navItems.map((item) => <button key={item.stage} type="button" data-current={controller.stage === item.stage || (item.stage === 'results' && controller.stage === 'review')} onClick={() => controller.navigate(item.stage)}><Icon icon={item.icon} /><span>{t.t(item.label)}</span></button>)}</nav>;
}

function WindowBar({ controller }: { controller: AppController }) {
  const t = useTranslation();
  const stageLabel = controller.stage === 'home' ? t.t('overview') : controller.stage === 'review' ? t.t('reviewTitle') : controller.stage === 'results' ? t.t('localSessions')
    : controller.stage === 'settings' ? t.t('settings') : controller.stage === 'backups' ? t.t('backupTitle') : controller.stage === 'cloud' ? t.t('cloudSessions') : t.t('checking');
  return <><span className="shell-window-title">{stageLabel}</span><span className="shell-window-actions">
    {controller.stage === 'cloud' && <IconButton label={t.t('checkAgain')} onClick={controller.refreshCloud} disabled={controller.busy}><Icon icon="redo" /></IconButton>}
    <IconButton label={controller.theme === 'dark' ? 'Light mode' : 'Dark mode'} onClick={() => controller.setTheme(controller.theme === 'dark' ? 'light' : 'dark')}><Icon icon={controller.theme === 'dark' ? 'sun' : 'moon'} /></IconButton>
  </span></>;
}

export function AppShell({ controller, children }: { controller: AppController; children: ReactNode }) {
  const t = useTranslation();
  const feedback = <div className="shell-feedback" role="status" aria-live="polite">{controller.error && <Callout heading={t.t('issue')} tone="danger">{controller.error}</Callout>}{controller.cleanupFeedback && <Callout tone="warning">{controller.cleanupFeedback}</Callout>}</div>;
  return <Shell title="ClaudeSync" className="claudesync-shell" look="aura" platform={controller.platform} density={controller.compact ? 'dense' : 'comfortable'} reducedMotion={controller.reducedMotion} layout="auto" sidebar={<Sidebar controller={controller} />} sidebarLabel={t.t('sources')} mobileNav={<MobileNav controller={controller} />} windowBar={<WindowBar controller={controller} />} overlay={feedback}>{children}</Shell>;
}
