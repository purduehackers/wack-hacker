import type { Packet } from "@/lib/protocol/types";

import { kindOfPacketType } from "@/lib/protocol/events";

import type { EventHandler, HandlerKind, PacketForHandlerKind } from "./events/types";
import type { HandlerContext } from "./types";

import { isBotMention, isReplyToBot } from "./mention";

export type { HandlerContext } from "./types";

type Handler<T> = (packet: T, ctx: HandlerContext) => Promise<void>;

export class EventRouter {
  private handlers = new Map<HandlerKind, Handler<never>[]>();

  on<K extends HandlerKind>(kind: K, handler: Handler<PacketForHandlerKind<K>>): this {
    const list = this.handlers.get(kind) ?? [];
    list.push(handler as Handler<never>);
    this.handlers.set(kind, list);
    return this;
  }

  /** Register a barrel-exported `defineEvent` handler. */
  register(handler: EventHandler): this {
    // TS can't correlate `type` and `handle` across the union members; `on` +
    // dispatch keep kind and packet aligned at runtime.
    return this.on(handler.type, async (packet, ctx) => handler.handle(packet as never, ctx));
  }

  private async run<K extends HandlerKind>(
    kind: K,
    packet: PacketForHandlerKind<K>,
    ctx: HandlerContext,
  ): Promise<void> {
    const list = (this.handlers.get(kind) ?? []) as Handler<PacketForHandlerKind<K>>[];
    await Promise.all(list.map((handler) => handler(packet, ctx)));
  }

  async dispatch(packet: Packet, ctx: HandlerContext): Promise<void> {
    if (packet.type === "GATEWAY_MESSAGE_CREATE") {
      const mentioned = isBotMention(packet.data, ctx.botUserId);
      const messageCtx: HandlerContext = { ...ctx, isBotMention: mentioned };
      if (mentioned || isReplyToBot(packet.data, ctx.botUserId)) {
        await this.run("mention", packet, messageCtx);
      }
      await this.run("message", packet, messageCtx);
      return;
    }
    // Same union-correlation limitation as register(); the table maps each
    // packet type to exactly one kind.
    await this.run(kindOfPacketType(packet.type), packet as never, ctx);
  }
}
