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

export class PhonebellError extends Data.TaggedError("PhonebellError")<{
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

export class MeetingAlreadyActive extends Data.TaggedError("MeetingAlreadyActive")<{
    guildId: string;
    activeChannelId: string;
}> {}

export class NoActiveMeeting extends Data.TaggedError("NoActiveMeeting")<{
    guildId: string;
}> {}

export class NotInVoiceChannel extends Data.TaggedError("NotInVoiceChannel")<{
    guildId: string;
    userId: string;
}> {}

export class MeetingVoiceJoinFailed extends Data.TaggedError("MeetingVoiceJoinFailed")<{
    guildId: string;
    channelId: string;
    cause: unknown;
}> {}

export class MeetingTranscriptionError extends Data.TaggedError("MeetingTranscriptionError")<{
    operation: string;
    cause: unknown;
}> {}

export class NotionError extends Data.TaggedError("NotionError")<{
    operation: string;
    cause: unknown;
}> {}

/**
 * Converts an unknown error into a structured object for logging.
 * Handles Effect tagged errors, standard Errors, and unknown values.
 */
export const structuredError = (e: unknown) => ({
    error_tag:
        typeof e === "object" && e !== null && "_tag" in e
            ? String((e as { _tag: unknown })._tag)
            : undefined,
    error_type:
        typeof e === "object" && e !== null && "_tag" in e
            ? (e as { _tag: string })._tag
            : e instanceof Error
              ? e.constructor.name
              : "Unknown",
    error_message: e instanceof Error ? e.message : String(e),
    error_cause_message:
        typeof e === "object" && e !== null && "cause" in e
            ? (() => {
                  const cause = (e as { cause: unknown }).cause;
                  if (cause instanceof Error) return cause.message;
                  if (cause === undefined || cause === null) return undefined;
                  return String(cause);
              })()
            : undefined,
    error_cause_type:
        typeof e === "object" && e !== null && "cause" in e
            ? (() => {
                  const cause = (e as { cause: unknown }).cause;
                  if (cause instanceof Error) return cause.constructor.name;
                  if (typeof cause === "object" && cause !== null && "name" in cause) {
                      return String((cause as { name: unknown }).name);
                  }
                  return cause === undefined || cause === null ? undefined : typeof cause;
              })()
            : undefined,
    error_stack: e instanceof Error ? e.stack?.split("\n").slice(0, 5).join("\n") : undefined,
});
