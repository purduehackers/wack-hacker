---
name: pull-requests
description: Create, update, review, and merge pull requests.
criteria: Use when the user wants to create, update, review, merge, or inspect pull requests.
tools:
  [
    create_pull_request,
    update_pull_request,
    merge_pull_request,
    list_pr_reviews,
    create_pr_review,
    list_pr_files,
    list_pr_comments,
  ]
minRole: organizer
mode: inline
---

<creating>
- Always specify head (source) and base (target) branches.
- Default base branch is the repo's default branch.
- Set `draft: true` for WIP/draft PRs.
</creating>

<merging>
- Requires approval (Approve/Deny button).
- Default merge method is "squash" unless specified otherwise.
- Consider checking reviews and changed files before merging.
</merging>

<reviews>
- create_pr_review to approve, request changes, or comment.
- Event types: "APPROVE", "REQUEST_CHANGES", "COMMENT".
</reviews>

<inspection>
- list_pr_files shows changed files with additions/deletions and patch snippet.
- list_pr_reviews shows review history.
- list_pr_comments shows inline review comments.
</inspection>
