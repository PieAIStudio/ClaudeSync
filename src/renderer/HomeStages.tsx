import { Button, Icon } from '@pieai/swimmer-ui-kit';
import { StageFrame } from './StageFrame';
import { useTranslation } from './i18n';
import type { AppController } from './app-controller';
import { homeAccountLabels } from './app-helpers';
import { PageArt, RelayArt } from './visuals';

export function HomeStage({ controller }: { controller: AppController }) {
  const t = useTranslation();
  const configured = Boolean(controller.info?.configured);
  const heroTitle = t.t('heroTitle').replace(/([,，、])\s*/u, '$1\n');
  return <StageFrame className="stage-surface stage-surface--home" title={heroTitle} description={t.t('heroBody')} header={<PageArt kind="home" />}>
    <div className="home-stage"><div className="home-art"><RelayArt state="ready" /></div>
      <ul className="home-scope-list"><li><Icon icon="scroll" /><span><strong>{t.t('localSessions')} · {t.t('cloudSessions')}</strong><small>{t.t('homeLocalBody')}</small></span></li>
        <li><Icon icon="user" /><span><strong>{homeAccountLabels(controller.included, t) || t.t('unverifiedCount')}</strong><button type="button" className="inline-action" onClick={() => controller.navigate('settings')}>{t.t('viewScope')}</button></span></li>
        <li><Icon icon="lock" /><span><strong>{t.t('homeSafety')}</strong></span></li></ul>
      <div className="hero-actions"><Button variant="primary" disabled={controller.busy} onClick={() => configured ? void controller.startCheck() : controller.navigate('settings')}><Icon icon={configured ? 'search' : 'scroll'} />{configured ? (controller.hasChecked ? t.t('checkAgain') : t.t('checkChats')) : t.t('noDesktopAction')}</Button><small>{t.t('firstCheckHint')}</small></div>
    </div>
  </StageFrame>;
}

export function ScanStage() {
  const t = useTranslation();
  return <StageFrame className="stage-surface stage-surface--state" layout="centered" title={t.t('checking')} description={t.t('heroBody')}>
    <div className="state-stage"><RelayArt state="scanning" /><div className="liquid-progress" aria-hidden="true"><span /></div><p>{t.t('checking')}</p><small>{t.t('localOnly')}</small></div>
  </StageFrame>;
}

export function ProgressStage() {
  const t = useTranslation();
  return <StageFrame className="stage-surface stage-surface--state" layout="centered" title={t.t('operationInProgress')} description={t.t('operationInProgressBody')}>
    <div className="state-stage"><RelayArt state="syncing" /><div className="liquid-progress liquid-progress--wide" aria-label={t.t('operationInProgress')}><span /></div><p>{t.t('applying')}</p><small>{t.t('waiting')}</small></div>
  </StageFrame>;
}
