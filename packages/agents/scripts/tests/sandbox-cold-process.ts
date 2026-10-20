import { createClient } from "@libsql/client";

import { DurableSession } from "../../agent/lib/sandbox/session.ts";
import { WorkspaceStore } from "../../agent/lib/sandbox/store.ts";
import { testOperation } from "./sandbox-fixtures.ts";

const [url, scope, generation] = process.argv.slice(2);
if (url === undefined || scope === undefined || generation === undefined)
  throw new Error("Missing cold-process fixture arguments");
const client = createClient({ url });
try {
  const store = new WorkspaceStore(client);
  const sandbox = new DurableSession(store, await store.read(scope, generation));
  const result = await sandbox.run(
    { command: "cat saved.txt; printf restored > child.txt" },
    testOperation(),
  );
  if (result.exitCode !== 0) throw new Error(result.stderr);
  process.stdout.write(result.stdout);
  await sandbox.close();
} finally {
  client.close();
}
