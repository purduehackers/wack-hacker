/**
 * What a scheduled task does when it fires.
 *
 * `message` posts fixed text; `agent` starts a durable agent session with a
 * prompt. Stored as a JSON column, so this is a wire contract with rows already
 * on disk — adding a variant is safe, renaming or removing one is not.
 */
export type TaskAction =
  | { readonly type: "message"; readonly channelId: string; readonly content: string }
  | { readonly type: "agent"; readonly channelId: string; readonly prompt: string };
