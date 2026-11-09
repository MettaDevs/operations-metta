---
name: code-formatting
description: Format and verify source code with the repository's existing formatter (`bun run format` / `bun run format:check`, Prettier with `.prettierrc`) when changing code or addressing formatting drift. Do not use for investigations that do not change code.
---

# Code formatting

Keep formatting mechanical and separate from behavior changes. Do not hand-compress JSX, TypeScript, SQL, or another supported language to reduce line count; run the project's formatter after editing.

## Discover the project workflow

- Before formatting, inspect the active project's scripts and formatter configuration. Use its existing tool and rules; do not override editor settings or add a second formatter.
- Use a check-only command for audits. Run a writing formatter only when the user has authorized the affected files.
- In this repository the formatter is Prettier, configured in `.prettierrc`: `bun run format:check` checks and `bun run format` writes. Both cover `src`, `modules`, `scripts`, `test`, `.github`, `package.json`, and `tsconfig.json` only; Markdown, SQL migrations, `parity/`, and `.agents/` are outside them. `.vscode/` settings format TypeScript, JSON, and YAML with the same Prettier configuration.

## Verify the result

- Run the formatter check after writing.
- Review the diff. A formatting-only task must not change identifiers, conditions, strings, component structure, or imports except where the formatter itself makes a mechanical adjustment.
- Exclude generated files and dependency directories such as `node_modules/`, `dist/`, caches, build outputs, and runtime storage.
- Run the smallest relevant compile, lint, or test command for the modified source (`bun run typecheck`, `bun test <path>`).

## Scope and approval

- Adding or replacing a formatter, changing its rules, widening the folders it covers, or reformatting unrelated files changes project policy and needs explicit user approval.
- Preserve user edits. If formatter output overlaps unrelated changes, stop and ask before continuing.
