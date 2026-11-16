# `buffer`

_Write the identity of this subagent here._

<!-- generated: do not edit below this line -->

## Surface

**50 tools** across **10 skills**, plus 4 always-available.

## Skills

| Skill                                        | Role      | Tools | Description                                                                                                            |
| -------------------------------------------- | --------- | ----: | ---------------------------------------------------------------------------------------------------------------------- |
| [`channels`](lib/skill_defs/channels.md)     | organizer |     5 | Buffer channels: account, channel, channels, configuration, dailyPostingLimits.                                        |
| [`publishing`](lib/skill_defs/publishing.md) | organizer |     6 | Buffer publishing: post, posts, createPost, editPost, deletePost, movePostInQueue.                                     |
| [`metrics`](lib/skill_defs/metrics.md)       | organizer |     2 | Buffer post metrics, channel comparisons, chart datasets, and optional observed history.                               |
| [`ideas`](lib/skill_defs/ideas.md)           | organizer |     3 | Buffer ideas: ideaGroups, ideas, createIdea.                                                                           |
| [`content`](lib/skill_defs/content.md)       | organizer |    10 | Buffer content: contentItem, contentItems, createContentItem, createContentItemDraft, updateContentItem, updateConten… |
| [`notes`](lib/skill_defs/notes.md)           | organizer |     5 | Buffer notes: collaborationNotes, selectableTeamMembers, createCollaborationNote, updateCollaborationNote, deleteColl… |
| [`tags`](lib/skill_defs/tags.md)             | organizer |     5 | Buffer tags: tag, tagsV2, createTag, updateTag, deleteTag.                                                             |
| [`templates`](lib/skill_defs/templates.md)   | organizer |     5 | Buffer templates: postTemplate, postTemplates, createPostTemplate, updatePostTemplate, deletePostTemplate.             |
| [`snippets`](lib/skill_defs/snippets.md)     | organizer |     4 | Buffer snippets: snippets, createSnippet, updateSnippet, deleteSnippet.                                                |
| [`audio`](lib/skill_defs/audio.md)           | organizer |     5 | Buffer audio: instagramAudio, instagramAudioCatalog, searchInstagramAudio, searchInstagramAudioCatalog, trendingInsta… |

## Always available

Reachable without loading a skill.

| Tool       | Risk | Role      | What it does                                                                                                           |
| ---------- | ---- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| `account`  | read | organizer | Retrieves the authenticated user's account information Complete Buffer API operation.                                  |
| `channel`  | read | organizer | Fetches a single channel using the provided ID Complete Buffer API operation.                                          |
| `channels` | read | organizer | Fetch all channels for the organization taking into account the current's user permissions Complete Buffer API operat… |
| `posts`    | read | organizer | Fetches posts for the given organization: first and last can be set for forward pagination using Relay convention Com… |

## `channels`

Buffer channels: account, channel, channels, configuration, dailyPostingLimits.

| Tool                   | Risk | Role      | What it does                                                                                                           |
| ---------------------- | ---- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| `account`              | read | organizer | Retrieves the authenticated user's account information Complete Buffer API operation.                                  |
| `channel`              | read | organizer | Fetches a single channel using the provided ID Complete Buffer API operation.                                          |
| `channels`             | read | organizer | Fetch all channels for the organization taking into account the current's user permissions Complete Buffer API operat… |
| `configuration`        | read | organizer | Global, per-organization configuration: the connected `channels` the actor can view (with per-feature authorization) … |
| `daily_posting_limits` | read | organizer | Returns posting limit status for the given channels at the intended posting time.                                      |

## `publishing`

Buffer publishing: post, posts, createPost, editPost, deletePost, movePostInQueue.

| Tool                 | Risk        | Role      | What it does                                                                                                           |
| -------------------- | ----------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| `create_post`        | write       | organizer | Create post for channel Complete Buffer API operation.                                                                 |
| `delete_post`        | destructive | admin     | Delete a post by id.                                                                                                   |
| `edit_post`          | write       | organizer | Edit post for channel Complete Buffer API operation.                                                                   |
| `move_post_in_queue` | write       | organizer | Move a queued post to the top or bottom of its channel's queue.                                                        |
| `post`               | read        | organizer | Fetches a post by PostID for the given organization: first and last can be set for forward pagination using Relay con… |
| `posts`              | read        | organizer | Fetches posts for the given organization: first and last can be set for forward pagination using Relay convention Com… |

## `metrics`

Buffer post metrics, channel comparisons, chart datasets, and optional observed history.

| Tool                      | Risk | Role      | What it does                                                  |
| ------------------------- | ---- | --------- | ------------------------------------------------------------- |
| `aggregated_post_metrics` | read | organizer | Aggregate normalized post metrics across a filtered post set. |
| `metric_snapshots`        | read | organizer | Read Wack Hacker's stored daily Buffer observations.          |

## `ideas`

Buffer ideas: ideaGroups, ideas, createIdea.

| Tool          | Risk  | Role      | What it does                                                                           |
| ------------- | ----- | --------- | -------------------------------------------------------------------------------------- |
| `create_idea` | write | organizer | Create a new idea with the given content and metadata Complete Buffer API operation.   |
| `idea_groups` | read  | organizer | Retrieves idea groups based on the provided input parameters.                          |
| `ideas`       | read  | organizer | Fetch a paginated list of ideas with optional filtering Complete Buffer API operation. |

## `content`

Buffer content: contentItem, contentItems, createContentItem, createContentItemDraft, updateContentItem, updateContentItemDraft, promoteContentItemDraftToPosts, addPostToContentItem, removePostFromContentItem, deleteContentItem.

| Tool                                  | Risk        | Role      | What it does                                                                                                           |
| ------------------------------------- | ----------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| `add_post_to_content_item`            | write       | organizer | Add a post that already exists to a content item.                                                                      |
| `content_item`                        | read        | organizer | Fetch a single content item by id.                                                                                     |
| `content_items`                       | read        | organizer | Fetch an organization's content items in the requested order, newest first by default. Uses standard cursor paginatio… |
| `create_content_item`                 | write       | organizer | Create a content item together with all of its channel-specific post variants in a single operation. Validation is al… |
| `create_content_item_draft`           | write       | organizer | Create a content item holding a channel-less draft, before any channels are selected. No network-specific validation … |
| `delete_content_item`                 | destructive | admin     | Delete a content item: the item itself and any posts created from it.                                                  |
| `promote_content_item_draft_to_posts` | write       | organizer | Promote a channel-less draft into channel-specific posts.                                                              |
| `remove_post_from_content_item`       | write       | organizer | Remove a post from a content item.                                                                                     |
| `update_content_item`                 | write       | organizer | Update a content item's title or target date.                                                                          |
| `update_content_item_draft`           | write       | organizer | Replace a channel-less draft's content in full, and optionally set the content item's target date in the same write. … |

## `notes`

Buffer notes: collaborationNotes, selectableTeamMembers, createCollaborationNote, updateCollaborationNote, deleteCollaborationNote.

| Tool                        | Risk        | Role      | What it does                                                                                                           |
| --------------------------- | ----------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| `collaboration_notes`       | read        | organizer | The authorized Notes in a thread, in descending creation order.                                                        |
| `create_collaboration_note` | write       | organizer | Creates a collaboration Note in a thread.                                                                              |
| `delete_collaboration_note` | destructive | admin     | Deletes a collaboration Note.                                                                                          |
| `selectable_team_members`   | read        | organizer | The team members the requesting account may offer for selection, ordered by display name and then by account ID. On a… |
| `update_collaboration_note` | write       | organizer | Updates a collaboration Note.                                                                                          |

## `tags`

Buffer tags: tag, tagsV2, createTag, updateTag, deleteTag.

| Tool         | Risk        | Role      | What it does                                                                |
| ------------ | ----------- | --------- | --------------------------------------------------------------------------- |
| `create_tag` | write       | organizer | Create a tag for an organization.                                           |
| `delete_tag` | destructive | admin     | Delete a tag.                                                               |
| `tag`        | read        | organizer | Fetch a single tag by id.                                                   |
| `tags_v2`    | read        | organizer | Fetch a page of the organization's tags, sorted by name in ascending order. |
| `update_tag` | write       | organizer | Update a tag's name and color.                                              |

## `templates`

Buffer templates: postTemplate, postTemplates, createPostTemplate, updatePostTemplate, deletePostTemplate.

| Tool                   | Risk        | Role      | What it does                                                                                                           |
| ---------------------- | ----------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| `create_post_template` | write       | organizer | Create a post template visible only to the caller (`private`) or to the caller's organization (`internal`). Complete … |
| `delete_post_template` | destructive | admin     | Delete a post template owned by the caller (or an internal template in the caller's organization, if the caller is an… |
| `post_template`        | read        | organizer | Fetch a single post template by ID.                                                                                    |
| `post_templates`       | read        | organizer | Fetch the templates visible to the current actor for the template library: public templates, plus internal templates … |
| `update_post_template` | write       | organizer | Update a post template owned by the caller (or an internal template in the caller's organization, if the caller is an… |

## `snippets`

Buffer snippets: snippets, createSnippet, updateSnippet, deleteSnippet.

| Tool             | Risk        | Role      | What it does                                             |
| ---------------- | ----------- | --------- | -------------------------------------------------------- |
| `create_snippet` | write       | organizer | Creates a snippet in an organization.                    |
| `delete_snippet` | destructive | admin     | Deletes a snippet.                                       |
| `snippets`       | read        | organizer | Returns the snippets of an organization, sorted by name. |
| `update_snippet` | write       | organizer | Replaces the name and text of a snippet.                 |

## `audio`

Buffer audio: instagramAudio, instagramAudioCatalog, searchInstagramAudio, searchInstagramAudioCatalog, trendingInstagramAudio.

| Tool                             | Risk | Role      | What it does                                                             |
| -------------------------------- | ---- | --------- | ------------------------------------------------------------------------ |
| `instagram_audio`                | read | organizer | Refresh metadata and preview availability for one Instagram audio asset. |
| `instagram_audio_catalog`        | read | organizer | Return trending music and original sounds in a single request.           |
| `search_instagram_audio`         | read | organizer | Search Instagram audio for one channel.                                  |
| `search_instagram_audio_catalog` | read | organizer | Search music and original sounds in a single request.                    |
| `trending_instagram_audio`       | read | organizer | Return Meta trending Instagram audio for one channel.                    |
