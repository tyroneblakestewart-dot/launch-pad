import type { Metadata } from "next";
import { AccountOverlayShell } from "@/components/account-overlay-shell";
import { SocialHub } from "@/components/social-hub";
import { SubscriptionAccessGate } from "@/components/subscription-access-gate";

export const metadata: Metadata = {
  title: "AI Social Studio",
  description:
    "Prepare once. Review every destination. Publish to X and Telegram from Hoodlums Social.",
};

export default function SocialPage() {
  return (
    <>
      <AccountOverlayShell />
      <SubscriptionAccessGate>
        <SocialHub />
      </SubscriptionAccessGate>
    </>
  );
}
