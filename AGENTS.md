# Agent Configuration

## Agent skills

### Issue tracker

Issues are tracked on GitHub. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage labels with default names. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Development conventions

### Lint before commit

After any code modification, run `bun run lint` and fix all reported issues. Do not commit code with unresolved lint errors.
