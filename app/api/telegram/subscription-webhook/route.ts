import { NextResponse } from "next/server";
import {
  handleSubscriptionTelegramUpdate,
  isTelegramWebhookAuthorised,
  type TelegramWebhookUpdate,
} from "@/lib/server/subscription-telegram";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isTelegramWebhookAuthorised(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let update: TelegramWebhookUpdate;
  try {
    update = (await request.json()) as TelegramWebhookUpdate;
  } catch {
    return NextResponse.json({ error: "Invalid Telegram update." }, { status: 400 });
  }

  const result = await handleSubscriptionTelegramUpdate(update);
  return NextResponse.json({ ok: true, ...result }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
