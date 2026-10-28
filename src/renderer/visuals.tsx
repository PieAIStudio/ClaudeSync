import { Icon, type IconName } from '@pieai/swimmer-ui-kit';
import hero128 from './assets/icons-3d/hero-128.png';
import hero256 from './assets/icons-3d/hero-256.png';
import hero512 from './assets/icons-3d/hero-512.png';
import home128 from './assets/icons-3d/home-128.png';
import home256 from './assets/icons-3d/home-256.png';
import home512 from './assets/icons-3d/home-512.png';
import local128 from './assets/icons-3d/local-128.png';
import local256 from './assets/icons-3d/local-256.png';
import local512 from './assets/icons-3d/local-512.png';
import cloud128 from './assets/icons-3d/cloud-128.png';
import cloud256 from './assets/icons-3d/cloud-256.png';
import cloud512 from './assets/icons-3d/cloud-512.png';
import backup128 from './assets/icons-3d/backup-128.png';
import backup256 from './assets/icons-3d/backup-256.png';
import backup512 from './assets/icons-3d/backup-512.png';
import settings128 from './assets/icons-3d/settings-128.png';
import settings256 from './assets/icons-3d/settings-256.png';
import settings512 from './assets/icons-3d/settings-512.png';
import groupAligned from './assets/group-aligned.png';
import groupAttention from './assets/group-attention.png';
import groupCarry from './assets/group-carry.png';
import groupOlder from './assets/group-older.png';

export type RelayState = 'ready' | 'scanning' | 'syncing' | 'complete' | 'attention';
export type GroupVisual = 'recent' | 'older' | 'attention' | 'aligned';
export type PageVisual = 'home' | 'local' | 'cloud' | 'backup' | 'settings';
type ThreeDVisual = 'hero' | PageVisual;
type ThreeDSource = { small: string; medium: string; large: string };

const threeDImages: Record<ThreeDVisual, ThreeDSource> = {
  hero: { small: hero128, medium: hero256, large: hero512 },
  home: { small: home128, medium: home256, large: home512 },
  local: { small: local128, medium: local256, large: local512 },
  cloud: { small: cloud128, medium: cloud256, large: cloud512 },
  backup: { small: backup128, medium: backup256, large: backup512 },
  settings: { small: settings128, medium: settings256, large: settings512 },
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

function ThreeDImage({ name, className, size }: { name: ThreeDVisual; className: string; size: 'hero' | 'page' }) {
  const source = threeDImages[name];
  return <img className={className} src={source.large}
    srcSet={`${source.small} 128w, ${source.medium} 256w, ${source.large} 512w`}
    sizes={size === 'hero' ? '(max-width: 900px) 300px, 500px' : '96px'} alt="" aria-hidden="true" />;
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

export function PageArt({ kind }: { kind: PageVisual }) {
  return <ThreeDImage name={kind} className="page-header-art" size="page" />;
}

export function GroupArt({ kind }: { kind: GroupVisual }) {
  return <img className={`group-art group-art--${kind}`} src={groupImages[kind]} alt="" aria-hidden="true" />;
}
