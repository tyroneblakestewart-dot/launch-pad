import { accountOverlayContentFromRecord } from "@/lib/account-overlay-content";
import { getPublishedPageContent } from "@/lib/server/page-content";
import { AccountOverlay } from "./account-overlay";
import { SubscriptionLifecycleBanner } from "./subscription-lifecycle-banner";
import styles from "./account-overlay.module.css";

export async function AccountOverlayShell() {
  const content = await getPublishedPageContent("account");

  return (
    <>
      <SubscriptionLifecycleBanner />
      <div className={styles.accountDock}>
        <AccountOverlay initialContent={accountOverlayContentFromRecord(content)} />
      </div>
    </>
  );
}
