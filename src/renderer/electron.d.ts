import type { ClaudeSyncApi } from '../shared/contracts';

declare global {
  interface Window { claudeSync?: ClaudeSyncApi }
}
