import type {
  SandboxProviderPrepareContext,
  SandboxProviderSessionContext,
} from "eve/sandbox/provider";

const auth = { attributes: {}, authenticator: "test", principalId: "user", principalType: "user" };
const host: SandboxProviderSessionContext["host"] = {
  loadOptionalPackage: async () => {
    throw new Error("Host package access is forbidden in this fixture");
  },
  resolveProjectPath: () => {
    throw new Error("Host filesystem access is forbidden in this fixture");
  },
};

export function sessionContext(id = "session-a"): SandboxProviderSessionContext {
  return {
    host,
    storagePath: "/nonexistent/host-cache",
    session: {
      id,
      auth: { current: auth, initiator: auth },
      turn: { id: "turn-1", sequence: 1 },
    },
  };
}

export function prepareContext(): SandboxProviderPrepareContext {
  return {
    host,
    storagePath: "/nonexistent/build-cache",
    sourceRevision: "fixture-v1",
    files: {
      list: async () => [],
      read: async () => {
        throw new Error("No host files");
      },
      readText: async () => {
        throw new Error("No host files");
      },
    },
    resources: {
      source: { kind: "inline", key: "fixture" },
      workspace: {
        key: "workspace",
        targetPath: "/workspace",
        mountPath: "/eve/resources/workspace",
        files: [{ relativePath: "seed.txt", content: "seed" }],
      },
    },
  };
}
