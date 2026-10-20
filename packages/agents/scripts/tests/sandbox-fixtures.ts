import type { SandboxSession } from "eve/sandbox";
import type {
  SandboxProviderPrepareContext,
  SandboxProviderSessionContext,
} from "eve/sandbox/provider";

import { operationIdentity } from "../../agent/lib/sandbox/operation.ts";
import type { DurableSession } from "../../agent/lib/sandbox/session.ts";

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

export function testOperation(callId: string = crypto.randomUUID()) {
  return operationIdentity({
    sessionId: "session-a",
    turnId: "turn-1",
    callId,
    toolName: "fixture",
    workflowRunId: "fixture-run",
  });
}

/** Existing engine/lifecycle tests model distinct already-checkpointed calls. */
export function trackedSandbox(sandbox: DurableSession): SandboxSession {
  return {
    resolvePath: (path) => sandbox.resolvePath(path),
    run: (options) => sandbox.run(options, testOperation()),
    spawn: (options) => sandbox.spawn(options),
    readFile: (options) => sandbox.readFile(options),
    readBinaryFile: (options) => sandbox.readBinaryFile(options),
    readTextFile: (options) => sandbox.readTextFile(options),
    writeFile: (options) => sandbox.writeFile(options, testOperation()),
    writeBinaryFile: (options) => sandbox.writeBinaryFile(options, testOperation()),
    writeTextFile: (options) => sandbox.writeTextFile(options, testOperation()),
    removePath: (options) => sandbox.removePath(options, testOperation()),
  };
}
