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
  startedAt: z.iso.datetime(),
});

export type Delegation = z.output<typeof delegationSchema>;

/**
 * Long enough for any delegation, because the record no longer carries a
 * credential that could expire under it.
 *
 * It used to hold a Vercel OIDC token and was bounded by that token's supposed
 * twelve-hour life. Both halves of that were wrong: the token is issued with a
 * *fixed* expiry shared across every mint, so one taken at 20:52 died at 21:38 —
 * forty-six minutes, not twelve hours — and a reader handed a stored copy has no
 * way to renew it. The credential is fetched per connection now.
 */
export const DELEGATION_TTL_SECONDS = 24 * 60 * 60;
