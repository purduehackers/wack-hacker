import { Schema } from "effect";

export class DatabaseError extends Schema.TaggedError<DatabaseError>("DatabaseError")(
    "DatabaseError",
    {
        operation: Schema.String,
        cause: Schema.optional(Schema.Defect),
    },
) {}

export class DiscordError extends Schema.TaggedError<DiscordError>("DiscordError")(
    "DiscordError",
    {
        action: Schema.String,
        cause: Schema.optional(Schema.Defect),
    },
) {}

export class ChannelNotFound extends Schema.TaggedError<ChannelNotFound>("ChannelNotFound")(
    "ChannelNotFound",
    {
        channelId: Schema.String,
    },
) {}

export class AIError extends Schema.TaggedError<AIError>("AIError")("AIError", {
    model: Schema.String,
    cause: Schema.optional(Schema.Defect),
}) {}

export class TranscriptionError extends Schema.TaggedError<TranscriptionError>("TranscriptionError")(
    "TranscriptionError",
    {
        cause: Schema.optional(Schema.Defect),
    },
) {}

export class StorageError extends Schema.TaggedError<StorageError>("StorageError")(
    "StorageError",
    {
        operation: Schema.String,
        key: Schema.optional(Schema.String),
        cause: Schema.optional(Schema.Defect),
    },
) {}

export class GitHubError extends Schema.TaggedError<GitHubError>("GitHubError")("GitHubError", {
    operation: Schema.String,
    cause: Schema.optional(Schema.Defect),
}) {}

export class MediaWikiError extends Schema.TaggedError<MediaWikiError>("MediaWikiError")(
    "MediaWikiError",
    {
        operation: Schema.String,
        cause: Schema.optional(Schema.Defect),
    },
) {}

export class DashboardError extends Schema.TaggedError<DashboardError>("DashboardError")(
    "DashboardError",
    {
        operation: Schema.String,
        cause: Schema.optional(Schema.Defect),
    },
) {}

export class DashboardConnectionFailed extends Schema.TaggedError<DashboardConnectionFailed>(
    "DashboardConnectionFailed",
)("DashboardConnectionFailed", {
    attempts: Schema.Number,
    lastError: Schema.optional(Schema.Defect),
}) {}

export class FeatureDisabled extends Schema.TaggedError<FeatureDisabled>("FeatureDisabled")(
    "FeatureDisabled",
    {
        feature: Schema.String,
    },
) {}

export class ValidationError extends Schema.TaggedError<ValidationError>("ValidationError")(
    "ValidationError",
    {
        field: Schema.String,
        message: Schema.String,
    },
) {}

export class DiscordReactError extends Schema.TaggedError<DiscordReactError>("DiscordReactError")(
    "DiscordReactError",
    {
        messageId: Schema.String,
        emoji: Schema.optional(Schema.String),
        cause: Schema.optional(Schema.Defect),
    },
) {}

export class DiscordReplyError extends Schema.TaggedError<DiscordReplyError>("DiscordReplyError")(
    "DiscordReplyError",
    {
        messageId: Schema.String,
        cause: Schema.optional(Schema.Defect),
    },
) {}

export class DiscordSendError extends Schema.TaggedError<DiscordSendError>("DiscordSendError")(
    "DiscordSendError",
    {
        channelId: Schema.String,
        cause: Schema.optional(Schema.Defect),
    },
) {}

export class DiscordFetchError extends Schema.TaggedError<DiscordFetchError>("DiscordFetchError")(
    "DiscordFetchError",
    {
        resource: Schema.String,
        resourceId: Schema.optional(Schema.String),
        cause: Schema.optional(Schema.Defect),
    },
) {}

export class DiscordRoleError extends Schema.TaggedError<DiscordRoleError>("DiscordRoleError")(
    "DiscordRoleError",
    {
        userId: Schema.String,
        roleId: Schema.String,
        action: Schema.String,
        cause: Schema.optional(Schema.Defect),
    },
) {}

export class DiscordThreadError extends Schema.TaggedError<DiscordThreadError>("DiscordThreadError")(
    "DiscordThreadError",
    {
        channelId: Schema.String,
        operation: Schema.String,
        cause: Schema.optional(Schema.Defect),
    },
) {}

export class DiscordPinError extends Schema.TaggedError<DiscordPinError>("DiscordPinError")(
    "DiscordPinError",
    {
        messageId: Schema.String,
        action: Schema.String,
        cause: Schema.optional(Schema.Defect),
    },
) {}

export class IntervalParseError extends Schema.TaggedError<IntervalParseError>("IntervalParseError")(
    "IntervalParseError",
    {
        interval: Schema.String,
        cause: Schema.optional(Schema.Defect),
    },
) {}

export class EmptyArrayError extends Schema.TaggedError<EmptyArrayError>("EmptyArrayError")(
    "EmptyArrayError",
    {
        operation: Schema.String,
    },
) {}

export const structuredError = (e: unknown) => ({
    error_type:
        typeof e === "object" && e !== null && "_tag" in e
            ? (e as { _tag: string })._tag
            : e instanceof Error
              ? e.constructor.name
              : "Unknown",
    error_message: e instanceof Error ? e.message : String(e),
    error_stack: e instanceof Error ? e.stack?.split("\n").slice(0, 5).join("\n") : undefined,
});
