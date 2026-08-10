/**
 * Gateway event authoring and routing.
 *
 * Far smaller than the prior equivalent because events are handled in-process.
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
 * Reactions are *not* force-fetched when partial. The prior gateway published
 * straight off the partial so a reaction on a just-deleted message still
 * relayed; a REST fetch here would throw instead. Handlers that need more data
 * fetch it themselves and handle failure.
 */

import type { KnownError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { instrument } from "@repo/shared/result/observe";
import type { Reporter } from "@repo/shared/result/observe";
import { Events } from "discord.js";
import type { Client, ClientEvents } from "discord.js";

import { isBotMention, isReplyToBot } from "../utils/mention.ts";
import { traceOperation } from "./observability.ts";

/**
 * `mention` is derived rather than a real gateway event: it is a `MESSAGE_CREATE`
 * addressed to the bot. Keeping it a separate kind is what lets the router order
 * the two groups.
 */
type EventKind = "mention" | "message" | "messageDelete" | "reactionAdd" | "reactionRemove";

interface EventContext {
  readonly client: Client<true>;
  readonly botUserId: string;
  /** True when this message also matched a mention handler. */
  readonly isBotMention: boolean;
}

export type ReactorLike = ClientEvents[Events.MessageReactionAdd][1];

interface EventPayloads {
  mention: ClientEvents[Events.MessageCreate][0];
  message: ClientEvents[Events.MessageCreate][0];
  messageDelete: ClientEvents[Events.MessageDelete][0];
  reactionAdd: {
    readonly reaction: ClientEvents[Events.MessageReactionAdd][0];
    readonly user: ClientEvents[Events.MessageReactionAdd][1];
  };
  reactionRemove: {
    readonly reaction: ClientEvents[Events.MessageReactionRemove][0];
    readonly user: ClientEvents[Events.MessageReactionRemove][1];
  };
}

/**
 * The payload-independent part of an event handler.
 *
 * `EventHandler` below pins this to the payload of a single kind. The router's
 * internals stay parameterized on the payload alone, which is load-bearing:
 * `mention` and `message` are distinct kinds over the same payload, so
 * `runEventHandlerGroups` takes both buckets in one call. Keying those helpers
 * on `EventKind` instead would demand `EventHandler<"mention" | "message">`,
 * which neither bucket satisfies — each declares the narrower `kind` literal —
 * and only a cast would bridge that.
 */
interface RoutedEventHandler<P> {
  /** Used in logs and metric dimensions. */
  readonly name: string;
  readonly kind: EventKind;
  /**
   * A stable identity for this occurrence, or undefined to skip deduplication.
   * Scoped per handler so two handlers on the same event do not evict each other.
   */
  readonly dedupKey?: (payload: P) => string | undefined;
  readonly handle: (payload: P, context: EventContext) => Promise<Result<void, KnownError>>;
}

interface EventHandler<K extends EventKind = EventKind> extends RoutedEventHandler<
  EventPayloads[K]
> {
  readonly kind: K;
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
 * Declared here and injected rather than importing Redis directly, so the
 * router itself carries no dependency on a store being reachable.
 */
export interface Deduplicator {
  /** True when this caller is the first to claim the key. */
  readonly claim: (key: string) => Promise<boolean>;
}

interface RouterDeps {
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
async function runHandler<P>(
  handler: RoutedEventHandler<P>,
  payload: P,
  context: EventContext,
  deps: Pick<RouterDeps, "reporter" | "dedup">,
): Promise<void> {
  const key = handler.dedupKey?.(payload);
  if (key !== undefined) {
    const claimed = await deps.dedup.claim(`${handler.name}:${key}`);
    if (!claimed) return;
  }

  const op = `event.${handler.kind}.${handler.name}`;
  await traceOperation(
    op,
    () =>
      instrument(op, deps.reporter, () =>
        Result.tryPromise({
          try: () => handler.handle(payload, context),
          catch: (cause) => cause,
        }).then((settled) => (Result.isError(settled) ? Result.err(settled.error) : settled.value)),
      ),
    { "discord.event.kind": handler.kind, "discord.handler": handler.name },
  );
}

/** Runs every handler in a bucket concurrently. Siblings never block each other. */
async function runAll<P>(
  bucket: readonly RoutedEventHandler<P>[],
  payload: P,
  context: EventContext,
  deps: Pick<RouterDeps, "reporter" | "dedup">,
): Promise<void> {
  await Promise.all(bucket.map((handler) => runHandler(handler, payload, context, deps)));
}

/** Runs handler groups in declaration order while keeping siblings concurrent. */
async function runEventHandlerGroups<P>(
  handlerGroups: readonly (readonly RoutedEventHandler<P>[])[],
  payload: P,
  context: EventContext,
  deps: Pick<RouterDeps, "reporter" | "dedup">,
): Promise<void> {
  for (const group of handlerGroups) await runAll(group, payload, context, deps);
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
      // Bot messages are filtered at the edge, exactly as the prior gateway did:
      // handlers never see them, so none of them need their own check.
      if (message.author.bot) return;

      const addressed = isBotMention(message, botUserId) || isReplyToBot(message, botUserId);
      const context: EventContext = { client, botUserId, isBotMention: addressed };

      // Mention handlers first, to completion. They decide whether a
      // conversation starts; message handlers then see that decision.
      await runEventHandlerGroups(
        addressed ? [registry.mention, registry.message] : [registry.message],
        message,
        context,
        deps,
      );
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
