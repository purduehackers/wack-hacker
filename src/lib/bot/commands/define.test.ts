import { SlashCommandBuilder } from "discord.js";
import { describe, it, expect } from "vitest";

import { defineCommand } from "./define";

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
    const execute = async () => {};
    const cmd = defineCommand({
      builder: new SlashCommandBuilder().setName("test").setDescription("test"),
      execute,
    });
    // eslint-disable-next-line typescript-eslint/unbound-method
    expect(cmd.execute).toBe(execute);
  });
});
