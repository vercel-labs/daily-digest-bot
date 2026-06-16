import { createSlackAdapter } from "@chat-adapter/slack";
import { createRedisState } from "@chat-adapter/state-redis";
import { getToken } from "@vercel/connect";
import { Chat } from "chat";

let bot: Chat | null = null;

function getSlackBotToken() {
  const connector = process.env.CONNECTOR_SLACK;

  if (!connector) {
    throw new Error(
      "CONNECTOR_SLACK is required. Use the Vercel Connect connector id, such as slack/acme-slack.",
    );
  }

  return getToken(connector, { subject: { type: "app" } });
}

function verifyConnectForwardedSlackRequest() {
  // Vercel Connect verifies Slack events before forwarding them to this app.
  // Chat SDK's Slack adapter still requires a verifier in webhook mode.
  return true;
}

export function getBot() {
  if (!bot) {
    bot = new Chat({
      userName: process.env.BOT_USER_NAME ?? "digest-bot",
      adapters: {
        slack: createSlackAdapter({
          botToken: getSlackBotToken,
          webhookVerifier: verifyConnectForwardedSlackRequest,
        }),
      },
      state: createRedisState(),
      dedupeTtlMs: 600_000,
    }).registerSingleton();
  }

  return bot;
}
