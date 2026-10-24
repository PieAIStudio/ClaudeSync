import { Icon, type IconName } from '@pieai/swimmer-ui-kit';
import relayDark from './assets/relay-dark.png';
import relayLight from './assets/relay-light.png';
import groupAligned from './assets/group-aligned.png';
import groupAttention from './assets/group-attention.png';
import groupCarry from './assets/group-carry.png';
import groupOlder from './assets/group-older.png';

export type RelayState = 'ready' | 'scanning' | 'syncing' | 'complete' | 'attention';
export type GroupVisual = 'recent' | 'older' | 'attention' | 'aligned';

const groupImages: Record<GroupVisual, string> = {
  recent: groupCarry,
  older: groupOlder,
  attention: groupAttention,
  aligned: groupAligned,
};

const relayIcons: Record<RelayState, IconName> = {
  ready: 'redo',
  scanning: 'search',
  syncing: 'redo',
  complete: 'check',
  attention: 'alert',
};

export function RelayArt({ state = 'ready', celebrate = false, compact = false }: {
  state?: RelayState;
  celebrate?: boolean;
  compact?: boolean;
}) {
  return <div className={`relay-art ${compact ? 'relay-art--compact' : ''}`} data-relay-state={state} data-celebrate={celebrate} aria-hidden="true">
    <img className="relay-render relay-light" src={relayLight} alt="" />
    <img className="relay-render relay-dark" src={relayDark} alt="" />
    <span className="relay-badge"><Icon icon={relayIcons[state]} size={compact ? 'md' : 'lg'} /></span>
  </div>;
}

export function GroupArt({ kind }: { kind: GroupVisual }) {
  return <img className={`group-art group-art--${kind}`} src={groupImages[kind]} alt="" aria-hidden="true" />;
}
