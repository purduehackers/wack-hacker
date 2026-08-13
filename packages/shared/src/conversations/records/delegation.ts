/**
 * Which child session a delegated turn is waiting on.
 *
 * A declared subagent runs in its own session, and the parent's stream carries
 * only `subagent.called` and `subagent.completed` — the bookends. Everything
 * between happens on the child's own stream, which the parent cannot read because
 * it is suspended for exactly that span.
 *
 * This record is how the child's address gets out to something that can read it.
 * The bot is a long-lived process holding a socket; the agent is not.
 */

import { z } from "zod";

export const delegationSchema = z.strictObject({
  /**
   * The parent session, which is the only one reachable from where this is written.
   *
   * Not where the progress is: a delegated child publishes on its own stream, and
   * the parent emits only `subagent.called` and `subagent.completed`. The child's
   * id rides on `subagent.called`, which never reaches a hook, so the reader picks
   * it up off this stream and attaches to the child itself.
   */
  sessionId: z.string().min(1).max(128),
  /** What to call it in the channel: "code", "github", … */
  name: z.string().min(1).max(64),
  /** Which call this is, so a second delegation replaces rather than duplicates. */
  callId: z.string().min(1).max(128),
  /**
   * Vercel OIDC token for reading the child's stream.
   *
   * Minted where the delegation is announced, because that runs in a Vercel
   * function and the reader does not: the bot is a long-lived sandbox process
   * with no Vercel identity of its own. Twelve hours covers any delegation, so
   * one mint serves the whole thing and there is no refresh path to get wrong.
   */
  streamToken: z.string().min(1).max(4_096),
  startedAt: z.iso.datetime(),
});

export type Delegation = z.output<typeof delegationSchema>;

/**
 * Shorter than the token it carries, deliberately.
 *
 * A Vercel OIDC token lives twelve hours. Bounding the record by the credential
 * rather than the other way round means a delegation can never outlive the thing
 * that makes it useful — a reader is never handed an address it has no way to
 * authenticate to. Cleared on completion regardless.
 */
export const DELEGATION_TTL_SECONDS = 6 * 60 * 60;
