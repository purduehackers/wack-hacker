# Checkpoint and ship emoji selection

Reviewed November 16, 2026. The bot uses `typesafe-ai/jev-1.14.0` through
Vercel AI Gateway and AI SDK `experimental_decide` (requires AI SDK 7.0.173).

## Candidates and ranking

The catalog contains **1,158 candidates** from the pinned `emojibase-data` 18.0.0
English dataset. It includes every object/technology emoji, plus animals,
nature, food, places, activities, symbols, and neutral professions, sports and
useful body parts. Faces, families, country flags and redundant skin/gender
variants are excluded. Robot is included explicitly despite Unicode classifying
it as a face. A few meanings supplement Unicode labels with project context,
such as Rust for crab, Python for snake and fabrication for printer. Those are
model descriptions, not keyword matching rules.

Every candidate is scored in batches of at most 128, with three simultaneous
requests. There is no regex shortlist and no fallback reaction list. Each
candidate uses the same 0–4 rubric: unrelated, generic encouragement, loosely
related, direct aspect, central subject/tool/medium. The three highest positive
scores become distinct Unicode reactions. Generic celebration competes on that
same rubric and ranks below a subject match.

Image and caption relevance are evaluated separately, then combined in code:

- Caption plus images: **75% image score + 25% text score**.
- Images alone: 100% image score.
- Text alone, including when no image can be prepared: 100% text score.

The image pass excludes the caption, so a conflicting caption cannot override
what the model sees before weighting. Instructions tell the model to focus on
the work's subject, medium and tools, discount incidental backgrounds, and
ignore instructions in the content asking for particular reactions. Text is
capped at 8,000 characters and includes forwarded text. Linked pages are not
fetched.

## Images

The bot sends actual image bytes, not just attachment filenames or URLs. It
collects direct and forwarded image attachments first, then image/thumbnail
embeds already proxied by Discord. Up to ten distinct images are downloaded
once and reused across scoring batches. Only HTTPS URLs on
`cdn.discordapp.com` and `media.discordapp.net` are fetched, with no credentials
and no redirects. Downloads are limited to 12 MiB each and share an eight-second
deadline. Unreadable images are skipped; remaining images still contribute.

`sharp` applies orientation, takes the first animation frame, flattens
transparency, resizes the full frame to at most 1024px per side, and pads sides
shorter than 280px. The result is a still JPEG with metadata removed, satisfying
[Jev's image constraints](https://docs.typesafe.ai/images.md). Source formats
are limited to what the installed sharp build can decode. Videos are not sent.

TypeSafe currently calls image support experimental. Live Gateway checks
accepted image file parts without an application-side TypeSafe opt-in header;
Gateway handles the provider transport. Images appear once in each batch's
shared state, rather than being repeated inside every candidate question.

## Failure behavior and configuration

The SDK validates response completeness, types and score bounds. Missing,
invalid, refused or failed decisions do not produce partial rankings. Fewer
than three positive scores also produces no reactions. Each request permits
one transient retry within a shared 20-second scoring deadline. Pending sibling
requests are aborted if selection fails.

Thread creation happens first. Image/model failures are isolated from the WACKY
celebration reply. Discord reaction failures are isolated from later reactions
and the reply.

Set `AI_GATEWAY_API_KEY` in `packages/bot/.env.local` for local use and in the
agent deployment when using Sandbox supervision. The supervisor forwards it
into the bot container. The bot validates this credential at startup; the agent
requires it only when supervision is enabled. Use an API key for the long-lived
container, not a copied short-lived Vercel OIDC token.

## Cost choice

| Model                       | Input per million tokens |             Cached input | Output |
| --------------------------- | -----------------------: | -----------------------: | -----: |
| Jev 1.14                    |                   $0.042 |  No separate rate listed |   Free |
| OpenAI GPT-6 Luna Decisions |                    $0.10 | $0.01 per million tokens |   Free |

Sources: [Gateway catalog](https://ai-gateway.vercel.sh/v1/models),
[TypeSafe pricing](https://help.typesafe.ai/articles/5187202169-how-much-does-jev-cost),
and [OpenAI Decisions pricing](https://developers.openai.com/api/docs/guides/decisions#pricing-and-availability).

Jev has the lower uncached rate and was approximately 75% cheaper in our live
comparison of the complete catalog. Provider token accounting differs. OpenAI
cache hits can be cheaper, but cache writes also cost money and no sustained
hit rate has been measured here. This choice does not assume account credits or
future cache discounts. Revisit it if production usage shows cheaper effective
pricing elsewhere. Retries and additional images can add cost.

## Implementations researched

- [Dub's original Jev emoji search](https://github.com/dubinc/dub/commit/1d2fd9263f52d5f29332741a1af561a75ab6ff6a)
  asked one independent boolean question per emoji, ranked probabilities,
  cached results and chunked the catalog across requests. Its
  [subsequent write-up](https://upstash.com/blog/how-we-built-emoji-search-at-dub-with-upstash-vector)
  explains switching to embeddings because repeated evaluation of 1,941
  candidates dominated input cost. We use the broad, batched catalog pattern;
  scoring both images and text has a measurable cost shown below.
- [Codeforces tag prediction](https://github.com/msobroza/codeforces-tag-prediction#how-jev-is-asked)
  uses independent questions with defined tags and shared input, learning
  thresholds from labeled examples rather than assuming universal calibration.
- [Jev Book Tags](https://github.com/iamjonatha/jev-book-tags#classification)
  evaluates tags independently, checks evidence sufficiency and caches by
  model/input/category definitions. Its review thresholds suit persistent book
  labels; these reactions instead need the highest three scores.

These follow [TypeSafe's guidance](https://docs.typesafe.ai/introduction) to
make independent judgments and combine them in code. The image/text weighting
is our implementation choice, not a claim that the other projects use it.

## Verification

All 23 bot tests pass. Selector tests cover complete catalog evaluation,
object/technology coverage, bounded requests, caption truncation, image weighting,
image-only state, and invalid/failing responses. Image tests cover forwarded
attachments and embed proxies, URL/size/count restrictions, conversion and
padding, and downloading bytes without authentication or redirects.

An offline handler check verified that provider failure preserves the thread
and WACKY reply, a failed Discord reaction does not block later actions, and
forwarded text and prepared images reach the selector. No Discord messages or
reactions were sent during verification.

Live checks used temporary development OIDC from `vercel env run`, without
writing credentials. All 1,158 candidates were evaluated for each modality. A
synthetic piano illustration was normalized through the production image path.

| Input                                           | Jev reactions | Input tokens | Gateway cost | Wall time |
| ----------------------------------------------- | ------------- | -----------: | -----------: | --------: |
| Piano image only                                | 🎹 🎵 🎶      |      133,881 | $0.005623002 |  1,592 ms |
| Piano image with conflicting scarf caption      | 🎵 🎹 🎶      |      259,699 | $0.010907358 |  2,154 ms |
| Scarf caption only, explicitly not a video game | 🧶 🧣 🟣      |      125,879 | $0.005286918 |    920 ms |

The same three inputs and scoring questions on OpenAI cost $0.0215471,
$0.0427942 and $0.0212521 respectively. These are small smoke checks, not a
representative accuracy, latency or cache benchmark. The larger catalog costs
more than the earlier 70-candidate implementation; that earlier cost estimate
no longer describes this implementation.

Package lint/type checks and changed-file formatting pass. Repository-wide
lint and formatting are blocked by unrelated existing files under `outputs/`
and an operations document; their rules are unchanged.

The production Dockerfile builds successfully for `linux/amd64`. A network-free
check inside that Alpine image imported the selector/catalog and converted a
transparent WebP into a valid 1024 × 280 JPEG using the installed sharp binary.

## Production release

Deployed November 16, 2026, from isolated release commit `15332321`, based on
production commit `cec97ac4`. [PR #202](https://github.com/purduehackers/wack-hacker/pull/202)
contains the release source. The original workspace's unrelated changes were
excluded. The isolated checkout passed all 73 tests (six optional integration
tests skipped), full lint and formatting, and GitHub validation/migration checks.
Pullfrog review could not run because the repository's Router balance was empty.

A dedicated Gateway key is configured as a Production Secret and forwarded into
the bot. Local development still requires its own credential or fresh development
OIDC. No credential is embedded in the image or committed to source.

- Agent deployment: `dpl_bQwP8W8Q3c1UcUxTnFNaiGeEggBC`, serving
  [eve.purduehackers.com](https://eve.purduehackers.com).
- Bot image: `vcr.vercel.com/purdue-hackers/wack-hacker-v2/wack-hacker@sha256:cc207a280f42a48434db74495977fccfc90a14fdd0c4ae5b5117c931d4ef868c`.
- The scheduled supervisor adopted generation 27926 at 08:50 UTC; bot health
  reported ready and a 16 ms Discord websocket ping.
- In-container inference confirmed the injected credential, all 1,158 candidates,
  and image priority: a piano image with a scarf caption returned 🎹 🎵 🎶.
- No Discord messages or reactions were posted during these checks. The agent's
  runtime error log query was empty after activation.

The previous bot image is
`vcr.vercel.com/purdue-hackers/wack-hacker-v2/wack-hacker@sha256:ce54424a1b2403a4b3a217814dfb904058f4ea5f6518259521c1b4c0ea9f47ca`;
the previous agent deployment is `dpl_BMdN4eAWJFoESVSbGai4d7t8Sj3e`.
