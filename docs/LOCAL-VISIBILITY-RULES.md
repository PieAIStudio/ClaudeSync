# Local visibility and verified write targets

## Scope and evidence limits

These are the conservative rules approved by the Owner for this repair. They are not a reverse-engineered specification of Claude Desktop. Installed-package inspection was stopped when tooling blocked it; it was not bypassed. This change uses only already-visible ClaudeSync metadata and synthetic fixtures. The Owner must make the final comparison with the four ordinary conversations visible in their Desktop sidebar. No real conversation, account identifier, title, credential, or screenshot is included in this document or the fixture.

## Counting rules and implementation evidence

| Rule | Evidence / implementation location |
| --- | --- |
| Group login accounts by the first scope component, and require a previously verified organization binding. Never infer the current organization from the folder count, timestamps, titles, or an email alone. A binding whose scope is absent from configuration is also unverified. | `src/core/account-identity.ts: accountIdForScope`; `electron/accounts.ts: managedWorkspace`; `src/core/visibility.ts: verifiedOrganization` |
| The main number counts distinct ordinary CLI session identities in the verified current organization: not archived, not a scheduled run, and not covered by a deletion marker. Transcript availability affects sync eligibility, not visibility. | `src/core/catalog.ts: sessionKey, buildCatalog`; `src/core/visibility.ts: entryGroup` |
| Archive state is the JSON `isArchived` flag OR the configured scope's `archived-sessions.idx` membership. Both full local entry IDs and bare entry IDs are accepted. Old scopes cannot override current archive state. | `src/core/workspace.ts: archivedSessions, loadWorkspace`; `src/core/visibility.ts: entryGroup` |
| A nonempty `scheduledTaskId` identifies a scheduled run. Similar titles, daily timestamps, and single-turn length do not. Unknown non-string task-ID formats stop scanning rather than pretending to be ordinary records. | `src/core/record.ts: validateSessionRecord`; `src/core/visibility.ts: entryGroup` |
| Native `deleted_<id>` markers in configured scopes of the same login suppress matching entries and history lineage from the main count. Another login's marker does not hide this login's rows. The existing cross-account anti-resurrection guard remains stricter for copying. | `src/core/visibility.ts: deletionMarkers, hasDeletionMarker`; `src/core/workspace.ts: entryEligibility`; `src/core/planner.ts: buildPlan` |
| Classification precedence per copy is deleted, old organization, scheduled, archived, then ordinary or organization-unverified. Main counts are null, not zero or an estimate, without a usable verified organization. | `src/core/visibility.ts: entryGroup`; `src/core/catalog.ts: buildCatalog` |
| Archive, scheduled-run, old-organization, deletion-marker and unverified groups are separate and initially collapsed. Per-group projection excludes other groups' titles, states and copies before selection. | `src/renderer/session-groups.ts: sessionsInGroup`; `src/renderer/components.tsx: AccountSidebar, CollapsedSessionGroup`; `src/renderer/App.tsx` |

Each group deduplicates by the existing CLI session identity. The same identity may have a current copy and an old-organization copy, so group counts must not be added to infer a distinct-session total. Deletion counts are distinct marker IDs per login; the deletion group lists only surviving indexed records. Cloud counts remain separate. Unsupported scheduled/remote records direct the user to Claude rather than allowing unsafe task edits.

The organization binding is the last successful profile verification remembered locally, not a claim that an offline scan freshly queried Desktop's UI. Switch accounts in Desktop and refresh to establish or update a binding. Email-only identities remain unverified. No new credential-access mechanism was added or invoked for this repair.

## Why old organizations could receive copies

The preserved migration baseline is commit `1e1c7a1`. In that baseline, `electron/accounts.ts: managedWorkspace` kept every configured scope when the identity cache had no organization. `src/core/planner.ts: buildPlan` iterated every configured scope as an independent destination. `src/core/operations.ts: buildOperationPlan` required keep-only coverage in every included folder; its regression test explicitly expected writes into duplicate organization folders.

This is a reproduced mechanism capable of producing the reported old-organization copies. It is not a forensic claim about the exact provenance of individual historical files; those real files were not read.

## Write boundary

`verifiedTargets` requires one usable verified current organization for every included destination login. Sync and keep-only refuse the entire plan if any destination is unknown or missing; they never silently skip the uncertain account. Additions, title changes and keep-only archive changes are constrained to verified current scopes. The transaction boundary independently rejects sync/keep plans that target old scopes.

The full index inventory and old copies remain in stale-input and shared-history protection. Organization bindings are included in the displayed revision and checked again during application. An organization change invalidates an old selection or preview.

Explicit archive, rename, star and deletion actions are scoped to the selected group. A current-group selection does not silently edit an old copy. Sync source paths are also pinned to the selected group: an ineligible archived selection cannot silently borrow a same-ID old copy. Keep-only may unarchive an existing selected-ID counterpart in a verified current target, but never unarchives the old source in place. Shared entry IDs can therefore prevent deletion of just one copy; the app explains the conflict and leaves archive available. Selecting an old copy as a sync source may create a copy in a verified current target, but never writes back into the old organization. Scheduled runs and deletion-marked entries are not editable through these grouped controls.

## Synthetic acceptance

`tests/sidebar-fixture.ts` constructs a new temporary workspace with four current ordinary records, seven scheduled single-turn records, two current archive records (one flag and one index hint), ten old-organization copies (including repeated identities), and one deletion marker with a retained index. `src/core/visibility.test.ts` uses the real filesystem scanner and asserts a main count of **4** and untouched input bytes.

Additional tests cover missing verification, missing configured current scope, malformed scheduling metadata, deletion precedence and lineage, another login's markers, old-copy import, keep-only scope, hidden-copy protection, forged plans and stale organization bindings. `src/renderer/session-groups.test.tsx` checks group projection and collapsed defaults in all five interface languages. Service tests cover binding changes between preview and application.

Only synthetic counts and validation logs are written under ignored `.devspace-reports/`. Final real-sidebar acceptance belongs to the Owner; automated synthetic success is not represented as real-data acceptance. All delivery commits are local only pending review.
