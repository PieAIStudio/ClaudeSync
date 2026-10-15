# ClaudeSync

[中文](README.zh-CN.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Português](README.pt-BR.md)

ClaudeSync shows and organizes local Claude Code sessions across accounts and the current login’s cloud Code history on one computer. **Role:** free, self-use first. **Stack:** TypeScript + React + Electron, SwimmerUIKit and SwimmerI18nKit. **Status:** v2 local preview, not publicly released; public v1 installers remain on [GitHub Releases](https://github.com/PieAIStudio/ClaudeSync/releases).

## Use

1. Open `ClaudeSync.app`, or run the source launcher for your platform. Refresh.
2. Check the accounts to include. Click an account to see its sessions, or view the deduplicated union.
3. Search, filter and select sessions. Sync, archive and other local changes have a review. **Delete selected sessions** opens a short confirmation with the account, count and state-specific advice; deletion has no preview plan, backup or undo.
4. Save work and fully quit Claude and Claude Code before changing local files. Viewing one account restricts deletion to that account. Use **Cloud sessions** for the current Desktop login’s cloud history; cloud deletion does not require quitting Claude.

To keep the same ten sessions in each account, select those ten and choose **Keep only selected in each account**. Selected sessions are added where missing and unarchived; the rest are archived. Missing transcripts or blocked destinations stop the operation before any other sessions are archived. **Select 10 recent syncable sessions** changes the selection only.

Active remote or scheduled records also block exact keep-only. Handle those tasks in Claude first, then organize the local sessions.

## Actions

- Sync selected sessions; review differing titles before choosing a shared title.
- Archive or unarchive; rename one session across included accounts; star or unstar.
- Delete selected local sessions, their configured old copies in the same login, and exclusive main JSONL transcripts; retain content claimed by other sessions/accounts and leave project/worktree files alone. No deletion backup or recovery.
- Select and delete verified, idle Remote Control cloud Code records, including archived Wakeup history, through the same session DELETE endpoint used by the installed Desktop.
- Preview/restore backups from other local operations. Later edits block restoration.

Search includes alternate titles, projects and IDs. Filters include active, archived, syncable, blocked and starred sessions. Hidden selections still participate; the interface warns about them.

Removal stops if another session or an unconfigured sibling folder still claims the entry ID; archive it instead.

## Counts and identity

Counts represent distinct sessions, deduplicated by `cliSessionId`. Accounts with a verified organization use the organization UUID confirmed by the profile response; old organization copies cannot override current archive state. Both local and cloud profile checks remember the verified organization locally with the email. Older email-only bindings need one fresh check while that account is logged in to confirm its organization. Accounts without a verified organization retain their saved local scope view; those counts are not proof of the current Desktop list. Each session lists its accounts, titles, copies and reasons it cannot be synced.

On macOS, refresh confirms the **Claude Desktop** account and email with one read-only request to Anthropic's profile service using Desktop's existing profile-only credential. It reads Claude Safe Storage through Keychain, keeps credentials in memory, and never refreshes or stores them. The verified current account's local folders are added to ClaudeSync's configuration with a configuration backup. Account participation choices are retained. CLI login metadata can identify a historical account but never establishes Desktop's current login. Emails are remembered only on this computer; unidentified accounts keep stable short IDs. No guessing or manual email entry.

Local session scanning and management still work offline. If verification fails or the account changes during a check, no old account is marked current. Automatic Desktop identity verification on Windows/Linux remains unsupported. This optional first-party identity request is a maintenance exception to the default offline-only small-tool stack; there is no backend, inference request, telemetry or payment SDK.

The **Local sessions** and **Cloud sessions** views have separate counts and selections. A session can exist in both; do not add their totals. Reading local archive flags does not require quitting Claude. Cloud reads use the current verified account/organization and an existing unexpired Code sessions credential; only metadata needed for the list reaches the renderer. The first 100 returned records are displayed; a warning explains when that limit is reached.

## Safety and boundaries

Local deletion permanently removes selected local records and their same-login configured copies, updates archive hints and native deletion markers, and unlinks exclusive main JSONL transcripts. Every login folder under the configured session root is checked for shared history before transcript removal, including accounts omitted from settings. Shared content, project/worktree files and auxiliary CLI files stay untouched. Removing an entry whose own ID is still claimed by another chat or unconfigured sibling stops before writing. Deletion creates no backup, journal, trash copy or restore token. An interrupted deletion reports partial completion and cannot be undone by ClaudeSync. Older backups from other operations are not purged.

Other local changes still use review tokens, original-byte backups, atomic writes and guarded recovery. All local writes require stopped Claude/Code processes, unchanged settings, transcript fingerprints, file inventory and index snapshots, an exclusive lock and final verification.

Cloud deletion affects only the selected session IDs in the verified current account/organization. A fresh read checks their state, each request rechecks local login/expiry, deletion stops on the first failure, and readback reports confirmed completion. Unknown outcomes are not retried. Running records, linked/template records and unknown cloud formats cannot be deleted here. The app does not call task-trigger/settings endpoints, enroll devices, refresh OAuth, or modify Claude’s local database for cloud actions. These internal endpoints/formats are version-sensitive. Live reads were verified; real user cloud deletion has not been performed for acceptance.

Settings, identity/organization cache and backups from non-delete operations live in the OS ClaudeSync application-data directory. Credentials stay in main-process memory and never enter IPC, logs or backups. Core local management works offline; optional first-party profile/cloud requests are a documented maintenance exception to the small-tool default. There is no backend, inference request, telemetry or payment SDK. Never attach private state, reports or real-session screenshots to public issues.

## Development

Use Node 24 and the locked pnpm version. For a fresh checkout, run `pnpm install --frozen-lockfile`.

```sh
pnpm dev
pnpm typecheck
pnpm test
pnpm build
pnpm package:mac:dir
```

The default development entry is Electron. Tests use temporary synthetic data only. Development builds accept `CLAUDESYNC_DATA_DIR` for an isolated application-data directory; packaged builds ignore it.

The local package is an unsigned Apple silicon `.app`. Windows, Intel Mac, Linux, signing and notarization still need acceptance. Five interface languages are included. No ads, tracking, payments or automatic background sync. Hosted CI is manual only; pushes do not publish or deploy.

See [ARCHITECTURE.md](ARCHITECTURE.md), [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and the [execution plan](docs/PLAN-TS-CROSSPLATFORM-COMMERCIAL.md). Obsolete Python/Tk/Web code and packagers have been retired from current source; v1 remains in Git history and public releases. Existing local edits were privately snapshotted before cleanup.
