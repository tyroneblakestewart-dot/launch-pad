import { sendText } from "@/lib/server/telegram";
import type { SupportTicket } from "@/lib/server/support-tickets-store";

// Best-effort owner notification on ticket creation (issue #393). Never
// throws — a Telegram outage, missing config, or invalid response must
// never fail, roll back, or materially delay ticket creation, matching the
// repository's existing best-effort post-send bookkeeping principle
// (see recordAdminActivityBestEffort). Never includes the ticket body.

function truncateWallet(walletAddress: string): string {
  if (walletAddress.length <= 10) return walletAddress;
  return `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`;
}

export function buildSupportTicketAlertText(ticket: Pick<SupportTicket, "id" | "category" | "subject" | "walletAddress">): string {
  return [
    "New support ticket",
    `Category: ${ticket.category}`,
    `Subject: ${ticket.subject}`,
    `Wallet: ${truncateWallet(ticket.walletAddress)}`,
    `Ticket: ${ticket.id}`,
  ].join("\n");
}

export async function sendSupportTicketTelegramAlertBestEffort(
  ticket: Pick<SupportTicket, "id" | "category" | "subject" | "walletAddress">,
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  try {
    const botToken = (env.TELEGRAM_BOT_TOKEN || "").trim();
    const chatId = (env.TELEGRAM_ADMIN_CHAT_ID || "").trim();
    if (!botToken || !chatId) return;

    await sendText(botToken, chatId, buildSupportTicketAlertText(ticket));
  } catch (error) {
    console.error("Support ticket Telegram alert failed; the ticket was still created.", error instanceof Error ? error.message : error);
  }
}
