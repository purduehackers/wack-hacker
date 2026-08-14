/**
 * Which child session a delegated turn waits on.
 *
 * A declared subagent runs in its own session and the parent suspends for the
 * whole span. This record is how the child's address reaches something that
 * can read it. The bot holds sockets. The agent cannot.
 */

import { z } from "zod";

export const delegationSchema = z.strictObject({
  /**
   * The parent session, the only one the write site can reach.
   *
   * Not where the progress is: a delegated child publishes on its own stream,
   * and the parent emits only `subagent.called` and `subagent.completed`. The
   * child's id rides on `subagent.called`, which never reaches a hook. The
   * reader therefore picks it up off this stream and attaches to the child
   * itself.
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
 * It used to hold a Vercel OIDC token, bounded by that token's supposed
 * twelve-hour life. Both halves of that were wrong. Vercel issues the token
 * with a *fixed* expiry shared across every mint. One taken at 20:52 died at
 * 21:38: forty-six minutes, not twelve hours. A reader handed a stored copy
 * has no way to renew it. Each connection now fetches the credential fresh.
 */
export const DELEGATION_TTL_SECONDS = 24 * 60 * 60;
