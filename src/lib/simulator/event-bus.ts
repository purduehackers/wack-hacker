import type { EmittableEvent, SimEvent } from "./types.ts";

/**
 * A single SSE consumer. A promise-queue: `push` either resolves a pending
 * `next()` or buffers; `close` ends the iterator. Implements the async
 * iterator protocol so the SSE handler can `for await` over it.
 */
class Subscriber implements AsyncIterableIterator<SimEvent> {
  private queue: SimEvent[] = [];
  private resolve: ((result: IteratorResult<SimEvent>) => void) | null = null;
  private done = false;
  /** Cleanup run when the consumer stops iterating (loop break / return). */
  onReturn: (() => void) | null = null;

  push(event: SimEvent): void {
    if (this.done) return;
    if (this.resolve) {
      const resolve = this.resolve;
      this.resolve = null;
      resolve({ value: event, done: false });
    } else {
      this.queue.push(event);
    }
  }

  close(): void {
    this.done = true;
    if (this.resolve) {
      const resolve = this.resolve;
      this.resolve = null;
      resolve({ value: undefined, done: true });
    }
  }

  next(): Promise<IteratorResult<SimEvent>> {
    if (this.queue.length > 0) {
      return Promise.resolve({ value: this.queue.shift()!, done: false });
    }
    if (this.done) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  // Called automatically when a `for await` loop breaks/returns, so a finished
  // per-turn SSE consumer is unregistered from the bus instead of leaking.
  return(): Promise<IteratorResult<SimEvent>> {
    this.onReturn?.();
    this.close();
    return Promise.resolve({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<SimEvent> {
    return this;
  }
}

/**
 * Promise-queue fan-out that bridges synchronous transport calls (a renderer
 * `flush()`, a tool's REST write) to the SSE async iterator the route awaits.
 * `emit()` stamps `seq`/`ts`/`runId`, records to a replay buffer, and wakes
 * every live subscriber. New subscribers replay the full history first so a
 * reconnect (or a subscribe that races the first emits) loses nothing.
 */
export class SimEventBus {
  private seq = 0;
  private historyBuffer: SimEvent[] = [];
  private subscribers = new Set<Subscriber>();
  private closed = false;

  constructor(readonly runId: string) {}

  emit(event: EmittableEvent): SimEvent {
    const full = { ...event, seq: this.seq++, ts: Date.now(), runId: this.runId } as SimEvent;
    this.historyBuffer.push(full);
    for (const subscriber of this.subscribers) subscriber.push(full);
    return full;
  }

  subscribe(
    opts: { signal?: AbortSignal; replayHistory?: boolean } = {},
  ): AsyncIterableIterator<SimEvent> {
    const subscriber = new Subscriber();
    if (opts.replayHistory ?? true) {
      for (const event of this.historyBuffer) subscriber.push(event);
    }
    if (this.closed) {
      subscriber.close();
      return subscriber;
    }
    this.subscribers.add(subscriber);
    subscriber.onReturn = () => this.subscribers.delete(subscriber);
    const drop = () => {
      this.subscribers.delete(subscriber);
      subscriber.close();
    };
    opts.signal?.addEventListener("abort", drop, { once: true });
    return subscriber;
  }

  history(): SimEvent[] {
    return [...this.historyBuffer];
  }

  close(): void {
    this.closed = true;
    for (const subscriber of this.subscribers) subscriber.close();
    this.subscribers.clear();
  }
}
