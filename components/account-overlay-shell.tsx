import { getPublishedPageContent } from "@/lib/server/page-content";
import {
  AccountOverlay,
  type AccountOverlayContent,
} from "./account-overlay";

export function accountOverlayContentFromRecord(
  content: Record<string, string>,
): AccountOverlayContent {
  return {
    header_eyebrow: content.header_eyebrow || "ACCOUNT",
    header_title: content.header_title || "Choose how you sign in.",
    header_intro: content.header_intro || "",
    web_accounts_title: content.web_accounts_title || "Continue with",
    web_accounts_subtitle: content.web_accounts_subtitle || "Web accounts",
    google_note: content.google_note || "Email and project sync",
    github_note: content.github_note || "Developer account",
    x_note: content.x_note || "Social identity",
    wallet_title: content.wallet_title || "Connect a wallet",
    wallet_subtitle: content.wallet_subtitle || "Web3 accounts",
    metamask_note: content.metamask_note || "EVM wallet",
    rabby_note: content.rabby_note || "EVM wallet",
    phantom_note: content.phantom_note || "Solana and EVM wallet",
    footer_copy: content.footer_copy || "",
  };
}

export async function AccountOverlayShell() {
  const content = await getPublishedPageContent("account");
  return <AccountOverlay initialContent={accountOverlayContentFromRecord(content)} />;
}
