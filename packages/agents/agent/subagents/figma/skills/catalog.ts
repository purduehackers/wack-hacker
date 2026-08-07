import { defineDynamic } from "eve/skills";

import {
  resolveIntegrationSkills,
  type IntegrationSkillDefinition,
} from "../../../lib/policy/skill-catalog.ts";

export const FIGMA_BASE_TOOL_NAMES = [
  "get_file",
  "list_projects",
  "list_project_files",
  "search_files",
] as const;

export const FIGMA_SKILL_DEFINITIONS = [
  {
    name: "comments",
    description: "List, create, and delete comments and reactions on files.",
    criteria:
      "Use when the user wants to view, post, or delete comments on a Figma file, or add reactions.",
    minRole: "organizer",
    tools: ["list_comments", "create_comment", "delete_comment", "add_reaction", "delete_reaction"],
    instructions:
      '<listing>\n- list_comments returns all comments on a file with text, author, timestamp, and resolved status.\n- Comments can be pinned to specific locations (x, y coordinates) or nodes.\n- Threaded replies have a parent comment ID.\n</listing>\n\n<creating>\n- Specify file_key and message text.\n- Optionally pin to a position with x/y coordinates, or to a specific node_id.\n- For replies, include the parent comment_id.\n- Only post comments when the user explicitly asks.\n</creating>\n\n<reactions>\n- add_reaction/delete_reaction target a specific comment by ID.\n- Emoji is specified as a shortcode (e.g., ":thumbsup:", ":heart:").\n</reactions>',
  },
  {
    name: "components",
    description:
      "Browse published components, component sets, and styles across the team and files.",
    criteria:
      "Use when the user asks about design system components, component variants, published styles, colors, or text styles.",
    minRole: "organizer",
    tools: [
      "list_team_components",
      "list_file_components",
      "get_component",
      "list_team_component_sets",
      "get_component_set",
      "list_team_styles",
      "list_file_styles",
      "get_style",
    ],
    instructions:
      "<components>\n- list_team_components returns all published components across the team. Paginated.\n- list_file_components scopes to a single file.\n- get_component returns full metadata: name, description, containing file, thumbnail URL.\n- Component sets group variants of a single component (e.g., Button with Primary/Secondary variants).\n</components>\n\n<styles>\n- list_team_styles returns published color, text, effect, and grid styles.\n- list_file_styles scopes to a single file.\n- get_style returns summarized style metadata (key, name, description, style type).\n- Style types: FILL, TEXT, EFFECT, GRID.\n</styles>",
  },
  {
    name: "dev-resources",
    description: "Manage dev resource links attached to design nodes.",
    criteria:
      "Use when the user asks about dev links, code links, documentation links, or annotations on design nodes.",
    minRole: "organizer",
    tools: [
      "list_dev_resources",
      "create_dev_resources",
      "update_dev_resource",
      "delete_dev_resource",
    ],
    instructions:
      "<listing>\n- list_dev_resources returns links (URLs, names) attached to specific nodes in a file.\n- Filter by node_ids to see resources for specific frames/components.\n</listing>\n\n<creating>\n- create_dev_resources accepts an array of dev resources, each with a URL, name, and target node_id.\n- Use to link code files, documentation, or Storybook pages to design nodes.\n</creating>\n\n<managing>\n- update_dev_resource changes the URL or name of an existing resource.\n- delete_dev_resource removes a resource by its ID.\n- Always confirm before deleting.\n</managing>",
  },
  {
    name: "nodes",
    description: "Inspect specific nodes within a file and export images.",
    criteria:
      "Use when the user wants to inspect specific frames, components, or layers, or export designs as images.",
    minRole: "organizer",
    tools: ["get_file_nodes", "get_images", "get_image_fills"],
    instructions:
      '<inspecting>\n- Use get_file first (base tool) with depth=1 to see top-level pages.\n- Then use get_file_nodes with specific node IDs to drill into frames/components.\n- Node IDs look like "1:2" or "123:456" — they come from get_file results.\n</inspecting>\n\n<exporting>\n- get_images exports nodes as PNG (default), SVG, JPG, or PDF.\n- Pass scale (1–4) for raster formats to control resolution.\n- Returns temporary download URLs (valid ~14 days).\n- get_image_fills returns URLs for all images used as fills (photos, textures, etc.).\n</exporting>',
  },
  {
    name: "variables",
    description: "Inspect and modify design variables and collections.",
    criteria:
      "Use when the user asks about design variables, design tokens, variable collections, or wants to create/update/delete variables.",
    minRole: "organizer",
    tools: ["get_local_variables", "get_published_variables", "modify_variables"],
    instructions:
      '<reading>\n- get_local_variables returns all variables and collections in a file (including unpublished).\n- get_published_variables returns only published variables visible to consumers.\n- Variables have modes (e.g., Light/Dark) with per-mode values.\n- Variable types: COLOR, FLOAT, STRING, BOOLEAN.\n</reading>\n\n<modifying>\n- modify_variables is a bulk operation that can create, update, and delete variables and collections in a single call.\n- The request body contains optional arrays using the tool\'s input keys: variable_collections, variables, variable_modes.\n- Each entry specifies an action: "CREATE", "UPDATE", or "DELETE".\n- Always read current variables first before modifying.\n- Only modify when the user explicitly asks.\n</modifying>',
  },
  {
    name: "versions",
    description: "View file version history.",
    criteria:
      "Use when the user asks about file history, past versions, or who last edited a file.",
    minRole: "organizer",
    tools: ["list_versions"],
    instructions:
      "- list_versions returns the version history with IDs, labels, descriptions, timestamps, and the user who created each version.\n- Named versions (user-saved checkpoints) have a label and description.\n- Auto-save versions may have no label.\n- Results are paginated — use pagination params for files with long histories.",
  },
  {
    name: "webhooks",
    description: "List, create, update, and delete team webhooks.",
    criteria:
      "Use when the user asks about Figma webhooks, event subscriptions, or automated notifications from Figma.",
    minRole: "admin",
    tools: [
      "list_team_webhooks",
      "create_webhook",
      "get_webhook",
      "update_webhook",
      "delete_webhook",
    ],
    instructions:
      "<listing>\n- list_team_webhooks returns all webhooks configured for the team.\n- get_webhook returns details for a specific webhook by ID.\n</listing>\n\n<creating>\n- create_webhook requires event_type, endpoint (callback URL), and passcode. Optionally accepts description.\n- The team is determined automatically from the configured environment; do not ask the user for a team_id.\n- Event types include: FILE_UPDATE, FILE_DELETE, FILE_VERSION_UPDATE, LIBRARY_PUBLISH, and more.\n</creating>\n\n<managing>\n- update_webhook can change the endpoint, passcode, description, or status (ACTIVE/PAUSED).\n- delete_webhook removes a webhook permanently.\n- Always confirm before deleting or creating webhooks.\n</managing>",
  },
] as const satisfies readonly IntegrationSkillDefinition[];

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) =>
      resolveIntegrationSkills(ctx.session.auth.current, FIGMA_SKILL_DEFINITIONS),
  },
});
