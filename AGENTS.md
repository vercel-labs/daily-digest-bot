<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

# AGENTS.md

Guidance for AI coding agents working in this repository. See `ARCHITECTURE.md`
for the system map.

## Project overview

A scheduled digest bot. Vercel Cron calls `/api/cron/digest`, the route starts a
durable Vercel Workflow, and the workflow processes one configured channel in
retryable steps: it gathers GitHub activity through Vercel Connect, summarizes it
into a structured digest with the AI SDK, and posts a Chat SDK Card to Slack. The
cron entry point and Slack webhook live under `app/api/`; all digest logic lives
under `lib/`.

## Setup & commands

```bash
pnpm install            # install dependencies
vercel link             # link the project (Vercel Connect + OIDC need it)
vercel env pull         # pull managed env + a fresh OIDC token for Connect
pnpm dev                # dev server at http://localhost:3000
pnpm build              # production build
pnpm lint               # ESLint (eslint-config-next)
pnpm exec tsc --noEmit  # type-check (tsconfig sets noEmit; no dedicated script)
pnpm exec workflow web  # local Workflow dashboard for inspecting runs
vercel --prod           # deploy to production
```

No unit-test suite. Verify a change by running the dev server and triggering the
cron route, which fails closed without a valid secret:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/digest
```

## Next.js & Workflow conventions

- Read the docs in `node_modules/next/dist/docs/` before writing route or config
  code — this is Next.js 16.
- The workflow function in `lib/digest/workflow.ts` is marked `"use workflow"`;
  each step in `lib/digest/step.ts` is marked `"use step"` and sets `maxRetries`.
- Keep source fetching, generation, and Slack delivery in separate steps so a
  failure retries only that step.
- Throw `FatalError` from `workflow` for unrecoverable conditions and
  `RetryableError` (with `retryAfter`) for transient ones, as in
  `lib/digest/sources.ts`.
- Zod schemas in `lib/digest/types.ts` are the contract; the AI SDK
  `Output.object` call validates model output against `DigestSchema`.
- Tokens come from `getToken()` in `@vercel/connect` via the `CONNECTOR_SLACK` /
  `CONNECTOR_GITHUB` ids — never long-lived bot tokens or PATs.
- Change digest behavior in `lib/digest/enrollment.ts`, swap the data source in
  `lib/digest/sources.ts`, and adjust the Slack card in `lib/digest/card.tsx`.

## Code style

- TypeScript strict, ESM with `moduleResolution: bundler`; relative imports take
  no `.js` extension. Use the `@/*` alias for absolute imports from the root.
- Validate external input with zod through the schemas in `types.ts`.
- Models are `provider/model` strings (default `anthropic/claude-haiku-4.5`)
  routed through the Vercel AI Gateway — no provider key in code.
- Lint and format with `pnpm lint` (`eslint-config-next`).

## Security

- Never request or commit credentials; `.env*` is gitignored and `.env.example`
  holds placeholders only.
- The cron route returns 401 unless `CRON_SECRET` is set and the
  `Authorization: Bearer …` header matches — keep this check intact.
- Slack events are verified by Vercel Connect before forwarding; `lib/bot.ts`
  delegates verification accordingly. Restore real signature verification if you
  accept Slack webhooks directly.
- Prefer short-lived Vercel Connect tokens (`getToken`) for outbound API auth.

## Before committing

- `pnpm exec tsc --noEmit` reports no type errors.
- `pnpm lint` passes.
- `pnpm build` succeeds.
- No secrets, `.env.local`, or build output (`.next/`) are staged.
