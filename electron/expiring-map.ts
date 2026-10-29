const PREVIEW_TTL_MS = 15 * 60 * 1000;

export function pruneExpiringMap<T extends { at: number }>(items: Map<string, T>, limit: number): void {
  const now = Date.now();
  for (const [key, item] of items) if (now - item.at > PREVIEW_TTL_MS) items.delete(key);
  if (items.size >= limit) items.delete(items.keys().next().value!);
}
