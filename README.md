# ClaudeSync

[中文](README.zh-CN.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Português](README.pt-BR.md)

ClaudeSync shows and organizes local Claude Code sessions across accounts and the current login’s cloud Code history on one computer. **Role:** free, self-use first. **Stack:** TypeScript + React + Electron, SwimmerUIKit and SwimmerI18nKit. **Status:** v2 local preview, not publicly released; public v1 installers remain on [GitHub Releases](https://github.com/PieAIStudio/ClaudeSync/releases).

## Use

1. Open `ClaudeSync.app`, or run the source launcher for your platform. Refresh.
2. Check the accounts to include. Click an account to see its sessions, or view the deduplicated union.
3. Search, filter and select sessions. Sync, archive and other local changes have a review. **Delete selected sessions** opens a short confirmation with the account, count and state-specific advice; deletion has no preview plan, backup or undo.
4. Save work before changing local files. Sync and other organizing actions require quitting Claude/Code. Selected deletion and old-copy cleanup allow positively identified unrelated CLI sessions; relevant or unidentifiable writers and Desktop must be closed as directed. Viewing one account restricts deletion to that account. Use **Cloud sessions** for the current Desktop login’s cloud history; cloud deletion does not require quitting Claude.

To keep the same ten sessions in each account, select those ten and choose **Keep only selected in each account**. Selected sessions are added where missing and unarchived; the rest are archived. Missing transcripts or blocked destinations stop the operation before any other sessions are archived. **Select 10 recent syncable sessions** changes the selection only.

Keep-only organizes ordinary chats in verified current organizations; scheduled-run and old-organization groups are left alone. Unsupported remote records in the ordinary list still block exact keep-only. Handle linked tasks in Claude.

## Actions

- Sync selected sessions, including copies already present. The review shows the source, target and known turn difference. Proven continuations advance resume state; forks or uncertain ancestry require choosing a version. Shared transcript bytes and destination permissions stay intact. Explicit sync can bring a deleted session back from a surviving copy; relevant native deletion notes in included accounts are removed in the reviewed transaction. Bulk keep-only retains anti-resurrection protection.
- Archive or unarchive; rename one session across included accounts; star or unstar.
- Delete selected local sessions within the selected group and exclusive main JSONL transcripts; do not silently delete hidden old copies. Shared entry IDs can block partial-copy deletion; use archive instead. Other claimed content and project/worktree files stay untouched. No deletion backup or recovery.
- Select and delete verified, idle Remote Control cloud Code records, including archived Wakeup history, through the same session DELETE endpoint used by the installed Desktop.
- Preview/restore backups from other local operations. Later edits block restoration.

Search includes alternate titles, projects and IDs. Filters include active, archived, syncable, blocked and starred sessions. Hidden selections still participate; the interface warns about them.

Removal normally stops if another session or an unconfigured sibling folder still claims the entry ID. Explicitly deleting an old-organization copy with a verified current counterpart removes only the old index, retaining the counterpart and shared history without a shared-ID deletion note. **Clean old organization copies** is the safer alternative: unique old sessions return archived before old indexes go to Trash.

## Counts and identity

The main account number is the distinct ordinary-session count in its verified current organization: exclude archived records, scheduled task runs and deletion-marked records. Without a usable verified organization, the number says **Unverified**, never an estimated count. Archive, scheduled runs, old-organization copies, deleted sessions with surviving copies and unverified records remain separately inspectable in initially collapsed groups. Each group deduplicates by `cliSessionId`; one identity may have copies in several groups, so do not add group counts into a distinct-session total. Sync and keep-only require a verified current destination for every included account. See [local visibility rules and evidence limits](docs/LOCAL-VISIBILITY-RULES.md).

On macOS, refresh confirms the **Claude Desktop** account and email with one read-only request to Anthropic's profile service using Desktop's existing profile-only credential. It reads Claude Safe Storage through Keychain, keeps credentials in memory, and never refreshes or stores them. The verified current account's local folders are added to ClaudeSync's configuration with a configuration backup. Account participation choices are retained. CLI login metadata can identify a historical account but never establishes Desktop's current login. Emails are remembered only on this computer; unidentified accounts keep stable short IDs. No guessing or manual email entry.

Local session scanning and management still work offline. If verification fails or the account changes during a check, no old account is marked current. Automatic Desktop identity verification on Windows/Linux remains unsupported. This optional first-party identity request is a maintenance exception to the default offline-only small-tool stack; there is no backend, inference request, telemetry or payment SDK.

The **Local sessions** and **Cloud sessions** views have separate counts and selections. A session can exist in both; do not add their totals. Reading local archive flags does not require quitting Claude. Cloud reads use the current verified account/organization and an existing unexpired Code sessions credential; only metadata needed for the list reaches the renderer. The first 100 returned records are displayed; a warning explains when that limit is reached.

## Safety and boundaries

Local deletion permanently removes selected local records within the confirmed group, updates archive hints and native deletion markers, and unlinks exclusive main JSONL transcripts. Every login folder under the configured session root is checked for shared history before transcript removal, including accounts omitted from settings. Shared content, project/worktree files and auxiliary CLI files stay untouched. Shared entry-ID protection remains, except for the explicit old-copy/current-counterpart case described above. Deletion creates no backup, journal, trash copy or restore token. An interrupted deletion reports partial completion and cannot be undone by ClaudeSync. Older backups from other operations are not purged.

Other local changes still use review tokens, original-byte backups, atomic writes and guarded recovery. Selected deletion and old-copy cleanup validate the relevant indexes, archive files, shared-history claims and transcript fingerprints instead of rejecting unrelated activity. Unknown local entries are skipped, left untouched and listed by path under **Needs attention**; known Desktop `backlog` and `waiting-input` stores are kept without warnings and never managed. If unknown entries may hide shared references, local deletion keeps transcript bodies. Unsafe actual write targets, new known shared claims, organization/configuration changes and relevant writers still stop the affected operation. Other local actions retain whole-workspace guards. All writes use an exclusive lock and final verification.

Cloud deletion affects only the selected session IDs in the verified current account/organization. A fresh read checks their state, each request rechecks local login/expiry, deletion stops on the first failure, and readback reports confirmed completion. Unknown outcomes are not retried. Running records, linked/template records and unknown cloud formats cannot be deleted here. The app does not call task-trigger/settings endpoints, enroll devices, refresh OAuth, or modify Claude’s local database for cloud actions. These internal endpoints/formats are version-sensitive. Live reads were verified; real user cloud deletion has not been performed for acceptance.

Settings, identity/organization cache and backups from non-delete operations live in the OS ClaudeSync application-data directory. Credentials stay in main-process memory and never enter IPC, logs or backups. Core local management works offline; optional first-party profile/cloud requests are a documented maintenance exception to the small-tool default. There is no backend, inference request, telemetry or payment SDK. Never attach private state, reports or real-session screenshots to public issues.

## Materials

The UIKit 4.0 preview uses the six local PNGs copied byte-for-byte from the approved synthetic `MatrixAPPs/design/claudesync-v2.7/assets/` set: two relay states and four result-group marks. They contain no real account or chat data and are bundled locally; no remote image request is made.

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

After building, `CLAUDESYNC_UI_SCENARIO=skipped-entries node tests/ui-smoke.cjs` checks non-blocking notices and unchanged opaque entries through sync/archive, with evidence under ignored `.reports/2026-10-21-waiting-input/`.

`node tests/ui-smoke.cjs` exercises the three repair paths in the real Electron renderer/preload/IPC/core, including both old-copy actions. It creates its own synthetic home and accounts, blocks network and external commands, and substitutes a fixture-only process list and Trash. Screenshots and receipts go to ignored `.reports/2026-10-18-claudesync-fixes/`; it never accepts a user data directory. This is not native Desktop or real-account acceptance.

The local package is an unsigned Apple silicon `.app`. Windows, Intel Mac, Linux, signing and notarization still need acceptance. Five interface languages are included. The current build has no ads, tracking, payments or automatic background sync. Hosted CI is manual only; pushes do not publish or deploy.

See [ARCHITECTURE.md](ARCHITECTURE.md), [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and the [execution plan](docs/PLAN-TS-CROSSPLATFORM-COMMERCIAL.md). Obsolete Python/Tk/Web code and packagers have been retired from current source; v1 remains in Git history and public releases. Existing local edits were privately snapshotted before cleanup.
