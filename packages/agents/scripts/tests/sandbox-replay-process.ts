import { createClient } from "@libsql/client";

import { DurableSession } from "../../agent/lib/sandbox/session.ts";
import { WorkspaceStore } from "../../agent/lib/sandbox/store.ts";
import { testOperation } from "./sandbox-fixtures.ts";

const [url, scope, generation, callId, command] = process.argv.slice(2);
if (
  url === undefined ||
  scope === undefined ||
  generation === undefined ||
  callId === undefined ||
  command === undefined
)
  throw new Error("Missing replay fixture arguments");
const client = createClient({ url });
try {
  const store = new WorkspaceStore(client);
  const sandbox = new DurableSession(store, await store.read(scope, generation));
  process.stdout.write(JSON.stringify(await sandbox.run({ command }, testOperation(callId))));
  await sandbox.close();
} finally {
  client.close();
}
