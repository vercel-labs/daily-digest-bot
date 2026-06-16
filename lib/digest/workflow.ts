import { fetchGitHubActivity, generateDigest, postDigest } from "./step";
import type { DigestInput } from "./types";

export async function runDailyDigest(channel: DigestInput) {
  "use workflow";

  try {
    const activity = await fetchGitHubActivity(channel);
    const digest = await generateDigest(channel, activity);

    await postDigest(channel, digest);

    return {
      posted: 1,
      failed: 0,
      channelId: channel.channelId,
    };
  } catch (error) {
    return {
      posted: 0,
      failed: 1,
      channelId: channel.channelId,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
