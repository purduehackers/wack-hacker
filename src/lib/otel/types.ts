/**
 * Attributes we stamp onto every span emitted inside a chat workflow or any
 * handler that can be correlated to a chat. Deliberately excludes username
 * (PII); user_id is sufficient for joining back to a person off-trace.
 *
 * Axiom-queryable: `chat.id == "<workflowRunId>"` returns every span in the
 * conversation, across workflow-step invocation boundaries.
 *
 * Index signature is present so `ChatAttributes` is structurally assignable
 * to `TelemetryMetadata` (an alias for `Record<string, string | number>`),
 * letting the same object flow into AI SDK telemetry metadata and OTEL span
 * attributes without re-keying.
 */
export interface ChatAttributes {
  "chat.id": string;
  "chat.channel_id": string;
  "chat.thread_id"?: string;
  "chat.user_id": string;
  "chat.turn_index"?: number;
  "chat.workflow_run_id": string;
  [key: string]: string | number | undefined;
}
