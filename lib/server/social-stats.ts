import { getSocialConnectionsStore } from "@/lib/server/social-connections-store";
import { getChatMemberCount } from "@/lib/server/telegram";
import { lookupTokenHolderStats } from "@/lib/server/token-holders";

// The Queue tab's private "How it's going" panel (owner decision, 6 Sep 2026:
// honest numbers only). Two figures can be read truthfully today and both are
// free: the token's holder count (the same cached Blockscout read the token
// page uses) and the member count of the wallet's connected Telegram channel
// (Bot API getChatMemberCount). X followers, views, reactions and replies
// need paid X API reads, and the Telegram Bot API cannot return post views,
// so they come back null and the panel says "not tracked yet" — never a
// made-up figure.

export type SocialStats = {
  holders: number | null;
  telegramMembers: number | null;
  xFollowers: null;
};

export type SocialStatsDeps = {
  readHolderCount?: (tokenAddress: string) => Promise<number | null>;
  readTelegramMembers?: (walletAddress: string) => Promise<number | null>;
  env?: Record<string, string | undefined>;
};

let depsForTests: SocialStatsDeps | null = null;

/** Test seam: inject readers instead of hitting Blockscout / Telegram. */
export function setSocialStatsDepsForTests(deps: SocialStatsDeps | null): void {
  depsForTests = deps;
}

async function defaultReadHolderCount(tokenAddress: string): Promise<number | null> {
  const stats = await lookupTokenHolderStats("robinhood", tokenAddress);
  return stats.supported ? stats.holderCount : null;
}

async function defaultReadTelegramMembers(walletAddress: string, env: Record<string, string | undefined>): Promise<number | null> {
  const botToken = (env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!botToken) return null;
  const credentials = await getSocialConnectionsStore().getCredentials(walletAddress, "telegram");
  if (credentials.status !== "ok") return null;
  let chatId = "";
  try {
    chatId = String((JSON.parse(credentials.plaintext) as { chatId?: unknown }).chatId ?? "");
  } catch {
    return null;
  }
  if (!chatId) return null;
  return getChatMemberCount(botToken, chatId);
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Each figure degrades to null on its own — a Blockscout hiccup never hides the Telegram count, and vice versa. Never throws. */
export async function getSocialStats(walletAddress: string, tokenAddress: string, deps: SocialStatsDeps = {}): Promise<SocialStats> {
  const merged = { ...depsForTests, ...deps };
  const env = merged.env ?? process.env;
  const readHolderCount = merged.readHolderCount ?? defaultReadHolderCount;
  const readTelegramMembers = merged.readTelegramMembers ?? ((wallet: string) => defaultReadTelegramMembers(wallet, env));

  const [holders, telegramMembers] = await Promise.all([
    tokenAddress ? readHolderCount(tokenAddress).catch(() => null) : Promise.resolve(null),
    readTelegramMembers(walletAddress).catch(() => null),
  ]);

  return { holders: finiteOrNull(holders), telegramMembers: finiteOrNull(telegramMembers), xFollowers: null };
}
