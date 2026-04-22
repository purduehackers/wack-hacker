---
name: reactions
description: Add or remove reaction emojis on issues and issue/PR comments.
criteria: Use when the user wants to react to an issue or comment with an emoji, or remove a reaction.
tools: [add_issue_reaction, remove_issue_reaction, add_comment_reaction, remove_comment_reaction]
minRole: organizer
mode: inline
---

- Supported reactions: +1, -1, laugh, confused, heart, hooray, rocket, eyes.
- add_issue_reaction and add_comment_reaction return a reaction_id; save it to remove the reaction later.
- Remove calls require the reaction_id (the one returned when adding).
