/**
 * Gateway event authoring and routing.
 *
 * Far smaller than the legacy equivalent because events are handled in-process.
 * There is no `Packet` type, no codec, no Vercel Queue, and no consumer function
 * — a discord.js object goes straight to a handler. What survives from that
 * design is the part that was load-bearing rather than incidental:
 *
 * 1. **Deduplication.** At-least-once queue delivery is gone, but duplicates are
 *    not: a gateway `RESUME` replays events, and two deployments briefly overlap
 *    during a handoff. Dedup is what keeps a handler's side effects from firing
 *    twice, so it stays.
 * 2. **Mention-before-message ordering.** A mention also satisfies the plain
 *    `message` kind. Mention handlers therefore run to completion first, and
 *    message handlers can short-circuit on `ctx.isBotMention` rather than racing
 *    to decide who owns the message.
 * 3. **Guarded listeners.** discord.js does not await listeners, so an
 *    unhandled rejection inside one is silently lost — the event just vanishes.
 *    Every dispatch is wrapped.
 *
 * Reactions are *not* force-fetched when partial. The legacy gateway published
 * straight off the partial so a reaction on a just-deleted message still
 * relayed; a REST fetch here would throw instead. Handlers that need more data
 * fetch it themselves and handle failure.
 */

import type { KnownError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { instrument } from "@repo/shared/result/observe";
import type { Reporter } from "@repo/shared/result/observe";
import { Events } from "discord.js";
import type {
  Client,
  Message,
  MessageReaction,
  PartialMessage,
  PartialMessageReaction,
  PartialUser,
  User,
} from "discord.js";

import { isBotMention, isReplyToBot } from "../utils/mention.ts";

/**
 * `mention` is derived rather than a real gateway event: it is a `MESSAGE_CREATE`
 * addressed to the bot. Keeping it a separate kind is what lets the router order
 * the two groups.
 */
export type EventKind = "mention" | "message" | "messageDelete" | "reactionAdd" | "reactionRemove";

export interface EventContext {
  readonly client: Client<true>;
  readonly botUserId: string;
  /** True when this message also matched a mention handler. */
  readonly isBotMention: boolean;
}

export type ReactionLike = MessageReaction | PartialMessageReaction;
export type ReactorLike = User | PartialUser;

export interface EventPayloads {
  mention: Message;
  message: Message;
  messageDelete: Message | PartialMessage;
  reactionAdd: { readonly reaction: ReactionLike; readonly user: ReactorLike };
  reactionRemove: { readonly reaction: ReactionLike; readonly user: ReactorLike };
}

export interface EventHandler<K extends EventKind = EventKind> {
  /** Used in logs and metric dimensions. */
  readonly name: string;
  readonly kind: K;
  /**
   * A stable identity for this occurrence, or undefined to skip deduplication.
   * Scoped per handler so two handlers on the same event do not evict each other.
   */
  readonly dedupKey?: (payload: EventPayloads[K]) => string | undefined;
  readonly handle: (
    payload: EventPayloads[K],
    context: EventContext,
  ) => Promise<Result<void, KnownError>>;
}

/**
 * A handler of any kind, as a discriminated union on `kind`.
 *
 * Distributed over `EventKind` rather than written as `EventHandler<EventKind>`,
 * because only a real union narrows: switching on `kind` then gives TypeScript
 * the matching payload type with no cast.
 */
export type AnyEventHandler = { [K in EventKind]: EventHandler<K> }[EventKind];

/** Identity, but it pins the payload type to the declared kind. */
export function defineEvent<K extends EventKind>(handler: EventHandler<K>): EventHandler<K> {
  return handler;
}

/**
 * Claims a key for the first caller and rejects later ones.
 *
 * Injected rather than importing Redis directly, so the router does not depend
 * on a store being reachable and a single-process deployment can pass an
 * in-memory implementation.
 */
export interface Deduplicator {
  /** True when this caller is the first to claim the key. */
  readonly claim: (key: string) => Promise<boolean>;
}

/** Never deduplicates. Correct only where every handler is idempotent. */
export const noDedup: Deduplicator = { claim: async () => true };

export interface RouterDeps {
  readonly handlers: readonly AnyEventHandler[];
  readonly reporter: Reporter;
  readonly dedup: Deduplicator;
}

/** Handlers bucketed by kind, each bucket correctly typed. */
type Registry = { [K in EventKind]: EventHandler<K>[] };

function buildRegistry(declared: readonly AnyEventHandler[]): Registry {
  const registry: Registry = {
    mention: [],
    message: [],
    messageDelete: [],
    reactionAdd: [],
    reactionRemove: [],
  };

  for (const handler of declared) {
    // Switching on the discriminant is what narrows each handler to its kind.
    switch (handler.kind) {
      case "mention":
        registry.mention.push(handler);
        break;
      case "message":
        registry.message.push(handler);
        break;
      case "messageDelete":
        registry.messageDelete.push(handler);
        break;
      case "reactionAdd":
        registry.reactionAdd.push(handler);
        break;
      case "reactionRemove":
        registry.reactionRemove.push(handler);
        break;
    }
  }

  return registry;
}

/**
 * Runs one handler, deduplicated and instrumented. Never rejects.
 *
 * Failures are reported and swallowed on purpose: one handler failing must not
 * prevent its siblings from running, and there is no caller to propagate to.
 */
async function runHandler<K extends EventKind>(
  handler: EventHandler<K>,
  payload: EventPayloads[K],
  context: EventContext,
  deps: RouterDeps,
): Promise<void> {
  const key = handler.dedupKey?.(payload);
  if (key !== undefined) {
    const claimed = await deps.dedup.claim(`${handler.name}:${key}`);
    if (!claimed) return;
  }

  await instrument(`event.${handler.kind}.${handler.name}`, deps.reporter, () =>
    Result.tryPromise({
      try: () => handler.handle(payload, context),
      catch: (cause) => cause,
    }).then((settled) => (Result.isError(settled) ? Result.err(settled.error) : settled.value)),
  );
}

/** Runs every handler in a bucket concurrently. Siblings never block each other. */
async function runAll<K extends EventKind>(
  bucket: readonly EventHandler<K>[],
  payload: EventPayloads[K],
  context: EventContext,
  deps: RouterDeps,
): Promise<void> {
  await Promise.all(bucket.map((handler) => runHandler(handler, payload, context, deps)));
}

export function attachEventRouter(client: Client<true>, deps: RouterDeps): void {
  const botUserId = client.user.id;
  const registry = buildRegistry(deps.handlers);

  const guard = (op: string, work: () => Promise<void>): void => {
    void work().catch((cause: unknown) => {
      // Reaching here means the router itself failed, not a handler.
      deps.reporter.captureDefect(cause, { op });
    });
  };

  client.on(Events.MessageCreate, (message) => {
    guard("event.router.message", async () => {
      // Bot messages are filtered at the edge, exactly as the legacy gateway did:
      // handlers never see them, so none of them need their own check.
      if (message.author.bot) return;

      const addressed = isBotMention(message, botUserId) || isReplyToBot(message, botUserId);
      const context: EventContext = { client, botUserId, isBotMention: addressed };

      // Mention handlers first, to completion. They decide whether a
      // conversation starts; message handlers then see that decision.
      if (addressed) await runAll(registry.mention, message, context, deps);
      await runAll(registry.message, message, context, deps);
    });
  });

  client.on(Events.MessageDelete, (message) => {
    guard("event.router.messageDelete", async () => {
      await runAll(
        registry.messageDelete,
        message,
        { client, botUserId, isBotMention: false },
        deps,
      );
    });
  });

  client.on(Events.MessageReactionAdd, (reaction, user) => {
    guard("event.router.reactionAdd", async () => {
      if (user.bot) return;
      await runAll(
        registry.reactionAdd,
        { reaction, user },
        { client, botUserId, isBotMention: false },
        deps,
      );
    });
  });

  client.on(Events.MessageReactionRemove, (reaction, user) => {
    guard("event.router.reactionRemove", async () => {
      if (user.bot) return;
      await runAll(
        registry.reactionRemove,
        { reaction, user },
        { client, botUserId, isBotMention: false },
        deps,
      );
    });
  });
}
