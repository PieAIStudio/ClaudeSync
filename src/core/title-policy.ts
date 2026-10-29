import type { SessionEntry, SessionRecord, TitleAction, TitleOrigin } from './types';
import { isUuid } from './record';

const MANUAL_TITLE_SOURCES = new Set(['user', 'tool']);
const LEGACY_BRANCH_TITLE = /^(.*?)（来自 .+ 的分支）$/u;

function legacyBranchTitle(data: SessionRecord): string | undefined {
  const title = String(data.title ?? '').trim();
  const match = LEGACY_BRANCH_TITLE.exec(title);
  if (match && !Array.isArray(data.previousTitles)) return match[1];
  return undefined;
}

export function titleOrigin(data: SessionRecord): TitleOrigin {
  if (legacyBranchTitle(data) !== undefined) return 'legacy_generated';
  return MANUAL_TITLE_SOURCES.has(data.titleSource ?? '') ? 'manual' : 'auto';
}

function effectiveTitle(data: SessionRecord): string {
  return legacyBranchTitle(data) ?? String(data.title ?? '未命名会话');
}

export function updateTitle(target: SessionRecord, source: SessionRecord): SessionRecord {
  const next: SessionRecord = { ...target };
  const oldTitle = next.title;
  const newTitle = source.title || '未命名会话';
  next.title = newTitle;
  next.titleSource = MANUAL_TITLE_SOURCES.has(source.titleSource ?? '') ? source.titleSource : 'user';
  const previous = Array.isArray(next.previousTitles)
    ? next.previousTitles.filter((value): value is string => typeof value === 'string')
    : [];
  if (oldTitle && oldTitle !== newTitle && !previous.includes(oldTitle)) previous.push(oldTitle);
  next.previousTitles = previous;
  if (typeof next.completedTurns === 'number' && Number.isInteger(next.completedTurns) && next.completedTurns >= 0) {
    next.titleTurn = next.completedTurns;
  }
  return next;
}

function entriesByCli(entries: SessionEntry[]): Map<string, SessionEntry[]> {
  const result = new Map<string, SessionEntry[]>();
  for (const entry of entries) {
    if (!isUuid(entry.data.cliSessionId)) continue;
    const group = result.get(entry.data.cliSessionId) ?? [];
    group.push(entry);
    result.set(entry.data.cliSessionId, group);
  }
  return result;
}

function normalizedTitles(cliSessionId: string, candidates: SessionEntry[]): TitleAction[] {
  const actions: TitleAction[] = [];
  for (const target of candidates) {
    if (legacyBranchTitle(target.data) === undefined) continue;
    const source = candidates.find((entry) => entry !== target && legacyBranchTitle(entry.data) === undefined)
      ?? candidates.find((entry) => entry !== target) ?? target;
    actions.push({ status: 'normalize', cliSessionId, source, target,
      notes: ['去掉旧的同步分支标记，标题恢复为统一文本'], data: updateTitle(target.data, source.data) });
  }
  return actions;
}

function manualTitleActions(cliSessionId: string, candidates: SessionEntry[], manualTitles: Set<string>): TitleAction[] {
  const selectedTitle = [...manualTitles][0];
  const source = candidates.find((entry) => titleOrigin(entry.data) === 'manual' && effectiveTitle(entry.data) === selectedTitle)!;
  return candidates.flatMap((target) => target === source || effectiveTitle(target.data) === effectiveTitle(source.data) ? [] : [{
    status: 'safe' as const, cliSessionId, source, target,
    notes: ['唯一手动标题优先于自动标题；只更新需要统一的账号'], data: updateTitle(target.data, source.data),
  }]);
}

function differingTitleActions(cliSessionId: string, candidates: SessionEntry[], manualTitles: Set<string>, selections: Record<string, string>): TitleAction[] {
  const selectedScope = manualTitles.size > 1 ? selections[cliSessionId] : undefined;
  const chosen = selectedScope && selectedScope !== 'skip' ? candidates.find((entry) => entry.account.scope === selectedScope) : undefined;
  const status = manualTitles.size > 1 ? 'conflict' as const : 'auto_difference' as const;
  return candidates.map((target) => {
    const source = chosen ?? candidates.find((entry) => entry !== target) ?? target;
    if (chosen && target === chosen && !legacyBranchTitle(target.data)) {
      return { status: 'selected_target' as const, cliSessionId, source, target, notes: ['已选择此账号标题；此账号不需要改写'] };
    }
    return {
      status: chosen ? 'selected_source' as const : status, cliSessionId, source, target,
      ...(chosen ? { data: updateTitle(target.data, chosen.data) } : {}),
      notes: [chosen ? '已选择此账号标题，更新其他需要统一的账号'
        : manualTitles.size > 1 ? (selectedScope === 'skip' ? '已选择跳过此标题冲突' : '多个账号都有不同的手动标题，等待选择')
        : '两边都是自动标题；不根据活动时间猜测'],
    };
  });
}

function actionsForTitleGroup(cliSessionId: string, group: SessionEntry[], selections: Record<string, string>): TitleAction[] {
  const candidates = [...group].sort((a, b) => a.account.scope.localeCompare(b.account.scope));
  if (candidates.length < 2) return [];
  const titles = new Set(candidates.map((entry) => effectiveTitle(entry.data)));
  const manualTitles = new Set(candidates.filter((entry) => titleOrigin(entry.data) === 'manual').map((entry) => effectiveTitle(entry.data)));
  if (titles.size === 1) return normalizedTitles(cliSessionId, candidates);
  if (manualTitles.size === 1) return manualTitleActions(cliSessionId, candidates, manualTitles);
  return differingTitleActions(cliSessionId, candidates, manualTitles, selections);
}

export function buildTitleActions(entries: SessionEntry[], selections: Record<string, string> = {}): TitleAction[] {
  return [...entriesByCli(entries)].flatMap(([cliSessionId, group]) => actionsForTitleGroup(cliSessionId, group, selections));
}
