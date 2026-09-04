import type { Metadata } from "next";
import { AccountOverlayShell } from "@/components/account-overlay-shell";
import { HoodchatHub } from "@/components/hoodchat-hub";
import { CMS_PREVIEW_QUERY_PARAM, resolvePageContent } from "@/lib/server/page-content";

export const metadata: Metadata = {
  title: "Hoodchat | HOODLUMS",
  description: "Live community chat for HOODLUMS launches, trading and projects.",
};

type HoodchatPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function HoodchatPage({ searchParams }: HoodchatPageProps) {
  const { content } = await resolvePageContent("hoodchat", (await searchParams)?.[CMS_PREVIEW_QUERY_PARAM]);

  return (
    <>
      <AccountOverlayShell />
      <HoodchatHub
        heroIntro={content.hero_intro}
        emptyState={content.empty_state}
        composerPlaceholder={content.composer_placeholder}
        connectPrompt={content.connect_prompt}
      />
    </>
  );
}
