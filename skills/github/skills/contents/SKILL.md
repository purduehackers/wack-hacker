---
name: contents
description: Read and write file contents; browse directory trees; view commits and diffs.
criteria: Use when the user wants to read files, browse code, edit files, view commits, or compare branches.
tools:
  [
    get_file_content,
    create_or_update_file,
    delete_file,
    get_directory_tree,
    list_commits,
    get_commit,
    compare_commits,
  ]
minRole: organizer
mode: inline
---

<reading>
- get_file_content returns decoded content. For large files (>50KB), content is truncated.
- Use ref parameter to read from a specific branch/tag/SHA.
- get_directory_tree returns the full recursive tree.
</reading>

<writing>
- For updates, you MUST provide the sha of the existing file. Get it via get_file_content first.
- Always provide a clear, descriptive commit message.
- Specify branch to commit to a non-default branch.
</writing>

<deleting>
- File deletion requires approval and the file's SHA.
</deleting>

<commits>
- list_commits supports filtering by path, date range, and branch.
- compare_commits compares two branches/tags/SHAs and shows the diff summary.
</commits>
