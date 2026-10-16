# Code scope and short help

## What was verified

This review reads ClaudeSync source and the installed UIKit package only. It does not inspect real sessions, credentials, Claude's installed internals, or another product's private storage.

- `electron/accounts.ts: defaultRoots` prefers `Claude/claude-code-sessions`, then the legacy `Claude/claude-code/sessions` and `Claude/sessions` candidates. Code transcript lookup defaults to `.claude/projects` (or the explicit Code config override). `savedRoots` also allows user-configured roots.
- `src/core/workspace.ts: loadWorkspace` reads the configured root and account/organization scopes; it emits only `local_<uuid>.json` entries. `collectTranscriptIndex` looks for UUID-named JSONL files in the configured projects root. `src/core/record.ts: validateSessionRecord` checks the Code index contract; local records require a CLI session ID and working directory, with a separate existing remote-record branch.
- `src/core/storage.ts: takeWorkspaceSnapshot` stays within that session root, including sibling organization scopes for stale-write protection. Scheduled-task and backlog metadata are snapshots, not additional Chat or Cowork discovery. Unrelated stores outside the configured roots are not traversed.
- `electron/cloud-sessions.ts: readRows` requests only `/v1/code/sessions`; cloud deletion stays under that route. Profile verification identifies the login; it is not a Chat/Cowork history request. No regular web/mobile Chat or Cowork reader, import adapter, or endpoint exists in this app.

Thus the supported scope is **Code sessions**, not regular Claude Chat or Cowork. This is an adapter boundary, not a guarantee that arbitrary files manually placed into a custom root can be authenticated to a particular product. The UI does not claim that every record was manually started in Desktop: scheduled runs, imported copies and linked cloud Code sessions can also appear. No new claim about Cowork's private format is made. `src/core/scope.test.ts` uses only synthetic unrelated sibling stores to guard the traversal boundary, without inventing a native Cowork fixture.

## Wording and interaction

`src/term-copy.ts` holds nine short explanations in Chinese, English, Japanese, Spanish and Brazilian Portuguese. Each is at most two sentences. `Code sessions` names the product; `regular sessions` names the main subgroup. Old-organization copies do not prove that a user moved organizations, and an unverified binding blocks sync destinations, not every explicit local cleanup operation. The two tips say exactly that.

`src/renderer/TermTip.tsx` uses UIKit **GameHelpTip**, not a new tooltip implementation. Its installed contract is `@pieai/swimmer-ui-kit@3.2.1/dist/index.d.ts:750-761`; implementation is `dist/index.js:224-303`. It supplies a native non-submitting button, localized accessible name, focus/click/hover, Escape dismissal and floating placement.

Account checkboxes, account navigation buttons, disclosure summaries and help buttons are separate controls. Right-hand tips stay visible when their group is collapsed. Required write-blocking messages and destructive confirmations stay visible; optional long explanations are replaced by tips. Synthetic UI smoke checks keyboard/click behavior, unchanged selections, hit targets and overflow in all five languages. Screenshots and local delivery receipts live only under ignored `.devspace-reports/`.

The separate, Owner-confirmed old-copy cleanup is documented in [`OLD-ORGANIZATION-CLEANUP.md`](OLD-ORGANIZATION-CLEANUP.md). It does not run as part of account refresh or a tooltip interaction.
