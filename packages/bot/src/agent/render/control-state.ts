import type { ConversationStore, TaskControl } from "@repo/shared/conversations";
import type { Reporter } from "@repo/shared/result/observe";

/** Optional controls cannot block an otherwise valid answer or terminal paint. */
export async function readTaskControl(
  reader: Pick<ConversationStore["cancellations"], "read"> | undefined,
  reporter: Reporter,
  dispatchId: string,
): Promise<TaskControl | undefined> {
  try {
    return await reader?.read(dispatchId);
  } catch (cause) {
    reporter.captureDefect(cause, {
      op: "agent.work-card.control-state",
      attributes: { dispatchId },
    });
    return undefined;
  }
}
