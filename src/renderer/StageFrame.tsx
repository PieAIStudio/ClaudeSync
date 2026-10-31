import { useId, type HTMLAttributes, type ReactNode } from 'react';

export type StageFrameLayout = 'default' | 'centered' | 'split';

export interface StageFrameProps extends Omit<HTMLAttributes<HTMLElement>, 'children' | 'title'> {
  aside?: ReactNode;
  children: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  footer?: ReactNode;
  header?: ReactNode;
  layout?: StageFrameLayout;
  primaryAction?: ReactNode;
  title: ReactNode;
}

/** App-owned page frame after UIKit 4 removed the old quiet-shell PageSurface. */
export function StageFrame({
  aside,
  children,
  className,
  description,
  eyebrow,
  footer,
  header,
  layout = 'default',
  primaryAction,
  title,
  ...props
}: StageFrameProps) {
  const headingId = `claudesync-stage-${useId().replace(/[^a-zA-Z0-9_-]/gu, '')}`;
  return <section {...props} aria-labelledby={headingId} className={['game-ui-page-surface', className].filter(Boolean).join(' ')} data-layout={layout}>
    <header className="game-ui-page-surface-header">
      <div className="game-ui-page-surface-heading">
        {eyebrow ? <span className="game-ui-page-surface-eyebrow">{eyebrow}</span> : null}
        <h1 id={headingId}>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {header ? <div className="game-ui-page-surface-header-slot">{header}</div> : null}
      {primaryAction ? <div className="game-ui-page-surface-primary">{primaryAction}</div> : null}
    </header>
    <div className="game-ui-page-surface-content">
      {aside ? <aside className="game-ui-page-surface-aside">{aside}</aside> : null}
      <div className="game-ui-page-surface-body">{children}</div>
    </div>
    {footer ? <footer className="game-ui-page-surface-footer">{footer}</footer> : null}
  </section>;
}
