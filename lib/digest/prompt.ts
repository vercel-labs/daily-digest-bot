import type { DigestConfig } from "./types";

export function buildPrompt(activity: unknown, config: DigestConfig) {
  return [
    `Write a ${config.tone} daily GitHub issues digest.`,
    `Return at most ${config.maxSections} sections.`,
    `Only include these source areas: ${config.include.join(", ")}.`,
    "Include the total number of public repositories and private repositories.",
    "Include the total number of open issues in public repositories and private repositories.",
    "If repository totals may be limited by the fetch cap, call that out briefly.",
    "Highlight newly opened issues, affected repositories, owners, labels, and notable themes.",
    "If there are no recently opened issues, still summarize the repository and open issue totals.",
    "Use clear labels and concise bodies.",
    "Return a headline and sections that match the requested schema.",
    JSON.stringify(activity, null, 2),
  ].join("\n\n");
}
