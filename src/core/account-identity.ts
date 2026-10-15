// Claude Desktop stores accountUuid first, organizationUuid second.
export function accountIdForScope(scope: string): string {
  return scope.split('/')[0] ?? '';
}
