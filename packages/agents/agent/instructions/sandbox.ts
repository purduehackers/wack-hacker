import { defineDynamic, defineInstructions } from "eve/instructions";

import { env } from "../env.ts";

export default defineDynamic({
  events: {
    "turn.started": () =>
      defineInstructions({
        content: env.DURABLE_BASH_ENABLED
          ? "The computation workspace uses durable just-bash. Use provider tools directly for API work; do not open a workspace merely to load guidance. Call workspace_open once before the first bash or write_file call; read_file and inbound attachments also initialize it. Bash, jq, Python (python3), and sandboxed JavaScript (js-exec -c) are available; Node, Bun, native binaries, browser automation, package installation, and network access are unavailable. Writable files under /workspace, /home, and /tmp persist. Attachments under /workspace/.eve are immutable: copy one elsewhere before editing it. Each command starts a fresh shell in /workspace; cd/export last only within that command. Commands have a 10 second limit; files are limited to 3 MiB each and 4 MiB total, with 1,024 entries. To use write_file, read the existing file and obtain its SHA-256 with bash sha256sum; pass that hash as expectedSha256, or missing for a new file. A replayed command returns its original committed result. If an error reports an ambiguous call or unknown commit, inspect the files and explain the uncertainty before issuing a replacement command; do not blindly repeat it as a new call. Native work or larger files require an operator-selected native session; automatic escalation is not implemented. Never ask for credentials or attempt to bypass these limits."
          : "Use provider tools directly for API work; a shell workspace is only needed for computation or files.",
      }),
  },
});
