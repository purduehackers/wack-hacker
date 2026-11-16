import type { DomainToolSpec } from "../../../lib/policy/domain-tools.ts";
import type { IntegrationSkillDefinition } from "../../../lib/policy/skill-catalog.ts";
import audioDoc from "./skill_defs/audio.md" with { type: "text" };
import channelsDoc from "./skill_defs/channels.md" with { type: "text" };
import contentDoc from "./skill_defs/content.md" with { type: "text" };
import ideasDoc from "./skill_defs/ideas.md" with { type: "text" };
import metricsDoc from "./skill_defs/metrics.md" with { type: "text" };
import notesDoc from "./skill_defs/notes.md" with { type: "text" };
import publishingDoc from "./skill_defs/publishing.md" with { type: "text" };
import snippetsDoc from "./skill_defs/snippets.md" with { type: "text" };
import tagsDoc from "./skill_defs/tags.md" with { type: "text" };
import templatesDoc from "./skill_defs/templates.md" with { type: "text" };
import { instagram_audio } from "./tool_defs/audio/instagram_audio.ts";
import { instagram_audio_catalog } from "./tool_defs/audio/instagram_audio_catalog.ts";
import { search_instagram_audio } from "./tool_defs/audio/search_instagram_audio.ts";
import { search_instagram_audio_catalog } from "./tool_defs/audio/search_instagram_audio_catalog.ts";
import { trending_instagram_audio } from "./tool_defs/audio/trending_instagram_audio.ts";
import { account } from "./tool_defs/channels/account.ts";
import { channel } from "./tool_defs/channels/channel.ts";
import { channels } from "./tool_defs/channels/channels.ts";
import { configuration } from "./tool_defs/channels/configuration.ts";
import { daily_posting_limits } from "./tool_defs/channels/daily_posting_limits.ts";
import { add_post_to_content_item } from "./tool_defs/content/add_post_to_content_item.ts";
import { content_item } from "./tool_defs/content/content_item.ts";
import { content_items } from "./tool_defs/content/content_items.ts";
import { create_content_item } from "./tool_defs/content/create_content_item.ts";
import { create_content_item_draft } from "./tool_defs/content/create_content_item_draft.ts";
import { delete_content_item } from "./tool_defs/content/delete_content_item.ts";
import { promote_content_item_draft_to_posts } from "./tool_defs/content/promote_content_item_draft_to_posts.ts";
import { remove_post_from_content_item } from "./tool_defs/content/remove_post_from_content_item.ts";
import { update_content_item } from "./tool_defs/content/update_content_item.ts";
import { update_content_item_draft } from "./tool_defs/content/update_content_item_draft.ts";
import { create_idea } from "./tool_defs/ideas/create_idea.ts";
import { idea_groups } from "./tool_defs/ideas/idea_groups.ts";
import { ideas } from "./tool_defs/ideas/ideas.ts";
import { aggregated_post_metrics } from "./tool_defs/metrics/aggregated_post_metrics.ts";
import { metric_snapshots } from "./tool_defs/metrics/metric_snapshots.ts";
import { collaboration_notes } from "./tool_defs/notes/collaboration_notes.ts";
import { create_collaboration_note } from "./tool_defs/notes/create_collaboration_note.ts";
import { delete_collaboration_note } from "./tool_defs/notes/delete_collaboration_note.ts";
import { selectable_team_members } from "./tool_defs/notes/selectable_team_members.ts";
import { update_collaboration_note } from "./tool_defs/notes/update_collaboration_note.ts";
import { create_post } from "./tool_defs/publishing/create_post.ts";
import { delete_post } from "./tool_defs/publishing/delete_post.ts";
import { edit_post } from "./tool_defs/publishing/edit_post.ts";
import { move_post_in_queue } from "./tool_defs/publishing/move_post_in_queue.ts";
import { post } from "./tool_defs/publishing/post.ts";
import { posts } from "./tool_defs/publishing/posts.ts";
import { create_snippet } from "./tool_defs/snippets/create_snippet.ts";
import { delete_snippet } from "./tool_defs/snippets/delete_snippet.ts";
import { snippets } from "./tool_defs/snippets/snippets.ts";
import { update_snippet } from "./tool_defs/snippets/update_snippet.ts";
import { create_tag } from "./tool_defs/tags/create_tag.ts";
import { delete_tag } from "./tool_defs/tags/delete_tag.ts";
import { tag } from "./tool_defs/tags/tag.ts";
import { tags_v2 } from "./tool_defs/tags/tags_v2.ts";
import { update_tag } from "./tool_defs/tags/update_tag.ts";
import { create_post_template } from "./tool_defs/templates/create_post_template.ts";
import { delete_post_template } from "./tool_defs/templates/delete_post_template.ts";
import { post_template } from "./tool_defs/templates/post_template.ts";
import { post_templates } from "./tool_defs/templates/post_templates.ts";
import { update_post_template } from "./tool_defs/templates/update_post_template.ts";

export const BUFFER_TOOLS = {
  account,
  add_post_to_content_item,
  aggregated_post_metrics,
  metric_snapshots,
  channel,
  channels,
  collaboration_notes,
  configuration,
  content_item,
  content_items,
  create_collaboration_note,
  create_content_item,
  create_content_item_draft,
  create_idea,
  create_post,
  create_post_template,
  create_snippet,
  create_tag,
  daily_posting_limits,
  delete_collaboration_note,
  delete_content_item,
  delete_post,
  delete_post_template,
  delete_snippet,
  delete_tag,
  edit_post,
  idea_groups,
  ideas,
  instagram_audio,
  instagram_audio_catalog,
  move_post_in_queue,
  post,
  post_template,
  post_templates,
  posts,
  promote_content_item_draft_to_posts,
  remove_post_from_content_item,
  search_instagram_audio,
  search_instagram_audio_catalog,
  selectable_team_members,
  snippets,
  tag,
  tags_v2,
  trending_instagram_audio,
  update_collaboration_note,
  update_content_item,
  update_content_item_draft,
  update_post_template,
  update_snippet,
  update_tag,
} as const satisfies Record<string, DomainToolSpec>;
export const BUFFER_BASE_TOOL_NAMES = ["account", "channels", "channel", "posts"] as const;
export const BUFFER_SKILLS = [
  {
    name: "channels",
    minRole: "organizer",
    doc: channelsDoc,
    tools: ["account", "channel", "channels", "configuration", "daily_posting_limits"],
  },
  {
    name: "publishing",
    minRole: "organizer",
    doc: publishingDoc,
    tools: ["post", "posts", "create_post", "edit_post", "delete_post", "move_post_in_queue"],
  },
  {
    name: "metrics",
    minRole: "organizer",
    doc: metricsDoc,
    tools: ["aggregated_post_metrics", "metric_snapshots"],
  },
  {
    name: "ideas",
    minRole: "organizer",
    doc: ideasDoc,
    tools: ["idea_groups", "ideas", "create_idea"],
  },
  {
    name: "content",
    minRole: "organizer",
    doc: contentDoc,
    tools: [
      "content_item",
      "content_items",
      "create_content_item",
      "create_content_item_draft",
      "update_content_item",
      "update_content_item_draft",
      "promote_content_item_draft_to_posts",
      "add_post_to_content_item",
      "remove_post_from_content_item",
      "delete_content_item",
    ],
  },
  {
    name: "notes",
    minRole: "organizer",
    doc: notesDoc,
    tools: [
      "collaboration_notes",
      "selectable_team_members",
      "create_collaboration_note",
      "update_collaboration_note",
      "delete_collaboration_note",
    ],
  },
  {
    name: "tags",
    minRole: "organizer",
    doc: tagsDoc,
    tools: ["tag", "tags_v2", "create_tag", "update_tag", "delete_tag"],
  },
  {
    name: "templates",
    minRole: "organizer",
    doc: templatesDoc,
    tools: [
      "post_template",
      "post_templates",
      "create_post_template",
      "update_post_template",
      "delete_post_template",
    ],
  },
  {
    name: "snippets",
    minRole: "organizer",
    doc: snippetsDoc,
    tools: ["snippets", "create_snippet", "update_snippet", "delete_snippet"],
  },
  {
    name: "audio",
    minRole: "organizer",
    doc: audioDoc,
    tools: [
      "instagram_audio",
      "instagram_audio_catalog",
      "search_instagram_audio",
      "search_instagram_audio_catalog",
      "trending_instagram_audio",
    ],
  },
] as const satisfies readonly IntegrationSkillDefinition[];
