import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

let rootOverride: string | undefined;

// This is a launch-time data location, not a test mode or a credential bypass.
export function initializeClaudeRoot(app: { setPath(name: 'home', path: string): void },
  argv: readonly string[] = process.argv, env: NodeJS.ProcessEnv = process.env): string | undefined {
  let option: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg !== '--claude-root' && !arg.startsWith('--claude-root=')) continue;
    if (option !== undefined) throw new Error('Specify --claude-root only once.');
    option = arg === '--claude-root' ? argv[++i] : arg.slice('--claude-root='.length);
    if (!option?.trim() || option.startsWith('--')) throw new Error('Expected a directory after --claude-root.');
  }
  const value = option ?? env.CLAUDESYNC_CLAUDE_ROOT?.trim();
  rootOverride = undefined;
  if (!value) return undefined; // Preserve native home and existing defaults.
  const root = realpathSync(resolve(value));
  if (!lstatSync(root).isDirectory()) throw new Error('Claude root must be an existing directory.');
  app.setPath('home', root);
  rootOverride = root;
  return root;
}

export function claudeRootOverride(): string | undefined { return rootOverride; }

// Explicit profiles must not escape through saved absolute roots or symlinked
// ancestors. Missing leaf directories are fine for first-run suggestions.
export function assertClaudeDataPath(path: string): string {
  if (!rootOverride) return path;
  const inside = (value: string) => {
    const suffix = relative(rootOverride!, value);
    return suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix);
  };
  const absolute = resolve(path);
  if (!inside(absolute)) throw new Error('Claude data path is outside --claude-root.');
  let ancestor = absolute;
  while (!existsSync(ancestor) && ancestor !== rootOverride) ancestor = dirname(ancestor);
  if (realpathSync(ancestor) !== ancestor || !inside(realpathSync(ancestor))) throw new Error('Claude data path has a symlink outside its launch root.');
  return absolute;
}
