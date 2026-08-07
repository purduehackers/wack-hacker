---
name: nodes
description: Inspect specific nodes within a file and export images.
criteria: Use when the user wants to inspect specific frames, components, or layers, or export designs as images.
tools: [get_file_nodes, get_images, get_image_fills]
minRole: organizer
mode: inline
---

<inspecting>
- Use get_file first (base tool) with depth=1 to see top-level pages.
- Then use get_file_nodes with specific node IDs to drill into frames/components.
- Node IDs look like "1:2" or "123:456" — they come from get_file results.
</inspecting>

<exporting>
- get_images exports nodes as PNG (default), SVG, JPG, or PDF.
- Pass scale (1–4) for raster formats to control resolution.
- Returns temporary download URLs (valid ~14 days).
- get_image_fills returns URLs for all images used as fills (photos, textures, etc.).
</exporting>
