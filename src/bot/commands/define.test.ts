import { SlashCommandBuilder } from "discord.js";
import { describe, it, expect } from "vitest";

import type { InteractionResponsePayload, SlashCommandContext } from "./types";

import { defineCommand } from "./define";

type ExecuteFn = (ctx: SlashCommandContext) => Promise<InteractionResponsePayload | void>;

describe("defineCommand", () => {
  it("derives name from builder", () => {
    const cmd = defineCommand({
      builder: new SlashCommandBuilder().setName("test").setDescription("test"),
      execute: async () => {},
    });
    expect(cmd.name).toBe("test");
  });

  it("preserves the builder instance", () => {
    const builder = new SlashCommandBuilder().setName("test").setDescription("test");
    const cmd = defineCommand({ builder, execute: async () => {} });
    expect(cmd.builder).toBe(builder);
  });

  it("preserves the execute function", () => {
    const execute: ExecuteFn = async () => {};
    const cmd = defineCommand({
      builder: new SlashCommandBuilder().setName("test").setDescription("test"),
      execute,
    });
    // Access via an object shape to avoid the method-binding lint (execute
    // doesn't use `this`; the reference round-trips through defineCommand).
    expect((cmd as { execute: ExecuteFn }).execute).toBe(execute);
  });
});
