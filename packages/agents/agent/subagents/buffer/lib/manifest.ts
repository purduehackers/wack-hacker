// Reviewed public operations and their Wack Hacker policy.
export const BUFFER_MANIFEST = [
  {
    operation: "account",
    kind: "query",
    tool: "account",
    minRole: "organizer",
    risk: "read",
    arguments: [],
  },
  {
    operation: "dailyPostingLimits",
    kind: "query",
    tool: "daily_posting_limits",
    minRole: "organizer",
    risk: "read",
    arguments: [
      {
        name: "input",
        type: "DailyPostingLimitsInput!",
      },
    ],
  },
  {
    operation: "channel",
    kind: "query",
    tool: "channel",
    minRole: "organizer",
    risk: "read",
    arguments: [
      {
        name: "input",
        type: "ChannelInput!",
      },
    ],
  },
  {
    operation: "channels",
    kind: "query",
    tool: "channels",
    minRole: "organizer",
    risk: "read",
    arguments: [
      {
        name: "input",
        type: "ChannelsInput!",
      },
    ],
  },
  {
    operation: "aggregatedPostMetrics",
    kind: "query",
    tool: "aggregated_post_metrics",
    minRole: "organizer",
    risk: "read",
    arguments: [
      {
        name: "input",
        type: "AggregatedPostMetricsInput!",
      },
    ],
  },
  {
    operation: "snippets",
    kind: "query",
    tool: "snippets",
    minRole: "organizer",
    risk: "read",
    arguments: [
      {
        name: "after",
        type: "String",
      },
      {
        name: "first",
        type: "Int",
      },
      {
        name: "input",
        type: "SnippetsInput!",
      },
    ],
  },
  {
    operation: "collaborationNotes",
    kind: "query",
    tool: "collaboration_notes",
    minRole: "organizer",
    risk: "read",
    arguments: [
      {
        name: "after",
        type: "String",
      },
      {
        name: "first",
        type: "Int",
      },
      {
        name: "input",
        type: "CollaborationNotesInput!",
      },
    ],
  },
  {
    operation: "post",
    kind: "query",
    tool: "post",
    minRole: "organizer",
    risk: "read",
    arguments: [
      {
        name: "input",
        type: "PostInput!",
      },
    ],
  },
  {
    operation: "posts",
    kind: "query",
    tool: "posts",
    minRole: "organizer",
    risk: "read",
    arguments: [
      {
        name: "after",
        type: "String",
      },
      {
        name: "first",
        type: "Int",
      },
      {
        name: "input",
        type: "PostsInput!",
      },
    ],
  },
  {
    operation: "contentItem",
    kind: "query",
    tool: "content_item",
    minRole: "organizer",
    risk: "read",
    arguments: [
      {
        name: "input",
        type: "ContentItemInput!",
      },
    ],
  },
  {
    operation: "contentItems",
    kind: "query",
    tool: "content_items",
    minRole: "organizer",
    risk: "read",
    arguments: [
      {
        name: "after",
        type: "String",
      },
      {
        name: "first",
        type: "Int",
      },
      {
        name: "input",
        type: "ContentItemsInput!",
      },
    ],
  },
  {
    operation: "tag",
    kind: "query",
    tool: "tag",
    minRole: "organizer",
    risk: "read",
    arguments: [
      {
        name: "input",
        type: "TagByIdInput!",
      },
    ],
  },
  {
    operation: "tagsV2",
    kind: "query",
    tool: "tags_v2",
    minRole: "organizer",
    risk: "read",
    arguments: [
      {
        name: "after",
        type: "String",
      },
      {
        name: "first",
        type: "Int",
      },
      {
        name: "input",
        type: "TagsInput!",
      },
    ],
  },
  {
    operation: "selectableTeamMembers",
    kind: "query",
    tool: "selectable_team_members",
    minRole: "organizer",
    risk: "read",
    arguments: [
      {
        name: "after",
        type: "String",
      },
      {
        name: "first",
        type: "Int",
      },
      {
        name: "input",
        type: "SelectableTeamMembersInput!",
      },
    ],
  },
  {
    operation: "instagramAudio",
    kind: "query",
    tool: "instagram_audio",
    minRole: "organizer",
    risk: "read",
    arguments: [
      {
        name: "input",
        type: "InstagramAudioInput!",
      },
    ],
  },
  {
    operation: "searchInstagramAudio",
    kind: "query",
    tool: "search_instagram_audio",
    minRole: "organizer",
    risk: "read",
    arguments: [
      {
        name: "input",
        type: "SearchInstagramAudioInput!",
      },
    ],
  },
  {
    operation: "trendingInstagramAudio",
    kind: "query",
    tool: "trending_instagram_audio",
    minRole: "organizer",
    risk: "read",
    arguments: [
      {
        name: "input",
        type: "TrendingInstagramAudioInput!",
      },
    ],
  },
  {
    operation: "instagramAudioCatalog",
    kind: "query",
    tool: "instagram_audio_catalog",
    minRole: "organizer",
    risk: "read",
    arguments: [
      {
        name: "input",
        type: "InstagramAudioCatalogInput!",
      },
    ],
  },
  {
    operation: "searchInstagramAudioCatalog",
    kind: "query",
    tool: "search_instagram_audio_catalog",
    minRole: "organizer",
    risk: "read",
    arguments: [
      {
        name: "input",
        type: "SearchInstagramAudioCatalogInput!",
      },
    ],
  },
  {
    operation: "configuration",
    kind: "query",
    tool: "configuration",
    minRole: "organizer",
    risk: "read",
    arguments: [
      {
        name: "input",
        type: "ConfigurationInput!",
      },
    ],
  },
  {
    operation: "postTemplate",
    kind: "query",
    tool: "post_template",
    minRole: "organizer",
    risk: "read",
    arguments: [
      {
        name: "input",
        type: "PostTemplateInput!",
      },
    ],
  },
  {
    operation: "postTemplates",
    kind: "query",
    tool: "post_templates",
    minRole: "organizer",
    risk: "read",
    arguments: [
      {
        name: "after",
        type: "String",
      },
      {
        name: "first",
        type: "Int",
      },
      {
        name: "input",
        type: "PostTemplatesInput!",
      },
    ],
  },
  {
    operation: "ideaGroups",
    kind: "query",
    tool: "idea_groups",
    minRole: "organizer",
    risk: "read",
    arguments: [
      {
        name: "input",
        type: "IdeaGroupsInput!",
      },
    ],
  },
  {
    operation: "ideas",
    kind: "query",
    tool: "ideas",
    minRole: "organizer",
    risk: "read",
    arguments: [
      {
        name: "after",
        type: "String",
      },
      {
        name: "first",
        type: "Int",
      },
      {
        name: "input",
        type: "IdeasInput!",
      },
    ],
  },
  {
    operation: "createSnippet",
    kind: "mutation",
    tool: "create_snippet",
    minRole: "organizer",
    risk: "write",
    arguments: [
      {
        name: "input",
        type: "CreateSnippetInput!",
      },
    ],
  },
  {
    operation: "deleteSnippet",
    kind: "mutation",
    tool: "delete_snippet",
    minRole: "admin",
    risk: "destructive",
    arguments: [
      {
        name: "input",
        type: "DeleteSnippetInput!",
      },
    ],
  },
  {
    operation: "updateSnippet",
    kind: "mutation",
    tool: "update_snippet",
    minRole: "organizer",
    risk: "write",
    arguments: [
      {
        name: "input",
        type: "UpdateSnippetInput!",
      },
    ],
  },
  {
    operation: "createCollaborationNote",
    kind: "mutation",
    tool: "create_collaboration_note",
    minRole: "organizer",
    risk: "write",
    arguments: [
      {
        name: "input",
        type: "CreateCollaborationNoteInput!",
      },
    ],
  },
  {
    operation: "deleteCollaborationNote",
    kind: "mutation",
    tool: "delete_collaboration_note",
    minRole: "admin",
    risk: "destructive",
    arguments: [
      {
        name: "input",
        type: "DeleteCollaborationNoteInput!",
      },
    ],
  },
  {
    operation: "updateCollaborationNote",
    kind: "mutation",
    tool: "update_collaboration_note",
    minRole: "organizer",
    risk: "write",
    arguments: [
      {
        name: "input",
        type: "UpdateCollaborationNoteInput!",
      },
    ],
  },
  {
    operation: "createPost",
    kind: "mutation",
    tool: "create_post",
    minRole: "organizer",
    risk: "write",
    arguments: [
      {
        name: "input",
        type: "CreatePostInput!",
      },
    ],
  },
  {
    operation: "deletePost",
    kind: "mutation",
    tool: "delete_post",
    minRole: "admin",
    risk: "destructive",
    arguments: [
      {
        name: "input",
        type: "DeletePostInput!",
      },
    ],
  },
  {
    operation: "editPost",
    kind: "mutation",
    tool: "edit_post",
    minRole: "organizer",
    risk: "write",
    arguments: [
      {
        name: "input",
        type: "EditPostInput!",
      },
    ],
  },
  {
    operation: "movePostInQueue",
    kind: "mutation",
    tool: "move_post_in_queue",
    minRole: "organizer",
    risk: "write",
    arguments: [
      {
        name: "input",
        type: "MovePostInQueueInput!",
      },
    ],
  },
  {
    operation: "addPostToContentItem",
    kind: "mutation",
    tool: "add_post_to_content_item",
    minRole: "organizer",
    risk: "write",
    arguments: [
      {
        name: "input",
        type: "AddPostToContentItemInput!",
      },
    ],
  },
  {
    operation: "createContentItem",
    kind: "mutation",
    tool: "create_content_item",
    minRole: "organizer",
    risk: "write",
    arguments: [
      {
        name: "input",
        type: "CreateContentItemInput!",
      },
    ],
  },
  {
    operation: "createContentItemDraft",
    kind: "mutation",
    tool: "create_content_item_draft",
    minRole: "organizer",
    risk: "write",
    arguments: [
      {
        name: "input",
        type: "CreateContentItemDraftInput!",
      },
    ],
  },
  {
    operation: "deleteContentItem",
    kind: "mutation",
    tool: "delete_content_item",
    minRole: "admin",
    risk: "destructive",
    arguments: [
      {
        name: "input",
        type: "DeleteContentItemInput!",
      },
    ],
  },
  {
    operation: "promoteContentItemDraftToPosts",
    kind: "mutation",
    tool: "promote_content_item_draft_to_posts",
    minRole: "organizer",
    risk: "write",
    arguments: [
      {
        name: "input",
        type: "PromoteContentItemDraftToPostsInput!",
      },
    ],
  },
  {
    operation: "removePostFromContentItem",
    kind: "mutation",
    tool: "remove_post_from_content_item",
    minRole: "organizer",
    risk: "write",
    arguments: [
      {
        name: "input",
        type: "RemovePostFromContentItemInput!",
      },
    ],
  },
  {
    operation: "updateContentItem",
    kind: "mutation",
    tool: "update_content_item",
    minRole: "organizer",
    risk: "write",
    arguments: [
      {
        name: "input",
        type: "UpdateContentItemInput!",
      },
    ],
  },
  {
    operation: "updateContentItemDraft",
    kind: "mutation",
    tool: "update_content_item_draft",
    minRole: "organizer",
    risk: "write",
    arguments: [
      {
        name: "input",
        type: "UpdateContentItemDraftInput!",
      },
    ],
  },
  {
    operation: "createTag",
    kind: "mutation",
    tool: "create_tag",
    minRole: "organizer",
    risk: "write",
    arguments: [
      {
        name: "input",
        type: "CreateTagInput!",
      },
    ],
  },
  {
    operation: "deleteTag",
    kind: "mutation",
    tool: "delete_tag",
    minRole: "admin",
    risk: "destructive",
    arguments: [
      {
        name: "input",
        type: "DeleteTagInput!",
      },
    ],
  },
  {
    operation: "updateTag",
    kind: "mutation",
    tool: "update_tag",
    minRole: "organizer",
    risk: "write",
    arguments: [
      {
        name: "input",
        type: "UpdateTagInput!",
      },
    ],
  },
  {
    operation: "createPostTemplate",
    kind: "mutation",
    tool: "create_post_template",
    minRole: "organizer",
    risk: "write",
    arguments: [
      {
        name: "input",
        type: "CreatePostTemplateInput!",
      },
    ],
  },
  {
    operation: "deletePostTemplate",
    kind: "mutation",
    tool: "delete_post_template",
    minRole: "admin",
    risk: "destructive",
    arguments: [
      {
        name: "input",
        type: "DeletePostTemplateInput!",
      },
    ],
  },
  {
    operation: "updatePostTemplate",
    kind: "mutation",
    tool: "update_post_template",
    minRole: "organizer",
    risk: "write",
    arguments: [
      {
        name: "input",
        type: "UpdatePostTemplateInput!",
      },
    ],
  },
  {
    operation: "createIdea",
    kind: "mutation",
    tool: "create_idea",
    minRole: "organizer",
    risk: "write",
    arguments: [
      {
        name: "input",
        type: "CreateIdeaInput!",
      },
    ],
  },
] as const;
