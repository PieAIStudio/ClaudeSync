# Old organization Code-session copy cleanup

This operation is opt-in and never runs during refresh, startup, build or release.
No Owner account data was read during its development.

## Inspect, then confirm
- Require a verified current organization and compare every old index `cliSessionId`
  with that organization's own Code sessions (`src/core/old-organization.ts`).
- Review each source: is there a current copy, and what will happen to it?
  Counts are shown before a second, explicit confirmation.
- Current counterpart exists: move the old index into macOS Trash.
- No current counterpart: first restore one portable index ARCHIVED in the
  current organization, then move all old sources for that session into Trash.
  Existing JSONL transcripts and project files are neither deleted nor copied.
- Imported archived sessions can later be unarchived or deleted by the Owner;
  the main ordinary number must remain unchanged.

## Safety and readback
- Unknown current organization, unconfigured old folders, deletion marks,
  scheduled/remote structures, missing transcripts, and destination collisions
  fail closed before any file is moved.
- A 15-minute single-use token, stopped Claude/Code writers, an exclusive lock,
  unchanged identity/config/index/transcript snapshots, and path guards apply.
- Execution uses Electron `shell.trashItem`, never permanent deletion;
  Finder Trash is the recovery method. Partial results stop without retry.
- After execution the complete workspace is rescanned: ordinary main count
  must be identical and all selected-account old JSON copies must be gone.

## Synthetic-only acceptance
The temporary fixture has 4 visible, 2 archived, 7 scheduled, 10 old copies
and 1 deletion mark. Four old copies already have current counterparts; six
return archived. A fake Trash directory replaces Electron's native Trash in
tests. No live session, credential or Owner Trash was accessed during testing.
