import { accountOverlayContentFromRecord } from "@/lib/account-overlay-content";
import { getPublishedPageContent } from "@/lib/server/page-content";
import { AccountOverlay } from "./account-overlay";

export async function AccountOverlayShell() {
  const content = await getPublishedPageContent("account");
  return <AccountOverlay initialContent={accountOverlayContentFromRecord(content)} />;
}
