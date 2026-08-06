import { accountOverlayContentFromRecord } from "@/lib/account-overlay-content";
import { getPublishedPageContent } from "@/lib/server/page-content";
import { AccountOverlay } from "./account-overlay";
import styles from "./account-overlay.module.css";

export async function AccountOverlayShell() {
  const content = await getPublishedPageContent("account");

  return (
    <div className={styles.accountDock}>
      <AccountOverlay initialContent={accountOverlayContentFromRecord(content)} />
    </div>
  );
}
