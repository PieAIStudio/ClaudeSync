import { GameHelpTip } from '@pieai/swimmer-ui-kit';
import { termTips, type HelpTerm } from '../term-copy';
import { useTranslation } from './i18n';

/** Keep the native UIKit trigger separate from selection and disclosure buttons. */
export function TermTip({ term }: { term: HelpTerm }) {
  const t = useTranslation();
  const copy = termTips[term];
  return <span className="term-tip" data-help-term={term}>
    <GameHelpTip label={t.t('helpFor', { term: t.t(copy.label) })}>{t.t(copy.body)}</GameHelpTip>
  </span>;
}
