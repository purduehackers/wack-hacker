import { Data } from "effect";

export class DatabaseError extends Data.TaggedError("DatabaseError")<{
    operation: string;
    cause: unknown;
}> {}

export class DiscordError extends Data.TaggedError("DiscordError")<{
    action: string;
    cause: unknown;
}> {}

export class ChannelNotFound extends Data.TaggedError("ChannelNotFound")<{
    channelId: string;
}> {}

export class AIError extends Data.TaggedError("AIError")<{
    model: string;
    cause: unknown;
}> {}

export class TranscriptionError extends Data.TaggedError("TranscriptionError")<{
    cause: unknown;
}> {}

export class StorageError extends Data.TaggedError("StorageError")<{
    operation: string;
    key?: string;
    cause: unknown;
}> {}

export class GitHubError extends Data.TaggedError("GitHubError")<{
    operation: string;
    cause: unknown;
}> {}

export class MediaWikiError extends Data.TaggedError("MediaWikiError")<{
    operation: string;
    cause: unknown;
}> {}

export class DashboardError extends Data.TaggedError("DashboardError")<{
    operation: string;
    cause: unknown;
}> {}

export class DashboardConnectionFailed extends Data.TaggedError("DashboardConnectionFailed")<{
    attempts: number;
    lastError: unknown;
}> {}

export class FeatureDisabled extends Data.TaggedError("FeatureDisabled")<{
    feature: string;
}> {}

export class ValidationError extends Data.TaggedError("ValidationError")<{
    field: string;
    message: string;
}> {}
