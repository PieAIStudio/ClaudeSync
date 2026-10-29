import { Badge, Button, Icon, PageSurface } from '@pieai/swimmer-ui-kit';
import { useTranslation } from './i18n';
import type { AppController } from './app-controller';
import { categoryLabels, categoryVisuals } from './app-types';
import { GroupArt, PageArt } from './visuals';
import { SkippedEntriesNotice, groupLabels } from './components';

function ResultCard({ kind, title, count, copy, canSync, onView, onSync }: {
  kind: Exclude<keyof typeof categoryVisuals, 'all'>; title: string; count: number; copy: string; canSync: boolean;
  onView(): void; onSync(): void;
}) {
  const t = useTranslation();
  return <article className={`summary-card summary-card--${kind}`} data-empty={count === 0 || undefined}>
    <button type="button" className="summary-card-main" onClick={onView} aria-label={`${title} · ${t.t(kind === 'attention' ? 'viewReasons' : 'viewGroup')}`}>
      <GroupArt kind={categoryVisuals[kind]} /><span className="summary-card-copy"><strong>{title}</strong><span>{copy}</span></span><span className="summary-card-count">{count}</span>
    </button>
    {canSync && count > 0 && <button type="button" className="summary-card-sync" onClick={onSync}>{t.t('syncCount', { count })}<Icon icon="arrow-right" /></button>}
  </article>;
}

export function ResultsStage({ controller }: { controller: AppController }) {
  const t = useTranslation();
  if (!controller.workspace) return <PageSurface className="stage-surface" layout="centered" title={t.t('noCheck')} description={t.t('heroBody')} header={<PageArt kind="local" />} primaryAction={<Button variant="primary" onClick={() => void controller.startCheck()}>{t.t('checkAgain')}</Button>}><div className="empty-state">{t.t('noCheck')}</div></PageSurface>;
  const resultTitle = controller.listCount ? controller.listCount === 1 ? t.t('resultsTitleOne') : t.t('resultsTitle', { count: controller.listCount }) : t.t('noSessions');
  const resultBody = t.t('resultsBody', { count: controller.syncableCount });
  const otherCount = controller.scopedGroups.archived.length + controller.scopedGroups.scheduled.length + controller.scopedGroups.oldOrganization.length;
  const firstAction = controller.syncableCount ? <Button variant="primary" disabled={controller.busy || controller.included.size < 2 || !controller.targetsVerified} onClick={() => controller.openReview('all', true)}>{t.t('syncCount', { count: controller.syncableCount })}</Button>
    : <Button variant="primary" onClick={() => controller.openReview(controller.categories.attention.sessions.length ? 'attention' : 'aligned')}>{controller.categories.attention.sessions.length ? t.t('categoryAttention') : t.t('categoryAligned')}</Button>;
  return <PageSurface className="stage-surface stage-surface--results" title={resultTitle} description={resultBody} header={<div className="page-header-tools"><PageArt kind="local" /><button type="button" className="plain-action" onClick={() => controller.navigate('settings')}>{t.t('viewScope')}</button></div>}>
    <div className="results-body"><div className="summary-grid">{(['recent', 'older', 'attention', 'aligned'] as const).map((kind) => <ResultCard key={kind} kind={kind} title={t.t(categoryLabels[kind])} count={controller.categories[kind].sessions.length}
      copy={kind === 'recent' ? t.t('categoryRecentCopy') : kind === 'older' ? t.t('categoryOlderCopy') : kind === 'attention' ? t.t('categoryAttentionCopy') : t.t('categoryAlignedCopy')}
      canSync={kind === 'recent' || kind === 'older'} onView={() => controller.openReview(kind)} onSync={() => controller.openReview(kind, true)} />)}</div>
      <div className="results-cta">{firstAction}<small>{controller.listVerified ? t.t('visibleCount', { shown: controller.grouped.visible.length, total: controller.scopedGroups.visible.length }) : t.t('unverifiedCount')} · {t.t('localOnly')}</small></div>
      {otherCount > 0 && <details className="other-records"><summary><Icon icon="arrow-right" />{t.t(otherCount === 1 ? 'otherRecordsOne' : 'otherRecords', { count: otherCount })}</summary><div className="other-records-grid">{(['archived', 'scheduled', 'oldOrganization'] as const).map((group) => <div key={group}><strong>{t.t(groupLabels[group])}</strong><Badge tone="neutral">{controller.scopedGroups[group].length}</Badge></div>)}</div></details>}
      {controller.workspace.skippedPaths.length > 0 && <SkippedEntriesNotice paths={controller.workspace.skippedPaths} />}
    </div>
  </PageSurface>;
}
