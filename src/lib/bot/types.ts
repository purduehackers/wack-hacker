/** Per-thread state persisted via Chat SDK's Redis adapter. */
export interface ThreadState {
  /** Workflow run ID for the active chat session. */
  runId?: string;
  /** Run IDs for scheduled tasks spawned from this thread. */
  taskIds?: string[];
}
