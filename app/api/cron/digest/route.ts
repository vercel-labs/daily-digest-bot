import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { loadDigestChannel } from "@/lib/digest/enrollment";
import { runDailyDigest } from "@/lib/digest/workflow";

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");

  if (
    !process.env.CRON_SECRET ||
    auth !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return new Response("Unauthorized", { status: 401 });
  }

  const channel = await loadDigestChannel();

  if (!channel) {
    return new Response("DIGEST_CHANNEL_ID is not configured", { status: 500 });
  }

  const run = await start(runDailyDigest, [channel]);

  return NextResponse.json({
    started: run.runId,
    channelId: channel.channelId,
  });
}
