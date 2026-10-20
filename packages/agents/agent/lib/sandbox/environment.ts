import { createClient } from "@libsql/client/web";
import type { SandboxSession } from "eve/sandbox";
import { defineSandboxProvider } from "eve/sandbox/provider";

import { tursoConfig } from "../../env.ts";
import { durableBashImplementation, type Artifact, type State } from "./provider.ts";
import { WorkspaceStore } from "./store.ts";

let database: WorkspaceStore | undefined;
export function workspaceStore(): WorkspaceStore {
  database ??= new WorkspaceStore(createClient(tursoConfig()));
  return database;
}
export const DurableBashSandbox = defineSandboxProvider<
  undefined,
  undefined,
  Artifact,
  State,
  SandboxSession
>({
  name: "wack-durable-bash",
  stateProtocolVersion: 2,
  environment: () => durableBashImplementation(workspaceStore),
});
