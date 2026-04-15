---
name: files
description: Inspect file nodes in detail and export design images as PNG/SVG/PDF.
criteria: Use when the user wants to see specific frames or nodes, export design images, or view version history.
tools: [get_file_nodes, export_file_images, list_file_versions]
minRole: organizer
mode: inline
---

<inspecting>
- Use `get_file_metadata` first to find page and frame IDs.
- Node IDs use the format "X:Y" (e.g., "0:1", "123:456").
- Set `depth` to limit how deep children are fetched — use 1 or 2 for an overview.
</inspecting>

<exporting>
- `export_file_images` renders nodes to temporary image URLs (expire after 14 days).
- Format options: `png` (default, best for Discord), `svg` (vector), `jpg` (smaller), `pdf` (print).
- Scale: 1 = original size, 2 = 2x resolution. Max 4. Only applies to png/jpg.
- Export entire pages by using the page's node ID, or individual frames for specific designs.
- Share the image URL directly — it can be embedded in Discord messages.
</exporting>

<versions>
- `list_file_versions` shows who changed what and when.
- Named versions have a `label` field — unnamed versions have an empty label.
</versions>
