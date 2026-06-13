/** Thrown when the per-channel lock is held so the queue retries instead of acking. */
export class LockContentionError extends Error {
  constructor(public readonly channelId: string) {
    super("Channel lock contended: " + channelId);
    this.name = "LockContentionError";
  }
}
