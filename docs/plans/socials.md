# Social announcements

Wack Hacker checks YouTube, the blog, and Instagram every five minutes and sends
new posts to **#📡socials** (`1416915165609463888`). Delivery runs separately every
minute. These schedules always run with the bot. X and LinkedIn are deferred.

## Sources and embeds

All sources implement `SocialSource.read(since)` and return the same `SocialPost`.
Polling, Redis storage, retries, and Discord embeds are shared.

| Source    | Implementation                                                                   | Credentials      |
| --------- | -------------------------------------------------------------------------------- | ---------------- |
| YouTube   | Channel `UCaiaDVdWSIhv0sIzdiA0l2w` Atom feed, parsed with `rss-parser`           | None             |
| Blog      | `https://blog.purduehackers.com/rss.xml`, same parser; article Open Graph images | None             |
| Instagram | Instagram Login API `v26.0`, paginated media; checks `@purduehackers` identity   | Long-lived token |

The bot reuses Discord's REST client, the Upstash SDK, and Croner. Instagram uses a
small typed HTTP client for the Instagram Login endpoints.

Embeds use YouTube red (`#FF0033`), blog yellow (`#F5C842`), and Instagram pink
(`#FF0069`). YouTube and Instagram descriptions keep up to 125 characters of whole
words, adding `…` only when truncated. Blog titles are uppercase. Images, video
thumbnails, and carousel covers link to the original publication. Mentions are disabled.

## Setup

Set these in the bot's environment and the agent deployment that supervises it:

```dotenv
INSTAGRAM_USER_ID=17841408764682550
INSTAGRAM_ACCESS_TOKEN=<long-lived token>
```

Generate the Instagram token in the club's **Wack Hacker** app in the
[Meta App Dashboard](https://developers.facebook.com/apps/), under Instagram's API
setup with Instagram business login. Select `@purduehackers` and grant
`instagram_business_basic`. The runtime needs no app secret.

Production baselines were initialized on September 15, 2026, without queuing old
posts. Preserve them across deployments. The bot checks View Channel, Send Messages,
Embed Links, and Read Message History before delivery.

## Tokens and recovery

Redis stores the active Instagram token across restarts. Daily maintenance starts
refreshing after 25 hours, then refreshes about every 30 days. To replace a revoked
or expired token, update `INSTAGRAM_ACCESS_TOKEN` and deploy it to the bot. Once
the replacement bot is running, delete only the Redis credential key
`socials:v1:772576325897945119:instagram:17841408764682550:credential` so the bot
uses the new token. Every poll validates the account before reading media.
Provider errors are sanitized; token refresh is excluded from tracing because
Meta requires a query credential.

Each source stores its baseline, checkpoint, known IDs, and pending posts under
`socials:v1:772576325897945119:<platform>:<account>`, with no TTL. A 120-second lease
serializes workers; saves check lease ownership atomically. Discovery saves the
queue and checkpoint together. Delivery records an attempt before sending and
removes the pending entry only after success. Retries back off up to six hours.

After an uncertain send, the bot searches its own Discord embeds for the source
URL before retrying. Failed permission checks or incomplete history scans stop
that batch. This reduces duplicates but cannot guarantee exactly-once delivery
if Discord history is changed or removed.

Missing or corrupt state must be restored from backup. Instagram reads with a
seven-day overlap, up to 2,000 posts; feeds expose only their recent window. A gap
or incomplete pagination stops discovery so missed posts can be reconciled before
repairing the checkpoint. Do not delete state to clear a recovery error.

Validate changes with `bun run lint`, `bunx oxfmt --check .`, and focused manual checks.
