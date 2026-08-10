import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getAdminAccountSection,
  getAdminAccountSummary,
  searchAdminAccounts,
  type AdminAccountsQuery,
} from "@/lib/server/admin-accounts";

const ROOT = process.cwd();
const WALLET = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";

async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

describe("Admin Accounts support records", () => {
  it("searches a complete wallet address with server-side pagination", async () => {
    const calls: Array<{ text: string; params?: unknown[] }> = [];
    const query = (async (text: string, params?: unknown[]) => {
      calls.push({ text, params });
      return {
        rows: [{
          wallet_address: WALLET,
          telegram_username: "hoodsupport",
          tier: "pro",
          paid_until: "2026-09-30T00:00:00.000Z",
          expires_at: null,
          payment_count: "3",
          site_count: "2",
          total_count: "1",
        }],
      };
    }) as AdminAccountsQuery;

    const result = await searchAdminAccounts(
      { query: `0x${WALLET.slice(2).toUpperCase()}`, page: 1, pageSize: 20 },
      { query, now: new Date("2026-08-10T00:00:00.000Z") },
    );

    expect(result).toMatchObject({ total: 1, page: 1, pageSize: 20 });
    expect(result.items[0]).toMatchObject({
      walletAddress: WALLET,
      telegramUsername: "@hoodsupport",
      status: "active",
      paymentCount: 3,
      siteCount: 2,
    });
    expect(calls[0].text).toContain("candidate_wallets");
    expect(calls[0].text).toContain("LIMIT $2 OFFSET $3");
    expect(calls[0].params).toHaveLength(3);
  });

  it("assembles account entitlement and support counts from existing records", async () => {
    const query = (async (text: string) => {
      if (text.includes("reported_message_count")) {
        return {
          rows: [{
            has_subscription: true,
            tier: "pro_bundle",
            paid_from: "2026-08-01T00:00:00.000Z",
            paid_until: "2026-11-05T00:00:00.000Z",
            expires_at: null,
            last_payment_asset: "USDG",
            last_payment_amount: "288",
            amount_eth: null,
            telegram_user_id: "123",
            telegram_chat_id: "456",
            telegram_username: "crewmember",
            telegram_linked_at: "2026-08-02T00:00:00.000Z",
            payment_count: "2",
            reminder_count: "1",
            token_count: "3",
            site_count: "4",
            hoodchat_count: "7",
            token_chat_count: "5",
            reported_message_count: "2",
            reports_against: "4",
            hidden_message_count: "1",
          }],
        };
      }

      return {
        rows: [{
          wallet_address: WALLET,
          tier: "pro_bundle",
          paid_from: "2026-08-01T00:00:00.000Z",
          paid_until: "2026-11-05T00:00:00.000Z",
          expires_at: null,
          telegram_chat_id: "456",
        }],
      };
    }) as AdminAccountsQuery;

    const summary = await getAdminAccountSummary(WALLET, {
      query,
      now: new Date("2026-08-10T00:00:00.000Z"),
    });

    expect(summary.exists).toBe(true);
    expect(summary.subscription).toMatchObject({
      plan: "pro-bundle",
      active: true,
      lastPaymentAsset: "USDG",
    });
    expect(summary.telegram).toMatchObject({ linked: true, username: "@crewmember" });
    expect(summary.counts).toEqual({
      payments: 2,
      reminders: 1,
      tokensLaunched: 3,
      sitesPublished: 4,
      hoodchatMessages: 7,
      tokenChatMessages: 5,
      reportedMessages: 2,
      reportsAgainst: 4,
      hiddenMessages: 1,
    });
  });

  it("returns paginated payment history with the transaction hash", async () => {
    const query = (async () => ({
      rows: [{
        payment_tx_hash: "0xpayment",
        plan_id: "pro",
        tier: "pro",
        billing_period: "monthly",
        asset_symbol: "USDG",
        amount_display: "50",
        amount_eth: null,
        amount_usd_cents: 5_000,
        paid_from: "2026-08-01T00:00:00.000Z",
        paid_until: "2026-09-02T00:00:00.000Z",
        chain_id: 4663,
        block_number: 123,
        confirmed_at: "2026-08-01T00:00:00.000Z",
        total_count: 1,
      }],
    })) as AdminAccountsQuery;

    const page = await getAdminAccountSection(
      WALLET,
      "payments",
      { page: 1, pageSize: 20 },
      { query },
    );

    expect(page).toMatchObject({ section: "payments", total: 1, totalPages: 1 });
    expect(page.items[0]).toMatchObject({
      kind: "payment",
      transactionHash: "0xpayment",
      detail: "50 USDG · $50.00",
    });
  });

  it("adds only lookup indexes and no support logging table", async () => {
    const migration = await source("db", "migrations", "012_admin_account_lookup_indexes.sql");
    const server = await source("lib", "server", "admin-accounts.ts");

    expect(migration).toContain("CREATE INDEX IF NOT EXISTS");
    expect(migration).not.toContain("CREATE TABLE");
    expect(migration).not.toContain("INSERT INTO");
    expect(server).toContain("plan_payment_events");
    expect(server).toContain("subscription_reminder_events");
    expect(server).toContain("published_sites");
    expect(server).toContain("hoodchat_messages");
    expect(server).toContain("token_chat_messages");
    expect(server).not.toContain("INSERT INTO");
  });
});
