import { beforeEach, describe, expect, it, vi } from "vitest";

import { toolOpts } from "@/lib/test/fixtures";

const getProjects = vi.fn();
const deleteProject = vi.fn();
const pauseProject = vi.fn();
const unpauseProject = vi.fn();
const createProjectTransferRequest = vi.fn();
const filterProjectEnvs = vi.fn();
const getProjectEnv = vi.fn();
const createProjectEnv = vi.fn();
const editProjectEnv = vi.fn();
const removeProjectEnv = vi.fn();
const getProjectDomains = vi.fn();
const getProjectDomain = vi.fn();
const verifyProjectDomain = vi.fn();
const removeProjectDomain = vi.fn();
const listPromoteAliases = vi.fn();
const getProjectMembers = vi.fn();
const removeProjectMember = vi.fn();

vi.mock("./client.ts", () => ({
  vercel: () => ({
    projects: {
      getProjects,
      deleteProject,
      pauseProject,
      unpauseProject,
      createProjectTransferRequest,
      filterProjectEnvs,
      getProjectEnv,
      createProjectEnv,
      editProjectEnv,
      removeProjectEnv,
      getProjectDomains,
      getProjectDomain,
      verifyProjectDomain,
      removeProjectDomain,
      listPromoteAliases,
    },
    projectMembers: {
      getProjectMembers,
      removeProjectMember,
    },
  }),
}));

vi.mock("./constants.ts", () => ({
  VERCEL_TEAM_ID: "team_test",
  VERCEL_TEAM_SLUG: "purduehackers",
  VERCEL_DASHBOARD_BASE: "https://vercel.com/purduehackers",
}));

const mod = await import("./projects.ts");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("list_projects", () => {
  it("passes pagination + filters (limit stringified, from stringified)", async () => {
    getProjects.mockResolvedValueOnce({ projects: [] });
    await mod.list_projects.execute!({ search: "wack", limit: 10, from: 123 }, toolOpts);
    expect(getProjects).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: "team_test",
        slug: "purduehackers",
        search: "wack",
        limit: "10",
        from: "123",
      }),
    );
  });
});

describe("get_project", () => {
  it("calls getProjects with search", async () => {
    getProjects.mockResolvedValueOnce({ projects: [] });
    await mod.get_project.execute!({ project_id_or_name: "wack-hacker" }, toolOpts);
    expect(getProjects).toHaveBeenCalledWith(
      expect.objectContaining({ search: "wack-hacker", limit: "1" }),
    );
  });
});

describe("delete_project", () => {
  it("returns ok and calls deleteProject", async () => {
    deleteProject.mockResolvedValueOnce(undefined);
    const raw = await mod.delete_project.execute!({ project_id_or_name: "prj_1" }, toolOpts);
    expect(JSON.parse(raw as string)).toEqual({ ok: true, id: "prj_1" });
    expect(deleteProject).toHaveBeenCalledWith(expect.objectContaining({ idOrName: "prj_1" }));
  });
});

describe("pause/unpause_project", () => {
  it("flips paused state", async () => {
    pauseProject.mockResolvedValueOnce(undefined);
    const paused = await mod.pause_project.execute!({ project_id: "prj_1" }, toolOpts);
    expect(JSON.parse(paused as string).paused).toBe(true);

    unpauseProject.mockResolvedValueOnce(undefined);
    const unpaused = await mod.unpause_project.execute!({ project_id: "prj_1" }, toolOpts);
    expect(JSON.parse(unpaused as string).paused).toBe(false);
  });
});

describe("create_project_transfer_request", () => {
  it("calls createProjectTransferRequest with idOrName", async () => {
    createProjectTransferRequest.mockResolvedValueOnce({ code: "xyz" });
    await mod.create_project_transfer_request.execute!({ project_id_or_name: "prj_1" }, toolOpts);
    expect(createProjectTransferRequest).toHaveBeenCalledWith(
      expect.objectContaining({ idOrName: "prj_1" }),
    );
  });
});

describe("env var value stripping — security regression", () => {
  it("redacts `value` from list response", async () => {
    filterProjectEnvs.mockResolvedValueOnce({
      envs: [
        { id: "e1", key: "SECRET", value: "plaintext-should-not-leak", type: "encrypted" },
        { id: "e2", key: "FEATURE_FLAG", value: "yes", type: "plain" },
      ],
    });
    const raw = await mod.list_project_env_vars.execute!({ project_id_or_name: "prj_1" }, toolOpts);
    expect(raw).not.toContain("plaintext-should-not-leak");
    expect(raw).not.toContain("yes");
    const parsed = JSON.parse(raw as string);
    for (const e of parsed.envs) {
      expect(Object.keys(e)).not.toContain("value");
    }
  });

  it("redacts from create response", async () => {
    createProjectEnv.mockResolvedValueOnce({
      created: { key: "K", value: "v-should-redact", type: "encrypted" },
    });
    const raw = await mod.create_project_env_vars.execute!(
      {
        project_id_or_name: "prj_1",
        entries: [{ key: "K", value: "v", type: "encrypted", target: ["production"] }],
      },
      toolOpts,
    );
    expect(raw).not.toContain("v-should-redact");
  });

  it("redacts from edit response", async () => {
    editProjectEnv.mockResolvedValueOnce({ id: "e1", key: "K", value: "v", type: "encrypted" });
    const raw = await mod.edit_project_env_var.execute!(
      { project_id_or_name: "prj_1", env_var_id: "e1", value: "v" },
      toolOpts,
    );
    const parsed = JSON.parse(raw as string);
    expect(Object.keys(parsed)).not.toContain("value");
  });
});

describe("create_project_env_vars", () => {
  it("upsert query flag is stringified", async () => {
    createProjectEnv.mockResolvedValueOnce({});
    await mod.create_project_env_vars.execute!(
      {
        project_id_or_name: "prj_1",
        upsert: true,
        entries: [{ key: "K", value: "v", type: "plain", target: ["preview"] }],
      },
      toolOpts,
    );
    expect(createProjectEnv).toHaveBeenCalledWith(expect.objectContaining({ upsert: "true" }));
  });
});

describe("remove_project_env_var", () => {
  it("passes id", async () => {
    removeProjectEnv.mockResolvedValueOnce({});
    await mod.remove_project_env_var.execute!(
      { project_id_or_name: "prj_1", env_var_id: "e1" },
      toolOpts,
    );
    expect(removeProjectEnv).toHaveBeenCalledWith(expect.objectContaining({ id: "e1" }));
  });
});

describe("get_project_env_var", () => {
  it("returns decrypted value (not stripped)", async () => {
    getProjectEnv.mockResolvedValueOnce({ id: "e1", key: "K", value: "v" });
    const raw = await mod.get_project_env_var.execute!(
      { project_id_or_name: "prj_1", env_var_id: "e1" },
      toolOpts,
    );
    expect(JSON.parse(raw as string).value).toBe("v");
  });
});

describe("project domains", () => {
  it("list", async () => {
    getProjectDomains.mockResolvedValueOnce({ domains: [] });
    await mod.list_project_domains.execute!(
      { project_id_or_name: "prj_1", verified: "true" },
      toolOpts,
    );
    expect(getProjectDomains).toHaveBeenCalledWith(
      expect.objectContaining({ idOrName: "prj_1", verified: "true" }),
    );
  });

  it("get", async () => {
    getProjectDomain.mockResolvedValueOnce({ name: "example.com" });
    await mod.get_project_domain.execute!(
      { project_id_or_name: "prj_1", domain: "example.com" },
      toolOpts,
    );
    expect(getProjectDomain).toHaveBeenCalledWith(
      expect.objectContaining({ domain: "example.com" }),
    );
  });

  it("verify", async () => {
    verifyProjectDomain.mockResolvedValueOnce({ verified: true });
    await mod.verify_project_domain.execute!(
      { project_id_or_name: "prj_1", domain: "example.com" },
      toolOpts,
    );
    expect(verifyProjectDomain).toHaveBeenCalledWith(
      expect.objectContaining({ domain: "example.com" }),
    );
  });

  it("remove", async () => {
    removeProjectDomain.mockResolvedValueOnce({});
    await mod.remove_project_domain.execute!(
      { project_id_or_name: "prj_1", domain: "example.com" },
      toolOpts,
    );
    expect(removeProjectDomain).toHaveBeenCalled();
  });
});

describe("project members", () => {
  it("list", async () => {
    getProjectMembers.mockResolvedValueOnce({ members: [] });
    await mod.list_project_members.execute!({ project_id_or_name: "prj_1", limit: 10 }, toolOpts);
    expect(getProjectMembers).toHaveBeenCalledWith(
      expect.objectContaining({ idOrName: "prj_1", limit: 10 }),
    );
  });

  it("remove", async () => {
    removeProjectMember.mockResolvedValueOnce({});
    await mod.remove_project_member.execute!({ project_id_or_name: "prj_1", uid: "u_1" }, toolOpts);
    expect(removeProjectMember).toHaveBeenCalledWith(expect.objectContaining({ uid: "u_1" }));
  });
});

describe("list_promote_aliases", () => {
  it("scopes to project", async () => {
    listPromoteAliases.mockResolvedValueOnce({ aliases: [] });
    await mod.list_promote_aliases.execute!({ project_id_or_name: "prj_1" }, toolOpts);
    expect(listPromoteAliases).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "prj_1" }),
    );
  });
});
