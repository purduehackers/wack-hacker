#!/usr/bin/env bun
/**
 * Pre-build a Vercel Sandbox snapshot with ripgrep + gh installed so every
 * coding subagent session skips the ~20-30s boot-time install.
 *
 * Usage:
 *   bun scripts/create-sandbox-snapshot.ts
 *
 * Copy the printed snapshotId into Vercel project env as
 * `SANDBOX_BASE_SNAPSHOT_ID` and redeploy. The `createCodingSandbox` factory
 * will pick it up and skip the toolchain install.
 */

import { Sandbox } from "@vercel/sandbox";

// Vercel Sandbox `node24` runtime runs on Amazon Linux 2023 — dnf, not apt —
// and system commands need sudo since the default shell is non-root.
const TOOLCHAIN_SCRIPT = ["set -e", "sudo dnf install -y --skip-broken ripgrep gh"].join(" && ");

async function main() {
  console.log("Creating temporary sandbox for snapshot build…");
  const sandbox = await Sandbox.create({
    runtime: "node24",
    timeout: 10 * 60 * 1000,
    resources: { vcpus: 2 },
  });

  try {
    console.log("Installing toolchain (ripgrep, gh)…");
    const install = await sandbox.runCommand({
      cmd: "bash",
      args: ["-c", TOOLCHAIN_SCRIPT],
    });
    const out = await install.output("both");
    if (install.exitCode !== 0) {
      console.error("Install failed:\n", out.slice(-4000));
      process.exit(1);
    }
    console.log("Toolchain installed. Tail:\n", out.slice(-1000));

    console.log("Creating snapshot (this stops the sandbox)…");
    const snapshot = await sandbox.snapshot();
    console.log("\n✅ Snapshot ready");
    console.log("   snapshotId:", snapshot.snapshotId);
    console.log("   size:", snapshot.sizeBytes, "bytes");
    console.log("\nSet this in Vercel project env:");
    console.log(`   SANDBOX_BASE_SNAPSHOT_ID=${snapshot.snapshotId}`);
  } catch (err) {
    console.error("Snapshot creation failed:", err);
    try {
      await sandbox.stop();
    } catch {
      // ignore — we're already erroring
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
