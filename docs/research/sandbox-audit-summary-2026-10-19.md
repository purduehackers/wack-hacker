# Retained sandbox audit, October 19, 2026

This records the findings used to choose the product refactor's runtime direction.
The inspection covered all 101 retained sandbox/session command lists returned by
the current Wack project and the legacy project's empty inventory. Current-project
pagination was exhausted after three pages. The retained period was September 17
through October 19, 2026. No historical sandbox was resumed or stopped by the audit.

| Retained evidence                            |  Count |
| -------------------------------------------- | -----: |
| Discord gateway sandboxes                    |      1 |
| Agent workspaces                             |    100 |
| Root / provider agent workspaces             | 8 / 92 |
| Agent commands                               |  1,946 |
| File uploads                                 |    905 |
| Home-directory probes                        |    886 |
| Runtime setup                                |    100 |
| Ripgrep availability probes                  |      6 |
| Other task commands                          |     49 |
| Agent workspaces with no other task commands |     84 |

Uploads, setup, and probes account for 1,897 of the 1,946 agent commands (97.48%).
The other commands involved JSON processing, Discord member batching, dates,
filesystem inspection, and public HTTP requests. No native build, browser, media,
or package installation workload appeared in the retained command metadata.

Local synthetic probes using just-bash 3.6.0 passed representative shell, JSON,
Python, date, file-batching, and QuickJS operations. Native `node -e` was unavailable;
QuickJS `js-exec` handled the tested JavaScript calculation. Some ripgrep flags were
unsupported, while Eve's grep fallback handled the tested search case.

The installed Eve 0.31.3 just-bash adapter persisted a local filesystem path. After
moving that temporary directory to simulate a fresh host, restoring from its saved
metadata did not recover a saved file. Its stock adapter also did not enable the
optional Python or JavaScript runtimes. Durable storage and explicit language
support are therefore requirements before switching ordinary computation.

The gateway sandbox runs a real Bun/Discord process and is outside that migration.
Provider SDK/HTTP calls run in the application-side policy runtime; those operations
do not intrinsically need an agent VM.

## Limits of this evidence

- This is retained history, not all sandboxes ever created. Deleted history cannot
  be reconstructed from these APIs.
- Command metadata is not a filesystem snapshot. The 905 upload records do not
  expose archive contents, so they cannot all be labeled as skill-only transfers.
- Four long command arguments were truncated by the API. Stopped-session output
  returned HTTP 410 through both the connector and CLI.
- The compatibility probes are representative synthetic cases, not production
  replay or a complete runtime compatibility suite.
- Platform request/start timestamps omit client and workflow orchestration time.
  Aggregate VM uptime is not user waiting time; this audit does not establish that
  VM startup dominates response latency.

The detailed local audit artifact was retained with the research session and is
not committed here because it includes individual historical resource identifiers
and command metadata. This summary preserves the decision evidence and its limits;
it is not a reproducible live provider export. Future latency and runtime claims
must come from the instrumented comparisons in the
[refactor plan](../plans/wack-hacker-product-refactor.md).
