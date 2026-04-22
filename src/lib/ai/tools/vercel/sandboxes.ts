import { tool } from "ai";
import { z } from "zod";

import { vercel } from "./client.ts";
import { VERCEL_TEAM_ID, VERCEL_TEAM_SLUG } from "./constants.ts";

const TEAM = { teamId: VERCEL_TEAM_ID, slug: VERCEL_TEAM_SLUG } as const;

// ──────────────── SANDBOX LIFECYCLE ────────────────

export const list_sandboxes = tool({
  description: "List every active Vercel Sandbox in the team.",
  inputSchema: z.object({
    limit: z.number().optional(),
    since: z.number().optional(),
    until: z.number().optional(),
  }),
  execute: async (input) => {
    const result = await vercel().sandboxes.getSandboxesV1({ ...TEAM, ...input });
    return JSON.stringify(result);
  },
});

export const get_sandbox = tool({
  description: "Retrieve a Vercel Sandbox by id.",
  inputSchema: z.object({ sandbox_id: z.string() }),
  execute: async ({ sandbox_id }) => {
    const result = await vercel().sandboxes.getSandbox({ ...TEAM, sandboxId: sandbox_id });
    return JSON.stringify(result);
  },
});

/** @destructive Stops a running Vercel Sandbox. */
export const stop_sandbox = tool({
  description: "Stop a running Vercel Sandbox. Files and state within the sandbox are lost.",
  inputSchema: z.object({ sandbox_id: z.string() }),
  execute: async ({ sandbox_id }) => {
    const result = await vercel().sandboxes.stopSandbox({
      ...TEAM,
      sandboxId: sandbox_id,
    });
    return JSON.stringify(result);
  },
});

/** @destructive Extends a sandbox's timeout — costs additional compute. */
export const extend_sandbox_timeout = tool({
  description:
    "Extend a sandbox's maximum runtime by an additional `duration` (seconds). Costs additional compute.",
  inputSchema: z.object({
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

export const list_sandbox_commands = tool({
  description: "List commands that have been run inside a sandbox.",
  inputSchema: z.object({
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

export const get_sandbox_command = tool({
  description: "Retrieve a command by id.",
  inputSchema: z.object({
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

export const get_sandbox_command_logs = tool({
  description: "Fetch stdout/stderr of a sandbox command.",
  inputSchema: z.object({
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

/** @destructive Kills an in-flight sandbox command. */
export const kill_sandbox_command = tool({
  description: "Terminate a running sandbox command.",
  inputSchema: z.object({
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

export const list_sandbox_snapshots = tool({
  description: "List snapshots captured across the team's sandboxes.",
  inputSchema: z.object({
    limit: z.number().optional(),
    since: z.number().optional(),
    until: z.number().optional(),
  }),
  execute: async (input) => {
    const result = await vercel().sandboxes.listSnapshots({ ...TEAM, ...input });
    return JSON.stringify(result);
  },
});

export const get_sandbox_snapshot = tool({
  description: "Retrieve a sandbox snapshot by id.",
  inputSchema: z.object({ snapshot_id: z.string() }),
  execute: async ({ snapshot_id }) => {
    const result = await vercel().sandboxes.getSnapshot({
      ...TEAM,
      snapshotId: snapshot_id,
    });
    return JSON.stringify(result);
  },
});

/** @destructive Deletes a sandbox snapshot. */
export const delete_sandbox_snapshot = tool({
  description: "Delete a sandbox snapshot.",
  inputSchema: z.object({ snapshot_id: z.string() }),
  execute: async ({ snapshot_id }) => {
    const result = await vercel().sandboxes.deleteSnapshot({
      ...TEAM,
      snapshotId: snapshot_id,
    });
    return JSON.stringify(result);
  },
});
