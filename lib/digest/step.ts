import { generateText, Output } from "ai";
import { postDigestCard } from "./card";
import { buildPrompt } from "./prompt";
import { gatherProjectActivity } from "./sources";
import { DigestSchema, type Digest, type DigestInput } from "./types";

export async function fetchGitHubActivity(input: DigestInput) {
  "use step";

  return gatherProjectActivity(input);
}

fetchGitHubActivity.maxRetries = 3;

export async function generateDigest(input: DigestInput, activity: unknown) {
  "use step";

  const { output } = await generateText({
    model: process.env.DIGEST_MODEL ?? "anthropic/claude-haiku-4.5",
    output: Output.object({
      schema: DigestSchema,
      name: "daily_digest",
      description: "A concise channel digest with headline and sections.",
    }),
    prompt: buildPrompt(activity, input.config),
  });

  return output;
}

generateDigest.maxRetries = 2;

export async function postDigest(input: DigestInput, digest: Digest) {
  "use step";

  return postDigestCard(input, digest);
}

postDigest.maxRetries = 3;
