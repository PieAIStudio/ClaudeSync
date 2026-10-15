# Contributing

Use Node 24, the pnpm version in `package.json`, and the locked brand-kit packages.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

Keep dependencies one-way: renderer → typed preload API → application service → core plan → filesystem transaction. Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing a write operation. Do not duplicate sync rules in React or restore a parallel Python/Tk/browser runtime.

Non-delete local writes need a concrete preview, selected account/session scope, process and snapshot guards, a byte-preserving backup and recovery verification. Local deletion instead needs a short state-aware confirmation, frozen scope/revision, process/snapshot/shared-history guards and verification; it must not create a deletion backup or recovery path. Cloud deletion needs verified current identity, fresh selected-state checks, single-use selection, per-request login/expiry checks and independent readback without retries. Test deletions with temporary fixtures or mocks only; never exercise destructive operations on real Claude data during development. UI changes need an actual local window check.

Do not commit personal settings, identity maps, transcripts, reports, backups or real-data screenshots. Ordinary pushes save code only. CI runs through manual workflow dispatch. Public release, signing and other-platform installers require separate authorization and acceptance.
