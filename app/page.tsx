export default function Home() {
  return (
    <main className="min-h-screen bg-background px-6 py-10 text-foreground sm:px-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10">
        <header className="flex flex-col gap-3 border-b border-black/10 pb-8 dark:border-white/10">
          <p className="font-mono text-sm uppercase tracking-normal text-zinc-500">
            Chat SDK + Vercel Workflow
          </p>
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight">
            Scheduled digest bot
          </h1>
          <p className="max-w-2xl text-base leading-7 text-zinc-600 dark:text-zinc-400">
            Vercel Cron starts a durable workflow. The workflow summarizes
            source activity with structured AI output and posts one Chat SDK
            Card to the configured channel.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          {[
            ["Cron route", "/api/cron/digest"],
            ["Slack webhook", "/api/webhooks/slack"],
            ["Schedule", "0 8 * * *"],
          ].map(([label, value]) => (
            <div
              className="rounded-lg border border-black/10 p-5 dark:border-white/10"
              key={label}
            >
              <p className="text-sm text-zinc-500">{label}</p>
              <p className="mt-2 font-mono text-sm">{value}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-6 md:grid-cols-2">
          <div>
            <h2 className="text-xl font-medium">Runtime flow</h2>
            <ol className="mt-4 space-y-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              <li>1. Vercel Cron calls the authenticated digest route.</li>
              <li>2. The route loads the configured channel and starts a workflow.</li>
              <li>3. The workflow runs one retryable channel-processing step.</li>
              <li>4. Each step gathers data, calls the model, and posts a card.</li>
            </ol>
          </div>
          <div>
            <h2 className="text-xl font-medium">Required environment</h2>
            <ul className="mt-4 space-y-3 font-mono text-sm text-zinc-600 dark:text-zinc-400">
              <li>CRON_SECRET</li>
              <li>DIGEST_CHANNEL_ID</li>
              <li>CONNECTOR_SLACK</li>
              <li>REDIS_URL</li>
            </ul>
          </div>
        </section>
      </div>
      </main>
  );
}
