---
name: contents
description: Read and write file contents; browse directory trees; view commit history and diffs.
criteria: Use when the user wants to read files, browse code, edit files, view commits, or compare branches.
tools: get_file_content, create_or_update_file, delete_file, get_directory_tree, list_commits, get_commit, compare_commits
---

<reading>
- `get_file_content` returns decoded file content or directory listing.
- For large files (>50KB), content is truncated with a note.
- Use `ref` parameter to read from a specific branch/tag/SHA.
- `get_directory_tree` returns the full recursive tree — useful for understanding repo structure.
</reading>

<writing>
- `create_or_update_file` creates a new file or updates an existing one.
- Content is provided as plain text (auto-encoded to base64).
- For updates, you MUST provide the `sha` of the existing file. Get it via `get_file_content` first.
- Always provide a clear, descriptive commit message.
- Specify `branch` to commit to a non-default branch.
</writing>

<deleting>
- File deletion requires approval and the file's SHA.
- Get the SHA via `get_file_content` before deleting.
</deleting>

<commits>
- `list_commits` supports filtering by path, date range, and branch.
- `get_commit` shows full details including changed files.
- `compare_commits` compares two branches/tags/SHAs and shows the diff summary.
</commits>
