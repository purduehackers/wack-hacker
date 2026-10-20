import { posix } from "node:path";

import type { SandboxProcess, SandboxRunOptions, SandboxSession } from "eve/sandbox";
import type { SandboxProviderHandle } from "eve/sandbox/provider";
import { Bash } from "just-bash";

import {
  commandResultSchema,
  hash,
  operationPayload,
  operationResultSchema,
  voidResultSchema,
  writeResultSchema,
  type OperationIdentity,
  type RecordedOperation,
} from "./operation.ts";
import { capture, limits, restore, type WorkspaceFs } from "./snapshot.ts";
import { StaleWorkspaceError, WorkspaceStore, type WorkspaceRecord } from "./store.ts";

const baseEnv = { HOME: "/home/wack", PATH: "/usr/bin:/bin", AI_AGENT: "eve", TMPDIR: "/tmp" };

function streamResult(
  result: Promise<{ stdout: string; stderr: string }>,
  key: "stdout" | "stderr",
) {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(new TextEncoder().encode((await result)[key]));
        controller.close();
      } catch (cause) {
        controller.error(cause);
      }
    },
  });
}

export class DurableSession implements SandboxSession {
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  private readonly abort = new AbortController();

  private readonly store: WorkspaceStore;
  private record: WorkspaceRecord;
  constructor(store: WorkspaceStore, record: WorkspaceRecord) {
    this.store = store;
    this.record = record;
  }

  resolvePath(path: string): string {
    if (Buffer.byteLength(path) > limits.pathBytes || path.includes("\0"))
      throw new Error("Invalid workspace path");
    return posix.resolve("/workspace", path);
  }

  private operate<T>(
    mode: "read" | "candidate" | "attachment",
    execute: (fs: WorkspaceFs) => Promise<T>,
    operation?: { identity: RecordedOperation; parse: (value: unknown) => T },
    abortSignal?: AbortSignal,
  ): Promise<T> {
    const queued = this.queue.then(async () => {
      if (this.closed) throw new Error("Workspace handle is closed; reopen it before continuing");
      abortSignal?.throwIfAborted();
      const current = await this.store.read(this.record.scope, this.record.generation);
      if (operation !== undefined) {
        const receipt = await this.store.receipt(current, operation.identity);
        if (receipt !== undefined) {
          this.record = current;
          return operation.parse(receipt);
        }
      }
      if (current.revision !== this.record.revision) throw new StaleWorkspaceError();
      const fs = await restore(current.snapshot);
      const result = await execute(fs);
      this.abort.signal.throwIfAborted();
      abortSignal?.throwIfAborted();
      if (mode !== "read") {
        const snapshot = await capture(fs);
        if (mode !== "attachment") {
          const protectedEntries = (value: typeof snapshot) =>
            value.entries.filter(
              (entry) =>
                entry.path === "/workspace/.eve" || entry.path.startsWith("/workspace/.eve/"),
            );
          if (
            JSON.stringify(protectedEntries(snapshot)) !==
            JSON.stringify(protectedEntries(current.snapshot))
          )
            throw new Error(
              "Staged attachments are immutable; copy them outside /workspace/.eve before editing",
            );
        }
        // Snapshot capture performs asynchronous reads. Cancellation during it
        // must still discard private changes before starting a DB transaction.
        this.abort.signal.throwIfAborted();
        abortSignal?.throwIfAborted();
        if (operation !== undefined) {
          const output = await this.store.commitOperation(
            current,
            snapshot,
            operation.identity,
            operationResultSchema.parse(result),
          );
          this.record = await this.store.read(current.scope, current.generation);
          return operation.parse(output);
        }
        if (JSON.stringify(snapshot) !== JSON.stringify(current.snapshot)) {
          if (mode !== "attachment")
            throw new Error(
              "Unscoped workspace mutations are disabled. Use the checkpointed bash or write_file tool.",
            );
          this.record = await this.store.commit(current, snapshot);
        }
      }
      return result;
    });
    this.queue = queued.then(
      () => {},
      () => {},
    );
    return queued;
  }

  async run(options: SandboxRunOptions, identity?: OperationIdentity) {
    options.abortSignal?.throwIfAborted();
    if (Buffer.byteLength(options.command) > limits.sourceBytes)
      throw new Error("Command source limit exceeded");
    if (Buffer.byteLength(JSON.stringify(options.env ?? {})) > limits.sourceBytes)
      throw new Error("Command environment limit exceeded");
    return await this.operate(
      "candidate",
      async (fs) => {
        const signal = AbortSignal.any([
          this.abort.signal,
          AbortSignal.timeout(limits.commandMs),
          ...(options.abortSignal === undefined ? [] : [options.abortSignal]),
        ]);
        const bash = new Bash({
          fs,
          cwd: this.resolvePath(options.workingDirectory ?? "/workspace"),
          env: { ...baseEnv, ...options.env },
          python: true,
          javascript: true,
          // No network/fetch/customCommands/invokeTool and no host-backed filesystem.
          executionLimitProfile: "hardened",
          executionLimits: {
            maxSourceBytes: limits.sourceBytes,
            maxOutputSize: limits.outputBytes,
            maxExecutionTimeMs: limits.commandMs,
            maxPythonTimeoutMs: limits.commandMs,
            maxJsTimeoutMs: limits.commandMs,
            maxCommandCount: 5000,
            maxLoopIterations: 5000,
            maxFileSystemBytes: limits.bytes,
            maxWorkerMessageBytes: 8 * 1024 * 1024,
            maxLiveBytes: 32 * 1024 * 1024,
            maxInputBytes: 8 * 1024 * 1024,
            maxArchiveBytes: limits.bytes,
            maxArchiveEntryBytes: limits.fileBytes,
            maxArchiveEntries: limits.entries,
            maxStringLength: limits.fileBytes,
          },
        });
        const result = await bash.exec(options.command, { signal, rawScript: true });
        signal.throwIfAborted();
        return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
      },
      identity === undefined
        ? undefined
        : {
            identity: operationPayload(identity, "run", [
              options.command,
              this.resolvePath(options.workingDirectory ?? "/workspace"),
              Object.entries(options.env ?? {}).sort(([left], [right]) =>
                left.localeCompare(right),
              ),
            ]),
            parse: (value) => commandResultSchema.parse(value),
          },
      options.abortSignal,
    );
  }

  async spawn(options: SandboxRunOptions): Promise<SandboxProcess> {
    const abort = new AbortController();
    const signal = AbortSignal.any([
      abort.signal,
      ...(options.abortSignal === undefined ? [] : [options.abortSignal]),
    ]);
    const result = this.run({ ...options, abortSignal: signal });
    // Suppress an unobserved wait rejection; stream consumers still receive it.
    void result.catch(() => {});
    return {
      stdout: streamResult(result, "stdout"),
      stderr: streamResult(result, "stderr"),
      wait: async () => ({ exitCode: (await result).exitCode }),
      kill: async () => {
        abort.abort();
        await result.catch(() => {});
      },
    };
  }

  async readBinaryFile(options: Parameters<SandboxSession["readBinaryFile"]>[0]) {
    options.abortSignal?.throwIfAborted();
    return await this.operate(
      "read",
      async (fs) => {
        options.abortSignal?.throwIfAborted();
        const path = this.resolvePath(options.path);
        // oxlint-disable-next-line unicorn/no-null -- The public Eve/AI SDK file API requires null for a missing file.
        if (!(await fs.exists(path))) return null;
        const bytes = await fs.readFileBuffer(path);
        options.abortSignal?.throwIfAborted();
        return bytes;
      },
      undefined,
      options.abortSignal,
    );
  }

  async readFile(options: Parameters<SandboxSession["readFile"]>[0]) {
    const bytes = await this.readBinaryFile(options);
    // oxlint-disable-next-line unicorn/no-null -- Preserve the public Eve/AI SDK missing-file sentinel.
    if (bytes === null) return null;
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
  }

  async readTextFile(options: Parameters<SandboxSession["readTextFile"]>[0]) {
    const bytes = await this.readBinaryFile(options);
    // oxlint-disable-next-line unicorn/no-null -- Preserve the public Eve/AI SDK missing-file sentinel.
    if (bytes === null) return null;
    if (options.encoding !== undefined && !["utf-8", "utf8"].includes(options.encoding)) {
      throw new Error("Text reads support UTF-8; use readBinaryFile for other encodings");
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (options.startLine === undefined && options.endLine === undefined) return text;
    const start = options.startLine ?? 1;
    const end = options.endLine ?? Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) {
      throw new Error("Invalid file line range");
    }
    return text
      .split("\n")
      .slice(start - 1, end)
      .join("\n");
  }

  async writeBinaryFile(
    options: Parameters<SandboxSession["writeBinaryFile"]>[0],
    identity?: OperationIdentity,
  ): Promise<void> {
    options.abortSignal?.throwIfAborted();
    if (options.content.byteLength > limits.fileBytes)
      throw new Error("Workspace file limit exceeded");
    const path = this.resolvePath(options.path);
    if (identity === undefined) {
      const match = /^\/workspace\/\.eve\/attachments\/([a-f0-9]{16})\/[\w.-]+$/u.exec(path);
      if (match?.[1] !== hash(options.content).slice(0, 16))
        throw new Error(
          "Unscoped file writes are disabled; only verified immutable attachment imports are accepted",
        );
    }
    await this.operate(
      identity === undefined ? "attachment" : "candidate",
      async (fs) => {
        options.abortSignal?.throwIfAborted();
        if (identity === undefined && (await fs.exists(path))) {
          const prior = await fs.readFileBuffer(path);
          if (!Buffer.from(prior).equals(options.content))
            throw new Error("Immutable attachment path already contains different bytes");
          return { completed: true };
        }
        await fs.mkdir(posix.dirname(path), { recursive: true });
        await fs.writeFile(path, options.content);
        options.abortSignal?.throwIfAborted();
        return { completed: true };
      },
      identity === undefined
        ? undefined
        : {
            identity: operationPayload(identity, "write", [path, hash(options.content)]),
            parse: (value) => voidResultSchema.parse(value),
          },
      options.abortSignal,
    );
  }

  async writeTextFile(
    options: Parameters<SandboxSession["writeTextFile"]>[0],
    identity?: OperationIdentity,
  ): Promise<void> {
    if (options.encoding !== undefined && !["utf-8", "utf8"].includes(options.encoding)) {
      throw new Error("Text writes support UTF-8; use writeBinaryFile for other encodings");
    }
    await this.writeBinaryFile(
      { ...options, content: new TextEncoder().encode(options.content) },
      identity,
    );
  }

  async writeFile(
    options: Parameters<SandboxSession["writeFile"]>[0],
    identity?: OperationIdentity,
  ): Promise<void> {
    const reader = options.content.getReader();
    const buffers: Uint8Array[] = [];
    let size = 0;
    const signal = AbortSignal.any([
      this.abort.signal,
      AbortSignal.timeout(limits.commandMs),
      ...(options.abortSignal === undefined ? [] : [options.abortSignal]),
    ]);
    const cancel = () => {
      void reader.cancel(signal.reason).catch(() => {});
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      while (true) {
        signal.throwIfAborted();
        const chunk = await reader.read();
        signal.throwIfAborted();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > limits.fileBytes) throw new Error("Workspace file limit exceeded");
        buffers.push(chunk.value);
      }
    } catch (cause) {
      await reader.cancel(cause);
      throw cause;
    } finally {
      signal.removeEventListener("abort", cancel);
      reader.releaseLock();
    }
    await this.writeBinaryFile({ ...options, content: Buffer.concat(buffers, size) }, identity);
  }

  async removePath(
    options: Parameters<SandboxSession["removePath"]>[0],
    identity?: OperationIdentity,
  ): Promise<void> {
    options.abortSignal?.throwIfAborted();
    if (identity === undefined)
      throw new Error("Unscoped removal is disabled; use the checkpointed bash tool");
    await this.operate(
      "candidate",
      async (fs) => {
        options.abortSignal?.throwIfAborted();
        await fs.rm(this.resolvePath(options.path), {
          ...(options.force === undefined ? {} : { force: options.force }),
          ...(options.recursive === undefined ? {} : { recursive: options.recursive }),
        });
        options.abortSignal?.throwIfAborted();
        return { completed: true };
      },
      {
        identity: operationPayload(identity, "remove", [
          this.resolvePath(options.path),
          options.force ?? false,
          options.recursive ?? false,
        ]),
        parse: (value) => voidResultSchema.parse(value),
      },
      options.abortSignal,
    );
  }

  async replaceFile(
    options: { path: string; content: string; expectedSha256: string; abortSignal?: AbortSignal },
    identity: OperationIdentity,
  ) {
    return await this.operate(
      "candidate",
      async (fs) => {
        options.abortSignal?.throwIfAborted();
        const path = this.resolvePath(options.path.replace(/^\$HOME(?=\/|$)/u, "/home/wack"));
        const existed = await fs.exists(path);
        const expected = existed ? hash(await fs.readFileBuffer(path)) : "missing";
        if (expected !== options.expectedSha256)
          throw new Error(
            "File changed or was not read. Use bash with sha256sum, then pass that hash; use missing only for a new file.",
          );
        await fs.mkdir(posix.dirname(path), { recursive: true });
        await fs.writeFile(path, options.content);
        options.abortSignal?.throwIfAborted();
        return { existed, path, sha256: hash(options.content) };
      },
      {
        identity: operationPayload(identity, "replace", [
          options.path,
          hash(options.content),
          options.expectedSha256,
        ]),
        parse: (value) => writeResultSchema.parse(value),
      },
      options.abortSignal,
    );
  }

  async close(): Promise<void> {
    this.closed = true;
    this.abort.abort();
    await this.queue;
  }
}

export function handle(
  store: WorkspaceStore,
  record: WorkspaceRecord,
): SandboxProviderHandle<DurableSession> {
  const sandbox = new DurableSession(store, record);
  return {
    sandbox,
    onRuntimeShutdown: () => sandbox.close(),
    onSandboxStop: () => sandbox.close(),
    async onSandboxDelete() {
      await sandbox.close();
      await store.delete(record.scope, record.generation);
    },
  };
}
