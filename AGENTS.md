# Writing Effect Guide

## Critical information

**Important**: When requiring more information about Effect, use the `effect_docs_search` MCP
tool. It is an authoritative source of information about Effect and its
ecosystem.

## Writing basic Effect's

Prefer `Effect.gen` when writing Effect's. It is a powerful way to create
an Effect in a async/await style, which is more readable and maintainable.

```ts
import { Effect, Random } from "effect"

Effect.gen(function* () {
  // Use `yield*` to run another Effect
  yield* Effect.sleep("1 second")

  const bool = yield* Random.nextBoolean
  if (bool) {
    // When failing with Effect.fail/die etc. always use `return yield*` so
    // TypeScript can correctly narrow conditional types
    return yield* Effect.fail("Random boolean was true")
  }

  // You can return a success value directly
  return "Returned value"
}).pipe(
  // You can use the `pipe` method to add additional operations
  Effect.withSpan("tracing span"),
)
```

## Writing Effect functions

If you need to write a function that returns an Effect, prefer using
`Effect.fn`. It allows you to use the `yield*` syntax inside the function body,
and also add a span for observability.

```ts
import { Effect, Random } from "effect"

const myEffectFn = Effect.fn("myEffectFn")(
  function* (x: number, y: number) {
    const bool = yield* Random.nextBoolean
    if (bool) {
      // When failing with Effect.fail/die etc. always use `return yield*` so
      // TypeScript can correctly narrow conditional types
      return yield* Effect.fail("Random boolean was true")
    }
    return x + y
  },
  // You can add "pipe" operations as additional arguments
  Effect.annotateLogs({
    some: "annotation",
  }),
  // You can also access the arguments of the function in pipe operations
  (effect, x, y) => Effect.annotateLogs(effect, { x, y }),
)

// call the Effect function
myEffectFn(1, 2).pipe(Effect.runPromise)

// You can also omit the function span name if you don't need it
const withNoSpan = Effect.fn(function* (x: number, y: number) {
  yield* Effect.log("Calculating sum", { x, y })
  return x + y
})
```

## Avoid try / catch

**Critical**: Inside of Effect's, use `Effect.try` or `Effect.tryPromise` instead of `try /
catch`.

```ts
import { Effect, Schema } from "effect"

// Use Schema to define a custom error type
class JsonError extends Schema.TaggedError<JsonError>("JsonError")({
  cause: Schema.Defect,
}) {}

Effect.gen(function* () {
  // Use Effect.try to handle synchronous errors
  const result = yield* Effect.try({
    // Use the try block to execute code that may throw an error
    try: () => JSON.parse('{"invalidJson": }'),
    // Use the catch block to transform the error into a specific one
    catch: (cause) => new JsonError({ cause }),
  })

  // Use Effect.tryPromise to handle asynchronous errors
  const asyncResult = yield* Effect.tryPromise({
    // Use the try block to execute a Promise that may throw an error
    try: () => fetch("https://api.example.com/data").then((res) => res.json()),
    // Use the catch block to transform the error into a specific one
    catch: (cause) => new JsonError({ cause }),
  })

  return { result, asyncResult }
})
```

## Error handling with Effect

When you need to handle errors in Effect, use the following functions:

- `Effect.catchAll`: to handle all errors and recover from them.
- `Effect.catchAllCause`: to handle all errors including defects and recover
  from them.
- `Effect.catchTag`: to handle specific errors.
- `Effect.catchTags`: to handle multiple specific errors.
- `Effect.catchIf`: to handle errors based on a condition.

```ts
import { Effect, Random, Schema } from "effect"

// Use Schema to define some custom error types
class ErrorA extends Schema.TaggedError<ErrorA>("ErrorA")({
  cause: Schema.Defect,
}) {}

class ErrorB extends Schema.TaggedError<ErrorB>("ErrorB")({
  cause: Schema.Defect,
}) {}

class ErrorC extends Schema.TaggedError<ErrorC>("ErrorC")({
  cause: Schema.Defect,
}) {}

Effect.gen(function* () {
  const number = yield* Random.nextIntBetween(1, 4)

  if (number === 1) {
    // Simulate an error of type ErrorA
    return yield* Effect.fail(
      new ErrorA({ cause: new Error("Error A occurred") }),
    )
  } else if (number === 2) {
    // Simulate an error of type ErrorB
    return yield* Effect.fail(
      new ErrorB({ cause: new Error("Error B occurred") }),
    )
  } else if (number === 3) {
    // Simulate an error of type ErrorC
    return yield* Effect.fail(
      new ErrorC({ cause: new Error("Error C occurred") }),
    )
  }

  return "Success"
}).pipe(
  // Handle all errors and recover from them
  Effect.catchAll((error) => Effect.log("Got an error:", error)),
  // Or handle a specific error
  Effect.catchTag("ErrorA", (error) => Effect.log("Caught ErrorA:", error)),
  // Or handle multiple specific errors with a single handler
  Effect.catchTag("ErrorA", "ErrorB", (error) =>
    Effect.log("Caught ErrorA / ErrorB:", error),
  ),
  // Or handle multiple specific errors
  Effect.catchTags({
    ErrorA: (error) => Effect.log("Caught ErrorA:", error),
    ErrorB: (error) => Effect.log("Caught ErrorB:", error),
  }),
  // Or use a condition to handle errors
  Effect.catchIf(
    (error) => error._tag === "ErrorC",
    (error) => Effect.log("Caught ErrorC:", error),
  ),
)
```

## Writing Effect services

**VITAL INFORMATION: Most Effect code should be written as services**.

Services represent a collection of related Effect functions that can be composed together and
reused across your application. They are a powerful way to structure your
application and make it more maintainable.

```ts
import { Effect, Schema } from "effect"

export class Database extends Effect.Service<Database>()("Database", {
  // If you are using other Effect services, you can list them here
  dependencies: [],

  // ESSENTIAL: Always use the `scoped:` option
  scoped: Effect.gen(function* () {
    const query = Effect.fn("Database.query")(function* (sql: string) {
      // Add attributes to the current span for observability
      yield* Effect.annotateCurrentSpan({ sql })
      return { rows: [] } // Simulated result
    })

    // Return the service methods with `as const` to ensure type safety
    return { query } as const
  }),
}) {}

// Use Schema to define a custom service error type
export class UserServiceError extends Schema.TaggedError<UserServiceError>(
  "UserServiceError",
)({
  cause: Schema.optional(Schema.Defect),
}) {}

export class UserService extends Effect.Service<UserService>()("UserService", {
  // If you are using other Effect services, you can list them here.
  // `ServiceName.Default` is the default Layer that Effect.Service defines for
  // you.
  dependencies: [Database.Default],

  // ESSENTIAL: Always use the `scoped:` option
  scoped: Effect.gen(function* () {
    // Access other services at the top of the constructor

    // `yield*` the service class (it is actually a Context.Tag) to access it's interface
    const database = yield* Database

    const getAll = database.query("SELECT * FROM users").pipe(
      Effect.map((result) => result.rows),
      // Map the errors to the custom service error type
      Effect.mapError((cause) => new UserServiceError({ cause })),
    )

    return { getAll } as const
  }),
}) {}
```

### Type-first services

Another way of using the Effect dependency injection system is to define
services using `Context.Tag`.

```ts
import { Effect, Context, Layer } from "effect"

export class StripeClient extends Context.Tag("StripeClient")<
  StripeClient,
  {
    readonly methodA: (arg: string) => Effect.Effect<string>
    readonly methodB: (arg: number) => Effect.Effect<number>
  }
>() {
  // Define a Layer for the service
  static readonly Default = Layer.succeed(StripeClient, {
    methodA: (arg) => Effect.succeed(`Result A: ${arg}`),
    methodB: (arg) => Effect.succeed(arg * 2),
  })
}

Effect.gen(function* () {
  // Use `yield*` to access the service
  const stripe = yield* StripeClient

  // Call a method on the service
  const resultA = yield* stripeClient.methodA("some argument")
  const resultB = yield* stripeClient.methodB(42)

  return { resultA, resultB }
}).pipe(
  // Provide the service implementation with Effect.provideService
  Effect.provideService(StripeClient, {
    methodA: (arg) => Effect.succeed(`Result A: ${arg}`),
    methodB: (arg) => Effect.succeed(arg * 2),
  }),
  // Or provide the service implementation with a Layer
  // Essential: There should be only one `Effect.provide` in an Effect
  // application.
  Effect.provide(StripeClient.Default),
)
```

To re-iterate an essential point: **There should be only one `Effect.provide` in
an Effect application**. This means that you should provide all your services
at the top level of your application as a single Layer.

You can use functions from the `Layer` module to compose multiple Layers
together. Use the `effect_docs_search` MCP tool to find more information about
Layer composition.

## Defining the domain / entities with Effect

All domain entities should be defined using `Schema`. This allows you to
define the structure of your data, validate it, and use it in your Effect
services and functions.

For more information about `Schema`, use the `effect_docs_search` MCP tool to
search for the `Schema` README documentation.

```ts
import { Schema } from "effect"

// Define a UserId type
export const UserId = Schema.String.pipe(
  Schema.brand("UserId", {
    description: "A unique identifier for a user",
  }),
)
export type UserId = (typeof UserId).Type

// Define a User entity with Schema
export class User extends Schema.Class<User>("User")({
  id: UserId,
  name: Schema.String,
  email: Schema.String,
  // Prefer using `Schema.DateTimeUtc` for date/time fields
  createdAt: Schema.DateTimeUtc,
}) {}

// Define a User error type with Schema
export class UserError extends Schema.TaggedError<UserError>("UserError")({
  cause: Schema.optional(Schema.Defect),
  message: Schema.String,
}) {}
```

### Using `Model` from `@effect/sql`

You can also use the `Model` module from `@effect/sql` to define your domain
entities. It allows you to define multiple schemas for the same entity in one
class, which allows you to have different views of the same data.

```ts
import { DateTime, Option, Schema } from "effect"
import { Model } from "@effect/sql"

export class User extends Model.Class<User>("User")({
  id: Model.Generated(UserId),
  firstName: Schema.NonEmptyTrimmedString,
  lastName: Schema.NonEmptyTrimmedString,
  dateOfBirth: Model.FieldOption(Model.Date),
  createdAt: Model.DateTimeInsert,
  updatedAt: Model.DateTimeUpdate,
}) {}

// The schema to use when accessing the database
User

// The schema to use when sending data to the client
User.json

// The schemas to use when inserting data
User.insert // For the database
User.jsonCreate // When receiving data from the client
User.insert.make({
  firstName: "John",
  lastName: "Doe",
  dateOfBirth: Option.some(DateTime.unsafeNow()),
})

// The schemas to use when updating data
User.update // For the database
User.jsonUpdate // When receiving data from the client
User.update.make({
  id: UserId.make(123),
  firstName: "Jane",
  lastName: "Doe",
  dateOfBirth: Option.some(DateTime.unsafeNow()),
})
```

## Adding observability

It is essential to add observability to your Effect code. This allows you to
trace the execution of your code, log important events, and monitor the
performance of your application.

Use:

- `Effect.withSpan` to add a tracing span to an Effect.
- `Effect.fn("span name")` to create a function with a tracing span.
- `Effect.annotateCurrentSpan` to add attributes to the current tracing span.
- `Effect.log` to log messages with the Effect logging system.

```ts
import { Effect } from "effect"

const withSpan = Effect.gen(function* () {
  // Add an attribute to the current span
  yield* Effect.annotateCurrentSpan({
    some: "annotation",
  })

  // Log a message with the Effect logging system at different levels
  yield* Effect.logInfo("This is a info message")
  yield* Effect.logWarning("This is a warning message")
  yield* Effect.logError("This is an error message")
  yield* Effect.logFatal("This is an fatal message")
  yield* Effect.logDebug("This is a debug message")
  yield* Effect.logTrace("This is a trace message")
}).pipe(
  // Add a tracing span to the Effect
  Effect.withSpan("my-span"),
)

const fnWithSpan = Effect.fn("myFunction")(function* (x: number, y: number) {
  // Add an attribute to the current span
  yield* Effect.annotateCurrentSpan({ x, y })

  // Log a message with the Effect logging system
  yield* Effect.logInfo("Calculating sum", { x, y })

  return x + y
})
```

## Testing Effect code

Use `vitest` to test your Effect code. It is a powerful testing framework that
allows you to write tests in a readable and maintainable way. Use the
`@effect/vitest` package to easily integrate Effect with Vitest.

```ts
import { Effect, TestClock } from "effect"
import { describe, it, assert } from "@effect/vitest"

const effectToTest = Effect.succeed("Hello, World!")

describe("My Effect tests", () => {
  // Always use `it.scoped` to run Effect tests
  it.scoped("should run an Effect and assert the result", () =>
    Effect.gen(function* () {
      const result = yield* effectToTest
      assert.strictEqual(result, "Hello, World!")
    }),
  )

  it.scoped("should handle errors in Effect", () =>
    Effect.gen(function* () {
      const errorEffect = Effect.fail("An error occurred")

      // Use `Effect.flip` to put the error in the success channel
      const error = yield* errorEffect.pipe(Effect.flip)

      assert.strictEqual(error, "An error occurred")
    }),
  )
})
```

## Common Effect modules

- `HttpApi` modules from `@effect/platform`: Write HTTP APIs using Effect & the
  `Schema` module. Search for the `@effect/platform` README with the
  `effect_docs_search` MCP tool for more information.
- `HttpClient` modules from `@effect/platform`: Write HTTP clients using Effect.
  Search for the `@effect/platform` README with the `effect_docs_search` MCP
  tool for more information.
- `@effect/sql` package: Write SQL queries using Effect
  - `@effect/sql-pg` package: Write SQL queries using Effect and PostgreSQL.
  - `@effect/sql-sqlite` package: Write SQL queries using Effect and SQLite.
  - `@effect/sql-mysql2` package: Write SQL queries using Effect and MySQL.
- `ManagedRuntime` from `effect`: Integrate Effect with 3rd party frameworks like
  React. Search for `ManagedRuntime` with the `effect_docs_search` MCP tool
  for more information.

Reminder: Use the `effect_docs_search` MCP tool to find more information about
Effect and its ecosystem. It includes documentation for many other Effect
modules and packages.

---

# Wack Hacker Codebase Guide

## Overview

Wack Hacker is a Discord bot built with Effect.ts for the Purdue Hackers community. It provides features like auto-threading, commit tracking, voice transcription, photo management, and more.

**Tech Stack:**
- **Runtime**: Bun
- **Framework**: Effect.ts (functional effects system)
- **Database**: Cloudflare D1 (SQLite)
- **Storage**: Cloudflare R2 (S3-compatible)
- **APIs**: Discord.js, GitHub API, MediaWiki API, Groq AI
- **Language**: TypeScript

## Project Structure

```
src/
├── config.ts              # Environment configuration with @rayhanadev/env
├── constants.ts           # Discord IDs, channel IDs, role IDs
├── errors.ts              # Custom error types
├── index.ts               # Application entry point
├── db/                    # Database layer
│   ├── index.ts          # D1 driver and client setup
│   └── schema.ts         # Drizzle ORM schema definitions
├── features/              # Feature modules (bot functionality)
│   ├── auto-thread/      # Automatic thread creation for messages
│   ├── commit-overflow/  # GitHub commit tracking & streaks
│   ├── dashboard/        # WebSocket dashboard integration
│   ├── evergreen/        # GitHub issue + wiki page creation
│   ├── hack-night/       # Photo uploads and thread management
│   ├── praise/           # User praise/kudos system
│   ├── summarize/        # AI-powered message summarization
│   ├── voice-transcription/  # Audio transcription
│   └── welcomer/         # New member welcome messages
├── lib/                   # Utility functions
│   ├── dates.ts          # Date/time utilities (timezone-aware)
│   └── discord.ts        # Discord helper functions
├── runtime/               # Bot runtime coordination
│   ├── commands.ts       # Slash command registration
│   ├── crons.ts          # Scheduled jobs (hack night cleanup, etc.)
│   ├── events.ts         # Discord event handlers
│   └── index.ts          # Runtime exports
└── services/              # Effect services (infrastructure layer)
    ├── AI.ts             # Groq AI integration (chat, transcription)
    ├── Dashboard.ts      # WebSocket client for dashboard
    ├── Database.ts       # D1 database operations
    ├── Discord.ts        # Discord client lifecycle
    ├── GitHub.ts         # GitHub API client
    ├── MediaWiki.ts      # MediaWiki API client
    ├── Storage.ts        # R2 storage operations
    └── index.ts          # Service layer composition
```

## Core Concepts

### 1. Effect.ts Architecture

All code is written using **Effect.ts**, a functional programming framework that provides:
- **Type-safe error handling**: Errors are tracked in the type system
- **Dependency injection**: Services are provided via `Layer`
- **Observability**: Built-in tracing, logging, and metrics
- **Composability**: Effects can be combined and transformed

**Key principles:**
- Use `Effect.gen` for generator-style async code
- Use `Effect.fn` for reusable Effect functions
- Never use `try/catch` - use `Effect.try` or `Effect.tryPromise`
- All services extend `Effect.Service`
- One `Effect.provide` at the application root

### 2. Service Layer Pattern

Services are Effect-based abstractions over external systems:

```typescript
export class MyService extends Effect.Service<MyService>()("MyService", {
  dependencies: [OtherService.Default],
  scoped: Effect.gen(function* () {
    const other = yield* OtherService
    
    const myMethod = Effect.fn("MyService.myMethod")(function* (arg: string) {
      yield* Effect.annotateCurrentSpan({ arg })
      yield* Effect.logInfo("method called", { arg })
      return `result: ${arg}`
    })
    
    return { myMethod } as const
  }),
}) {}
```

**Existing services:**
- `Discord`: Discord.js client lifecycle (login, ready state, commands)
- `Database`: D1 database operations (users, commits tables)
- `AI`: Groq API client (chat completions, audio transcription)
- `GitHub`: GitHub REST API client (issues, user associations)
- `MediaWiki`: MediaWiki API client (login, page editing)
- `Storage`: R2 storage client (image uploads, event indexes)
- `Dashboard`: WebSocket client for external dashboard

### 3. Feature Module Pattern

Features are self-contained modules in `src/features/`:

```typescript
// Each feature exports handler functions
export const handleMyFeature = Effect.fn("handleMyFeature")(function* (message: Message) {
  // Feature logic here
  yield* Effect.logInfo("feature executed", { message_id: message.id })
})
```

**Feature characteristics:**
- Export handler functions (no classes needed)
- Use Effect.fn for automatic tracing spans
- Import services via `yield* ServiceName`
- Return early for filtered messages (with debug logs)
- One comprehensive log per operation (wide event logging)

### 4. Wide Event Logging

All logs follow the **wide logging format** (see loggingsucks.com):

**Rules:**
1. **All log levels are lowercase**: `logInfo`, `logDebug`, `logError`, `logWarning`
2. **One log per operation**: Include all relevant context in a single log entry
3. **Rich key-value pairs**: Use `snake_case` keys (e.g., `user_id`, `duration_ms`)
4. **Performance timing**: Always include `duration_ms` for operations
5. **Comprehensive context**: user IDs, message IDs, channel IDs, operation results

**Example:**
```typescript
const startTime = Date.now();

yield* Effect.logInfo("operation completed", {
  user_id: message.author.id,
  username: message.author.username,
  message_id: message.id,
  channel_id: message.channelId,
  operation_type: "thread_creation",
  thread_id: thread.id,
  thread_name: thread.name,
  duration_ms: Date.now() - startTime,
  status: "success",
});
```

**When to log:**
- Operation start (debug level)
- Early returns/filters (debug level with reason)
- Successful completion (info level with full context)
- Warnings (warning level for non-critical failures)
- Errors (error level with error details)

### 5. Database Schema (Drizzle ORM)

Located in `src/db/schema.ts`, uses Drizzle ORM:

**Tables:**
- `users`: Discord users with thread IDs
- `commits`: Commit tracking (approved commits, dates)

**Database operations:**
- All operations are wrapped in `Effect.fn`
- Include timing and context in logs
- Use `Effect.tryPromise` for async operations
- Return typed results from schemas

### 6. Configuration Management

Configuration is in `src/config.ts` using `@rayhanadev/env`:

```typescript
export const AppConfig = makeEnv("AppConfig", {
  DISCORD_BOT_TOKEN: Env.redacted("DISCORD_BOT_TOKEN"),
  GROQ_API_KEY: Env.redacted("GROQ_API_KEY"),
  // ... other vars
});
```

**Environment variables:**
- Discord API credentials
- Cloudflare credentials (R2, D1)
- Third-party API keys (GitHub, Groq, MediaWiki)
- Feature flags (enable/disable features)
- Timezone configuration

### 7. Constants

Discord-specific IDs are in `src/constants.ts`:
- Channel IDs (auto-thread channels, forums)
- Role IDs (organizer, bishop, wacky role)
- Emoji definitions
- Channel name patterns

**When adding new features:**
- Add required channel/role IDs to constants
- Use descriptive names
- Export as named constants

## Common Patterns

### Adding a New Feature

1. **Create feature folder**: `src/features/my-feature/`
2. **Create index.ts**: Export handler functions
3. **Define handler signature**:
   ```typescript
   export const handleMyFeature = Effect.fn("handleMyFeature")(
     function* (message: Message) {
       const startTime = Date.now();
       
       // Early returns with debug logs
       if (message.author.bot) {
         yield* Effect.logDebug("message skipped", {
           reason: "bot_author",
           message_id: message.id,
         });
         return;
       }
       
       // Main logic
       yield* Effect.logInfo("feature started", { message_id: message.id });
       
       // Use services
       const discord = yield* Discord;
       const database = yield* Database;
       
       // Perform operations
       const result = yield* someOperation;
       
       // Final comprehensive log
       yield* Effect.logInfo("feature completed", {
         message_id: message.id,
         duration_ms: Date.now() - startTime,
         result_count: result.length,
         status: "success",
       });
     },
     Effect.annotateLogs({ feature: "my_feature" }),
   );
   ```
4. **Register in runtime**: Add to `src/runtime/events.ts` handlers array
5. **Add feature flag**: Add to `src/config.ts` if toggleable

### Working with Discord.js

**Message handling:**
- Check `message.author.bot` early
- Check channel type (`isDMBased()`, `isThread()`)
- Fetch related data with `Effect.tryPromise`
- Use helper functions from `src/lib/discord.ts`

**Interaction handling:**
- Commands are registered in `src/runtime/commands.ts`
- Use `interaction.reply()` for responses
- Use ephemeral flags for private messages
- Handle deferred/replied states properly

### Working with Services

**Using a service:**
```typescript
const discord = yield* Discord;
const client = yield* discord.awaitReady();

const database = yield* Database;
const user = yield* database.users.get(userId);
```

**Adding a new service:**
1. Create `src/services/MyService.ts`
2. Extend `Effect.Service`
3. Define dependencies
4. Implement methods with `Effect.fn`
5. Add to `src/services/index.ts` exports
6. Add to `ServicesLive` layer

### Error Handling

**Define custom errors:**
```typescript
export class MyFeatureError extends Schema.TaggedError<MyFeatureError>(
  "MyFeatureError"
)({
  cause: Schema.optional(Schema.Defect),
  message: Schema.String,
}) {}
```

**Handle errors:**
```typescript
yield* myOperation.pipe(
  Effect.catchTag("MyFeatureError", (error) =>
    Effect.logError("operation failed", {
      error_type: error._tag,
      error_message: error.message,
    })
  ),
  Effect.catchAll((error) =>
    Effect.logError("unexpected error", {
      error: String(error),
    })
  ),
);
```

### Performance Timing

**Always track timing:**
```typescript
const startTime = Date.now();

const [result, duration] = yield* myOperation.pipe(Effect.timed);

yield* Effect.logInfo("operation completed", {
  duration_ms: Duration.toMillis(duration),
  // or manually:
  duration_ms: Date.now() - startTime,
});
```

## Development Workflow

### Setup
```bash
bun install
cp .env.example .env  # Add your credentials
```

### Running
```bash
bun dev              # Development mode
bun start            # Production mode
bun run build        # Compile to binary
```

### Database
```bash
bun run db:generate  # Generate migrations
bun run db:push      # Push schema to D1
```

### Linting & Formatting
```bash
bun run lint         # Run oxlint
bun run format       # Run oxfmt
```

## AI SDK Usage

When building AI features using the Vercel AI SDK:

- **Use Vercel AI Gateway**: Specify a model string (`<provider>/<model-id>`) in the model parameter. You do not need to import or use a gateway or provider-specific package.

```typescript
import { generateText } from "ai";

const result = await generateText({
  model: "anthropic/claude-sonnet-4-20250514",
  system: "You are a helpful assistant.",
  prompt: userInput,
});
```

- **Use Groq for speed/transcription**: When building AI features that require fast inference or Whisper for speech-to-text, use Groq which separately uses the `@ai-sdk/groq` provider.

```typescript
import { createGroq } from "@ai-sdk/groq";

const groq = createGroq({ apiKey: groqApiKey });

// Fast inference
const result = await generateText({
  model: groq("llama-3.3-70b-versatile"),
  prompt: userInput,
});

// Speech-to-text
const transcription = await transcribe({
  model: groq.transcription("whisper-large-v3"),
  audio: audioBuffer,
});
```

## Best Practices

### DO ✅
- Use `Effect.fn` for all functions that return Effects
- Add comprehensive logging with wide event format
- Use lowercase log levels (`logInfo`, `logDebug`, `logError`)
- Include `duration_ms` in all operation logs
- Use `Effect.annotateCurrentSpan` for tracing metadata
- Define custom error types with `Schema.TaggedError`
- Use `Effect.tryPromise` for async operations
- Return early with debug logs for filtered messages
- Add feature flags for toggleable features
- Use meaningful variable names with `snake_case` in logs

### DON'T ❌
- Never use `try/catch` (use `Effect.try` instead)
- Never use uppercase log levels (INFO, ERROR, etc.)
- Never use `console.log` (use `Effect.logInfo` instead)
- Don't create multiple small logs (use wide event logging)
- Don't forget to add timing instrumentation
- Don't suppress errors with empty catch blocks
- Don't hardcode IDs (use `src/constants.ts`)
- Don't forget to handle bot messages early
- Don't skip tracing spans for functions
- Don't use `camelCase` in log key names (use `snake_case`)

## Testing

Use `@effect/vitest` for testing:

```typescript
import { describe, it, assert } from "@effect/vitest";

describe("MyFeature", () => {
  it.scoped("should process message correctly", () =>
    Effect.gen(function* () {
      const result = yield* handleMyFeature(mockMessage);
      assert.strictEqual(result.status, "success");
    })
  );
});
```

## Common Issues & Solutions

### Issue: "Cannot find service"
**Solution**: Ensure service is in `ServicesLive` layer and dependencies are correct

### Issue: "yield* outside generator"
**Solution**: Use `Effect.gen(function* () { ... })` or `Effect.fn` wrapper

### Issue: TypeScript errors in logs
**Solution**: Ensure all log key names use `snake_case` and values are serializable

### Issue: Missing environment variables
**Solution**: Check `.env` file and `src/config.ts` definitions

### Issue: Database not found
**Solution**: Run `bun run db:push` to sync schema to D1

## Additional Resources

- [Effect.ts Documentation](https://effect.website)
- [Discord.js Guide](https://discordjs.guide)
- [Drizzle ORM Docs](https://orm.drizzle.team)
- [Wide Logging Format](https://loggingsucks.com)
- Use `effect_docs_search` MCP tool for Effect.ts questions
