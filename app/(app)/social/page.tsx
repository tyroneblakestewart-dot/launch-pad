import type { Metadata } from "next";
import { SocialHub } from "@/components/social-hub";

export const metadata: Metadata = {
  title: "Social Hub | Private Meme Token Studio",
  description:
    "Prepare, approve and publish token-project announcements to X and Telegram.",
};

export default function SocialPage() {
  return <SocialHub />;
}
