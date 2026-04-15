---
name: components
description: Browse components and styles in files and the team design library.
criteria: Use when the user asks about design components, styles, colors, typography, or the design system.
tools: [list_file_components, list_team_components, list_file_styles, list_team_styles]
minRole: organizer
mode: inline
---

<components>
- File-level: `list_file_components` shows components defined in a specific file.
- Team-level: `list_team_components` shows published components shared across all team files.
- Each component has a `key` (unique identifier), `name`, and optional `description`.
</components>

<styles>
- File-level: `list_file_styles` shows styles in a specific file.
- Team-level: `list_team_styles` shows published styles shared across the team.
- Style types: FILL (colors), TEXT (typography), EFFECT (shadows, blurs), GRID (layout grids).
</styles>
