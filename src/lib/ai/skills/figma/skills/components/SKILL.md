---
name: components
description: Browse published components, component sets, and styles across the team and files.
criteria: Use when the user asks about design system components, component variants, published styles, colors, or text styles.
tools:
  [
    list_team_components,
    list_file_components,
    get_component,
    list_team_component_sets,
    get_component_set,
    list_team_styles,
    list_file_styles,
    get_style,
  ]
minRole: organizer
mode: inline
---

<components>
- list_team_components returns all published components across the team. Paginated.
- list_file_components scopes to a single file.
- get_component returns full metadata: name, description, containing file, thumbnail URL.
- Component sets group variants of a single component (e.g., Button with Primary/Secondary variants).
</components>

<styles>
- list_team_styles returns published color, text, effect, and grid styles.
- list_file_styles scopes to a single file.
- get_style returns summarized style metadata (key, name, description, style type).
- Style types: FILL, TEXT, EFFECT, GRID.
</styles>
