---
name: files
description: Read, write, edit, and list files in the sandbox working tree
criteria: Use when you need to inspect file contents, create a new file, modify an existing file, or list the contents of a directory
tools: [read, write, edit, list_dir]
minRole: admin
mode: inline
---

<reading>
- `read` returns line-numbered content; use `offset` + `limit` for large files instead of reading the whole thing.
- Always `read` a file before `edit`ing it in the same turn. Targeting `old_string` correctly depends on seeing actual bytes.
- `list_dir` shows immediate children only — prefer `glob` for recursive discovery.
</reading>

<editing>
- `edit` does exact string replacement. `old_string` MUST be unique in the file unless you pass `replace_all: true`.
- If an edit fails with "appears N times", either expand `old_string` with more surrounding context to make it unique, or pass `replace_all`.
- Prefer multiple small `edit`s over a single sweeping rewrite — failures are easier to localize.
</editing>

<writing>
- `write` is for creating new files or full rewrites. It WILL overwrite. When editing an existing file, prefer `edit`.
- Paths outside the repo directory are refused. Use repo-relative paths (`src/foo.ts`) or absolute paths rooted at the working directory.
- `write` creates missing parent directories automatically.
</writing>
