# Project Conventions

## Git branch naming

Use lowercase English branch names in this format:

```text
<type>/<short-kebab-description>
```

Allowed branch types:

- `feature/` — new functionality or meaningful UI behavior
- `fix/` — bug fixes
- `content/` — resume, publication, copywriting, image, or portfolio content updates
- `style/` — visual-only CSS/layout refinements
- `refactor/` — code restructuring without behavior changes
- `docs/` — documentation changes
- `chore/` — tooling, config, generated-file cleanup, or maintenance
- `hotfix/` — urgent fixes meant to be merged quickly

Rules:

- Use lowercase letters, numbers, and hyphens only after the slash.
- Keep names concise but specific.
- Do not use spaces, underscores, Chinese characters, dates, or vague names like `test`, `update`, or `temp`.
- Prefer examples like `content/accepted-paper-status`, `style/mobile-journey-layout`, or `fix/music-player-progress`.

## Git workflow

Default workflow for version iteration:

1. Keep `main` stable.
2. Create a dedicated branch before making changes.
3. Commit related changes on that branch.
4. Push the branch to GitHub.
5. Merge back into `main` after review or confirmation.
