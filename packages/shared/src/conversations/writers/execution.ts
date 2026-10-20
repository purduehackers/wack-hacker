import type { RedisClient } from "../../redis/client.ts";
import { decodeStored, evalFlag } from "../io.ts";
import { dispatchExecutionKey, executionKey, resetKey } from "../keys.ts";
import { executionBindingSchema, type ExecutionBinding } from "../records/execution.ts";

const BIND = `
-- execution:bind
local existing = redis.call("GET", KEYS[1])
if existing then return existing end
redis.call("SET", KEYS[1], ARGV[1])
return ARGV[1]
`;

const DISPATCH = `
-- execution:dispatch
local existing = redis.call("GET", KEYS[2])
if existing then return existing end
local binding = redis.call("GET", KEYS[1])
if not binding then return nil end
redis.call("SET", KEYS[2], binding, "EX", 604800)
return binding
`;

const CONFIRM = `
-- execution:confirm
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local binding = cjson.decode(raw)
if binding.generation ~= ARGV[1] then return 0 end
if binding.sessionId and binding.sessionId ~= ARGV[2] then return 0 end
binding.sessionId = ARGV[2]
local dispatch = redis.call("GET", KEYS[2])
if dispatch then
  local pinned = cjson.decode(dispatch)
  if pinned.generation ~= binding.generation then return 0 end
  if pinned.sessionId and pinned.sessionId ~= ARGV[2] then return 0 end
  pinned.sessionId = ARGV[2]
  redis.call("SET", KEYS[2], cjson.encode(pinned), "KEEPTTL")
end
redis.call("SET", KEYS[1], cjson.encode(binding))
return 1
`;

const RETIRE = `
-- execution:retire
if redis.call("GET", KEYS[2]) ~= ARGV[1] then return 0 end
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local binding = cjson.decode(raw)
if binding.generation == ARGV[1] then return 1 end
if binding.generation ~= ARGV[2] then return 0 end
binding.generation = ARGV[1]
binding.sessionId = nil
redis.call("SET", KEYS[1], cjson.encode(binding))
return 1
`;

export class ExecutionWriter {
  private readonly redis: Pick<RedisClient, "eval">;

  constructor(redis: Pick<RedisClient, "eval">) {
    this.redis = redis;
  }

  /** No TTL: an idle session can outlive all delivery and render records. */
  async bind(continuationKey: string, binding: ExecutionBinding) {
    return decodeStored(
      executionBindingSchema,
      "conversation execution binding",
      await this.redis.eval(BIND, [executionKey(continuationKey)], [JSON.stringify(binding)]),
    );
  }

  async pinDispatch(continuationKey: string, dispatchId: string) {
    return decodeStored(
      executionBindingSchema,
      "dispatch execution binding",
      await this.redis.eval(
        DISPATCH,
        [executionKey(continuationKey), dispatchExecutionKey(dispatchId)],
        [],
      ),
    );
  }

  async confirmSession(
    continuationKey: string,
    dispatchId: string,
    generation: string,
    sessionId: string,
  ): Promise<boolean> {
    return evalFlag(
      this.redis,
      CONFIRM,
      [executionKey(continuationKey), dispatchExecutionKey(dispatchId)],
      [generation, sessionId],
    );
  }

  /** An explicit, successful reset retires this session but never changes its deployment. */
  async retireSession(continuationKey: string, resetId: string, generation: string) {
    return evalFlag(
      this.redis,
      RETIRE,
      [executionKey(continuationKey), resetKey(continuationKey)],
      [resetId, generation],
    );
  }
}
