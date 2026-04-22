import type { Mock } from "vitest";

import type { SlashCommandContext } from "@/bot/commands/types";
import type {
  CreateCodingSandboxConfig,
  ExecOptions,
  ExecResult,
  Sandbox,
  SandboxHooks,
  SandboxProvider,
  VercelSandboxReconnectOptions,
} from "@/lib/sandbox/types";

export interface MockCall {
  method: string;
  args: unknown[];
}

export interface MockDiscord {
  channels: Record<string, (...args: any[]) => Promise<any>>;
  guilds: Record<string, (...args: any[]) => Promise<any>>;
  users: Record<string, (...args: any[]) => Promise<any>>;
  interactions: Record<string, (...args: any[]) => Promise<any>>;
  _calls: MockCall[];
  callsTo(method: string): unknown[][];
}

export type FetchImpl = (url: URL) => Response | Promise<Response>;

export interface NotionClientMocks {
  dataSourcesQuery?: Mock;
  dataSourcesRetrieve?: Mock;
  pagesRetrieve?: Mock;
  pagesUpdate?: Mock;
  pagesCreate?: Mock;
  usersList?: Mock;
  search?: Mock;
  databasesRetrieve?: Mock;
}

export interface PayloadSDKMocks {
  find?: Mock;
  findByID?: Mock;
  create?: Mock;
  update?: Mock;
  delete?: Mock;
  count?: Mock;
}

export interface FakeSlashCommandCtxOptions {
  roles?: string[];
  /** Override interaction fields (id, application_id, token, etc.). */
  interaction?: Partial<SlashCommandContext["interaction"]>;
  /** Override member.user fields. */
  user?: { id?: string; username?: string };
  /** When true, omit `member` entirely (e.g. DM interaction). */
  noMember?: boolean;
}

export interface RichMemoryRedisPipeline {
  get(key: string): RichMemoryRedisPipeline;
  exec<T>(): Promise<T>;
}

export interface RichMemoryRedis {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<"OK">;
  del(key: string): Promise<number>;
  sadd(key: string, ...members: string[]): Promise<number>;
  smembers<T>(key: string): Promise<T>;
  srem(key: string, ...members: string[]): Promise<number>;
  pipeline(): RichMemoryRedisPipeline;
  reset(): void;
}

// ─── sandbox test fixtures ────────────────────────────────────────────────

export type ExecHandler = (
  command: string,
  options: Required<Pick<ExecOptions, "cwd">> & ExecOptions,
) => Promise<ExecResult> | ExecResult;

export interface InMemorySandboxOptions {
  name?: string;
  workingDirectory?: string;
  currentBranch?: string;
  hooks?: SandboxHooks;
  /** Custom exec handler — default returns exit 0 with empty output. */
  execHandler?: ExecHandler;
  /** Seed files: path (absolute) → content. */
  files?: Record<string, string>;
}

export interface TestSandboxProviderOptions {
  /** Override the default `sb-<n>` name assigned to fresh sandboxes. */
  name?: string;
  /** Pre-wire the first reconnect to throw. */
  reconnectFails?: boolean;
  /** Default exec handler for every sandbox the provider mints. */
  execHandler?: ExecHandler;
}

export interface TestSandboxProvider {
  provider: SandboxProvider;
  createCalls: CreateCodingSandboxConfig[];
  reconnectCalls: { id: string; options: VercelSandboxReconnectOptions }[];
  stoppedIds: string[];
  sandboxesById: Map<string, Sandbox>;
  failReconnectOnce: () => void;
}
