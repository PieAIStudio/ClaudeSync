// Never copy messages, causes, function names, filenames, paths or URLs.
export function anonymousError(value: unknown): Error {
  const error = new Error('Application error');
  const stack = value && typeof value === 'object' && 'stack' in value ? value.stack : undefined;
  const locations = typeof stack === 'string' ? stack.split('\n').slice(1, 21).flatMap((line) => {
    const match = /:(\d+):(\d+)\)?\s*$/.exec(line);
    return match ? [`    at app (app:${match[1]}:${match[2]})`] : [];
  }) : [];
  error.stack = ['Error: Application error', ...locations].join('\n');
  return error;
}
