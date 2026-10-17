import type { AccountView, OperationPreview } from '../shared/contracts';
import { useTranslation } from './i18n';

export function ProgressReview({ preview, accounts, choices, busy, onChoose }: {
  preview: OperationPreview; accounts: AccountView[]; choices?: Record<string, string>; busy: boolean;
  onChoose?(id: string, path: string): void;
}) {
  const t = useTranslation();
  const name = (id: string) => accounts.find((account) => account.id === id)?.email ?? t.t('unknown', { id: id.slice(0, 8) });
  return <>
    {Boolean(preview.progressUpdates?.length) && <section className="progress-updates"><h3>{t.t('update')}</h3>
      <p>{t.t('sharedTranscript')}</p>
      {preview.progressUpdates!.map((item, index) => <div className="presence-detail" key={`${item.id}-${index}`}>
        <strong>{item.title || t.t('untitled')}</strong>
        <p>{name(item.sourceAccountId)} → {name(item.targetAccountId)}</p>
        <p>{item.selected ? t.t('chosenVersion') : t.t('provenContinuation')}
          {item.deltaTurns !== undefined && ` · ${t.t('turnDifference', { count: item.deltaTurns })}`}</p>
        {item.updatedAt && <time>{t.date(item.updatedAt, { dateStyle: 'medium', timeStyle: 'short' })}</time>}
      </div>)}
    </section>}
    {Boolean(preview.progressConflicts?.length) && <section className="title-conflicts"><h3>{t.t('versionConflict')}</h3>
      <p>{t.t('versionConflictAdvice')}</p>
      {preview.progressConflicts!.map((item) => <label key={item.id}>
        <strong>{item.title || t.t('untitled')}</strong><span>{t.t('chooseVersion')}</span>
        <select aria-label={`${t.t('chooseVersion')} ${item.title}`} value={choices?.[item.id] ?? ''} disabled={busy}
          onChange={(event) => onChoose?.(item.id, event.target.value)}>
          <option value="">{t.t('chooseVersion')}</option>
          {item.options.map((option) => <option key={option.path} value={option.path}>
            {name(option.accountId)} · {option.turns === undefined ? '—' : t.t('turnCount', { count: option.turns })}
            {option.updatedAt ? ` · ${t.date(option.updatedAt, { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
          </option>)}
        </select>
      </label>)}
    </section>}
  </>;
}
