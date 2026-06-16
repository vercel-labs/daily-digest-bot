import {
  DigestChannelIdSchema,
  type DigestConfig,
  type DigestInput,
} from "./types";

const DIGEST_LOOKBACK_HOURS = 24;
const DIGEST_DETAILS_URL = "https://vercel.com";

const DIGEST_CONFIG: DigestConfig = {
  tone: "terse",
  maxSections: 4,
  include: ["github-repositories", "github-issues"],
};

export async function loadDigestChannel(): Promise<DigestInput | null> {
  const raw = process.env.DIGEST_CHANNEL_ID;

  if (!raw) {
    return null;
  }

  const channelId = DigestChannelIdSchema.parse(raw);

  return {
    channelId,
    lookbackHours: DIGEST_LOOKBACK_HOURS,
    detailsUrl: DIGEST_DETAILS_URL,
    config: DIGEST_CONFIG,
  };
}
