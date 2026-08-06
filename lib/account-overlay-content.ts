export type AccountOverlayContent = {
  header_eyebrow: string;
  header_title: string;
  header_intro: string;
  web_accounts_title: string;
  web_accounts_subtitle: string;
  google_note: string;
  github_note: string;
  x_note: string;
  wallet_title: string;
  wallet_subtitle: string;
  metamask_note: string;
  rabby_note: string;
  phantom_note: string;
  footer_copy: string;
};

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
