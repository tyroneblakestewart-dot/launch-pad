import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSupportTicketAlertText, sendSupportTicketTelegramAlertBestEffort } from "@/lib/server/support-ticket-alert";

const TICKET = {
  id: "11111111-1111-1111-1111-111111111111",
  category: "payments" as const,
  subject: "Payment stuck for an hour",
  walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildSupportTicketAlertText", () => {
  it("includes category, subject, a truncated wallet and the ticket id — never the ticket body", () => {
    const text = buildSupportTicketAlertText(TICKET);
    expect(text).toContain("payments");
    expect(text).toContain("Payment stuck for an hour");
    expect(text).toContain(TICKET.id);
    expect(text).toContain("0x1234…5678");
    expect(text).not.toContain(TICKET.walletAddress);
  });
});

describe("sendSupportTicketTelegramAlertBestEffort", () => {
  it("silently skips when TELEGRAM_ADMIN_CHAT_ID is unset, never calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await sendSupportTicketTelegramAlertBestEffort(TICKET, { TELEGRAM_BOT_TOKEN: "12345:token-aaaaaaaaaaaaaaaaaaaa" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("silently skips when TELEGRAM_BOT_TOKEN is unset, never calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await sendSupportTicketTelegramAlertBestEffort(TICKET, { TELEGRAM_ADMIN_CHAT_ID: "-100123" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends one Telegram message when both env vars are configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { message_id: 1 } })));
    vi.stubGlobal("fetch", fetchMock);
    await sendSupportTicketTelegramAlertBestEffort(TICKET, {
      TELEGRAM_BOT_TOKEN: "12345:token-aaaaaaaaaaaaaaaaaaaa",
      TELEGRAM_ADMIN_CHAT_ID: "-100123",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { chat_id: string; text: string };
    expect(body.chat_id).toBe("-100123");
    expect(body.text).not.toContain("undefined");
  });

  it("never throws when the Telegram call fails — ticket creation must not be affected", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network exploded"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      sendSupportTicketTelegramAlertBestEffort(TICKET, {
        TELEGRAM_BOT_TOKEN: "12345:token-aaaaaaaaaaaaaaaaaaaa",
        TELEGRAM_ADMIN_CHAT_ID: "-100123",
      }),
    ).resolves.toBeUndefined();
  });

  it("never throws when Telegram returns a non-ok response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, description: "bad request" }), { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      sendSupportTicketTelegramAlertBestEffort(TICKET, {
        TELEGRAM_BOT_TOKEN: "12345:token-aaaaaaaaaaaaaaaaaaaa",
        TELEGRAM_ADMIN_CHAT_ID: "-100123",
      }),
    ).resolves.toBeUndefined();
  });
});
