/** Electron adds the IPC channel to errors; keep only the useful explanation. */
export function errorMessage(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/u, '');
}
