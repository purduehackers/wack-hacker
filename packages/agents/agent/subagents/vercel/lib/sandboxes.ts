import { z } from "zod";

import { vercel } from "./client.ts";
import { VERCEL_TEAM_ID, VERCEL_TEAM_SLUG } from "./constants.ts";
import { defineTool } from "./define-tool.ts";

const TEAM = { teamId: VERCEL_TEAM_ID, slug: VERCEL_TEAM_SLUG } as const;

// ──────────────── SANDBOX LIFECYCLE ────────────────

export const list_sandboxes = defineTool({
  name: "list_sandboxes",
  domain: "vercel",
  description: "List every active Vercel Sandbox in the team.",
  access: { risk: "read" },
  input: z.object({
    limit: z.number().optional(),
    since: z.number().optional(),
    until: z.number().optional(),
  }),
  execute: async (input) => {
    const result = await vercel().sandboxes.getSandboxesV1({ ...TEAM, ...input });
    return JSON.stringify(result);
  },
});

export const get_sandbox = defineTool({
  name: "get_sandbox",
  domain: "vercel",
  description: "Retrieve a Vercel Sandbox by id.",
  access: { risk: "read" },
  input: z.object({ sandbox_id: z.string() }),
  execute: async ({ sandbox_id }) => {
    const result = await vercel().sandboxes.getSandbox({ ...TEAM, sandboxId: sandbox_id });
    return JSON.stringify(result);
  },
});

export const stop_sandbox = defineTool({
  name: "stop_sandbox",
  domain: "vercel",
  description: "Stop a running Vercel Sandbox. Files and state within the sandbox are lost.",
  access: { risk: "destructive" },
  input: z.object({ sandbox_id: z.string() }),
  execute: async ({ sandbox_id }) => {
    const result = await vercel().sandboxes.stopSandbox({
      ...TEAM,
      sandboxId: sandbox_id,
    });
    return JSON.stringify(result);
  },
});

export const extend_sandbox_timeout = defineTool({
  name: "extend_sandbox_timeout",
  domain: "vercel",
  description:
    "Extend a sandbox's maximum runtime by an additional `duration` (seconds). Costs additional compute.",
  access: { risk: "write", confirm: "self" },
  input: z.object({
    sandbox_id: z.string(),
    duration: z.number().describe("Additional runtime in seconds"),
  }),
  execute: async ({ sandbox_id, duration }) => {
    const result = await vercel().sandboxes.extendSandboxTimeout({
      ...TEAM,
      sandboxId: sandbox_id,
      requestBody: { duration },
    });
    return JSON.stringify(result);
  },
});

// ──────────────── COMMANDS ────────────────

export const list_sandbox_commands = defineTool({
  name: "list_sandbox_commands",
  domain: "vercel",
  description: "List commands that have been run inside a sandbox.",
  access: { risk: "read" },
  input: z.object({
    sandbox_id: z.string(),
  }),
  execute: async ({ sandbox_id }) => {
    const result = await vercel().sandboxes.listCommands({
      ...TEAM,
      sandboxId: sandbox_id,
    });
    return JSON.stringify(result);
  },
});

export const get_sandbox_command = defineTool({
  name: "get_sandbox_command",
  domain: "vercel",
  description: "Retrieve a command by id.",
  access: { risk: "read" },
  input: z.object({
    sandbox_id: z.string(),
    command_id: z.string(),
  }),
  execute: async ({ sandbox_id, command_id }) => {
    const result = await vercel().sandboxes.getCommand({
      ...TEAM,
      sandboxId: sandbox_id,
      cmdId: command_id,
    });
    return JSON.stringify(result);
  },
});

export const get_sandbox_command_logs = defineTool({
  name: "get_sandbox_command_logs",
  domain: "vercel",
  description: "Fetch stdout/stderr of a sandbox command.",
  access: { risk: "read" },
  input: z.object({
    sandbox_id: z.string(),
    command_id: z.string(),
  }),
  execute: async ({ sandbox_id, command_id }) => {
    const result = await vercel().sandboxes.getCommandLogs({
      ...TEAM,
      sandboxId: sandbox_id,
      cmdId: command_id,
    });
    return JSON.stringify(result);
  },
});

export const kill_sandbox_command = defineTool({
  name: "kill_sandbox_command",
  domain: "vercel",
  description: "Terminate a running sandbox command.",
  access: { risk: "destructive" },
  input: z.object({
    sandbox_id: z.string(),
    command_id: z.string(),
  }),
  execute: async ({ sandbox_id, command_id }) => {
    const result = await vercel().sandboxes.killCommand({
      ...TEAM,
      sandboxId: sandbox_id,
      cmdId: command_id,
    });
    return JSON.stringify(result);
  },
});

// ──────────────── SNAPSHOTS ────────────────

export const list_sandbox_snapshots = defineTool({
  name: "list_sandbox_snapshots",
  domain: "vercel",
  description: "List snapshots captured across the team's sandboxes.",
  access: { risk: "read" },
  input: z.object({
    limit: z.number().optional(),
    since: z.number().optional(),
    until: z.number().optional(),
  }),
  execute: async (input) => {
    const result = await vercel().sandboxes.listSnapshots({ ...TEAM, ...input });
    return JSON.stringify(result);
  },
});

export const get_sandbox_snapshot = defineTool({
  name: "get_sandbox_snapshot",
  domain: "vercel",
  description: "Retrieve a sandbox snapshot by id.",
  access: { risk: "read" },
  input: z.object({ snapshot_id: z.string() }),
  execute: async ({ snapshot_id }) => {
    const result = await vercel().sandboxes.getSnapshot({
      ...TEAM,
      snapshotId: snapshot_id,
    });
    return JSON.stringify(result);
  },
});

export const delete_sandbox_snapshot = defineTool({
  name: "delete_sandbox_snapshot",
  domain: "vercel",
  description: "Delete a sandbox snapshot.",
  access: { risk: "destructive" },
  input: z.object({ snapshot_id: z.string() }),
  execute: async ({ snapshot_id }) => {
    const result = await vercel().sandboxes.deleteSnapshot({
      ...TEAM,
      snapshotId: snapshot_id,
    });
    return JSON.stringify(result);
  },
});
