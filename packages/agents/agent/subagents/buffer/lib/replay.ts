import { bufferResultSchema } from "./results.ts";
import type { BufferResult } from "./results.ts";

interface ReplayRecord {
  readonly inputHash: string;
  readonly status: string;
  readonly result: string | null;
}
export interface MutationJournal {
  readonly start: () => Promise<boolean>;
  readonly previous: () => Promise<ReplayRecord | undefined>;
  readonly finish: (result: BufferResult) => Promise<void>;
}

/** Persist intent before network I/O. A crash or lost response never silently repeats a write. */
export async function executeOnce(
  inputHash: string,
  journal: MutationJournal,
  run: () => Promise<BufferResult>,
) {
  if (!(await journal.start())) {
    const previous = await journal.previous();
    if (previous?.inputHash !== inputHash) throw new Error("Buffer replay input changed");
    if (previous.status === "completed" && previous.result !== null)
      return bufferResultSchema.parse(JSON.parse(previous.result));
    throw new Error(
      "Previous Buffer write has an uncertain outcome. Re-fetch affected resources before taking another action; this call will not be replayed.",
    );
  }
  const result = await run();
  await journal.finish(result);
  return result;
}
