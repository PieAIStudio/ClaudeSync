import { useEffect, useMemo, useState } from 'react';
import { SESSION_GROUPS, type SessionGroup, type SessionView, type WorkspaceView } from '../shared/contracts';
import { sessionsInGroup } from './session-groups';
import { filterSessions, type SessionFilter } from './session-selection';
import { deletionSelection, type DeleteSelection } from './deletion-selection';
import type { ResultCategories, ReviewCategory } from './app-types';

function classifyVisibleSessions(sessions: SessionView[], included: Set<string>): ResultCategories {
  const result: ResultCategories = {
    recent: { ids: new Set(), sessions: [] }, older: { ids: new Set(), sessions: [] }, attention: { ids: new Set(), sessions: [] },
    aligned: { ids: new Set(), sessions: [] }, all: { ids: new Set(), sessions: sessions.slice() },
  };
  const recentCutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  for (const session of sessions) {
    const presence = session.presence.filter((item) => included.has(item.accountId));
    const eligible = presence.some((item) => item.eligible);
    const aligned = included.size > 0 && [...included].every((accountId) => presence.some((item) => item.accountId === accountId && item.active));
    const category: Exclude<ReviewCategory, 'all'> = !session.manageable || !eligible ? 'attention'
      : aligned ? 'aligned' : session.updatedAt && Date.parse(session.updatedAt) >= recentCutoff ? 'recent' : 'older';
    result[category].ids.add(session.id); result[category].sessions.push(session); result.all.ids.add(session.id);
  }
  return result;
}

export function useSessionBrowser(workspace: WorkspaceView | undefined, included: Set<string>, busy: boolean, accountFilter: string, setAccountFilter: (value: string) => void) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionGroup, setSelectionGroup] = useState<SessionGroup>('visible');
  const [reviewCategory, setReviewCategory] = useState<ReviewCategory>('recent');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<SessionFilter>('active');
  const [sort, setSort] = useState<'updated' | 'title'>('updated');
  const scopedGroups = useMemo(() => Object.fromEntries(SESSION_GROUPS.map((group) =>
    [group, sessionsInGroup(workspace?.sessions ?? [], group, accountFilter, included)])) as Record<SessionGroup, SessionView[]>, [workspace, accountFilter, included]);
  const grouped = useMemo(() => Object.fromEntries(SESSION_GROUPS.map((group) => [group,
    filterSessions(scopedGroups[group], { included, accountId: accountFilter, filter: group !== 'visible' && filter === 'active' ? 'all' : filter, search, sort }),
  ])) as Record<SessionGroup, SessionView[]>, [scopedGroups, included, accountFilter, filter, search, sort]);
  const categories = useMemo(() => classifyVisibleSessions(scopedGroups.visible, included), [scopedGroups.visible, included]);
  const displayedAccounts = workspace?.accounts.filter((account) => accountFilter === 'all' ? included.has(account.id) : account.id === accountFilter) ?? [];
  const listVerified = displayedAccounts.length > 0 && displayedAccounts.every((account) => account.organizationVerified);
  const markerCount = displayedAccounts.reduce((sum, account) => sum + account.deletedMarkers, 0);
  const reviewSessions = reviewCategory === 'all' ? grouped.visible : grouped.visible.filter((session) => categories[reviewCategory].ids.has(session.id));
  const eligibleToSelect = reviewSessions.filter((session) => session.manageable && session.presence.some((item) => included.has(item.accountId) && item.eligible));
  const hiddenSelected = [...selected].filter((id) => !reviewSessions.some((session) => session.id === id)).length;
  const deleteTargets = useMemo(() => ({ ...deletionSelection(scopedGroups[selectionGroup], selected, included, accountFilter), group: selectionGroup }), [scopedGroups, selectionGroup, selected, included, accountFilter]);
  const listCount = categories.all.sessions.length;
  const syncableCount = categories.recent.sessions.length + categories.older.sessions.length;
  const targetsVerified = workspace?.accounts.filter((account) => included.has(account.id)).every((account) => account.organizationVerified) ?? false;
  const canAct = selected.size > 0 && included.size > 0 && !busy;

  useEffect(() => {
    setSelected((current) => new Set([...current].filter((id) => scopedGroups[selectionGroup].some((session) => session.id === id && session.presence.some((item) => included.has(item.accountId))))));
  }, [scopedGroups, selectionGroup, included]);

  function toggle(group: SessionGroup, id: string, value: boolean) {
    if (!grouped[group].some((session) => session.id === id && session.manageable && session.presence.some((item) => included.has(item.accountId)))) return;
    setSelected((current) => { const next = selectionGroup === group ? new Set(current) : new Set<string>(); if (value) next.add(id); else next.delete(id); return next; });
    setSelectionGroup(group);
  }

  function openReview(category: ReviewCategory, preselect = false) {
    setReviewCategory(category); setSelectionGroup('visible');
    const ids = category === 'all' ? [...categories.recent.sessions, ...categories.older.sessions] : categories[category].sessions;
    setSelected(preselect ? new Set(ids.filter((session) => session.manageable && session.presence.some((item) => included.has(item.accountId) && item.eligible)).map((session) => session.id)) : new Set());
  }

  return { included, accountFilter, setAccountFilter, selected, setSelected, selectionGroup, setSelectionGroup, reviewCategory, setReviewCategory,
    search, setSearch, filter, setFilter, sort, setSort, scopedGroups, grouped, categories, displayedAccounts, listVerified, markerCount,
    reviewSessions, eligibleToSelect, hiddenSelected, deleteTargets, listCount, syncableCount, targetsVerified, canAct, toggle, openReview };
}
