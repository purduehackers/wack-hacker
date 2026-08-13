/**
 * Which child session a delegated turn is waiting on.
 *
 * A declared subagent runs in its own session and the parent suspends for the
 * whole span, so this record is how the child's address reaches something that
 * can read it. The bot holds sockets; the agent cannot.
 */

import { z } from "zod";

export const delegationSchema = z.strictObject({
  /**
   * The parent session, the only one reachable from where this is written.
   *
   * Not where the progress is: a delegated child publishes on its own stream,
   * and the parent emits only `subagent.called` and `subagent.completed`. The
   * child's id rides on `subagent.called`, which never reaches a hook, so the
   * reader picks it up off this stream and attaches to the child itself.
   */
  sessionId: z.string().min(1).max(128),
  /** What to call it in the channel: "code", "github", … */
  name: z.string().min(1).max(64),
  /** Which call this is, so a second delegation replaces rather than duplicates. */
  callId: z.string().min(1).max(128),
  /**
   * Vercel OIDC token for reading the child's stream, minted where the
   * delegation is announced because the bot has no Vercel identity of its own.
   */
  streamToken: z.string().min(1).max(4_096),
  startedAt: z.iso.datetime(),
});

export type Delegation = z.output<typeof delegationSchema>;

/**
 * Shorter than the twelve-hour token it carries, so a delegation can never
 * outlive the credential that makes it useful. Cleared on completion regardless.
 */
export const DELEGATION_TTL_SECONDS = 6 * 60 * 60;
