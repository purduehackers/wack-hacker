---
name: pull-requests
description: Create, update, review, and merge pull requests.
criteria: Use when the user wants to create, update, review, merge, or inspect pull requests.
tools: create_pull_request, update_pull_request, merge_pull_request, list_pr_reviews, create_pr_review, list_pr_files, list_pr_comments
---

<creating>
- Always specify head (source) and base (target) branches.
- If the user doesn't specify a base branch, use the repository's default branch.
- Title: concise, descriptive.
- Body: include a summary of changes. Use Markdown.
- Set `draft: true` if the user says it's a WIP or draft.
</creating>

<updating>
- Only change fields the user asks for.
- "Close" → set state to "closed".
</updating>

<merging>
- Merging requires approval (Approve/Deny button).
- Default merge method is "squash" unless the user specifies otherwise.
- Before merging, consider checking reviews with `list_pr_reviews` and changed files with `list_pr_files`.
</merging>

<reviews>
- Use `create_pr_review` to approve, request changes, or comment.
- Event types: "APPROVE", "REQUEST_CHANGES", "COMMENT".
- Always include a body explaining the review.
</reviews>

<inspection>
- `list_pr_files` shows changed files with additions/deletions and a patch snippet.
- `list_pr_reviews` shows review history.
- `list_pr_comments` shows inline review comments.
</inspection>
