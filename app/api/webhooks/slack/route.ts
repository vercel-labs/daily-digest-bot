import { after } from "next/server";
import { getBot } from "@/lib/bot";

export async function POST(request: Request) {
  return getBot().webhooks.slack(request, {
    waitUntil: (task) => after(() => task),
  });
}
