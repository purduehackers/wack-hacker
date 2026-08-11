#!/usr/bin/env bun

/**
 * What a schema change would do to production, decided before it merges.
 *
 * Two questions, both answerable without touching the database:
 *
 * 1. Did the schema move without a migration to carry it? `drizzle-kit generate`
 *    is the authority — if running it produces a file, the branch is missing one,
 *    and `db:migrate` on `main` would silently apply nothing while the code
 *    expects new columns.
 * 2. Would applying the new migrations lose data? SQLite has no `DROP COLUMN`
 *    before 3.35 and drizzle still rebuilds tables for most alterations, so the
 *    dangerous shapes show up as a `__new_` table plus a `DROP TABLE` rather
 *    than as an obvious `ALTER`. Both spellings are matched.
 *
 * Reports rather than guesses: every statement it cannot classify is listed as
 * unclassified instead of being assumed safe.
 */

import { $ } from "bun";

const BASE = process.argv[2] ?? "origin/main";
const MIGRATIONS = "packages/shared/migrations";

interface Finding {
  readonly kind: "destructive" | "rewrite" | "constraint" | "unclassified";
  readonly file: string;
  readonly statement: string;
  /** Carried from the rule that matched, not looked up by kind afterwards. */
  readonly why: string;
}

/** Statement shapes that drop or rewrite data rather than adding to it. */
const RULES: ReadonlyArray<{
  readonly kind: Finding["kind"];
  readonly pattern: RegExp;
  readonly why: string;
}> = [
  { kind: "destructive", pattern: /\bDROP\s+TABLE\b/iu, why: "drops a table and everything in it" },
  {
    kind: "destructive",
    pattern: /\bALTER\s+TABLE\b[\s\S]*\bDROP\s+(?:COLUMN\s+)?\S/iu,
    why: "drops a column and its values",
  },
  { kind: "destructive", pattern: /\bDELETE\s+FROM\b/iu, why: "deletes rows" },
  {
    kind: "rewrite",
    pattern: /\bCREATE\s+TABLE\b\s+`?__new_/iu,
    why: "drizzle rebuilds the table; the old one is dropped once rows are copied",
  },
  {
    kind: "constraint",
    pattern: /\bADD\s+(?:COLUMN\s+)?[\s\S]*\bNOT\s+NULL\b(?![\s\S]*\bDEFAULT\b)/iu,
    why: "adds a NOT NULL column with no default, which fails on a non-empty table",
  },
  {
    kind: "constraint",
    pattern: /\bCREATE\s+UNIQUE\s+INDEX\b/iu,
    why: "adds a uniqueness constraint that existing duplicate rows would violate",
  },
];

const SAFE =
  /^\s*(CREATE\s+TABLE(?!\s+`?__new_)|CREATE\s+INDEX|ALTER\s+TABLE[\s\S]*\bADD\b|INSERT\s+INTO|PRAGMA|DROP\s+INDEX)/iu;

function classify(file: string, sql: string): Finding[] {
  const parsed = sql
    .split(/-->\s*statement-breakpoint|;\s*$/gmu)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && !entry.startsWith("--"));

  return parsed.flatMap((statement): Finding[] => {
    for (const rule of RULES) {
      if (rule.pattern.test(statement)) {
        return [{ kind: rule.kind, file, statement, why: rule.why }];
      }
    }
    return SAFE.test(statement)
      ? []
      : [{ kind: "unclassified", file, statement, why: "not recognised by this reviewer" }];
  });
}

function summarize(statement: string): string {
  const single = statement.replaceAll(/\s+/gu, " ").trim();
  return single.length > 160 ? `${single.slice(0, 157)}…` : single;
}

/** Migration files this branch adds on top of the base ref. */
async function addedMigrations(): Promise<string[]> {
  const diff = await $`git diff --name-only --diff-filter=A ${BASE}...HEAD -- ${MIGRATIONS}`
    .quiet()
    .text();
  return diff
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".sql"));
}

async function migrationStatus(): Promise<Set<string>> {
  const raw = await $`git status --porcelain -- ${MIGRATIONS}`.quiet().text();
  return new Set(raw.split("\n").filter((line) => line.trim().length > 0));
}

/**
 * Whether the schema has moved without a migration to carry it.
 *
 * Compares the working tree before and after `drizzle-kit generate` rather than
 * asking whether it is dirty: a branch that correctly *adds* a migration is
 * dirty for a good reason, and testing dirtiness alone flags every honest
 * schema change as a missing one. Only entries that appear because of the
 * generate run count, and they are reverted so the caller is left as it started.
 */
async function missingMigration(): Promise<boolean> {
  const before = await migrationStatus();
  await $`bunx drizzle-kit generate`.cwd("packages/shared").quiet().nothrow();
  const created = [...(await migrationStatus())].filter((entry) => !before.has(entry));
  for (const entry of created) {
    const path = entry.slice(3).trim();
    if (entry.startsWith("??")) await $`rm -rf ${path}`.quiet().nothrow();
    else await $`git checkout -- ${path}`.quiet().nothrow();
  }
  return created.length > 0;
}

const added = await addedMigrations();
const missing = await missingMigration();
const findings = (
  await Promise.all(
    added.map(async (file) =>
      classify(file.replace(`${MIGRATIONS}/`, ""), await Bun.file(file).text()),
    ),
  )
).flat();

const blocking = findings.filter(
  (finding) => finding.kind === "destructive" || finding.kind === "rewrite",
);

const lines: string[] = ["## Database migration review", ""];

if (missing) {
  lines.push(
    "> [!CAUTION]",
    "> **The schema changed but no migration carries it.** `drizzle-kit generate`",
    "> produces a file on this branch, so `db:migrate` would apply nothing while the",
    "> code expects the new shape. Run `bun run db:generate` in `packages/shared`",
    "> and commit the result.",
    "",
  );
} else if (added.length === 0) {
  lines.push("No migrations added on this branch.", "");
} else {
  lines.push(
    `${added.length} migration(s) added: ${added.map((f) => `\`${f.split("/").pop()}\``).join(", ")}`,
    "",
  );
}

if (findings.length > 0) {
  lines.push("| Severity | File | Statement | Why |", "| --- | --- | --- | --- |");
  for (const finding of findings) {
    const badge =
      finding.kind === "destructive"
        ? "**data loss**"
        : finding.kind === "rewrite"
          ? "**table rewrite**"
          : finding.kind === "constraint"
            ? "constraint"
            : "unclassified";
    lines.push(
      `| ${badge} | \`${finding.file}\` | \`${summarize(finding.statement)}\` | ${finding.why} |`,
    );
  }
  lines.push("");
} else if (added.length > 0) {
  lines.push("Every statement is additive: new tables, new columns, or new indexes.", "");
}

if (blocking.length > 0) {
  lines.push(
    "> [!WARNING]",
    `> ${blocking.length} statement(s) would drop or rebuild existing data. Production`,
    "> migrates automatically on merge, so this needs a deliberate decision:",
    "> confirm the restore point, or split the change so the destructive half ships",
    "> separately.",
    "",
  );
}

console.log(lines.join("\n"));

const outputPath = process.env["GITHUB_OUTPUT"];
if (outputPath !== undefined) {
  await Bun.write(
    outputPath,
    `${await Bun.file(outputPath).text()}blocking=${blocking.length > 0 || missing}\n`,
  );
}
if (missing) process.exit(1);
