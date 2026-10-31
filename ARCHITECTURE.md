# ClaudeSync maintenance map

ClaudeSync v2 has one TypeScript core and one React/Electron interface. The renderer cannot access files or Node directly. It calls the typed API through a sandboxed preload. The app never switches logins or runs background synchronization. Optional cloud actions use the current verified Desktop login; local and cloud views remain separate.

The preload is bundled as CommonJS `out/preload/index.cjs`, even though the main process uses ES modules. Sandboxed preloads cannot load ESM imports; keep the build format and window preload path consistent. Packaging acceptance must verify real IPC data in the installed window, not just a rendered page or a successful build. See [Electron's preload restrictions](https://www.electronjs.org/docs/latest/tutorial/esm#sandboxed-preload-scripts-cant-use-esm-imports).

## Responsibilities

| Surface | Owner |
| --- | --- |
| Domain records and portable copies | `src/core/types.ts`, `record.ts` |
| Read-only configuration, indexes, archive hints, deletion markers, transcripts | `src/core/workspace.ts` |
| Distinct sessions and login-account counts | `src/core/catalog.ts`, `account-identity.ts` |
| Sync additions and title policy | `src/core/planner.ts`, `title-policy.ts` |
| Proven continuation, fork choice and portable resume updates | `src/core/sync-progress.ts` |
| Selected destructive-operation dependency revisions and named stale errors | `src/core/data-scope.ts` |
| Selected-session management and keep-only planning | `src/core/operations.ts` |
| Snapshot validation, backup journal, commit and recovery | `src/core/transaction.ts` |
| Plain files, path boundaries, atomic write/delete, snapshots, exclusive lock | `src/core/storage.ts` |
| Typed IPC payloads | `src/shared/contracts.ts` |
| OS folders, discovery and verified local email cache | `electron/accounts.ts` |
| Read-only macOS Desktop login verification, Keychain decryption and profile request | `electron/desktop-identity.ts` |
| Claude/CLI and legacy automatic-sync process guards | `electron/processes.ts` |
| Local views, non-delete preview tokens and direct deletion service | `electron/service.ts` |
| Current-account cloud list, selection guard, delete and readback | `electron/cloud-sessions.ts` |
| Window lifecycle, sender checks, CSP, navigation and IPC whitelist | `electron/main.ts`, `preload.ts` |
| UI state, account/sidebar/session views and operation review | `src/renderer/` |
| Product copy in five languages | `src/i18n.ts` |

## Identity and counting

The observed Desktop folder layout is `accountUuid/organizationUuid`. Login accounts group by the first UUID. Desktop and CLI logins are independent: `.claude.json/oauthAccount` can remember a historical UUID/email but never determines the Desktop current-login badge. CLI data only fills previously unknown email bindings; it does not replace a newer verified cached email.

On macOS, `checkDesktopIdentity()` reads Desktop's `lastKnownAccountUuid` and encrypted `oauth:tokenCacheV2`. The existing Claude Safe Storage Keychain item decrypts the observed Chromium `v10` cache format (PBKDF2-SHA1, `saltysalt`, 1003 iterations; AES-128-CBC). Select only a current-account, fixed-origin, unexpired **exact `user:profile`** token. Send one GET to `https://api.anthropic.com/api/oauth/profile`, forbid redirects and set a timeout. Require `account.uuid` and `organization.uuid` to match the chosen cache entry; read `account.email`; check the UUID and encrypted cache before and after the request to reject switching/logout races. No token refresh, OAuth flow, retry or credential persistence. Network, Keychain and format failures return a nonsecret status while local scanning continues. A Keychain prompt has a two-minute human-response budget. Within one app run, concurrent refresh/cloud reads share one in-memory decryption; only whitelisted profile/session token fields survive, never the password, refresh token or raw plaintext. A successful profile verification is reused while Desktop's account/encrypted-cache snapshot is unchanged. Login/cache changes invalidate it; session token expiry is checked separately before use. Windows/Linux decryption is not implemented.

Refresh is asynchronous over the existing typed IPC. It discovers and adds only the verified current Desktop UUID's folders to the existing configuration, backs up original configuration bytes, validates the new workspace and rolls back tool settings if validation fails. Other omitted accounts remain omitted. Existing account participation preferences remain in renderer storage. All raw credentials remain in the main process; only a status and verified email/organization association reach the view/cache. This optional first-party profile lookup is documented as a maintenance exception to the otherwise offline core.

Session rows group by `cliSessionId`, but preserve per-copy group metadata. `managedWorkspace` retains all configured scopes and adds the locally remembered verified organization bindings; it no longer removes old scopes from the catalog. `visibility.ts` classifies copies as deleted, explicitly retired old-organization, scheduled, archived, ordinary or unverified. A verified current organization does not prove another membership ended: other scopes without explicit retirement evidence stay unverified and cannot enter old-copy cleanup. The current profile adapter cannot prove retirement and never creates that evidence; synthetic old-copy scenarios supply it explicitly. Previously observed live organizations are never retired by a login/org switch. Only ordinary records in a usable verified current organization contribute to the main number. Unknown organization means `visible: null`. `session-groups.ts` projects the selected category before displaying titles, state or selections. Full snapshots retain old-scope bytes and deletion claims. `workspaceRevision` includes organization bindings, and the service rechecks them during application. See [the approved rules and evidence limits](docs/LOCAL-VISIBILITY-RULES.md); this is not a claim of completed native-sidebar reverse engineering.

## Local write contract

Non-delete operations retain 15-minute single-use preview tokens, original-byte backups, atomic writes and guarded recovery. Direct deletion takes selected IDs/account IDs and the displayed revision through its own IPC handler. The renderer’s short confirmation freezes the count, account names and active/archived/mixed advice; it does not generate a file preview. Viewing one account restricts deletion to that account; switching account views clears selection.

All local writes validate configuration, path safety and organization bindings, take the tool lock, and verify the result. Selected deletion and old-copy cleanup compare dependency-scoped snapshots and transcript fingerprints. A bounded 15-minute display cache lets the service compare selected data against what the user saw; unrelated index/body changes do not invalidate the selection. The core repeats dependency checks throughout writes. Positively identified unrelated CLI sessions may continue; relevant, ambiguous and Desktop writers remain blocked. Other organizing actions retain complete snapshots and stopped-writer guards. Deletion additionally snapshots all login folders under the configured root, including omitted accounts, and checks transcript inventory and exclusive removal candidates before each step. It creates no backup, manifest, trash copy or restore token. Interrupted deletion reports the completed file-change count and stops. Recovery remains available for other operations; older backups are not automatically removed.

## Management semantics

- Sync filters additions and resume/title changes by selected CLI IDs and verified current targets. `sync-progress.ts` reads a bounded parental graph from the shared JSONL files and advances existing copies only with proven ancestry/history coverage. Timestamps or turn counts alone never authorize overwrite. Unproven/forked states require an exact candidate-path choice, and unresolved conflicts block the entire transaction. Only portable resume fields replace existing destination data; permissions/local state are retained. New copies reset permission-specific fields.
- Archive/unarchive update both `isArchived` and the native `archived-sessions.idx` hint, preserving unrelated IDs and extra fields.
- Keep-only validates coverage in each included login's verified current organization. Selected chats are unarchived/added there; other ordinary chats there are archived. Scheduled runs and old scopes are not touched. Unsupported ordinary remote records still block an exact plan.
- Rename changes title metadata and retains previous titles; unrelated record settings remain intact. Star changes only its flag.
- Group-scoped deletion removes only the selected category's local records, updates archive hints and creates native deletion markers. It does not silently expand into hidden old copies; a shared entry ID may therefore block deletion and require archive instead. Exclusive main JSONL bodies are unlinked without copying their bytes. Shared bodies and project/worktree/auxiliary CLI files are retained. Same-login unconfigured sibling claims still protect shared stems. An explicit old-copy deletion with a verified current counterpart may remove the old index without tombstoning any shared ID; distinct shared history IDs also never receive markers.
- Explicit selected sync rechecks all eligibility guards except deletion notes, including body availability, then removes only relevant notes in participating accounts for versions actually present after the plan. Newly inspected bodies are carried into commit guards. Old-scope note removals have an internal constrained allowlist at the target boundary. Bulk keep-only retains cross-account anti-resurrection protection. Deleted indexes/bodies have no deletion backup; restoring from another surviving copy is a new selected sync, not undo.

Local management is record/transcript editing, not native worktree cleanup. Internal Desktop formats are version-sensitive: unknown entries are skipped, left untouched and reported by relative path under **Needs attention**. They are never read as sync inputs or traversed through links. Invalid known indexes are also skipped rather than guessed. Unsafe actual write targets and changed relevant transcripts still stop the affected operation before writing. General transcript checks use bounded first/last-line validation and fingerprints. Progress reconciliation additionally parses at most 64 MiB of relevant shared JSONL ancestry; absent, malformed, oversized or contradictory evidence requires an explicit version choice.

Claude Desktop owns `accountUuid/organizationUuid/backlog/tasks.json` and `waiting-input/`. Snapshot empty plain directories and supported regular-file bytes without adding chat rows, counts or write actions: backlog accepts `tasks.json` up to 32 MiB; waiting-input accepts first-level regular files up to the normal 10 MiB limit. Neither known store produces a warning. Unknown backlog members, nested directories, symlinks and special/unreadable/oversized files are skipped and reported without recursion. Changes to retained auxiliary bytes invalidate whole-workspace organizing previews; dependency-scoped operations ignore unrelated auxiliary bytes. Skipped entries are excluded from snapshot comparisons, so unrelated unknown content does not stop known-chat operations. All actual write paths are restricted to managed native index/marker names, with plain-parent and occupied-target checks. Local deletion retains transcript bodies whenever skipped stores might hide shared references; it never guesses exclusive ownership.

## Cloud adapter

`cloud-sessions.ts` uses the installed Desktop’s observed first-party `/v1/code/sessions` list/DELETE routes, with fixed origin, current organization header, no redirects and timeouts. The identity read still uses profile-only scope; a separate main-process credential selector accepts the existing sessions scope for the verified account/organization. No credential reaches the renderer. GET returns only whitelisted metadata; up to 100 loaded records are shown with an explicit limit warning. Cloud counts/selections remain separate from local ones.

A list revision is a bounded, expiring, opaque selection handle, not a credential. Deletion consumes it once, verifies identity again, compares selected metadata with a fresh read, checks login/cache/expiry on every request and stops at the first failure. Only observed idle `bridge` records without relations or trigger/schedule tags are deletable. Requests never target schedule settings, register a device or refresh OAuth. Independent list readback reports confirmed outcomes, including partial/uncertain results, without automatic DELETE retries. A read failure clears stale cloud selection. React StrictMode reuses the initial read promise so its effect replay does not discard the loaded list or make a duplicate request.

Cloud deletion does not mutate the local Desktop database. Real cloud reads were verified; real user DELETE requests were not executed for acceptance. Internal formats and routes remain version-sensitive.

## Verification and delivery

`pnpm typecheck`, `pnpm test`, `pnpm build`; then open the packaged local app and inspect it. Synthetic fixture tests cover selected sync, ten-session alignment across three accounts, duplicate scopes, archive hints, exclusions, tombstones/shared lineage, atomic recovery, stale inputs, symlinks and process classification. The frozen v1 fixture oracle preserves the migration baseline without retaining a second runtime.

No user configuration, reports, backups or real session screenshots belong in source control. New receipts and screenshots stay in ignored `.reports/YYYY-MM-DD-task/`; existing historical `docs/evidence` is left in place. The old Python runtime, Tk/web views, packagers and obsolete UI images were removed after a private source snapshot; they remain recoverable through Git history. Only one local `.app` is the default entry.

Packaging currently covers a local unsigned Apple silicon app. Other platform packages and signed releases remain separate acceptance work; hosted CI is manual and never triggered by ordinary pushes.

Use a separate `CLAUDESYNC_DATA_DIR` for development when a packaged app is installed. A leftover development process held the shared Chromium Local Storage lock during acceptance: preferences survived reloads but disappeared on restart in the packaged app. Closing that process restored persistence. Check the running processes and data-directory owner before diagnosing preference code or clearing user state.
