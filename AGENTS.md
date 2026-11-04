# ClaudeSync AI Router

<!-- PGS-ROUTER:BEGIN v1.1 -->

## Boundary

- PGS governs this `AGENTS.md` entry and governed Markdown under `docs/**`.
- `AGENTS.md` is the canonical project router; `CLAUDE.md` must be the exact
  relative symlink `AGENTS.md`.
- `.agents/skills/` is the canonical project skill root; `.claude/skills`
  must be the exact relative symlink `../.agents/skills`.
- Product artifacts outside `docs/**` are not governed docs unless this project explicitly opts them in.
- Read `README.md` when it provides relevant setup, verification, positioning,
  or product context; do not create a duplicate AI-only README.
- `../../docs/reference/execution/current-work.md` is the active-work index; read it
  when the task depends on current priorities or in-flight work.
- This app inherits the MatrixAPPs `engineering-runtime` profile.
- Its selected agents routing file is `../../docs/governance/agents-routing/engineering-runtime-v1.1.md`.

## Policy Discovery

All Markdown under `../../docs/policy/**/*.md`, including subdirectories and any
symlinked shared-rule files, belongs to the discoverable policy index. This is
not a command to load every policy at startup. Read the project-local baseline
and only the shared rules whose task surface actually matches.

## Credentials And Local Environment

Before creating or changing local credentials or environment files, discover the
workspace's shared credential location and read its instructions. When a portfolio
provides a central `<portfolio-root>/.secrets/README.md`, start there and follow the project's existing
adapter. Apply the cloud-access policy if installed; do not infer project-local
secret storage from a missing `.env` file. Read only task-required configuration.

## Skill Availability

An asset manifest or lock records desired state; it does not prove that an
optional skill is installed, host-discoverable, loaded, or invoked. Use a skill
only when its SKILL.md actually exists and can be read. Centrally managed
project links may need the portfolio control plane to materialize them after a
fresh clone; their absence must not hide or replace the portable policy rules.

## Documentation Tasks

For ordinary documentation content edits, read the short
`../../docs/governance/doc-agent-rules.md` and guidance for the changed subject.
Expand detailed rules only for the contract being changed:

- Scope, ownership, directory contracts or host aliases: relevant sections of
  `../../docs/governance/boundary.md` and `../../docs/governance/ssot-v1.1.md`.
- Classification, metadata or lifecycle: `../../docs/governance/doc-types.md`.
- Routing or profile behavior: the selected agents routing file.

Keep project AI development policy in `../../docs/policy/`. Ordinary small tasks do not
require new Spec, Plan, ADR or proof documents. Use existing document roles for
cross-session work, substantial changes and durable decisions.

When creating docs, changing documented truth, or closing a phase, apply the
document-convergence policy if installed by the asset selection. Limit the pass
to affected facts and references; preserve decision rationale and original evidence.

## Verification

Use relevant project checks and the gates required for delivery. Do not reinstall
dependencies or run every expensive test for an ordinary edit. Expand or repeat
checks for related code, input or environment changes, failures or unresolved
questions. Report actual evidence; once acceptance and required gates are met,
stop expanding the task.

## Test Tools
Web: use Playwright tests; explore with `playwright-cli`.
Phone: explore with the `mobile-mcp` server; keep Mobilewright tests in tests/mobile/; run `npx mobilewright test`.
Log each phone-tool use in <HQ-control-plane-on-Mac>/conductor/projects/HQ/mobile-mcp-install-20261104/USAGE.md.

<!-- PGS-ROUTER:END -->

Follow the shared MatrixAPPs rules in [../../AGENTS.md](../../AGENTS.md).

Use synthetic fixtures only for local gates. Real Keychain credentials, account
Refresh/Sync and cloud or local user-data operations require separate authorization.
The shared gate map is `scripts/check-map.json`; `pnpm check:changed` is a
compatibility entry to that same gate. Installed governance packages do not mean
that legacy app documents have been migrated to the governed document schema.
