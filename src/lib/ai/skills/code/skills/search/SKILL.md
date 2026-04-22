---
name: search
description: Search the repository by file contents (grep) or file names (glob)
criteria: Use when you need to locate code by a pattern, find all files matching a glob, or gather quick discovery context before editing
tools: [grep, glob]
minRole: admin
mode: inline
---

<grep>
- Runs ripgrep with structured JSON output. Regex is supported.
- Narrow with the `glob` parameter — e.g. `{"pattern": "foo", "glob": "**/*.ts"}` — to skip unrelated files.
- Use `case_insensitive: true` for fuzzy name searches.
- Exit code 1 (no matches) is NOT an error — the tool returns `match_count: 0` and an empty list.
</grep>

<glob>
- Returns file paths matching a glob relative to the repo root.
- Fast for "where is X?" questions (`"pattern": "**/*.md"`, `"pattern": "**/package.json"`).
- Paired with `read`, this is the canonical discovery flow. Prefer over bash `find` / `ls` recursion.
</glob>

<when-to-use-each>
- Reaching for `grep`? You're looking at file **contents**.
- Reaching for `glob`? You're looking at file **names** / locations.
- Use both in parallel (same turn) when planning edits for a large change.
</when-to-use-each>
