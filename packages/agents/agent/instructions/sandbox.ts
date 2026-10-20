import { defineDynamic, defineInstructions } from "eve/instructions";

import { env } from "../env.ts";

export default defineDynamic({
  events: {
    "turn.started": () =>
      defineInstructions({
        content: env.DURABLE_BASH_ENABLED
          ? "The computation workspace uses durable just-bash. Use provider tools directly for API work; do not open a workspace merely to load guidance. Bash, jq, Python (python3), and sandboxed JavaScript (js-exec -c) are available; Node, Bun, native binaries, browser automation, package installation, and network access are unavailable. Writable files under /workspace, /home, and /tmp persist. Each command starts a fresh shell in /workspace; cd/export last only within that command. Commands have a 10 second limit; files are limited to 3 MiB each and 4 MiB total, with 1,024 entries. Use idempotent file writes because an interrupted Workflow step may repeat a command. Native work or larger files require an operator-selected native session; automatic escalation is not implemented. Never ask for credentials or attempt to bypass these limits."
          : "Use provider tools directly for API work; a shell workspace is only needed for computation or files.",
      }),
  },
});
