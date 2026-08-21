import type { Metadata } from "next";
import { SupportHub } from "@/components/support-hub";
import { CMS_PREVIEW_QUERY_PARAM, resolvePageContent } from "@/lib/server/page-content";

export const metadata: Metadata = {
  title: "Support | HOODLUMS",
  description: "Report a problem to the HOODLUMS team.",
};

type SupportPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SupportPage({ searchParams }: SupportPageProps) {
  const { content } = await resolvePageContent("support", (await searchParams)?.[CMS_PREVIEW_QUERY_PARAM]);

  return (
    <SupportHub heroEyebrow={content.hero_eyebrow} heroTitle={content.hero_title} heroIntro={content.hero_intro} />
  );
}
