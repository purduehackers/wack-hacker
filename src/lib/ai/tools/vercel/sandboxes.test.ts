import { beforeEach, describe, expect, it, vi } from "vitest";

import { toolOpts } from "@/lib/test/fixtures";

const sandboxes = {
  getSandboxesV1: vi.fn(),
  getSandbox: vi.fn(),
  stopSandbox: vi.fn(),
  extendSandboxTimeout: vi.fn(),
  listCommands: vi.fn(),
  getCommand: vi.fn(),
  getCommandLogs: vi.fn(),
  killCommand: vi.fn(),
  listSnapshots: vi.fn(),
  getSnapshot: vi.fn(),
  deleteSnapshot: vi.fn(),
};

vi.mock("./client.ts", () => ({
  vercel: () => ({ sandboxes }),
}));

vi.mock("./constants.ts", () => ({
  VERCEL_TEAM_ID: "team_test",
  VERCEL_TEAM_SLUG: "purduehackers",
  VERCEL_DASHBOARD_BASE: "https://vercel.com/purduehackers",
}));

const mod = await import("./sandboxes.ts");

beforeEach(() => {
  for (const fn of Object.values(sandboxes)) fn.mockReset();
});

describe("sandbox lifecycle", () => {
  it("list + get", async () => {
    sandboxes.getSandboxesV1.mockResolvedValueOnce({ sandboxes: [] });
    await mod.list_sandboxes.execute!({ limit: 10 }, toolOpts);

    sandboxes.getSandbox.mockResolvedValueOnce({});
    await mod.get_sandbox.execute!({ sandbox_id: "sb_1" }, toolOpts);
    expect(sandboxes.getSandbox).toHaveBeenCalledWith(
      expect.objectContaining({ sandboxId: "sb_1" }),
    );
  });

  it("stop + extend timeout", async () => {
    sandboxes.stopSandbox.mockResolvedValueOnce({});
    await mod.stop_sandbox.execute!({ sandbox_id: "sb_1" }, toolOpts);

    sandboxes.extendSandboxTimeout.mockResolvedValueOnce({});
    await mod.extend_sandbox_timeout.execute!({ sandbox_id: "sb_1", duration: 300 }, toolOpts);
    expect(sandboxes.extendSandboxTimeout).toHaveBeenCalledWith(
      expect.objectContaining({
        sandboxId: "sb_1",
        requestBody: { duration: 300 },
      }),
    );
  });
});

describe("commands", () => {
  it("list + get + logs + kill", async () => {
    sandboxes.listCommands.mockResolvedValueOnce({});
    await mod.list_sandbox_commands.execute!({ sandbox_id: "sb_1" }, toolOpts);

    sandboxes.getCommand.mockResolvedValueOnce({});
    await mod.get_sandbox_command.execute!({ sandbox_id: "sb_1", command_id: "cmd_1" }, toolOpts);

    sandboxes.getCommandLogs.mockResolvedValueOnce({});
    await mod.get_sandbox_command_logs.execute!(
      { sandbox_id: "sb_1", command_id: "cmd_1" },
      toolOpts,
    );

    sandboxes.killCommand.mockResolvedValueOnce({});
    await mod.kill_sandbox_command.execute!({ sandbox_id: "sb_1", command_id: "cmd_1" }, toolOpts);
  });
});

describe("snapshots", () => {
  it("list + get + delete", async () => {
    sandboxes.listSnapshots.mockResolvedValueOnce({ snapshots: [] });
    await mod.list_sandbox_snapshots.execute!({}, toolOpts);

    sandboxes.getSnapshot.mockResolvedValueOnce({});
    await mod.get_sandbox_snapshot.execute!({ snapshot_id: "sn_1" }, toolOpts);

    sandboxes.deleteSnapshot.mockResolvedValueOnce({});
    await mod.delete_sandbox_snapshot.execute!({ snapshot_id: "sn_1" }, toolOpts);
  });
});
