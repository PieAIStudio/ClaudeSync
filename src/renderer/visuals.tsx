import { Icon, type IconName } from '@pieai/swimmer-ui-kit';
import hero64 from './assets/design6/hero-64.png';
import hero384 from './assets/design6/hero-384.png';
import home64 from './assets/design6/home-64.png';
import home384 from './assets/design6/home-384.png';
import local64 from './assets/design6/local-64.png';
import local384 from './assets/design6/local-384.png';
import cloud64 from './assets/design6/cloud-64.png';
import cloud384 from './assets/design6/cloud-384.png';
import backup64 from './assets/design6/backup-64.png';
import backup384 from './assets/design6/backup-384.png';
import settings64 from './assets/design6/settings-64.png';
import settings384 from './assets/design6/settings-384.png';
import groupAligned from './assets/group-aligned.png';
import groupAttention from './assets/group-attention.png';
import groupCarry from './assets/group-carry.png';
import groupOlder from './assets/group-older.png';

type RelayState = 'ready' | 'scanning' | 'syncing' | 'complete' | 'attention';
export type GroupVisual = 'recent' | 'older' | 'attention' | 'aligned';
type PageVisual = 'home' | 'local' | 'cloud' | 'backup' | 'settings';
type ThreeDVisual = 'hero' | PageVisual;
type ThreeDSource = { small: string; large: string };

const threeDImages: Record<ThreeDVisual, ThreeDSource> = {
  hero: { small: hero64, large: hero384 },
  home: { small: home64, large: home384 },
  local: { small: local64, large: local384 },
  cloud: { small: cloud64, large: cloud384 },
  backup: { small: backup64, large: backup384 },
  settings: { small: settings64, large: settings384 },
};

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

function ThreeDImage({ name, className }: { name: ThreeDVisual; className: string; size: 'hero' | 'page' }) {
  // Match the approved prototype's neutral frame; keep art static in every motion mode.
  return <img className={className} src={threeDImages[name].large}
    width={384} height={384} alt="" aria-hidden="true" draggable={false} />;
}

export function RelayArt({ state = 'ready', celebrate = false, compact = false }: {
  state?: RelayState;
  celebrate?: boolean;
  compact?: boolean;
}) {
  return <div className={`relay-art ${compact ? 'relay-art--compact' : ''}`} data-relay-state={state} data-celebrate={celebrate} aria-hidden="true">
    <ThreeDImage name="hero" className="relay-render" size="hero" />
    <span className="relay-badge"><Icon icon={relayIcons[state]} size={compact ? 'md' : 'lg'} /></span>
  </div>;
}

export function PageArt({ kind }: { kind: ThreeDVisual }) {
  return <ThreeDImage name={kind} className="page-header-art" size="page" />;
}

export function NavArt({ kind }: { kind: PageVisual }) {
  return <img className="nav-art" src={threeDImages[kind].small}
    width={64} height={64} alt="" aria-hidden="true" draggable={false} />;
}

export function GroupArt({ kind }: { kind: GroupVisual }) {
  return <img className={`group-art group-art--${kind}`} src={groupImages[kind]} alt="" aria-hidden="true" />;
}
