import { useEffect, useMemo, useState } from 'react';
import { SESSION_GROUPS, type SessionGroup, type SessionView, type WorkspaceView } from '../shared/contracts';
import { sessionsInGroup } from './session-groups';
import { filterSessions, type SessionFilter } from './session-selection';
import { deletionSelection } from './deletion-selection';
import { summarizeAccounts } from './account-summary';
import { selectedSourceAccountIds, sessionActionState } from './session-action-state';

export function useSessionBrowser(workspace: WorkspaceView | undefined, included: Set<string>, busy: boolean, accountFilter: string, setAccountFilter: (value: string) => void) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionGroup, setSelectionGroup] = useState<SessionGroup>('visible');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<SessionFilter>('all');
  const [sort, setSort] = useState<'updated' | 'title'>('updated');
  const [missingOnly, setMissingOnly] = useState(false);
  const allAccounts = useMemo(() => new Set(workspace?.accounts.map((account) => account.id) ?? []), [workspace]);
  // Browsing is independent of the checked accounts used by an operation.
  const scopedGroups = useMemo(() => Object.fromEntries(SESSION_GROUPS.map((group) =>
    [group, sessionsInGroup(workspace?.sessions ?? [], group, accountFilter, allAccounts)])) as Record<SessionGroup, SessionView[]>, [workspace, accountFilter, allAccounts]);
  const grouped = useMemo(() => Object.fromEntries(SESSION_GROUPS.map((group) => [group,
    filterSessions(scopedGroups[group], { included: allAccounts, accountId: accountFilter, filter: group !== 'visible' && filter === 'active' ? 'all' : filter, search, sort }),
  ])) as Record<SessionGroup, SessionView[]>, [scopedGroups, allAccounts, accountFilter, filter, search, sort]);
  const accountSummary = useMemo(() => summarizeAccounts(workspace, included), [workspace, included]);
  const displayedAccounts = workspace?.accounts.filter((account) => accountFilter === 'all' || account.id === accountFilter) ?? [];
  const listVerified = displayedAccounts.length > 0 && displayedAccounts.every((account) => account.organizationVerified);
  const markerCount = displayedAccounts.reduce((sum, account) => sum + account.deletedMarkers, 0);
  const reviewSessions = grouped[selectionGroup].filter((session) => !missingOnly || selectionGroup !== 'visible' || accountSummary.missingSessionIds.has(session.id));
  const eligibleToSelect = reviewSessions.filter((session) => {
    const state = sessionActionState(session, included);
    return state.manageable || (selectionGroup === 'scheduled' || selectionGroup === 'deleted') && state.deletable;
  });
  const recentEligible = ['visible', 'archived', 'deleted'].includes(selectionGroup)
    ? reviewSessions.filter((session) => { const state = sessionActionState(session, included); return state.manageable && (selectionGroup !== 'visible' || state.eligible); })
      .slice().sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')).slice(0, 10)
    : [];
  const hiddenSelected = [...selected].filter((id) => !reviewSessions.some((session) => session.id === id)).length;
  const selectedSourceAccountCount = useMemo(() => selectedSourceAccountIds(
    sessionsInGroup(workspace?.sessions ?? [], selectionGroup, 'all', included), selected, included,
  ).size, [workspace, selectionGroup, selected, included]);
  const deleteTargets = useMemo(() => ({ ...deletionSelection(scopedGroups[selectionGroup], selected, included, accountFilter), group: selectionGroup }), [scopedGroups, selectionGroup, selected, included, accountFilter]);
  const targetsVerified = included.size > 0 && (workspace?.accounts.filter((account) => included.has(account.id)).every((account) => account.organizationVerified) ?? false);
  const canAct = selected.size > 0 && included.size > 0 && !busy;

  useEffect(() => {
    setSelected((current) => new Set([...current].filter((id) => scopedGroups[selectionGroup].some((session) => session.id === id && session.presence.some((item) => included.has(item.accountId))))));
  }, [scopedGroups, selectionGroup, included]);

  function toggle(group: SessionGroup, id: string, value: boolean) {
    if (!grouped[group].some((session) => {
      const state = sessionActionState(session, included);
      return session.id === id && (state.manageable || (group === 'scheduled' || group === 'deleted') && state.deletable);
    })) return;
    setSelected((current) => { const next = selectionGroup === group ? new Set(current) : new Set<string>(); if (value) next.add(id); else next.delete(id); return next; });
    setSelectionGroup(group);
  }
  function browseAccount(id: string) {
    setAccountFilter(id);
    setSelected(new Set());
  }
  function browseGroup(group: SessionGroup) {
    setSelectionGroup(group);
    setSelected(new Set());
    setMissingOnly(false);
  }
  return { included, accountFilter, setAccountFilter, selected, setSelected, selectionGroup, setSelectionGroup,
    search, setSearch, filter, setFilter, sort, setSort, scopedGroups, grouped, displayedAccounts, listVerified, markerCount,
    reviewSessions, eligibleToSelect, recentEligible, hiddenSelected, selectedSourceAccountCount, deleteTargets, targetsVerified, canAct, toggle,
    missingOnly, setMissingOnly, accountSummary, browseAccount, browseGroup };
}