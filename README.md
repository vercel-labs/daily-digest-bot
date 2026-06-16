# Scheduled Digest Bot

A scheduled digest bot built with Next.js, [Chat SDK](https://www.npmjs.com/package/chat),
the [AI SDK](https://ai-sdk.dev), [Vercel Connect](https://vercel.com/docs/connect),
and [Vercel Workflow](https://vercel.com/docs/workflow).

Vercel Cron calls `/api/cron/digest`, the route starts a durable workflow, and the
workflow processes the configured channel in retryable steps: it gathers GitHub
activity, turns it into a structured digest with the AI SDK, and posts a Chat SDK
Card to Slack.

```
Vercel Cron ──► /api/cron/digest ──► Workflow
                                       ├─ fetchGitHubActivity  (Vercel Connect → GitHub REST + GraphQL)
                                       ├─ generateDigest       (AI SDK structured output)
                                       └─ postDigest           (Chat SDK Card → Slack)
```

## Prerequisites

- **Node.js 20+** and **[pnpm](https://pnpm.io/installation)**.
- A **Vercel account** with the project linked (`vercel link`). Vercel Connect and
  the local OIDC token both require a linked project.
- A **Slack workspace** where you can install a connector/bot.
- A **GitHub account or organization** to source issue activity from.
- A **Redis** instance for Chat SDK state and message de-duplication.

## Quick start

```bash
# 1. Install dependencies
pnpm install

# 2. Link the project to Vercel (needed for Vercel Connect + OIDC)
pnpm dlx vercel link

# 3. Create your local env file and fill in the values (see table below)
cp .env.example .env.local

# 4. Pull Vercel-managed env + a fresh OIDC token for Connect
pnpm dlx vercel env pull

# 5. Run the dev server
pnpm dev
```

The app runs at [http://localhost:3000](http://localhost:3000), which renders an
operator overview of the routes, schedule, and required environment.

## Environment variables

Copy `.env.example` to `.env.local` and set the following. On Vercel, add the same
variables under **Project → Settings → Environment Variables**.

| Variable | Required | Default | What it is / how to get it |
| --- | --- | --- | --- |
| `CRON_SECRET` | ✅ | — | Shared secret the route checks on the `Authorization: Bearer …` header. Generate one with `openssl rand -hex 32`. On Vercel, [Cron Jobs automatically send this header](https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs) when `CRON_SECRET` is set on the project. |
| `DIGEST_CHANNEL_ID` | ✅ | — | Chat SDK channel ID where the digest posts, in the form `slack:<CHANNEL_ID>` (e.g. `slack:C123ABC`). Get the Slack channel ID from the channel's **View channel details** dialog (shown at the bottom), or by copying the channel link. Invite the bot to that channel. |
| `CONNECTOR_SLACK` | ✅ | — | Vercel Connect connector ID for your Slack connector, e.g. `slack/acme-slack`. Create a Slack connector in the [Vercel dashboard → Connect](https://vercel.com/docs/connect), then use its `<provider>/<name>` id. The Slack adapter exchanges this for a short-lived bot token at runtime — no long-lived `SLACK_BOT_TOKEN` needed. |
| `CONNECTOR_GITHUB` | ✅ | — | Vercel Connect connector ID for your GitHub connector, e.g. `github/acme-github`. Create a GitHub connector in Connect and install it with access to the repositories you want digested. The source exchanges this for a short-lived token before calling the GitHub REST + GraphQL APIs. |
| `REDIS_URL` | ✅ | — | Redis connection string for Chat SDK state + dedupe, e.g. `redis://default:<password>@<host>:6379`. Provision Redis via the [Vercel Marketplace](https://vercel.com/marketplace?category=storage) (e.g. Upstash) or bring your own; `vercel env pull` will sync a Marketplace-provided URL automatically. |
| `DIGEST_MODEL` | ➖ | `anthropic/claude-haiku-4.5` | AI Gateway model string in `provider/model` form. Routed through the [Vercel AI Gateway](https://vercel.com/docs/ai-gateway), so no provider API key is required on Vercel. |
| `BOT_USER_NAME` | ➖ | `digest-bot` | Display name used by the Chat SDK bot. |

> **Local development & Vercel Connect:** `CONNECTOR_SLACK`/`CONNECTOR_GITHUB`
> issue tokens via Vercel Connect, which authenticates with a Vercel **OIDC
> token**. Run `vercel env pull` after linking (or use `vercel dev`) so the SDK
> has a valid token locally — `vercel dev` refreshes it automatically.

## Run and test locally

Start the dev server:

```bash
pnpm dev
```

Trigger the cron route manually (the route fails closed if `CRON_SECRET` is unset
or the header does not match):

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/cron/digest
```

Inspect workflow runs in the local Workflow dashboard:

```bash
pnpm exec workflow web
```

## Configure Slack

1. Create a **Slack connector** in Vercel Connect and keep triggers enabled.
2. Register this project as a trigger destination:

   ```text
   https://your-app.vercel.app/api/webhooks/slack
   ```

3. Grant bot scopes such as `chat:write`, `channels:history`, `channels:read`,
   `groups:history`, `im:history`, `mpim:history`, `reactions:write`, and
   `users:read`, then link the connector to this Vercel project and environment.

The Slack adapter reads `CONNECTOR_SLACK`, calls `getToken()` from
`@vercel/connect`, and uses the returned short-lived token for Slack API calls.
The Redis state adapter reads `REDIS_URL`.

Vercel Connect verifies Slack events before forwarding them, so `lib/bot.ts`
delegates webhook verification to Connect. If you receive webhooks directly from
Slack instead of through Connect, configure `SLACK_SIGNING_SECRET` and use the
adapter's built-in Slack verification.

## Configure Cron

`vercel.json` schedules the digest daily at 08:00 UTC:

```json
{
  "crons": [
    {
      "path": "/api/cron/digest",
      "schedule": "0 8 * * *"
    }
  ]
}
```

Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; the route fails closed
when `CRON_SECRET` is unset or the header does not match.

## Enroll channels

Set `DIGEST_CHANNEL_ID` to the Chat SDK channel ID where the digest should post:

```env
DIGEST_CHANNEL_ID=slack:C123ABC
```

The template expands that channel ID into a digest input in
`lib/digest/enrollment.ts`. Update that file to change the lookback window,
details URL, tone, section limit, or included source areas.

Replace `lib/digest/sources.ts` to digest GitHub pull requests, Linear issues,
support tickets, database rows, or another source.

## Repository discovery

The digest uses `CONNECTOR_GITHUB` to fetch the repositories visible to the GitHub
connector. It counts public and private repositories, counts open issues in
connector-accessible repositories, fetches issues created inside the configured
lookback window, and excludes pull requests.

To keep large installations predictable, the source fetches up to 1,000 active
repositories for totals and limits detailed per-repository issue checks to the
first 25 active repositories. Change the detail limit in `lib/digest/sources.ts`:

```ts
const MAX_REPOSITORIES_TO_DIGEST = 25;
```

The GitHub connector must be installed with access to the repositories you want
included. Issue counts and recent issue details are fetched with batched GitHub
GraphQL queries instead of the Search API, which avoids the much lower Search API
rate limit and keeps totals scoped to repositories visible to the connector.

## Workflow steps

The scheduled digest keeps source fetching, generation, and Slack delivery in
separate Workflow steps:

- `fetchGitHubActivity` discovers repositories, counts open issues, and fetches
  recent issue details.
- `generateDigest` turns the structured activity payload into the digest schema.
- `postDigest` sends the Chat SDK Card to Slack.

Keeping these separate makes Workflow retries and run inspection clearer: a GitHub
API failure retries only the GitHub step, while a Slack delivery failure retries
only the posting step.

## Project structure

| Path | Purpose |
| --- | --- |
| `app/api/cron/digest/route.ts` | Authenticated cron entry point that starts the workflow. |
| `app/api/webhooks/slack/route.ts` | Slack webhook route handled by the Chat SDK bot. |
| `lib/bot.ts` | Chat SDK bot wiring (Slack adapter + Redis state). |
| `lib/digest/workflow.ts` | Durable workflow definition. |
| `lib/digest/step.ts` | Workflow step that generates the digest with the AI SDK. |
| `lib/digest/sources.ts` | GitHub activity source via Vercel Connect. |
| `lib/digest/enrollment.ts` | Channel enrollment and digest configuration. |
| `lib/digest/card.tsx` | Chat SDK Card rendered into Slack. |
| `vercel.json` | Cron schedule. |

## Deploy

Push to a repository connected to Vercel, or run `pnpm dlx vercel --prod`. Set all
required environment variables on the project, ensure the Slack and GitHub
connectors are linked to the project/environment, and Vercel Cron will invoke the
digest on the configured schedule.
