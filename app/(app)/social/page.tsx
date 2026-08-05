import type { Metadata } from "next";
import { SocialHub } from "@/components/social-hub";
import { CMS_PREVIEW_QUERY_PARAM, resolvePageContent } from "@/lib/server/page-content";

export const metadata: Metadata = {
  title: "Social Hub | Private Meme Token Studio",
  description:
    "Prepare, approve and publish token-project announcements to X and Telegram.",
};

type SocialPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SocialPage({ searchParams }: SocialPageProps) {
  const { content } = await resolvePageContent(
    "social",
    (await searchParams)?.[CMS_PREVIEW_QUERY_PARAM],
  );

  return (
    <SocialHub
      headerEyebrow={content.header_eyebrow}
      headerTitle={content.header_title}
      headerIntro={content.header_intro}
    />
  );
}
