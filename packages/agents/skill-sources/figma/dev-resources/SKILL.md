---
name: dev-resources
description: Manage dev resource links attached to design nodes.
criteria: Use when the user asks about dev links, code links, documentation links, or annotations on design nodes.
tools: [list_dev_resources, create_dev_resources, update_dev_resource, delete_dev_resource]
minRole: organizer
mode: inline
---

<listing>
- list_dev_resources returns links (URLs, names) attached to specific nodes in a file.
- Filter by node_ids to see resources for specific frames/components.
</listing>

<creating>
- create_dev_resources accepts an array of dev resources, each with a URL, name, and target node_id.
- Use to link code files, documentation, or Storybook pages to design nodes.
</creating>

<managing>
- update_dev_resource changes the URL or name of an existing resource.
- delete_dev_resource removes a resource by its ID.
- Always confirm before deleting.
</managing>
