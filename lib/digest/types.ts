import { z } from "zod";

export const DigestConfigSchema = z.object({
  tone: z.enum(["terse", "detailed"]).default("terse"),
  maxSections: z.number().int().positive().max(8).default(4),
  include: z
    .array(z.string())
    .default(["github-repositories", "github-issues"]),
});

export const DigestInputSchema = z.object({
  channelId: z.string().min(1),
  lookbackHours: z.number().int().positive().max(168).default(24),
  detailsUrl: z.url().optional(),
  config: DigestConfigSchema.default({
    tone: "terse",
    maxSections: 4,
    include: ["github-repositories", "github-issues"],
  }),
});

export const DigestChannelIdSchema = z.string().min(1);

export type DigestConfig = z.infer<typeof DigestConfigSchema>;
export type DigestInput = z.infer<typeof DigestInputSchema>;

export type GatherActivity = (input: DigestInput) => Promise<unknown>;

export const DigestSchema = z.object({
  headline: z.string().min(1),
  sections: z
    .array(
      z.object({
        label: z.string().min(1),
        body: z.string().min(1),
      }),
    )
    .min(1),
});

export type Digest = z.infer<typeof DigestSchema>;
