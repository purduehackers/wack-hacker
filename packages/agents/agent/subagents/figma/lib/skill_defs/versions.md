---
description: View file version history.
---

## When to use

Use when the user asks about file history, past versions, or who last edited a file.

## Relevant tools

`list_versions`

## Instructions

- list_versions returns the version history with IDs, labels, descriptions, timestamps, and the user who created each version.
- Named versions (user-saved checkpoints) have a label and description.
- Auto-save versions may have no label.
- Results are paginated — use pagination params for files with long histories.
