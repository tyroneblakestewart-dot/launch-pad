import type { Metadata, Viewport } from "next";
import { HoodchatHub } from "@/components/hoodchat-hub";
import { CMS_PREVIEW_QUERY_PARAM, resolvePageContent } from "@/lib/server/page-content";

export const metadata: Metadata = {
  title: "Hoodchat | HOODLUMS",
  description: "Live community chat for HOODLUMS launches, trading and projects.",
};

// maximumScale locks pinch-zoom on this page, which also removes Safari's
// ~300ms tap-delay disambiguation on the composer's Send button and the
// category filter tabs (touch-action: manipulation alone wasn't enough).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#030805",
};

type HoodchatPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function HoodchatPage({ searchParams }: HoodchatPageProps) {
  const { content } = await resolvePageContent("hoodchat", (await searchParams)?.[CMS_PREVIEW_QUERY_PARAM]);

  return (
    <HoodchatHub
      heroEyebrow={content.hero_eyebrow}
      heroTitle={content.hero_title}
      heroIntro={content.hero_intro}
      emptyState={content.empty_state}
      composerPlaceholder={content.composer_placeholder}
      connectPrompt={content.connect_prompt}
    />
  );
}
