import { Actions, Card, CardText, LinkButton, Section } from "chat";
import { getBot } from "@/lib/bot";
import type { Digest, DigestInput } from "./types";

export async function postDigestCard(input: DigestInput, digest: Digest) {
  const channel = getBot().channel(input.channelId);

  await channel.post(
    Card({
      title: digest.headline,
      children: [
        ...digest.sections.map((section) =>
          Section([
            CardText(`**${section.label}** ${section.body}`),
          ]),
        ),
        Actions([
          LinkButton({
            url: input.detailsUrl ?? "https://vercel.com",
            label: "View details",
          }),
        ]),
      ],
    }),
  );

  return {
    posted: true as const,
    channelId: input.channelId,
  };
}
