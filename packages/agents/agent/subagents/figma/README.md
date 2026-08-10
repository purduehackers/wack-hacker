# `figma`

The Purdue Hackers Figma team, read through the REST API: files and projects,
the nodes inside a file, published components and styles, design variables,
comments, dev resources, version history, and team webhooks.

Everything hangs off a file key, which only ever appears in a file's URL, so
`search_files` and `list_project_files` are how a design people refer to by name
becomes something the other tools can address. `get_file` returns the document
tree and is the entry point to nodes; it defaults to pages only because a real
design file's full tree is enormous.

It is a reader of design, not an editor of it. There is no way here to move a
frame, change a fill, or publish a library — the Figma REST API does not offer
one, and the plugin API that does is not reachable from a chat message. What it
can write is metadata around the design: comments, dev resource links, variables,
and webhooks. Images come back as temporary export URLs that expire in about two
weeks, so they are for looking at now, not for embedding in anything durable.

<!-- generated: do not edit below this line -->

## Surface

**33 tools** across **7 skills**, plus 4 always-available.

## Skills

| Skill                                              | Role      | Tools | Description                                                                        |
| -------------------------------------------------- | --------- | ----: | ---------------------------------------------------------------------------------- |
| [`comments`](lib/skill_defs/comments.md)           | organizer |     5 | List, create, and delete comments and reactions on files.                          |
| [`components`](lib/skill_defs/components.md)       | organizer |     8 | Browse published components, component sets, and styles across the team and files. |
| [`dev-resources`](lib/skill_defs/dev-resources.md) | organizer |     4 | Manage dev resource links attached to design nodes.                                |
| [`nodes`](lib/skill_defs/nodes.md)                 | organizer |     3 | Inspect specific nodes within a file and export images.                            |
| [`variables`](lib/skill_defs/variables.md)         | organizer |     3 | Inspect and modify design variables and collections.                               |
| [`versions`](lib/skill_defs/versions.md)           | organizer |     1 | View file version history.                                                         |
| [`webhooks`](lib/skill_defs/webhooks.md)           | admin     |     5 | List, create, update, and delete team webhooks.                                    |

## Always available

Reachable without loading a skill.

| Tool                 | Risk | Role   | What it does                                        |
| -------------------- | ---- | ------ | --------------------------------------------------- |
| `get_file`           | read | public | Get a Figma file's metadata and document structure. |
| `list_project_files` | read | public | List files in a specific project.                   |
| `list_projects`      | read | public | List all projects in the team.                      |
| `search_files`       | read | public | Search for files by name across all team projects.  |

## `comments`

List, create, and delete comments and reactions on files.

| Tool              | Risk        | Role      | What it does                                             |
| ----------------- | ----------- | --------- | -------------------------------------------------------- |
| `add_reaction`    | write       | organizer | Add an emoji reaction to a comment on a Figma file.      |
| `create_comment`  | write       | organizer | Post a comment on a Figma file.                          |
| `delete_comment`  | destructive | organizer | Delete a comment from a Figma file.                      |
| `delete_reaction` | destructive | organizer | Remove an emoji reaction from a comment on a Figma file. |
| `list_comments`   | read        | public    | List comments on a Figma file.                           |

## `components`

Browse published components, component sets, and styles across the team and files.

| Tool                       | Risk | Role   | What it does                                                          |
| -------------------------- | ---- | ------ | --------------------------------------------------------------------- |
| `get_component`            | read | public | Get full details of a published component by its key.                 |
| `get_component_set`        | read | public | Get full details of a published component set by its key.             |
| `get_style`                | read | public | Get full details of a published style by its key.                     |
| `list_file_components`     | read | public | List components in a specific Figma file.                             |
| `list_file_styles`         | read | public | List styles in a specific Figma file.                                 |
| `list_team_component_sets` | read | public | List published component sets (variant groups) across the team.       |
| `list_team_components`     | read | public | List published components across the team.                            |
| `list_team_styles`         | read | public | List published styles (colors, text, effects, grids) across the team. |

## `dev-resources`

Manage dev resource links attached to design nodes.

| Tool                   | Risk        | Role      | What it does                                                                      |
| ---------------------- | ----------- | --------- | --------------------------------------------------------------------------------- |
| `create_dev_resources` | write       | organizer | Attach dev resource links to nodes in a Figma file.                               |
| `delete_dev_resource`  | destructive | organizer | Delete a dev resource from a Figma file.                                          |
| `list_dev_resources`   | read        | public    | List dev resources (links to code, docs, etc.) attached to nodes in a Figma file. |
| `update_dev_resource`  | write       | organizer | Update an existing dev resource's URL or name.                                    |

## `nodes`

Inspect specific nodes within a file and export images.

| Tool              | Risk | Role   | What it does                                                                             |
| ----------------- | ---- | ------ | ---------------------------------------------------------------------------------------- |
| `get_file_nodes`  | read | public | Get specific nodes from a Figma file by their IDs.                                       |
| `get_image_fills` | read | public | Get download URLs for all images used as fills in a Figma file (photos, textures, etc.). |
| `get_images`      | read | public | Export nodes from a Figma file as images.                                                |

## `variables`

Inspect and modify design variables and collections.

| Tool                      | Risk        | Role      | What it does                                                                                  |
| ------------------------- | ----------- | --------- | --------------------------------------------------------------------------------------------- |
| `get_local_variables`     | read        | public    | Get all local variables and variable collections in a Figma file, including unpublished ones. |
| `get_published_variables` | read        | public    | Get published variables and variable collections in a Figma file.                             |
| `modify_variables`        | destructive | organizer | Bulk create, update, or delete variables and variable collections in a Figma file.            |

## `versions`

View file version history.

| Tool            | Risk | Role   | What it does                          |
| --------------- | ---- | ------ | ------------------------------------- |
| `list_versions` | read | public | List version history of a Figma file. |

## `webhooks`

List, create, update, and delete team webhooks.

| Tool                 | Risk        | Role  | What it does                                                               |
| -------------------- | ----------- | ----- | -------------------------------------------------------------------------- |
| `create_webhook`     | destructive | admin | Create a new webhook for team events.                                      |
| `delete_webhook`     | destructive | admin | Delete a webhook permanently.                                              |
| `get_webhook`        | read        | admin | Get a webhook's details by ID.                                             |
| `list_team_webhooks` | read        | admin | List all webhooks configured for the team.                                 |
| `update_webhook`     | destructive | admin | Update webhook configuration — endpoint, passcode, description, or status. |
