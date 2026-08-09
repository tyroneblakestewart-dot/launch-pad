import type { Metadata } from "next";
import { SocialHub } from "@/components/social-hub";

export const metadata: Metadata = {
  title: "AI Social Studio",
  description:
    "Prepare once. Review every destination. Publish to X and Telegram from Hoodlums Social.",
};

export default function SocialPage() {
  return <SocialHub />;
}
