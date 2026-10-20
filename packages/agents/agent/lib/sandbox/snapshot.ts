import { posix } from "node:path";

import { InMemoryFs } from "just-bash";
import { z } from "zod";

export const limits = {
  bytes: 4 * 1024 * 1024,
  fileBytes: 3 * 1024 * 1024,
  entries: 1024,
  pathBytes: 1024,
  sourceBytes: 64 * 1024,
  outputBytes: 256 * 1024,
  commandMs: 10_000,
  snapshotBytes: 6 * 1024 * 1024,
};

const pathSchema = z
  .string()
  .max(limits.pathBytes)
  .refine(isPersistentPath, "Invalid workspace path");
const metadata = { path: pathSchema, mode: z.int().min(0).max(0o7777), mtime: z.int().min(0) };
export const snapshotSchema = z.strictObject({
  version: z.literal(1),
  entries: z
    .array(
      z.discriminatedUnion("kind", [
        z.strictObject({
          ...metadata,
          kind: z.literal("file"),
          data: z.base64().max((limits.fileBytes * 4) / 3),
        }),
        z.strictObject({ ...metadata, kind: z.literal("directory") }),
        z.strictObject({
          path: pathSchema,
          kind: z.literal("symlink"),
          target: z.string().max(limits.pathBytes),
        }),
      ]),
    )
    .max(limits.entries),
});
export type Snapshot = z.output<typeof snapshotSchema>;

export function isPersistentPath(path: string): boolean {
  return (
    !path.includes("\0") &&
    posix.normalize(path) === path &&
    ["/workspace", "/home", "/tmp"].some((root) => path === root || path.startsWith(`${root}/`))
  );
}

/** Pure virtual memory; never mount a host directory or pass process.env here. */
export class WorkspaceFs extends InMemoryFs {
  constructor() {
    super({}, { maxTotalBytes: limits.bytes });
  }

  async assertWritable(path: string): Promise<void> {
    const absolute = posix.resolve("/workspace", path);
    if (!isPersistentPath(absolute) || Buffer.byteLength(absolute) > limits.pathBytes) {
      throw new Error("Only /workspace, /home and /tmp are writable");
    }
    // Follow existing parents too: a symlink must not escape the durable roots.
    let parent = absolute;
    while (!(await this.exists(parent))) parent = posix.dirname(parent);
    if (!isPersistentPath(await this.realpath(parent))) {
      throw new Error("Symlink destination is outside the durable workspace");
    }
  }

  override async writeFile(...args: Parameters<InMemoryFs["writeFile"]>): Promise<void> {
    await this.assertWritable(args[0]);
    if (contentBytes(args[1], args[2]) > limits.fileBytes)
      throw new Error("Workspace file limit exceeded");
    await this.checkNewPaths(args[0]);
    await super.writeFile(...args);
    await this.checkBounds();
  }

  override async appendFile(...args: Parameters<InMemoryFs["appendFile"]>): Promise<void> {
    await this.assertWritable(args[0]);
    const current = (await this.exists(args[0])) ? (await this.stat(args[0])).size : 0;
    if (current + contentBytes(args[1], args[2]) > limits.fileBytes)
      throw new Error("Workspace file limit exceeded");
    await this.checkNewPaths(args[0]);
    await super.appendFile(...args);
    await this.checkBounds();
  }

  override async mkdir(...args: Parameters<InMemoryFs["mkdir"]>): Promise<void> {
    // A root may not exist yet; its parent is the virtual root.
    if (!["/workspace", "/home", "/tmp"].includes(args[0])) await this.assertWritable(args[0]);
    await this.checkNewPaths(args[0]);
    await super.mkdir(...args);
    await this.checkBounds();
  }

  override async createExclusive(
    ...args: Parameters<InMemoryFs["createExclusive"]>
  ): Promise<void> {
    await this.assertWritable(args[0]);
    await this.checkNewPaths(args[0]);
    await super.createExclusive(...args);
    await this.checkBounds();
  }

  override async rm(...args: Parameters<InMemoryFs["rm"]>): Promise<void> {
    await this.assertWritable(args[0]);
    if (["/workspace", "/home", "/tmp"].includes(posix.resolve(args[0])))
      throw new Error("Cannot remove workspace roots");
    await super.rm(...args);
  }

  override async cp(...args: Parameters<InMemoryFs["cp"]>): Promise<void> {
    await this.assertWritable(args[1]);
    await this.withRollback(async () => super.cp(...args));
  }

  override async mv(...args: Parameters<InMemoryFs["mv"]>): Promise<void> {
    await this.assertWritable(args[0]);
    await this.assertWritable(args[1]);
    if (
      [args[0], args[1]].some((path) =>
        ["/workspace", "/home", "/tmp"].includes(posix.resolve(path)),
      )
    )
      throw new Error("Cannot move workspace roots");
    await this.withRollback(async () => super.mv(...args));
  }

  override async chmod(...args: Parameters<InMemoryFs["chmod"]>): Promise<void> {
    await this.assertWritable(args[0]);
    await super.chmod(...args);
  }

  override async utimes(...args: Parameters<InMemoryFs["utimes"]>): Promise<void> {
    await this.assertWritable(args[0]);
    await super.utimes(...args);
  }

  override async symlink(target: string, path: string): Promise<void> {
    await this.assertWritable(path);
    if (
      Buffer.byteLength(target) > limits.pathBytes ||
      !isPersistentPath(posix.resolve(posix.dirname(path), target))
    ) {
      throw new Error("Symlinks must stay within the durable workspace");
    }
    await this.checkNewPaths(path);
    await super.symlink(target, path);
    await this.checkBounds();
  }

  override async link(): Promise<void> {
    throw new Error("Hard links are not supported; copy the file instead");
  }

  private async checkNewPaths(path: string): Promise<void> {
    const prospective = new Set(this.getAllPaths().filter(isPersistentPath));
    let parent = posix.resolve("/workspace", path);
    const missing: string[] = [];
    while (!(await this.exists(parent))) {
      missing.unshift(posix.basename(parent));
      parent = posix.dirname(parent);
    }
    parent = await this.realpath(parent);
    for (const part of missing) {
      parent = posix.join(parent, part);
      if (Buffer.byteLength(parent) > limits.pathBytes)
        throw new Error("Workspace path limit exceeded");
      prospective.add(parent);
    }
    if (prospective.size > limits.entries) throw new Error("Workspace entry limit exceeded");
  }

  /** cp/mv may alter several entries before failing; discard that partial change. */
  private async withRollback(action: () => Promise<void>): Promise<void> {
    const before = await capture(this);
    try {
      await action();
      await this.checkBounds();
    } catch (cause) {
      for (const root of ["/workspace", "/home", "/tmp"])
        await super.rm(root, { recursive: true, force: true });
      for (const entry of before.entries) {
        if (entry.kind === "directory") await super.mkdir(entry.path, { recursive: true });
      }
      for (const entry of before.entries) {
        if (entry.kind === "file")
          await super.writeFile(entry.path, Buffer.from(entry.data, "base64"));
      }
      for (const entry of before.entries) {
        if (entry.kind === "symlink") await super.symlink(entry.target, entry.path);
        else {
          await super.chmod(entry.path, entry.mode);
          await super.utimes(entry.path, new Date(entry.mtime), new Date(entry.mtime));
        }
      }
      throw cause;
    }
  }

  async checkBounds(): Promise<void> {
    const filenames = this.getAllPaths().filter(isPersistentPath);
    if (filenames.length > limits.entries) throw new Error("Workspace entry limit exceeded");
    let bytes = 0;
    for (const path of filenames) {
      if (Buffer.byteLength(path) > limits.pathBytes)
        throw new Error("Workspace path limit exceeded");
      const stat = await this.lstat(path);
      if (stat.isFile) {
        if (stat.size > limits.fileBytes) throw new Error("Workspace file limit exceeded");
        bytes += stat.size;
      }
    }
    if (bytes > limits.bytes) throw new Error("Workspace byte limit exceeded");
  }
}

const encodingSchema = z.enum(["utf8", "utf-8", "ascii", "binary", "base64", "hex", "latin1"]);
function contentBytes(
  content: string | Uint8Array,
  options: Parameters<InMemoryFs["writeFile"]>[2],
): number {
  if (content instanceof Uint8Array) return content.byteLength;
  const direct = encodingSchema.safeParse(options);
  const encoding = direct.success
    ? direct.data
    : (z.object({ encoding: encodingSchema.optional() }).parse(options ?? {}).encoding ?? "utf8");
  return Buffer.from(content, encoding).byteLength;
}

export async function capture(fs: WorkspaceFs): Promise<Snapshot> {
  await fs.checkBounds();
  const entries: Snapshot["entries"] = [];
  for (const path of fs.getAllPaths().filter(isPersistentPath).sort()) {
    const stat = await fs.lstat(path);
    const meta = { path, mode: stat.mode, mtime: stat.mtime.getTime() };
    if (stat.isSymbolicLink)
      entries.push({ path, kind: "symlink", target: await fs.readlink(path) });
    else if (stat.isDirectory) entries.push({ ...meta, kind: "directory" });
    else
      entries.push({
        ...meta,
        kind: "file",
        data: Buffer.from(await fs.readFileBuffer(path)).toString("base64"),
      });
  }
  return snapshotSchema.parse({ version: 1, entries });
}

export async function restore(value: Snapshot): Promise<WorkspaceFs> {
  const snapshot = snapshotSchema.parse(value);
  const fs = new WorkspaceFs();
  const seen = new Set<string>();
  // Directories, files, then links; never restore data through a saved link.
  for (const entry of snapshot.entries) {
    if (seen.has(entry.path)) throw new Error("Duplicate workspace path");
    seen.add(entry.path);
  }
  for (const root of ["/workspace", "/home", "/tmp"]) await fs.mkdir(root, { recursive: true });
  for (const entry of snapshot.entries.filter((item) => item.kind === "directory")) {
    await fs.mkdir(entry.path, { recursive: true });
  }
  for (const entry of snapshot.entries) {
    if (entry.kind !== "file") continue;
    await fs.mkdir(posix.dirname(entry.path), { recursive: true });
    await fs.writeFile(entry.path, Buffer.from(entry.data, "base64"));
  }
  for (const entry of snapshot.entries) {
    if (entry.kind === "symlink") await fs.symlink(entry.target, entry.path);
    else {
      await fs.chmod(entry.path, entry.mode);
      await fs.utimes(entry.path, new Date(entry.mtime), new Date(entry.mtime));
    }
  }
  await fs.checkBounds();
  return fs;
}
