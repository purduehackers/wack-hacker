// Generated from the reviewed Buffer schema. Do not narrow provider inputs.
import { z } from "zod";
export const accountArguments = z.strictObject({});
export const DailyPostingLimitsInputSchema = z.strictObject({
  channelIds: z
    .array(z.string().max(100_000))
    .max(1000)
    .describe(
      "List of channel IDs to check limits for. All channels must belong to the same organization.",
    ),
  date: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe(
      "The intended posting time. Defaults to now if not provided.\nFor X, the exact time determines the affected rolling 24-hour windows.\nFor other networks, the date selects the channel's local calendar day.",
    ),
});
export const dailyPostingLimitsArguments = z.strictObject({
  input: DailyPostingLimitsInputSchema.describe("Query's input."),
});
export const ChannelInputSchema = z.strictObject({
  id: z.string().max(100_000).describe("The ID of the channel to be retrieved"),
});
export const channelArguments = z.strictObject({
  input: ChannelInputSchema.describe("Query's input."),
});
export const ChannelsFiltersInputSchema = z.strictObject({
  isLocked: z
    .boolean()
    .nullable()
    .optional()
    .describe(
      "If not defined, it returns all channels\nElse,\n  if true, it only returns locked channels\n  if false, it only returns not locked channels",
    ),
  product: z
    .enum(["analyze", "buffer", "comments", "engage", "publish", "startPage"])
    .nullable()
    .optional()
    .describe(
      "If not passed, it return all channels\nElse, it filters the channels based on what the product supports.",
    ),
});
export const ChannelsInputSchema = z.strictObject({
  filter: ChannelsFiltersInputSchema.nullable()
    .optional()
    .describe("A list of option filters - passing null means we don't want to filter"),
  organizationId: z.string().max(100_000).describe("The Organization id to fetch channels for"),
});
export const channelsArguments = z.strictObject({
  input: ChannelsInputSchema.describe("Query's input."),
});
export const TagComparatorSchema = z.strictObject({
  in: z
    .array(z.string().max(100_000))
    .max(1000)
    .describe("Include results that have any of the specified tags (union/OR)."),
  isEmpty: z
    .boolean()
    .describe(
      "When true, include results that have no tags assigned.\nCan be combined with 'in' for union filtering.\nDefaults to false if not specified.",
    ),
});
export const AggregatedPostMetricsInputSchema = z.strictObject({
  channelIds: z
    .array(z.string().max(100_000))
    .max(1000)
    .nullable()
    .optional()
    .describe(
      "Optional list of channel IDs to filter by. When omitted (null), the\naggregate spans every channel in the organization the actor has\ninsights access to. When set to an empty array, no channels match and\nthe result is empty.",
    ),
  endDateTime: z
    .string()
    .max(100_000)
    .describe(
      "End of the aggregation window. Consumers typically pass UTC midnight of\nthe last calendar day in the window (the backend treats the range as\ninclusive of that day), for example `2026-01-31T00:00:00Z`. Date range\nis capped to 365 days.",
    ),
  organizationId: z.string().max(100_000).describe("The organization ID"),
  startDateTime: z
    .string()
    .max(100_000)
    .describe(
      "Start of the aggregation window. Consumers typically pass UTC midnight\nof the first calendar day in the window, for example\n`2026-01-01T00:00:00Z`. Must be no more than 2 years before now; older\nrequests are rejected.",
    ),
  tags: TagComparatorSchema.nullable()
    .optional()
    .describe(
      "Filter to posts with specific tags.\nWhen omitted, all posts are included regardless of tags.",
    ),
});
export const aggregatedPostMetricsArguments = z.strictObject({
  input: AggregatedPostMetricsInputSchema.describe(
    "Query's input: organization, date range, optional channel and tag\nfilters. Date range is capped to 365 days.",
  ),
});
export const SnippetsInputSchema = z.strictObject({
  organizationId: z.string().max(100_000).describe("The organization whose snippets to return."),
});
export const snippetsArguments = z.strictObject({
  after: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe(
      "The cursor after which to return results. Cursors are opaque: treat\nthem as a black box.",
    ),
  first: z
    .int()
    .min(-2_147_483_648)
    .max(2_147_483_647)
    .nullable()
    .optional()
    .describe("The number of snippets to return, from 1 to 100. Defaults to 10."),
  input: SnippetsInputSchema.describe("The query input."),
});
export const CollaborationNoteSubjectInputSchema = z.strictObject({
  contentItemId: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe(
      "The ContentItem ID. Selects the ContentItem's own thread, not the threads of\nits Posts.",
    ),
  postId: z.string().max(100_000).nullable().optional().describe("The Post ID."),
});
export const CollaborationNotesInputSchema = z.strictObject({
  subject: CollaborationNoteSubjectInputSchema.describe("The entity whose Notes thread to read."),
});
export const collaborationNotesArguments = z.strictObject({
  after: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("The opaque cursor after which to read Notes."),
  first: z
    .int()
    .min(-2_147_483_648)
    .max(2_147_483_647)
    .nullable()
    .optional()
    .describe("The number of Notes to read, from 1 through 100. The default is 10."),
  input: CollaborationNotesInputSchema.describe("The thread whose Notes to read."),
});
export const PostInputSchema = z.strictObject({
  id: z.string().max(100_000).describe("The ID of the post to be retrieved"),
});
export const postArguments = z.strictObject({ input: PostInputSchema.describe("Query's input.") });
export const DateTimeComparatorSchema = z.strictObject({
  end: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("Include results with dates equal to or before\nthe specified date"),
  start: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("Include results with dates equal to or after\nthe specified date"),
});
export const PostsFiltersInputSchema = z.strictObject({
  channelIds: z
    .array(z.string().max(100_000))
    .max(1000)
    .nullable()
    .optional()
    .describe("When set, it will filter posts by channel"),
  dueAt: DateTimeComparatorSchema.nullable()
    .optional()
    .describe("When set, it will filter posts by their scheduled posting date"),
  dueAtPresence: z
    .enum(["absent", "present"])
    .nullable()
    .optional()
    .describe(
      "When set, it will filter posts by whether their scheduled posting date exists.\n`absent` cannot be combined with `dueAt`, because absent dates cannot also match a date range.",
    ),
  postTypes: z
    .array(
      z.enum([
        "carousel",
        "event",
        "ghost_post",
        "offer",
        "post",
        "reel",
        "short",
        "story",
        "thread",
        "whats_new",
      ]),
    )
    .max(1000)
    .nullable()
    .optional()
    .describe(
      "When set, it will filter posts by format.\n\n`post` is a fallback bucket rather than one stored format: it matches every\npost the other formats do not claim, which is what `Post.metadata.type`\nreports for the same post. `carousel` and `thread` are rejected, because no\nstored value resolves to them.",
    ),
  status: z
    .array(z.enum(["draft", "error", "needs_approval", "scheduled", "sending", "sent"]))
    .max(1000)
    .nullable()
    .optional()
    .describe("When set, it will filter posts by status"),
  tags: TagComparatorSchema.nullable()
    .optional()
    .describe("Filter posts by tags. Supports specific tags, untagged posts, or union of both."),
  createdAt: DateTimeComparatorSchema.nullable()
    .optional()
    .describe("When set, it will filter posts by the date they were created"),
});
export const PostSortInputSchema = z.strictObject({
  direction: z.enum(["asc", "desc"]).describe("The direction to sort by."),
  field: z.enum(["dueAt", "createdAt"]).describe("The field to sort by."),
});
export const PostsInputSchema = z.strictObject({
  filter: PostsFiltersInputSchema.nullable()
    .optional()
    .describe("The filters to apply to the posts query"),
  organizationId: z.string().max(100_000).describe("The Organization id to fetch posts for"),
  sort: z
    .array(PostSortInputSchema)
    .max(1000)
    .nullable()
    .optional()
    .describe("The sort to apply to the posts results"),
});
export const postsArguments = z.strictObject({
  after: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("The cursor of the post to start fetching from"),
  first: z
    .int()
    .min(-2_147_483_648)
    .max(2_147_483_647)
    .nullable()
    .optional()
    .describe("The number of posts to return"),
  input: PostsInputSchema.describe("Query's input."),
});
export const ContentItemInputSchema = z.strictObject({
  id: z.string().max(100_000).describe("The unique identifier of the content item to fetch."),
});
export const contentItemArguments = z.strictObject({
  input: ContentItemInputSchema.describe("Input for fetching a single content item."),
});
export const ContentItemsTargetDateFilterSchema = z.strictObject({
  presence: z
    .enum(["absent", "present"])
    .nullable()
    .optional()
    .describe(
      "Only return content items by whether a target date is set: `present`\nreturns only dated items, `absent` only undated ones.",
    ),
  range: DateTimeComparatorSchema.nullable()
    .optional()
    .describe(
      "Only return content items whose target date falls within this range.\nA range with no bounds returns every content item that has a target date.",
    ),
});
export const ContentItemsFilterSchema = z.strictObject({
  contentStatus: z
    .enum(["draftContent", "postContent"])
    .nullable()
    .optional()
    .describe(
      "Only return content items with this content status. When omitted, content\nitems in every status are returned.",
    ),
  tags: TagComparatorSchema.nullable()
    .optional()
    .describe(
      "Only return content items carrying one of these tags, or, with `isEmpty`,\ncontent items with no tags at all. Matches the tags applied to the content\nitem itself, not tags applied later to an individual post.",
    ),
  targetDate: ContentItemsTargetDateFilterSchema.nullable()
    .optional()
    .describe("Only return content items matching this target date filter."),
});
export const ContentItemsSortInputSchema = z.strictObject({
  direction: z.enum(["asc", "desc"]).describe("The direction to sort by."),
  field: z.enum(["targetDate", "createdAt"]).describe("The field to sort by."),
});
export const ContentItemsInputSchema = z.strictObject({
  filter: ContentItemsFilterSchema.nullable()
    .optional()
    .describe(
      "Filters to apply. When omitted, all of the organization's content items\nare returned.",
    ),
  organizationId: z
    .string()
    .max(100_000)
    .describe(
      "Organization to list content items for. The caller must be a member of\nthis organization.",
    ),
  sort: z
    .array(ContentItemsSortInputSchema)
    .max(1000)
    .nullable()
    .optional()
    .describe(
      "Sorting to apply, each entry breaking ties in the one before it. Defaults to\nnewest first. A pagination cursor is only valid for the sort that produced\nit, so reset `after` to null whenever the sort changes.",
    ),
});
export const contentItemsArguments = z.strictObject({
  after: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe(
      "The cursor after which to return results. Cursors are opaque: treat\nthem as a black box and reset to null when the input changes, since a\ncursor from a different result set produces undefined behavior.",
    ),
  first: z
    .int()
    .min(-2_147_483_648)
    .max(2_147_483_647)
    .nullable()
    .optional()
    .describe("The number of content items to return, up to 100."),
  input: ContentItemsInputSchema.describe("Input for listing content items."),
});
export const TagByIdInputSchema = z.strictObject({
  id: z.string().max(100_000).describe("The unique identifier of the tag to fetch."),
});
export const tagArguments = z.strictObject({
  input: TagByIdInputSchema.describe("Identifies the tag to fetch."),
});
export const TagsFiltersInputSchema = z.strictObject({
  isLocked: z
    .boolean()
    .nullable()
    .optional()
    .describe(
      "Return only locked tags when true, only unlocked tags when false. Omit to\nreturn both. See `Tag.isLocked` for what locking means.",
    ),
});
export const TagsInputSchema = z.strictObject({
  filter: TagsFiltersInputSchema.nullable()
    .optional()
    .describe("Filters to apply. When omitted, all of the organization's tags are returned."),
  organizationId: z
    .string()
    .max(100_000)
    .describe("Organization to list tags for. The caller must be a member of this\norganization."),
});
export const tagsV2Arguments = z.strictObject({
  after: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe(
      "The cursor after which to return results. Cursors are opaque: treat them as\na black box and reset to null when the input changes, since a cursor from a\ndifferent result set produces undefined behavior.",
    ),
  first: z
    .int()
    .min(-2_147_483_648)
    .max(2_147_483_647)
    .nullable()
    .optional()
    .describe("The number of tags to return, up to 100."),
  input: TagsInputSchema.describe(
    "Identifies the organization whose tags to list, and how to filter them.",
  ),
});
export const TeamMemberSelectionScopeInputSchema = z.strictObject({
  channelId: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe(
      "Select from the members who can read Notes on this channel.\nThe organization is derived from the channel.",
    ),
  organizationId: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("Select from the members of this organization."),
});
export const SelectableTeamMembersInputSchema = z.strictObject({
  scope: TeamMemberSelectionScopeInputSchema.describe("The scope to select team members from."),
  search: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe(
      "A case-insensitive substring to match against name or email. Omitted, null\nor blank returns every member in scope. Reset `after` to null when this\nchanges, because the cursor is only meaningful within one filtered list.",
    ),
});
export const selectableTeamMembersArguments = z.strictObject({
  after: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("The opaque cursor after which to read team members."),
  first: z
    .int()
    .min(-2_147_483_648)
    .max(2_147_483_647)
    .nullable()
    .optional()
    .describe("The number of team members to read, from 1 through 100. The default is 10."),
  input: SelectableTeamMembersInputSchema.describe("The scope and search term."),
});
export const InstagramAudioInputSchema = z.strictObject({
  audioId: z.string().max(100_000).describe("Meta audio asset ID"),
  channelId: z.string().max(100_000).describe("Instagram channel used to authorize the refresh"),
});
export const instagramAudioArguments = z.strictObject({
  input: InstagramAudioInputSchema.describe("Channel and audio asset used to refresh metadata."),
});
export const SearchInstagramAudioInputSchema = z.strictObject({
  audioType: z.enum(["music", "originalSound"]).describe("Music or original sound catalog"),
  channelId: z.string().max(100_000).describe("Instagram channel to search audio for"),
  query: z
    .string()
    .max(100_000)
    .describe("Search text. Required. Use trendingInstagramAudio for trending results."),
});
export const searchInstagramAudioArguments = z.strictObject({
  input: SearchInstagramAudioInputSchema.describe("Channel, catalog type, and search text."),
});
export const TrendingInstagramAudioInputSchema = z.strictObject({
  audioType: z.enum(["music", "originalSound"]).describe("Music or original sound catalog"),
  channelId: z.string().max(100_000).describe("Instagram channel to load trending audio for"),
});
export const trendingInstagramAudioArguments = z.strictObject({
  input: TrendingInstagramAudioInputSchema.describe(
    "Channel and catalog type for Meta trending audio.",
  ),
});
export const InstagramAudioCatalogInputSchema = z.strictObject({
  channelId: z
    .string()
    .max(100_000)
    .describe("Instagram channel used to authorize the catalog request."),
});
export const instagramAudioCatalogArguments = z.strictObject({
  input: InstagramAudioCatalogInputSchema.describe(
    "Channel to load trending audio for. No catalog selection is needed.",
  ),
});
export const SearchInstagramAudioCatalogInputSchema = z.strictObject({
  channelId: z.string().max(100_000).describe("Instagram channel used to authorize the search."),
  query: z.string().max(100_000).describe("Search text. Must not be blank."),
});
export const searchInstagramAudioCatalogArguments = z.strictObject({
  input: SearchInstagramAudioCatalogInputSchema.describe(
    "Channel and nonblank search text. No catalog selection is needed.",
  ),
});
export const ConfigurationInputSchema = z.strictObject({
  organizationId: z.string().max(100_000).describe("The organization to return configuration for."),
});
export const configurationArguments = z.strictObject({
  input: ConfigurationInputSchema.describe("Input for the configuration query."),
});
export const PostTemplateInputSchema = z.strictObject({
  id: z.string().max(100_000).describe("The unique identifier of the template to fetch."),
});
export const postTemplateArguments = z.strictObject({
  input: PostTemplateInputSchema.describe("Input for fetching a single post template."),
});
export const PostTemplatesFilterInputSchema = z.strictObject({
  visibility: z
    .enum(["internal", "private", "public"])
    .nullable()
    .optional()
    .describe(
      "Narrow the result to a single visibility scope. Omit to receive the\nunion of: public templates, internal templates from the supplied\norganization, and private templates from the actor's account.",
    ),
});
export const PostTemplatesInputSchema = z.strictObject({
  filter: PostTemplatesFilterInputSchema.nullable()
    .optional()
    .describe("Optional filters to narrow the template list."),
  organizationId: z
    .string()
    .max(100_000)
    .describe(
      "Organization to scope `internal`-visibility templates to. The caller\nmust be a member of this organization.",
    ),
});
export const postTemplatesArguments = z.strictObject({
  after: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("The cursor after which to return results."),
  first: z
    .int()
    .min(-2_147_483_648)
    .max(2_147_483_647)
    .nullable()
    .optional()
    .describe("The number of templates to return."),
  input: PostTemplatesInputSchema.describe(
    "Input containing the organization scope and optional filters.",
  ),
});
export const IdeaGroupsInputSchema = z.strictObject({
  organizationId: z.string().max(100_000).describe("Unique identifier for the organization."),
});
export const ideaGroupsArguments = z.strictObject({
  input: IdeaGroupsInputSchema.describe("Input for retrieving idea groups."),
});
export const IdeasGroupFilterSchema = z.strictObject({
  groups: z
    .array(z.string().max(100_000))
    .max(1000)
    .nullable()
    .optional()
    .describe("Return only ideas that belong to these specific groups (union/OR)."),
  membership: z
    .enum(["grouped", "ungrouped"])
    .nullable()
    .optional()
    .describe("Return ideas by a group-membership bucket rather than by specific group IDs."),
});
export const IdeasInputSchema = z.strictObject({
  groupFilter: IdeasGroupFilterSchema.nullable()
    .optional()
    .describe(
      "Filter ideas by group membership. Omit this field entirely to return ideas\nacross all groups.",
    ),
  organizationId: z.string().max(100_000).describe("The organization to fetch ideas from."),
  tagsFilter: TagComparatorSchema.nullable()
    .optional()
    .describe("Filter ideas by tags using TagComparator."),
});
export const ideasArguments = z.strictObject({
  after: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("Cursor for pagination, marks where to start fetching from"),
  first: z
    .int()
    .min(-2_147_483_648)
    .max(2_147_483_647)
    .nullable()
    .optional()
    .describe("Maximum number of items to return"),
  input: IdeasInputSchema.describe("Filtering criteria for the ideas list"),
});
export const CreateSnippetInputSchema = z.strictObject({
  name: z.string().max(100_000).describe("Display name of the snippet."),
  organizationId: z.string().max(100_000).describe("The organization that owns the snippet."),
  text: z.string().max(100_000).describe("The hashtags, as the text that is inserted into a post."),
});
export const createSnippetArguments = z.strictObject({
  input: CreateSnippetInputSchema.describe("Input for createSnippet."),
});
export const DeleteSnippetInputSchema = z.strictObject({
  id: z.string().max(100_000).describe("The snippet to delete."),
  organizationId: z.string().max(100_000).describe("The organization that owns the snippet."),
});
export const deleteSnippetArguments = z.strictObject({
  input: DeleteSnippetInputSchema.describe("Input for deleteSnippet."),
});
export const UpdateSnippetInputSchema = z.strictObject({
  id: z.string().max(100_000).describe("The snippet to update."),
  name: z.string().max(100_000).describe("The new display name of the snippet."),
  organizationId: z.string().max(100_000).describe("The organization that owns the snippet."),
  text: z
    .string()
    .max(100_000)
    .describe("The new hashtags, as the text that is inserted into a post."),
});
export const updateSnippetArguments = z.strictObject({
  input: UpdateSnippetInputSchema.describe("Input for updateSnippet."),
});
export const AnnotationInputSchema = z.strictObject({
  content: z.string().max(100_000).describe("The text content in the annotation span."),
  displayValue: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("The display value, when present."),
  indices: z
    .array(z.int().min(-2_147_483_648).max(2_147_483_647))
    .max(1000)
    .describe("The start and exclusive end offsets in the text."),
  serviceEntityId: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("The service entity ID, when present."),
  text: z.string().max(100_000).describe("The text representation of the annotation."),
  type: z
    .enum([
      "annotation",
      "bold",
      "bulletedListItem",
      "cashtag",
      "hashtag",
      "heading",
      "italic",
      "mention",
      "orderedListItem",
      "strikethrough",
      "url",
    ])
    .describe("The annotation type."),
  url: z.string().max(100_000).nullable().optional().describe("The annotation URL, when present."),
});
export const CreateCollaborationNoteInputSchema = z.strictObject({
  annotations: z
    .array(AnnotationInputSchema)
    .max(1000)
    .nullable()
    .optional()
    .describe("The annotations for the Note. Omit or pass null to use an empty list."),
  subject: CollaborationNoteSubjectInputSchema.describe(
    "The entity whose Notes thread gets the Note.",
  ),
  text: z.string().max(100_000).describe("The Note text."),
});
export const createCollaborationNoteArguments = z.strictObject({
  input: CreateCollaborationNoteInputSchema.describe("The new Note content."),
});
export const DeleteCollaborationNoteInputSchema = z.strictObject({
  noteId: z.string().max(100_000).describe("The Note ID."),
});
export const deleteCollaborationNoteArguments = z.strictObject({
  input: DeleteCollaborationNoteInputSchema.describe("The Note to delete."),
});
export const UpdateCollaborationNoteInputSchema = z.strictObject({
  annotations: z
    .array(AnnotationInputSchema)
    .max(1000)
    .nullable()
    .optional()
    .describe(
      "The annotations for the Note. Omit or pass null to replace them with an empty list.",
    ),
  noteId: z.string().max(100_000).describe("The Note ID."),
  text: z.string().max(100_000).describe("The replacement Note text."),
});
export const updateCollaborationNoteArguments = z.strictObject({
  input: UpdateCollaborationNoteInputSchema.describe("The replacement Note content."),
});
export const DocumentAssetInputSchema = z.strictObject({
  thumbnailUrl: z.string().max(100_000).describe("Document thumbnail URL"),
  title: z.string().max(100_000).describe("Document title"),
  url: z.string().max(100_000).describe("Document URL"),
});
export const UserTagInputSchema = z.strictObject({
  handle: z
    .string()
    .max(100_000)
    .describe("The handle (username) of the account to tag, without the leading @."),
  x: z
    .number()
    .describe(
      "Horizontal position of the tag as a normalized decimal float between 0.0 and 1.0 - the fraction of the image width from the left edge (0.5 is the horizontal center). Pass a number, not a string, and do not use pixel coordinates; to convert, divide the pixel X by the image width.",
    ),
  y: z
    .number()
    .describe(
      "Vertical position of the tag as a normalized decimal float between 0.0 and 1.0 - the fraction of the image height from the top edge (0.5 is the vertical center). Pass a number, not a string, and do not use pixel coordinates; to convert, divide the pixel Y by the image height.",
    ),
});
export const ImageMetadataInputSchema = z.strictObject({
  altText: z.string().max(100_000).describe("Alternative text for accessibility"),
  animatedThumbnail: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("Animated thumbnail URL"),
  userTags: z
    .array(UserTagInputSchema)
    .max(1000)
    .nullable()
    .optional()
    .describe(
      "Accounts to tag at specific points on the image. Each tag's x/y position uses normalized 0.0-1.0 coordinates - see UserTagInput.",
    ),
});
export const ImageAssetInputSchema = z.strictObject({
  metadata: ImageMetadataInputSchema.nullable().optional().describe("Image specific metadata"),
  thumbnailUrl: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("URL to the static thumbnail of the asset"),
  url: z.string().max(100_000).describe("URL to the file source"),
});
export const VideoMetadataInputSchema = z.strictObject({
  thumbnailOffset: z
    .int()
    .min(-2_147_483_648)
    .max(2_147_483_647)
    .nullable()
    .optional()
    .describe("Offset of the thumbnail chosen for the video, in ms"),
  title: z.string().max(100_000).nullable().optional().describe("Video title"),
});
export const VideoAssetInputSchema = z.strictObject({
  metadata: VideoMetadataInputSchema.nullable().optional().describe("Video specific metadata"),
  thumbnailUrl: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe(
      "Do not use: social networks do not accept custom video thumbnail images, and\nthe API rejects video assets that set this field. To choose the video\nthumbnail, set `metadata.thumbnailOffset` to select a frame from the video\n(supported for Instagram, TikTok, and Pinterest only).",
    ),
  url: z.string().max(100_000).describe("URL to the file source"),
});
export const AssetInputSchema = z.strictObject({
  document: DocumentAssetInputSchema.nullable().optional().describe("Document asset"),
  image: ImageAssetInputSchema.nullable().optional().describe("Image asset"),
  video: VideoAssetInputSchema.nullable().optional().describe("Video asset"),
});
export const LinkAttachmentThumbnailInputSchema = z.strictObject({
  url: z.string().max(100_000).describe("URL of the thumbnail image"),
});
export const LinkAttachmentInputSchema = z.strictObject({
  description: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("Description shown on the link card"),
  thumbnail: LinkAttachmentThumbnailInputSchema.nullable()
    .optional()
    .describe("Thumbnail shown on the link card"),
  title: z.string().max(100_000).nullable().optional().describe("Title shown on the link card"),
  url: z.string().max(100_000).describe("URL that the link asset has been built from"),
});
export const ThreadItemBlueskyMetadataInputSchema = z.strictObject({
  linkAttachment: LinkAttachmentInputSchema.nullable()
    .optional()
    .describe(
      "Link attachment. Mutually exclusive with a non-empty `assets` array — input providing both is rejected.",
    ),
});
export const ThreadItemThreadsMetadataInputSchema = z.strictObject({
  linkAttachment: LinkAttachmentInputSchema.nullable()
    .optional()
    .describe(
      "Link attachment. Mutually exclusive with a non-empty `assets` array — input providing both is rejected.",
    ),
});
export const ThreadItemMetadataInputSchema = z.strictObject({
  bluesky: ThreadItemBlueskyMetadataInputSchema.nullable()
    .optional()
    .describe("Bluesky fields for this thread item"),
  threads: ThreadItemThreadsMetadataInputSchema.nullable()
    .optional()
    .describe("Threads fields for this thread item"),
});
export const ThreadedPostInputSchema = z.strictObject({
  assets: z
    .array(AssetInputSchema)
    .max(1000)
    .describe("Ordered list of assets on this threaded post"),
  metadata: ThreadItemMetadataInputSchema.nullable()
    .optional()
    .describe("Service-specific fields for this threaded post"),
  text: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("The text body content of the threaded post"),
});
export const BlueskyPostMetadataInputSchema = z.strictObject({
  linkAttachment: LinkAttachmentInputSchema.nullable()
    .optional()
    .describe(
      "Link attachment. Mutually exclusive with a non-empty `assets` array — input providing both is rejected.",
    ),
  thread: z
    .array(ThreadedPostInputSchema)
    .max(1000)
    .nullable()
    .optional()
    .describe(
      "The ordered list of posts that make up the thread (not paginated). This\narray is the source of truth for what gets published: every post in the\nthread, including the root post, must be provided here. Posts are\npublished in order, each replying to the previous one. The first item is\nthe root post and should match the top-level `text` on the post input.",
    ),
});
export const AnnotationInputFacebookSchema = z.strictObject({
  content: z
    .string()
    .max(100_000)
    .describe("The content of the annotation, e.g. '107509875938399'"),
  indices: z
    .array(z.int().min(-2_147_483_648).max(2_147_483_647))
    .max(1000)
    .describe(
      "The indices of the annotation in the text, e.g. [6, 9] (from 6 to 9 characters in the text)",
    ),
  text: z.string().max(100_000).describe("The text representation of the annotation, eg 'Buffer'"),
  url: z
    .string()
    .max(100_000)
    .describe("The URL the annotation points to, e.g. https://www.facebook.com/107509875938399"),
});
export const FacebookPostMetadataInputSchema = z.strictObject({
  annotations: z
    .array(AnnotationInputFacebookSchema)
    .max(1000)
    .nullable()
    .optional()
    .describe("Annotations representing entities in the text"),
  firstComment: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("Facebook post's first comment"),
  linkAttachment: LinkAttachmentInputSchema.nullable()
    .optional()
    .describe(
      "Link attachment. Mutually exclusive with a non-empty `assets` array — input providing both is rejected.",
    ),
  type: z
    .enum(["post", "reel", "story"])
    .describe("The channel-specific type of the post, eg, post, story, reel for Facebook"),
});
export const GoogleBusinessEventMetaDataInputSchema = z.strictObject({
  button: z
    .enum(["book", "call", "learn_more", "none", "order", "shop", "signup"])
    .nullable()
    .optional()
    .describe(
      "Action button. Optional: a post with no button, or `none`, publishes without a call-to-action. On edit, omitting it preserves the existing value.",
    ),
  endDate: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe(
      "End date of the event. Required on create; optional on edit (omitted preserves existing value).",
    ),
  isFullDayEvent: z.boolean().describe("Indicate whether the event has a start or end time."),
  link: z.string().max(100_000).nullable().optional().describe("Link to the action"),
  startDate: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe(
      "Start date of the event. Required on create; optional on edit (omitted preserves existing value).",
    ),
  title: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe(
      "Title of the event. Required on create; optional on edit (omitted preserves existing value).",
    ),
});
export const GoogleBusinessOfferMetaDataInputSchema = z.strictObject({
  code: z.string().max(100_000).nullable().optional().describe("Coupon code for the offer"),
  endDate: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe(
      "End date of the offer. Required on create; optional on edit (omitted preserves existing value).",
    ),
  link: z.string().max(100_000).nullable().optional().describe("Link to the offer"),
  startDate: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe(
      "Start date of the offer. Required on create; optional on edit (omitted preserves existing value).",
    ),
  terms: z.string().max(100_000).nullable().optional().describe("Terms and Conditions"),
  title: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe(
      "Title of the offer. Required on create; optional on edit (omitted preserves existing value).",
    ),
});
export const GoogleBusinessWhatsNewMetaDataInputSchema = z.strictObject({
  button: z
    .enum(["book", "call", "learn_more", "none", "order", "shop", "signup"])
    .nullable()
    .optional()
    .describe(
      "Action button. Optional: a post with no button, or `none`, publishes without a call-to-action. On edit, omitting it preserves the existing value.",
    ),
  link: z.string().max(100_000).nullable().optional().describe("Link to the action"),
});
export const GoogleBusinessPostMetadataInputSchema = z.strictObject({
  detailsEvent: GoogleBusinessEventMetaDataInputSchema.nullable()
    .optional()
    .describe("Details of the Event metadata"),
  detailsOffer: GoogleBusinessOfferMetaDataInputSchema.nullable()
    .optional()
    .describe("Details of the Offer metadata"),
  detailsWhatsNew: GoogleBusinessWhatsNewMetaDataInputSchema.nullable()
    .optional()
    .describe("Details of the Whats new metadata"),
  title: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("Title if available in the given GBP post type: event and offer"),
  type: z
    .enum(["event", "offer", "whats_new"])
    .describe(
      "The channel-specific type of the post, eg, post, offer, event for Google Business Profile",
    ),
});
export const InstagramGeolocationInputSchema = z.strictObject({
  id: z.string().max(100_000).nullable().optional().describe("The id of this location"),
  text: z.string().max(100_000).nullable().optional().describe("The name of this location"),
});
export const InstagramStickerFieldsInputSchema = z.strictObject({
  music: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("Placeholder text for the post's music"),
  other: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("Additional field for any other post content"),
  products: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("Placeholder text for the post's linked products"),
  text: z.string().max(100_000).nullable().optional().describe("Text for the Story or Reel"),
  topics: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("Placeholder text for the post's topics (Reels only)"),
});
export const InstagramPostMetadataInputSchema = z.strictObject({
  firstComment: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("Instagram post's first comment"),
  geolocation: InstagramGeolocationInputSchema.nullable()
    .optional()
    .describe("Geolocation of the post"),
  isAiGenerated: z
    .boolean()
    .nullable()
    .optional()
    .describe("Whether the post discloses AI-generated content"),
  link: z.string().max(100_000).nullable().optional().describe("Shop Grid link for the post"),
  shouldShareToFeed: z.boolean().describe("Indicates whether post should be shared to feed"),
  stickerFields: InstagramStickerFieldsInputSchema.nullable()
    .optional()
    .describe("Sticker fields for reminder-based publishing"),
  type: z
    .enum([
      "carousel",
      "event",
      "ghost_post",
      "offer",
      "post",
      "reel",
      "short",
      "story",
      "thread",
      "whats_new",
    ])
    .describe("The channel-specific type of the post, eg, post, story, reel for Instagram"),
});
export const AnnotationInputLinkedInSchema = z.strictObject({
  id: z.string().max(100_000).describe("The id of the annotation, e.g. 1521226"),
  entity: z
    .string()
    .max(100_000)
    .describe("The entity of the annotation, e.g. urn:li:organization:1521226"),
  length: z
    .int()
    .min(-2_147_483_648)
    .max(2_147_483_647)
    .describe("The length of the annotation, e.g. 6"),
  link: z
    .string()
    .max(100_000)
    .describe("The link of the annotation, e.g. https://www.linkedin.com/company/bufferapp"),
  localizedName: z
    .string()
    .max(100_000)
    .describe("The localized name of the annotation, e.g. Buffer"),
  start: z
    .int()
    .min(-2_147_483_648)
    .max(2_147_483_647)
    .describe("The start of the annotation, e.g. 5"),
  vanityName: z.string().max(100_000).describe("The vanity name of the annotation, e.g. bufferapp"),
});
export const LinkedInPostMetadataInputSchema = z.strictObject({
  annotations: z
    .array(AnnotationInputLinkedInSchema)
    .max(1000)
    .nullable()
    .optional()
    .describe("Annotations representing entities in the text"),
  firstComment: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("LinkedIn post's first comment"),
  linkAttachment: LinkAttachmentInputSchema.nullable()
    .optional()
    .describe(
      "Link attachment. Mutually exclusive with a non-empty `assets` array — input providing both is rejected.",
    ),
});
export const MastodonPostMetadataInputSchema = z.strictObject({
  spoilerText: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("Spoiler text hiding the root text of this post"),
  thread: z
    .array(ThreadedPostInputSchema)
    .max(1000)
    .nullable()
    .optional()
    .describe(
      "The ordered list of posts that make up the thread (not paginated). This\narray is the source of truth for what gets published: every post in the\nthread, including the root post, must be provided here. Posts are\npublished in order, each replying to the previous one. The first item is\nthe root post and should match the top-level `text` on the post input.",
    ),
});
export const PinterestPostMetadataInputSchema = z.strictObject({
  boardServiceId: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe(
      'The board ID of the Pin, can be obtained when fetching the channel details with the following query:\n```\nquery GetChannelWithSubprofiles {\n  channel(input: { id: "[CHANNEL_ID_HERE]" }) {\n    metadata {\n      ... on PinterestMetadata {\n        boards {\n          serviceId\n        }\n      }\n    }\n  }\n}\n```\nRequired on create; optional on edit (omitted preserves existing board).',
    ),
  title: z.string().max(100_000).nullable().optional().describe("The title of the Pin"),
  url: z.string().max(100_000).nullable().optional().describe("The Pin destination link"),
});
export const SubstackPostMetadataInputSchema = z.strictObject({
  linkAttachment: LinkAttachmentInputSchema.nullable()
    .optional()
    .describe(
      "Link attachment. Mutually exclusive with a non-empty `assets` array — input providing both is rejected.",
    ),
});
export const ThreadsPostMetadataInputSchema = z.strictObject({
  linkAttachment: LinkAttachmentInputSchema.nullable()
    .optional()
    .describe(
      "Link attachment. Mutually exclusive with a non-empty `assets` array — input providing both is rejected.",
    ),
  locationId: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("LocationId associated with the post"),
  locationName: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("Location name associated with the post"),
  thread: z
    .array(ThreadedPostInputSchema)
    .max(1000)
    .nullable()
    .optional()
    .describe(
      "The ordered list of posts that make up the thread (not paginated). This\narray is the source of truth for what gets published: every post in the\nthread, including the root post, must be provided here. Posts are\npublished in order, each replying to the previous one. The first item is\nthe root post and should match the top-level `text` on the post input.",
    ),
  topic: z.string().max(100_000).nullable().optional().describe("Topic associated with the post"),
  type: z
    .enum([
      "carousel",
      "event",
      "ghost_post",
      "offer",
      "post",
      "reel",
      "short",
      "story",
      "thread",
      "whats_new",
    ])
    .nullable()
    .optional()
    .describe("The type of the post"),
});
export const TikTokPostMetadataInputSchema = z.strictObject({
  isAiGenerated: z
    .boolean()
    .nullable()
    .optional()
    .describe("Whether the post discloses AI-generated content (TikTok video only)"),
  title: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("The title of the TikTok post (for photo posts)"),
});
export const RetweetMetadataInputSchema = z.strictObject({
  id: z.string().max(100_000).describe("Retweet ID"),
  comment: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("Optional user comment shown above the embedded retweet"),
});
export const TwitterPostMetadataInputSchema = z.strictObject({
  isAiGenerated: z
    .boolean()
    .nullable()
    .optional()
    .describe(
      "Whether the post discloses AI-generated content (original tweets only, never retweets)",
    ),
  retweet: RetweetMetadataInputSchema.nullable()
    .optional()
    .describe("The details of the tweet being retweeted"),
  thread: z
    .array(ThreadedPostInputSchema)
    .max(1000)
    .nullable()
    .optional()
    .describe(
      "The ordered list of posts that make up the thread (not paginated). This\narray is the source of truth for what gets published: every post in the\nthread, including the root post, must be provided here. Posts are\npublished in order, each replying to the previous one. The first item is\nthe root post and should match the top-level `text` on the post input.",
    ),
});
export const YoutubePostMetadataInputSchema = z.strictObject({
  categoryId: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe(
      "Youtube Category ID, one ID of this list:\nID: 1 -> Film & Animation\nID: 2 -> Autos & Vehicles\nID: 10 -> Music\nID: 15 -> Pets & Animals\nID: 17 -> Sports\nID: 19 -> Travel & Events\nID: 20 -> Gaming\nID: 22 -> People & Blogs\nID: 23 -> Comedy\nID: 24 -> Entertainment\nID: 25 -> News & Politics\nID: 26 -> Howto & Style\nID: 27 -> Education\nID: 28 -> Science & Technology\nID: 29 -> Nonprofits & Activism\n\nRequired on create; optional on edit (omitted preserves existing value).",
    ),
  embeddable: z
    .boolean()
    .nullable()
    .optional()
    .describe("Indicates whether the video allows embedding (default: true)"),
  isAiGenerated: z
    .boolean()
    .nullable()
    .optional()
    .describe("Whether the post discloses AI-generated content"),
  license: z
    .enum(["creativeCommon", "youtube"])
    .nullable()
    .optional()
    .describe("Video license (default: youtube)"),
  madeForKids: z
    .boolean()
    .nullable()
    .optional()
    .describe("Indicates whether the video is suitable for kids (default: false)"),
  notifySubscribers: z
    .boolean()
    .nullable()
    .optional()
    .describe("Indicates whether to notify subscribers on publish video (default: true)"),
  privacy: z
    .enum(["private", "public", "unlisted"])
    .nullable()
    .optional()
    .describe("Privacy setting for post (default: public)"),
  title: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe(
      "Title of the Youtube post. Required on create; optional on edit (omitted preserves existing value).",
    ),
});
export const PostInputMetaDataSchema = z.strictObject({
  bluesky: BlueskyPostMetadataInputSchema.nullable()
    .optional()
    .describe("Metadata for Bluesky post"),
  facebook: FacebookPostMetadataInputSchema.nullable()
    .optional()
    .describe("Metadata for Facebook post"),
  google: GoogleBusinessPostMetadataInputSchema.nullable()
    .optional()
    .describe("Metadata for Google Business Profile post"),
  instagram: InstagramPostMetadataInputSchema.nullable()
    .optional()
    .describe("Metadata for Instagram post"),
  linkedin: LinkedInPostMetadataInputSchema.nullable()
    .optional()
    .describe("Metadata for LinkedIn post"),
  mastodon: MastodonPostMetadataInputSchema.nullable()
    .optional()
    .describe("Metadata for Mastodon post"),
  pinterest: PinterestPostMetadataInputSchema.nullable()
    .optional()
    .describe("Metadata for Pinterest post"),
  substack: SubstackPostMetadataInputSchema.nullable()
    .optional()
    .describe("Metadata for Substack post"),
  threads: ThreadsPostMetadataInputSchema.nullable()
    .optional()
    .describe("Metadata for Threads post"),
  tiktok: TikTokPostMetadataInputSchema.nullable().optional().describe("Metadata for TikTok post"),
  twitter: TwitterPostMetadataInputSchema.nullable()
    .optional()
    .describe("Metadata for Twitter post"),
  youtube: YoutubePostMetadataInputSchema.nullable()
    .optional()
    .describe("Metadata for Youtube post"),
});
export const CreatePostInputSchema = z.strictObject({
  aiAssisted: z
    .boolean()
    .nullable()
    .optional()
    .describe("If this post was created with the help of AI"),
  assets: z.array(AssetInputSchema).max(1000).describe("Ordered list of assets on this post."),
  channelId: z.string().max(100_000).describe("Channel's Id for which we want to create the post"),
  draftId: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("Is set when the Post is generated from a Draft"),
  dueAt: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("Date when the post is scheduled to be published"),
  ideaId: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("Is set when the Post is generated from an Idea"),
  metadata: PostInputMetaDataSchema.nullable()
    .optional()
    .describe("Metadata of the post which differs based on the social network/service"),
  mode: z
    .enum(["addToQueue", "customScheduled", "shareNext", "shareNow"])
    .describe("How the post is being scheduled."),
  needsApproval: z
    .boolean()
    .describe(
      "Submit the post for approval instead of scheduling it. A post submitted for\napproval is always a draft, so this conflicts with turning `saveToDraft` off.\n\nOnly valid when your posting policy on the target channel requires approval.",
    ),
  saveToDraft: z
    .boolean()
    .nullable()
    .optional()
    .describe(
      "If true, saves the post as a draft instead of scheduling it.\nWhen saving as draft:\n- Post status will be 'draft' instead of 'buffer'\n- Posting limits are not checked\n- The post will not be published until explicitly scheduled",
    ),
  schedulingType: z
    .enum(["automatic", "notification"])
    .describe("Scheduling type to indicate notification publishing or automatic publishing"),
  source: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("source where the composer was initiated from, used for tracking."),
  tagIds: z
    .array(z.string().max(100_000))
    .max(1000)
    .nullable()
    .optional()
    .describe("List of tag IDs"),
  text: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe(
      "Text content of the Post.\n\nNote: for threaded posts, this needs to match the first item in the `thread` array.",
    ),
});
export const createPostArguments = z.strictObject({
  input: CreatePostInputSchema.describe("The mutation's input"),
});
export const DeletePostInputSchema = z.strictObject({
  id: z.string().max(100_000).describe("Post id to delete."),
});
export const deletePostArguments = z.strictObject({
  input: DeletePostInputSchema.describe("Input for the deletePost mutation."),
});
export const EditPostInputSchema = z.strictObject({
  id: z.string().max(100_000).describe("ID of the post to edit"),
  aiAssisted: z
    .boolean()
    .nullable()
    .optional()
    .describe("If this post was edited with the help of AI"),
  approvalChange: z
    .enum(["request", "revert"])
    .nullable()
    .optional()
    .describe(
      "Change the post's approval state alongside this edit. Leave unset to keep the\npost's current approval state.\n\nOnly valid when your posting policy on the post's channel requires approval,\nand only on your own drafts. Asking for the state the post is already in does\nnothing.",
    ),
  assets: z
    .array(AssetInputSchema)
    .max(1000)
    .nullable()
    .optional()
    .describe(
      "Ordered list of assets on this post. Omit to preserve the existing list,\npass an empty array to clear it",
    ),
  draftId: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("Is set when the Post is generated from a Draft"),
  dueAt: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("Date when the post is scheduled to be published"),
  ideaId: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("Is set when the Post is generated from an Idea"),
  metadata: PostInputMetaDataSchema.nullable()
    .optional()
    .describe("Metadata of the post which differs based on the social network/service"),
  mode: z
    .enum(["addToQueue", "customScheduled", "shareNext", "shareNow"])
    .nullable()
    .optional()
    .describe(
      "How the post is being scheduled. Omit the field or pass null to make no\nscheduling change — null does not clear or reset the schedule: a scheduled post\nkeeps its current share mode, queue slot, and any custom time, and the edit\napplies only the other provided fields. Pass a non-null ShareMode to apply that\nmode.",
    ),
  saveToDraft: z
    .boolean()
    .nullable()
    .optional()
    .describe(
      "If true, saves the post as a draft instead of keeping it scheduled.\nWhen saving as draft:\n- Post status will be 'draft' instead of 'buffer'\n- The post will not be published until explicitly scheduled",
    ),
  schedulingType: z
    .enum(["automatic", "notification"])
    .nullable()
    .optional()
    .describe(
      "Scheduling type to indicate notification publishing or automatic publishing.\n\nOmit it, or send null, to leave the post publishing the way it already does.",
    ),
  source: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("source where the composer was initiated from, used for tracking."),
  tagIds: z.array(z.string().max(100_000)).max(1000).nullable().optional().describe("tags"),
  text: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe(
      "Text content of the Post. Omit the field to keep the current text; pass an\nempty string or null to clear it.\n\nNote: for threaded posts, this needs to match the first item in the `thread` array.",
    ),
});
export const editPostArguments = z.strictObject({
  input: EditPostInputSchema.describe("The mutation's input"),
});
export const MovePostInQueueInputSchema = z.strictObject({
  id: z.string().max(100_000).describe("ID of the post to move."),
  position: z.enum(["bottom", "top"]).describe("Target position within the channel's queue."),
});
export const movePostInQueueArguments = z.strictObject({
  input: MovePostInQueueInputSchema.describe("The mutation's input"),
});
export const AddPostToContentItemInputSchema = z.strictObject({
  id: z.string().max(100_000).describe("The content item to add the post to."),
  postId: z
    .string()
    .max(100_000)
    .describe(
      "The post to add. The post must already exist. The post and the content item\nmust belong to the same organization.",
    ),
});
export const addPostToContentItemArguments = z.strictObject({
  input: AddPostToContentItemInputSchema.describe("Input for addPostToContentItem."),
});
export const CreateContentItemInputSchema = z.strictObject({
  organizationId: z
    .string()
    .max(100_000)
    .describe("Organization that owns the content item and all variants created in it."),
  posts: z
    .array(CreatePostInputSchema)
    .max(1000)
    .describe(
      "The channel-specific post variants to create, one per channel. Provide at\nleast one variant, and at most one variant per channel.",
    ),
  tagIds: z
    .array(z.string().max(100_000))
    .max(1000)
    .nullable()
    .optional()
    .describe("Tags to apply to this content item. Omit to create it with no tags."),
  targetDate: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe(
      "Optional date indicating when this piece of content should go out. This is\na planning aid only and does not schedule any posts.",
    ),
  title: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("Optional title describing what this piece of content is about."),
});
export const createContentItemArguments = z.strictObject({
  input: CreateContentItemInputSchema.describe("Input for createContentItem."),
});
export const DraftContentInputSchema = z.strictObject({
  aiAssisted: z
    .boolean()
    .describe("Set to true when the draft content was written with the help of AI."),
  assets: z
    .array(AssetInputSchema)
    .max(1000)
    .describe("Images, videos, or documents to attach to the draft, in display order."),
  text: z
    .string()
    .max(100_000)
    .describe(
      "The written content of the draft. Can be empty when the draft holds at\nleast one asset.",
    ),
});
export const CreateContentItemDraftInputSchema = z.strictObject({
  correlationId: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe(
      "Client-generated UUID that makes draft creation idempotent. A retry with the\nsame UUID in the same organization returns the first content item in its\ncurrent state.",
    ),
  draft: DraftContentInputSchema.describe("The channel-less draft content to start with."),
  organizationId: z.string().max(100_000).describe("Organization that will own the content item."),
  tagIds: z
    .array(z.string().max(100_000))
    .max(1000)
    .nullable()
    .optional()
    .describe("Tags to apply to this content item. Omit to create it with no tags."),
  targetDate: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe(
      "Optional date indicating when this piece of content should go out. This is\na planning aid only and does not schedule any posts.",
    ),
  title: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("Optional title describing what this piece of content is about."),
});
export const createContentItemDraftArguments = z.strictObject({
  input: CreateContentItemDraftInputSchema.describe("Input for createContentItemDraft."),
});
export const DeleteContentItemInputSchema = z.strictObject({
  id: z.string().max(100_000).describe("The content item to delete."),
});
export const deleteContentItemArguments = z.strictObject({
  input: DeleteContentItemInputSchema.describe("Input for deleteContentItem."),
});
export const PromoteContentItemDraftToPostsInputSchema = z.strictObject({
  id: z.string().max(100_000).describe("The content item to promote."),
  posts: z
    .array(CreatePostInputSchema)
    .max(1000)
    .describe(
      "The channel-specific posts to create, one per channel. Provide at least\none post, and at most one post per channel.",
    ),
  tagIds: z
    .array(z.string().max(100_000))
    .max(1000)
    .nullable()
    .optional()
    .describe(
      "Tags to apply to this content item. Omit to keep the current tags. An\nempty list or null removes them all.",
    ),
});
export const promoteContentItemDraftToPostsArguments = z.strictObject({
  input: PromoteContentItemDraftToPostsInputSchema.describe(
    "Input for promoteContentItemDraftToPosts.",
  ),
});
export const RemovePostFromContentItemInputSchema = z.strictObject({
  id: z.string().max(100_000).describe("The content item to remove the post from."),
  postId: z.string().max(100_000).describe("The post to remove from a content item."),
});
export const removePostFromContentItemArguments = z.strictObject({
  input: RemovePostFromContentItemInputSchema.describe("Input for removePostFromContentItem."),
});
export const UpdateContentItemInputSchema = z.strictObject({
  id: z.string().max(100_000).describe("The content item to update."),
  targetDate: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("Omit to preserve the existing target date. Null clears it."),
  title: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("Omit to preserve the existing title. Null clears it."),
});
export const updateContentItemArguments = z.strictObject({
  input: UpdateContentItemInputSchema.describe("Input for updateContentItem."),
});
export const UpdateContentItemDraftInputSchema = z.strictObject({
  id: z.string().max(100_000).describe("The content item whose channel-less draft is replaced."),
  draft: DraftContentInputSchema.describe(
    "The new draft content. Replaces the current draft in full.",
  ),
  tagIds: z
    .array(z.string().max(100_000))
    .max(1000)
    .nullable()
    .optional()
    .describe(
      "Tags to apply to this content item. Omit to keep the current tags. An\nempty list or null removes them all.",
    ),
  targetDate: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe(
      "Date indicating when this piece of content should go out. This is a\nplanning aid only and does not schedule any posts. Omit to preserve the\nexisting target date. Null clears it.",
    ),
});
export const updateContentItemDraftArguments = z.strictObject({
  input: UpdateContentItemDraftInputSchema.describe("Input for updateContentItemDraft."),
});
export const TagToCreateInputSchema = z.strictObject({
  color: z
    .string()
    .max(100_000)
    .describe(
      "The tag's color as a hex triplet: `#` followed by exactly six hex digits, for\nexample `#F523F1`. Shorthand such as `#F51` is rejected. Buffer maps\nrecognized palette colors onto `Tag.colorName`.",
    ),
  name: z
    .string()
    .max(100_000)
    .describe(
      "The tag's display name, for example `Summer sales`. Between 1 and 100\ncharacters, and unique within the organization. Names are compared exactly,\nso `Summer sales` and `summer sales` can coexist.",
    ),
});
export const CreateTagInputSchema = z.strictObject({
  organizationId: z
    .string()
    .max(100_000)
    .describe(
      "Organization to create the tag in. The caller must be an administrator of\nthis organization.",
    ),
  tag: TagToCreateInputSchema.describe("The name and color to give the new tag."),
});
export const createTagArguments = z.strictObject({
  input: CreateTagInputSchema.describe(
    "Identifies the organization to create the tag in, and the name and color to\ngive the tag.",
  ),
});
export const DeleteTagInputSchema = z.strictObject({
  id: z
    .string()
    .max(100_000)
    .describe(
      "The tag to delete. Its organization is taken from the tag itself, and the\ncaller must be an administrator of that organization.",
    ),
});
export const deleteTagArguments = z.strictObject({
  input: DeleteTagInputSchema.describe("Identifies the tag to delete."),
});
export const TagToUpdateInputSchema = z.strictObject({
  color: z
    .string()
    .max(100_000)
    .describe(
      "The tag's color as a hex triplet: `#` followed by exactly six hex digits, for\nexample `#F523F1`. Shorthand such as `#F51` is rejected. Buffer maps\nrecognized palette colors onto `Tag.colorName`.",
    ),
  name: z
    .string()
    .max(100_000)
    .describe(
      "The tag's display name, for example `Summer sales`. Between 1 and 100\ncharacters, and unique within the organization. Names are compared exactly,\nso `Summer sales` and `summer sales` can coexist.",
    ),
});
export const UpdateTagInputSchema = z.strictObject({
  id: z
    .string()
    .max(100_000)
    .describe(
      "The tag to update. Its organization is taken from the tag itself, and the\ncaller must be an administrator of that organization.",
    ),
  tag: TagToUpdateInputSchema.describe("The name and color to set on the tag."),
});
export const updateTagArguments = z.strictObject({
  input: UpdateTagInputSchema.describe(
    "Identifies the tag to update, and the name and color to set on it.",
  ),
});
export const CreatePostTemplateInputSchema = z.strictObject({
  body: z
    .string()
    .max(100_000)
    .describe("The main content body of the template, may contain {{placeholders}}."),
  description: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe(
      "A short user-facing description of the template. Nullable for\nbackwards-compat at the GraphQL boundary — the resolver rejects\nnull/empty values with a clear input error so the underlying\nstorage contract (non-empty string) is still honored.",
    ),
  emoji: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("The emoji associated with the template."),
  organizationId: z
    .string()
    .max(100_000)
    .describe(
      "Organization the template belongs to. The caller must be a member of\nthis organization. For `internal` visibility this is the team scope;\nfor `private` it's recorded on the template but does not affect\nvisibility.",
    ),
  title: z.string().max(100_000).describe("The title of the template."),
  visibility: z
    .enum(["internal", "private", "public"])
    .nullable()
    .optional()
    .describe(
      "Defaults to `private` if omitted. `public` is rejected — it is only\navailable to official Buffer clients.",
    ),
});
export const createPostTemplateArguments = z.strictObject({
  input: CreatePostTemplateInputSchema.describe("Input for creating a post template."),
});
export const DeletePostTemplateInputSchema = z.strictObject({
  id: z.string().max(100_000).describe("The ID of the template to delete."),
});
export const deletePostTemplateArguments = z.strictObject({
  input: DeletePostTemplateInputSchema.describe("Input for deleting a post template."),
});
export const UpdatePostTemplateInputSchema = z.strictObject({
  id: z.string().max(100_000).describe("The ID of the template to update."),
  body: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("The main content body of the template, may contain {{placeholders}}."),
  description: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("A short user-facing description of the template."),
  emoji: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("The emoji associated with the template."),
  title: z.string().max(100_000).nullable().optional().describe("The title of the template."),
  visibility: z
    .enum(["internal", "private", "public"])
    .nullable()
    .optional()
    .describe("`public` is rejected — it is only available to official Buffer\nclients."),
});
export const updatePostTemplateArguments = z.strictObject({
  input: UpdatePostTemplateInputSchema.describe("Input for updating a post template."),
});
export const IdeaMediaSourceInputSchema = z.strictObject({
  name: z.string().max(100_000),
  id: z.string().max(100_000).nullable().optional(),
  trigger: z.string().max(100_000).nullable().optional(),
  author: z.string().max(100_000).nullable().optional().describe("for unsplash only"),
  authorUrl: z.string().max(100_000).nullable().optional(),
});
export const IdeaMediaInputSchema = z.strictObject({
  url: z.string().max(100_000).describe("The URL of the media"),
  alt: z.string().max(100_000).nullable().optional().describe("Alternative text for the media"),
  thumbnailUrl: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("Thumbnail URL for the media"),
  type: z
    .enum(["image", "gif", "video", "link", "document", "unsupported"])
    .describe(
      "The type of media (image, gif, video, link, document, unsupported). Note: 'video' is not supported via public API",
    ),
  size: z
    .int()
    .min(-2_147_483_648)
    .max(2_147_483_647)
    .nullable()
    .optional()
    .describe("The size of the media in bytes"),
  source: IdeaMediaSourceInputSchema.nullable()
    .optional()
    .describe("Source information for the media"),
});
export const TagInputSchema = z.strictObject({
  id: z.string().max(100_000),
  name: z.string().max(100_000),
  color: z.string().max(100_000),
});
export const IdeaContentInputSchema = z.strictObject({
  aiAssisted: z.boolean().nullable().optional().describe("Whether AI tools were used in creation"),
  date: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("Target date for the idea, often used for planning publish schedules"),
  media: z
    .array(IdeaMediaInputSchema)
    .max(1000)
    .nullable()
    .optional()
    .describe("List of media items to attach"),
  services: z
    .array(
      z.enum([
        "bluesky",
        "facebook",
        "googlebusiness",
        "instagram",
        "linkedin",
        "mastodon",
        "pinterest",
        "startPage",
        "substack",
        "threads",
        "tiktok",
        "twitter",
        "whatsapp",
        "youtube",
      ]),
    )
    .max(1000)
    .nullable()
    .optional()
    .describe("Services associated with the idea for targeting specific platforms"),
  tags: z
    .array(TagInputSchema)
    .max(1000)
    .nullable()
    .optional()
    .describe("Tags to categorize the idea"),
  text: z.string().max(100_000).nullable().optional().describe("Main body text or description"),
  title: z.string().max(100_000).nullable().optional().describe("Title or headline of the idea"),
});
export const IdeaGroupInputSchema = z.strictObject({
  groupId: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("Target group ID (null for unassigned group)"),
  placeAfterId: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("ID of idea to place after (null for top position)"),
});
export const CreateIdeaInputSchema = z.strictObject({
  content: IdeaContentInputSchema.describe("Content and metadata for the new idea"),
  cta: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("Call-to-action identifier for analytics tracking"),
  group: IdeaGroupInputSchema.nullable()
    .optional()
    .describe("Group placement (null for unassigned group)"),
  organizationId: z.string().max(100_000).describe("Organization ID that will own the idea"),
  templateId: z
    .string()
    .max(100_000)
    .nullable()
    .optional()
    .describe("Template ID used to create the idea"),
});
export const createIdeaArguments = z.strictObject({
  input: CreateIdeaInputSchema.describe("Input to create an idea"),
});
