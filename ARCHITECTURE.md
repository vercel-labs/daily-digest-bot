# ARCHITECTURE.md

A map of the scheduled digest bot for both humans and AI agents. Keep it current
as the system changes.

- **Name:** scheduled-digest-bot
- **Maintainer:** — (not specified)
- **License:** none declared (`package.json` is marked `private`)
- **Last updated:** 2026-06-17

## Overview

A scheduled bot that posts a daily activity digest to Slack. Vercel Cron invokes
an authenticated route on a schedule; the route starts a durable Vercel Workflow
that gathers GitHub activity through Vercel Connect, summarizes it into a
structured digest with the AI SDK (routed via the Vercel AI Gateway), and
delivers it as a Chat SDK Card to a configured Slack channel. Chat SDK state and
message de-duplication live in Redis. There is no application database.

```
Vercel Cron ──► /api/cron/digest ──► Workflow (runDailyDigest)
                                       ├─ fetchGitHubActivity  (Vercel Connect → GitHub REST + GraphQL)
                                       ├─ generateDigest       (AI SDK structured output)
                                       └─ postDigest           (Chat SDK Card → Slack)
```

## Project structure

```text
app/
  api/
    cron/digest/route.ts      Authenticated cron entry point; starts the workflow
    webhooks/slack/route.ts   Slack webhook route handled by the Chat SDK bot
  layout.tsx                  Root layout
  page.tsx                    Operator overview page (routes, schedule, env)
  globals.css                 Tailwind styles
lib/
  bot.ts                      Chat SDK bot wiring (Slack adapter + Redis state)
  digest/
    workflow.ts               Durable workflow definition ("use workflow")
    step.ts                   Workflow steps ("use step") with retry counts
    sources.ts                GitHub activity source via Vercel Connect
    enrollment.ts             Channel enrollment and digest configuration
    prompt.ts                 Prompt builder for the digest model
    card.tsx                  Chat SDK Card rendered into Slack
    types.ts                  Zod schemas and inferred types
vercel.json                   Cron schedule
next.config.ts                Next config wrapped with withWorkflow()
```

## Core components

| Component     | Location                          | Primitive                 | Responsibility                                                                                                                                                                                      |
| ------------- | --------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cron route    | `app/api/cron/digest/route.ts`    | Next.js route handler     | Authenticates against `CRON_SECRET`, loads the channel, and starts the workflow with `start()`.                                                                                                     |
| Slack webhook | `app/api/webhooks/slack/route.ts` | Next.js route handler     | Delegates inbound Slack events to the Chat SDK bot.                                                                                                                                                 |
| Workflow      | `lib/digest/workflow.ts`          | `"use workflow"` function | Orchestrates the three steps and returns a posted/failed summary.                                                                                                                                   |
| Steps         | `lib/digest/step.ts`              | `"use step"` functions    | `fetchGitHubActivity`, `generateDigest`, `postDigest`, each with `maxRetries`.                                                                                                                      |
| Source        | `lib/digest/sources.ts`           | Data fetcher              | Discovers repositories and issue activity via the GitHub REST + GraphQL APIs using a Connect token; counts totals across up to 1,000 active repos and limits per-repo issue detail to the first 25. |
| Enrollment    | `lib/digest/enrollment.ts`        | Config loader             | Expands `DIGEST_CHANNEL_ID` into a `DigestInput` (lookback, details URL, tone, sections, sources).                                                                                                  |
| Prompt        | `lib/digest/prompt.ts`            | Prompt builder            | Turns the activity payload + config into the model prompt.                                                                                                                                          |
| Card          | `lib/digest/card.tsx`             | Chat SDK view             | Renders the digest as a Card (sections + a "View details" link) and posts it.                                                                                                                       |
| Types         | `lib/digest/types.ts`             | Zod schemas               | `DigestConfigSchema`, `DigestInputSchema`, `DigestSchema` and inferred types.                                                                                                                       |
| Bot           | `lib/bot.ts`                      | Chat SDK singleton        | Wires the Slack adapter (Connect-issued token) and Redis state.                                                                                                                                     |

## Data stores

- **Redis** — Chat SDK state and message de-duplication (`createRedisState()` in
  `lib/bot.ts`, `dedupeTtlMs: 600_000`). Connection string from `REDIS_URL`.
- **No application database.** Digest input is derived from environment
  configuration at request time; nothing is persisted beyond Chat SDK's Redis
  state.

## External integrations

| Integration       | How it's used                                                                                                              | Auth                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Slack             | Posting digest Cards and receiving webhook events via the Chat SDK Slack adapter.                                          | Connect connector `CONNECTOR_SLACK`; short-lived bot token from `getToken()`.                            |
| GitHub            | Repository discovery, open-issue counts, and recent issue details via REST + GraphQL (`X-GitHub-Api-Version: 2022-11-28`). | Connect connector `CONNECTOR_GITHUB`; short-lived token from `getToken()`.                               |
| Vercel AI Gateway | Structured digest generation with the AI SDK (`generateText` + `Output.object`).                                           | `provider/model` string (`DIGEST_MODEL`, default `anthropic/claude-haiku-4.5`); no provider key in code. |
| Vercel Workflow   | Durable, retryable orchestration of the digest steps.                                                                      | Configured via `withWorkflow()` in `next.config.ts`.                                                     |
| Vercel Cron       | Scheduled invocation of the digest route.                                                                                  | `vercel.json` schedule; `Authorization: Bearer $CRON_SECRET`.                                            |

## Deployment & infrastructure

- **Platform:** Vercel. `next.config.ts` wraps the Next config with
  `withWorkflow()` and declares `serverExternalPackages` for the Slack/Redis
  adapters.
- **Schedule:** `vercel.json` runs `/api/cron/digest` daily at `0 8 * * *`
  (08:00 UTC).
- **Connectors:** Slack and GitHub connectors are created in Vercel Connect and
  linked to the project/environment; their ids populate `CONNECTOR_SLACK` and
  `CONNECTOR_GITHUB`.
- **Environment:** `CRON_SECRET`, `DIGEST_CHANNEL_ID`, `CONNECTOR_SLACK`,
  `CONNECTOR_GITHUB`, and `REDIS_URL` are required; `DIGEST_MODEL` and
  `BOT_USER_NAME` are optional. See `.env.example`.
- **Local development:** `vercel link`, then `vercel env pull` for a valid OIDC
  token, then `pnpm dev`. `vercel dev` refreshes the token automatically.

## Security considerations

- **Inbound auth.** The cron route fails closed — 401 unless `CRON_SECRET` is set
  and the bearer header matches. Vercel Cron sends this header automatically when
  `CRON_SECRET` is configured. Slack events are verified by Vercel Connect before
  forwarding; `lib/bot.ts` delegates webhook verification to Connect.
- **Outbound auth.** Slack and GitHub calls use short-lived tokens issued by
  Vercel Connect (`getToken`), avoiding long-lived static keys.
- **Input hardening.** External shapes are parsed through zod; `sources.ts`
  rejects malformed `owner/repo` names with `FatalError` and classifies GitHub
  rate limits / 5xx as `RetryableError`.
- **Secrets.** Provided only through environment variables; `.env.example` holds
  placeholders, never real values.

## Development & testing

- **Runtime:** Next.js 16 (App Router), React 19, Node.js 20+.
- **Type checking:** `pnpm exec tsc --noEmit` (TypeScript strict; `noEmit`).
- **Lint/format:** `pnpm lint` via `eslint-config-next`.
- **Workflow inspection:** `pnpm exec workflow web` opens the local Workflow
  dashboard. No automated test suite; verify by triggering the cron route.

## Future considerations

- Replace `lib/digest/sources.ts` to digest other sources (pull requests, Linear
  issues, support tickets, database rows).
- Support multiple enrolled channels rather than a single `DIGEST_CHANNEL_ID`.
- Make lookback, tone, and section limits configurable per channel instead of via
  the constants in `lib/digest/enrollment.ts`.

---

## Glossary

- **Vercel Workflow** — Durable execution engine; functions marked
  `"use workflow"` orchestrate `"use step"` functions that retry independently.
- **Step** — A retryable unit of work within a workflow (`maxRetries`,
  `FatalError`, `RetryableError`).
- **Chat SDK** — The `chat` package; provides the `Chat` bot, channel posting,
  and Card view primitives (`Card`, `Section`, `CardText`, `Actions`,
  `LinkButton`).
- **Adapter** — A Chat SDK integration for a platform (the Slack adapter) plus a
  state adapter (Redis).
- **Connector** — A configured Vercel Connect integration identified as
  `<provider>/<name>` (e.g. `slack/acme-slack`).
- **Vercel Connect** — Issues short-lived, scoped tokens for third-party
  providers from a connector id, authenticated by a Vercel OIDC token.
- **AI Gateway** — Vercel's unified model endpoint; models are addressed as
  `provider/model` strings.
- **OIDC** — The Vercel-issued identity token that authenticates Connect token
  requests locally and in deployment.
